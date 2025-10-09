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
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setDefaultTimeout(60000);

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

  // Handle cookie banner if present
  try {
    await page.waitForSelector('button#onetrust-accept-btn-handler', { timeout: 5000 });
    await page.click('button#onetrust-accept-btn-handler');
    console.log('Cookie banner dismissed.');
  } catch (e) {}

  // Detect login type
  await page.waitForFunction(() => {
    return (
      document.querySelector('input[name="login_user"]') ||
      document.querySelector('#_username')
    );
  }, { timeout: 40000 });

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

  /* ---------------------- Expand Server & Domain ---------------------- */
  await retry(page, async () => {
    console.log('Waiting for server list...');
    await page.waitForSelector('tr.server', { timeout: 20000 });

    console.log('Expanding server row...');
    await page.evaluate(() => {
      const serverRow = document.querySelector('tr.server');
      if (serverRow) {
        const expandBtn = serverRow.querySelector('.toggle');
        if (expandBtn) expandBtn.click();
      }
    });

    await page.waitForTimeout(3000);

    console.log('Selecting elunic.net domain...');
    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll('tr.domain a, td a')).some((a) =>
        a.textContent.includes('elunic.net')
      );
    }, { timeout: 15000 });

    await page.evaluate(() => {
      const link = Array.from(document.querySelectorAll('tr.domain a, td a')).find((a) =>
        a.textContent.includes('elunic.net')
      );
      if (link) link.click();
    });

    await page.waitForNavigation({ waitUntil: 'networkidle2' });
  });

  console.log('Stabilizing domain context...');
  await page.waitForTimeout(3000);
  await page.reload({ waitUntil: 'networkidle2' }).catch(() => {});

  /* ---------------------- Navigate to Mailboxes ---------------------- */
  await retry(page, async () => {
    console.log('Opening Mailboxes list...');
    await page.goto('https://konsoleh.hetzner.com/mail/mailbox/list', {
      waitUntil: 'networkidle2',
    });
    const html = await page.content();
    if (html.includes('Internal error') || !html.includes('Mailbox'))
      throw new Error('Mailboxes list failed to load');
  });

  /* ---------------------- Open Create Mailbox Form ---------------------- */
  await retry(page, async () => {
    console.log('Opening Create Mailbox page...');
    await page.goto('https://konsoleh.hetzner.com/mail/mailbox/create', {
      waitUntil: 'networkidle2',
    });
    const html = await page.content();
    if (html.includes('Internal error')) throw new Error('Create page failed to load');
    await page.waitForSelector('#localaddress_input', { timeout: 20000 });
  });

  /* ---------------------- Fill Form & Submit ---------------------- */
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

  /* ---------------------- Confirmation ---------------------- */
  const resultMessage = await retry(page, async () => {
    const msg = await page.evaluate(() => {
      const okBox = document.querySelector('div.ok');
      const errorBox = document.querySelector('div.error');
      if (okBox) return okBox.innerText;
      if (errorBox) throw new Error(errorBox.innerText);
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
