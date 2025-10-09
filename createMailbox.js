require('dotenv').config();

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const puppeteer = require('puppeteer');
puppeteerExtra.use(StealthPlugin());

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/create-mailbox', async (req, res) => {
  console.log('Received POST data:', req.body);
  const { firstName, lastName, requestedBy } = req.body;

  if (!firstName || !lastName || !requestedBy) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const freelancer = { firstName, lastName, createdBy: 'Elunic', requestedBy };

  try {
    const result = await createMailbox(freelancer);
    return res.json(result);
  } catch (err) {
    console.error('Mailbox creation failed:', err);
    return res.status(500).json({
      error: 'Mailbox creation failed',
      detail: err.message,
    });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

/* ---------------------------------------------------------
   Main mailbox creation logic
--------------------------------------------------------- */
async function createMailbox(freelancer) {
  const browser = await puppeteerExtra.launch({
    headless: false,
    slowMo: 75,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();
  await page.setDefaultTimeout(90000);

  /* ---------------------- Utilities ---------------------- */
  async function retry(page, fn, retries = 3, delay = 2000) {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (err) {
        console.warn(`Attempt ${i + 1} failed: ${err.message}`);
        if (i < retries - 1) {
          await page.waitForTimeout(delay);
          await page.reload({ waitUntil: 'networkidle2' }).catch(() => {});
        } else {
          throw err;
        }
      }
    }
  }

  function generatePassword() {
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '0123456789';
    const specials = '!$%()=?+#-.:~*@[]_';
    const all = lower + upper + digits + specials;
    let pass = '';
    pass += lower[Math.floor(Math.random() * lower.length)];
    pass += upper[Math.floor(Math.random() * upper.length)];
    pass += Math.random() < 0.5
      ? digits[Math.floor(Math.random() * digits.length)]
      : specials[Math.floor(Math.random() * specials.length)];
    while (pass.length < 12)
      pass += all[Math.floor(Math.random() * all.length)];
    return pass;
  }

  /* ---------------------- Login ---------------------- */
  console.log('Navigating to Hetzner KonsoleH login...');
  await page.goto('https://konsoleh.hetzner.com', { waitUntil: 'networkidle2' });

  // Handle Cloudflare "Checking if you’re a robot" page
  try {
    console.log('Checking for Cloudflare bot check...');
    await page.waitForFunction(
      () => !document.body.innerText.includes("Checking if you're a robot"),
      { timeout: 60000 }
    );
    console.log('Cloudflare check cleared.');
  } catch {
    console.log('No Cloudflare check detected or it cleared immediately.');
  }

  // Handle cookie banner if present
  try {
    await page.waitForSelector('button#onetrust-accept-btn-handler', { timeout: 5000 });
    await page.click('button#onetrust-accept-btn-handler');
    console.log('Cookie banner dismissed.');
  } catch (e) {}

  // Detect login type (KonsoleH direct vs Accounts)
  await page.waitForFunction(() => {
    return (
      document.querySelector('input[name="login_user"]') ||
      document.querySelector('#_username')
    );
  }, { timeout: 90000 });

  if (await page.$('input[name="login_user"]')) {
    console.log('Detected KonsoleH login page.');
    await page.type('input[name="login_user"]', process.env.HETZNER_EMAIL);
    await page.type('input[name="login_pass"]', process.env.HETZNER_PASSWORD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('input[type="submit"]'),
    ]);
  } else {
    console.log('Detected Accounts.hetzner.com login page.');
    await page.type('#_username', process.env.HETZNER_EMAIL);
    await page.type('#_password', process.env.HETZNER_PASSWORD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('#submit-login'),
    ]);
  }

  console.log('Logged in successfully.');

  /* ---------------------- Force redirect to console ---------------------- */
  console.log('Ensuring we are inside KonsoleH console...');
  await page.goto('https://konsoleh.hetzner.com/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('body', { timeout: 30000 });
  console.log('Confirmed console loaded.');

  /* ---------------------- Navigate to elunic.net ---------------------- */
  await retry(page, async () => {
    console.log('Looking for dedi2093.your-server.de...');
    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll('*')).some(el =>
        el.textContent.includes('dedi2093.your-server.de')
      );
    }, { timeout: 45000 });

    console.log('Expanding dedi2093.your-server.de...');
    await page.evaluate(() => {
      const server = Array.from(document.querySelectorAll('*'))
        .find(el => el.textContent.includes('dedi2093.your-server.de'));
      if (server) {
        const expand = server.closest('tr, div')?.querySelector('button, .toggle, .expand');
        if (expand) expand.click();
      }
    });

    await page.waitForTimeout(3000);

    console.log('Selecting elunic.net...');
    const elunicDomain = await page.evaluate(() => {
      const domainRow = Array.from(document.querySelectorAll('a[href*="?domain_number="], [data-bs-title]'))
        .find(el => el.innerText.trim().toLowerCase().includes('elunic.net'));
      return domainRow
        ? domainRow.closest('a')?.href || domainRow.closest('[href]')?.href
        : null;
    });

    if (elunicDomain) {
      console.log('Found elunic.net domain link:', elunicDomain);
      await page.goto(elunicDomain, { waitUntil: 'networkidle2' });
      console.log('Navigated directly to elunic.net domain page.');
    } else {
      throw new Error('elunic.net domain link not found on page.');
    }

    /* ---------------------- Open Email → Mailboxes ---------------------- */
    console.log('Opening Email sidebar...');
    await page.waitForSelector('button[data-bs-target="#flush-collapse-email"]', { timeout: 20000 });
    await page.evaluate(() => {
      const emailButton = document.querySelector('button[data-bs-target="#flush-collapse-email"]');
      if (emailButton && emailButton.getAttribute('aria-expanded') === 'false') {
        emailButton.click();
      }
    });

    console.log('Clicking Mailboxes link...');
    await page.waitForSelector('#mailbox a[href="/mail/mailbox/list"]', { timeout: 20000 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('#mailbox a[href="/mail/mailbox/list"]'),
    ]);

    console.log('Mailboxes page loaded.');
  });

  /* ---------------------- Create Mailbox ---------------------- */
  await retry(page, async () => {
    console.log('Clicking New Mailbox...');
    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll('a, button')).some(el =>
        el.textContent.trim().includes('New mailbox')
      );
    }, { timeout: 20000 });

    await page.evaluate(() => {
      const newBtn = Array.from(document.querySelectorAll('a, button')).find(el =>
        el.textContent.trim().includes('New mailbox')
      );
      if (newBtn) newBtn.click();
    });

    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    console.log('Create Mailbox page loaded.');
    await page.waitForSelector('#localaddress_input', { timeout: 20000 });
  });

  console.log(`Creating mailbox for ${freelancer.firstName} ${freelancer.lastName}...`);
  const mailboxName = `${freelancer.firstName[0].toLowerCase()}.${freelancer.lastName.toLowerCase()}`;
  const password = generatePassword();

  await page.type('#localaddress_input', mailboxName);
  await page.type('#password_input', password);
  await page.type('#password_repeat_input', password);

  const description = `erstellt: ${freelancer.createdBy}, request: ${freelancer.requestedBy}, freelancer: ${freelancer.firstName} ${freelancer.lastName}`;
  await page.type('#description_input', description);

  console.log('Submitting form...');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.click('input[type="submit"][value="Save"]'),
  ]);

  /* ---------------------- Read confirmation message ---------------------- */
  const resultMessage = await retry(page, async () => {
    const msg = await page.evaluate(() => {
      const successBox = document.querySelector('div.alert.alert-success');
      const errorBox = document.querySelector('div.alert.alert-danger');
      const legacyOk = document.querySelector('div.ok');
      const legacyError = document.querySelector('div.error');
      if (successBox) return successBox.innerText.trim();
      if (legacyOk) return legacyOk.innerText.trim();
      if (errorBox) throw new Error(errorBox.innerText.trim());
      if (legacyError) throw new Error(legacyError.innerText.trim());
      return null;
    });
    if (!msg) throw new Error('No confirmation message found');
    return msg;
  });

  console.log(`Mailbox created successfully: ${mailboxName}@${process.env.HETZNER_DOMAIN}`);
  console.log('Result message:', resultMessage);

  await browser.close();

  return {
    email: `${mailboxName}@${process.env.HETZNER_DOMAIN}`,
    password,
  };
}
