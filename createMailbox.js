// Load environment variables
require('dotenv').config();

// Core imports
const express = require('express');
const cors = require('cors');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const puppeteer = require('puppeteer'); // NOTE: use "puppeteer" not "puppeteer-core"
puppeteerExtra.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware setup
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// POST endpoint
app.post('/create-mailbox', async (req, res) => {
  try {
    const { firstName, lastName, requestedBy } = req.body;
    console.log('Received POST data:', req.body);

    if (!firstName || !lastName || !requestedBy) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const freelancer = {
      firstName,
      lastName,
      createdBy: 'Elunic',
      requestedBy
    };

    const result = await createMailbox(freelancer);
    return res.json(result);
  } catch (err) {
    console.error('Mailbox creation failed:', err);
    return res.status(500).json({ error: 'Mailbox creation failed', detail: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Create mailbox logic
async function createMailbox(freelancer) {
  const browser = await puppeteerExtra.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  await page.goto('https://accounts.hetzner.com/login', { waitUntil: 'networkidle2' });
  await page.type('#_username', process.env.HETZNER_EMAIL);
  await page.type('#_password', process.env.HETZNER_PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.click('#submit-login')
  ]);

  await page.goto('https://konsoleh.hetzner.com/products.php', { waitUntil: 'networkidle2' });
  await page.waitForSelector(`a.loadMenu[title="${process.env.HETZNER_DOMAIN}"]`, { timeout: 15000 });
  await page.click(`a.loadMenu[title="${process.env.HETZNER_DOMAIN}"]`);

  await new Promise(resolve => setTimeout(resolve, 3000));

  const emailMenuExpanded = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('a[href="#"] > span'));
    const target = spans.find(span => span.textContent.includes(''));
    if (target && target.parentElement) {
      target.parentElement.click();
      return true;
    }
    return false;
  });
  if (!emailMenuExpanded) throw new Error('Email dropdown could not be clicked');

  await page.waitForFunction(() => {
    const el = document.querySelector('dd#mailbox > a');
    return el && el.offsetParent !== null;
  }, { timeout: 10000 });

  const mailboxLink = await page.$('dd#mailbox > a');
  if (!mailboxLink) throw new Error('Mailboxes link not found');

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    mailboxLink.click()
  ]);

  let attemptCount = 0;
  while (attemptCount < 2 && !page.url().includes('/mailbox/list')) {
    const retryLink = await page.$('dd#mailbox > a');
    if (retryLink) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        retryLink.click()
      ]);
    }
    attemptCount++;
  }

  if (!page.url().includes('/mailbox/list')) {
    throw new Error('Still not on Mailboxes page after retries');
  }

  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll('a')).some(a => a.textContent.trim() === 'New mailbox');
  }, { timeout: 15000 });

  await page.evaluate(() => {
    const link = Array.from(document.querySelectorAll('a')).find(a => a.textContent.trim() === 'New mailbox');
    if (link) link.click();
  });

  await page.waitForSelector('#localaddress_input', { timeout: 10000 });

  const mailboxName = `${freelancer.firstName[0].toLowerCase()}.${freelancer.lastName.toLowerCase()}`;
  const password = generatePassword();

  await page.type('#localaddress_input', mailboxName);
  await page.type('#password_input', password);
  await page.type('#password_repeat_input', password);
  await page.type('#description_input', `erstellt: ${freelancer.createdBy}, request: ${freelancer.requestedBy}, freelancer: ${freelancer.firstName} ${freelancer.lastName}`);

  await page.click('input[type="submit"][value="Save"]');

  return {
    email: `${mailboxName}@${process.env.HETZNER_DOMAIN}`,
    password
  };
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
  pass += Math.random() < 0.5 ? digits[Math.floor(Math.random() * digits.length)] : specials[Math.floor(Math.random() * specials.length)];
  while (pass.length < 12) pass += all[Math.floor(Math.random() * all.length)];
  return pass;
}
