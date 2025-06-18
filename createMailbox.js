require('dotenv').config();

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const puppeteer = require('puppeteer');
puppeteerExtra.use(StealthPlugin());

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON and form data
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/create-mailbox', async (req, res) => {
  console.log('Received POST data:', req.body);

  const { firstName, lastName, requestedBy } = req.body;

  if (!firstName || !lastName || !requestedBy) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const freelancer = {
    firstName,
    lastName,
    createdBy: 'Elunic',
    requestedBy
  };

  try {
    const result = await createMailbox(freelancer);
    return res.json(result);
  } catch (err) {
    console.error('Mailbox creation failed:', err);
    return res.status(500).json({ error: 'Mailbox creation failed', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

async function createMailbox(freelancer) {
  const browser = await puppeteerExtra.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  console.log('Navigating to Hetzner login...');
  await page.goto('https://accounts.hetzner.com/login', { waitUntil: 'networkidle2' });

  console.log("Loaded env email:", process.env.HETZNER_EMAIL);
  console.log("Loaded env password:", process.env.HETZNER_PASSWORD);
  console.log("Loaded env domain:", process.env.HETZNER_DOMAIN);

  await page.waitForSelector('#_username', { timeout: 15000 });
  await page.type('#_username', process.env.HETZNER_EMAIL);
  await page.type('#_password', process.env.HETZNER_PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.click('#submit-login')
  ]);

  console.log('Login successful. Navigating to Products page...');
  await page.goto('https://konsoleh.hetzner.com/products.php', { waitUntil: 'networkidle2' });

  console.log('Clicking elunic.net to activate domain...');
  await page.waitForSelector('a.loadMenu[title="elunic.net"]', { timeout: 15000 });
  await page.click('a.loadMenu[title="elunic.net"]');

  console.log('Waiting for Email menu to appear...');
  await page.waitForSelector('a[href="#"] > span', { timeout: 10000 });
  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log('Expanding Email menu...');
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

  console.log('Clicking Mailboxes...');
  await page.waitForFunction(() => {
    const el = document.querySelector('dd#mailbox > a');
    return el && el.offsetParent !== null;
  }, { timeout: 10000 });

  const mailboxLink = await page.$('dd#mailbox > a');
  if (!mailboxLink) throw new Error('Mailboxes link not found or not visible');

  console.log('Navigating to Mailboxes...');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    mailboxLink.click()
  ]);

  console.log('Verifying Mailboxes page loaded...');
  let attemptCount = 0;
  let atMailboxes = page.url().includes('/mailbox/list');

  while (attemptCount < 2 && !atMailboxes) {
    console.log('Retrying Mailboxes click...');
    const retryLink = await page.$('dd#mailbox > a');
    if (retryLink) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        retryLink.click()
      ]);
    }
    atMailboxes = page.url().includes('/mailbox/list');
    attemptCount++;
  }

  if (!atMailboxes) throw new Error('Could not reach the Mailboxes page');

  console.log('Opening New Mailbox form...');
  await page.waitForFunction(() => {
    const links = Array.from(document.querySelectorAll('a'));
    return links.some(link => link.textContent.trim() === 'New mailbox');
  }, { timeout: 15000 });

  await page.evaluate(() => {
    const link = Array.from(document.querySelectorAll('a')).find(l => l.textContent.trim() === 'New mailbox');
    if (link) link.click();
  });

  await page.waitForSelector('#localaddress_input', { timeout: 10000 });

  console.log('Filling mailbox form...');
  const mailboxName = `${freelancer.firstName[0].toLowerCase()}.${freelancer.lastName.toLowerCase()}`;
  const password = generatePassword();

  await page.type('#localaddress_input', mailboxName);
  await page.type('#password_input', password);
  await page.type('#password_repeat_input', password);

  const description = `erstellt: ${freelancer.createdBy}, request: ${freelancer.requestedBy}, freelancer: ${freelancer.firstName} ${freelancer.lastName}`;
  await page.type('#description_input', description);

  console.log('Submitting form...');
  await page.click('input[type="submit"][value="Save"]');

  console.log(`Mailbox created successfully! Email: ${mailboxName}@${process.env.HETZNER_DOMAIN}`);
  console.log(`Password: ${password}`);

  return {
    email: `${mailboxName}@${process.env.HETZNER_DOMAIN}`,
    password: password
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

  while (pass.length < 12) {
    pass += all[Math.floor(Math.random() * all.length)];
  }

  return pass;
}
