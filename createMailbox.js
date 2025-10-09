require('dotenv').config();

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
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
  // --- Double-locked headless mode logic ---
  const isProduction =
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.NODE_ENV === 'production' ||
    process.env.RAILWAY_STATIC_URL;

  const headlessMode = isProduction
    ? true
    : process.env.HEADLESS !== 'false';

  console.log(
    `Launching browser in ${headlessMode ? 'headless' : 'visible'} mode...`
  );

  const browser = await puppeteerExtra.launch({
    headless: headlessMode,
    slowMo: headlessMode ? 0 : 75,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
    ],
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
    await page.waitForSelector('button[data-bs-target="#flush-collapse-email"]', { timeout: 30000 });
    await page.evaluate(() => {
      const btn = document.querySelector('button[data-bs-target="#flush-collapse-email"]');
      if (btn && btn.getAttribute('aria-expanded') === 'false') btn.click();
    });

    await page.waitForFunction(() => {
      const section = document.querySelector('#flush-collapse-email');
      return section && section.classList.contains('show');
    }, { timeout: 10000 }).catch(() =>
      console.log('Sidebar did not visually expand, continuing anyway.')
    );

    console.log('Clicking Mailboxes link...');
    const mailboxLink = await page.$('#mailbox a[href="/mail/mailbox/list"]');

    if (mailboxLink) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        mailboxLink.click(),
      ]);
      console.log('Mailboxes page loaded.');
    } else {
      console.log('Mailboxes link not found, navigating directly as fallback...');
      await page.goto('https://konsoleh.hetzner.com/mail/mailbox/list', { waitUntil: 'networkidle2' });
      console.log('Mailboxes page loaded via fallback.');
    }
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

  // --- Sanitized mailbox name creation ---
  let cleanLast = freelancer.lastName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ''); // remove spaces & special chars
  const mailboxName = `${freelancer.firstName[0].toLowerCase()}.${cleanLast}`;
  const password = generatePassword();

  await page.type('#localaddress_input', mailboxName);
  await page.type('#password_input', password);
  await page.type('#password_repeat_input', password);

  const description = `erstellt: ${freelancer.createdBy}, request: ${freelancer.requestedBy}, freelancer: ${freelancer.firstName} ${freelancer.lastName}`;
  await page.type('#description_input', description);

  /* ---------------------- Safe single form submit ---------------------- */
  console.log('Submitting form...');
  await page.click('input[type="submit"][value="Save"]');
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000); // allow page to render alerts

  console.log('Checking for confirmation or error message...');
  const resultMessage = await page.evaluate(() => {
    const successBox = document.querySelector('div.alert.alert-success');
    const errorBox = document.querySelector('div.alert.alert-danger');
    const legacyOk = document.querySelector('div.ok');
    const legacyError = document.querySelector('div.error');
    if (successBox) return successBox.innerText.trim();
    if (legacyOk) return legacyOk.innerText.trim();
    if (errorBox) throw new Error(errorBox.innerText.trim());
    if (legacyError) throw new Error(legacyError.innerText.trim());
    return 'No confirmation message found.';
  });

  console.log(`Mailbox created successfully: ${mailboxName}@${process.env.HETZNER_DOMAIN}`);
  console.log('Result message:', resultMessage);

  try {
    await browser.close();
  } catch {
    console.log('Browser already closed or cleaned up.');
  }

  return {
    email: `${mailboxName}@${process.env.HETZNER_DOMAIN}`,
    password,
  };
}
