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
// DO NOT use express.json() here to debug raw body parsing

app.post('/create-mailbox', async (req, res) => {
  let rawBody = '';
  req.on('data', chunk => {
    rawBody += chunk;
  });

  req.on('end', async () => {
    try {
      const body = JSON.parse(rawBody);
      console.log('Parsed JSON:', body);

      const { firstName, lastName, requestedBy } = body;

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
      console.error('Invalid JSON:', rawBody);
      return res.status(400).send('Invalid JSON');
    }
  });
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

  if (!emailMenuExpanded) {
    throw new Error('Email dropdown could not be clicked');
  }

  console.log('Clicking Mailboxes...');
  await page.waitForFunction(() => {
    const el = document.querySelector('dd#mailbox > a');
    return el && el.offsetParent !== null;
  }, { timeout: 10000 });

  const mailboxLink = await page.$('dd#mailbox > a');
  if (!mailboxLink) {
    throw new Error('Mailboxes link not found or not visible');
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    mailboxLink.click()
  ]);

  let attemptCount = 0;
  let atMailboxes = page.url().includes('/mailbox/list');
  while (attemptCount < 2 && !atMailboxes) {
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

  if (!atMailboxes) {
    throw new Error('Could not reach the Mailboxes page after retrying.');
  }

  await page.waitForFunction(() => {
    const links = Array.from(document.querySelectorAll('a'));
    return links.some(link => link.textContent.trim() === 'New mailbox');
  }, { timeout: 15000 });

  await page.evaluate(() => {
    const link = Array.from(document.querySelectorAll('a')).find(l => l.textContent.trim() === 'New mailbox');
    if (link) link.click();
  });

  await page.waitForSelector('#localaddress_input', { timeout: 10000 });

  const mailboxName = `${freelancer.firstName[0].toLowerCase()}.${freelancer.lastName.toLowerCase()}`;
  const password = generatePassword();

  await page.type('#localaddress_input', mailboxName);
  await page.type('#password_input', password);
  await page.type('#password_repeat_input', password);

  const description = `erstellt: ${freelancer.createdBy}, request: ${freelancer.requestedBy}, freelancer: ${freelancer.firstName} ${freelancer.lastName}`;
  await page.type('#description_input', description);

  await page.click('input[type="submit"][value="Save"]');

  console.log('Mailbox created successfully!');
  console.log(`Email: ${mailboxName}@${process.env.HETZNER_DOMAIN}`);
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
  pass += Math.random() < 0.5
    ? digits[Math.floor(Math.random() * digits.length)]
    : specials[Math.floor(Math.random() * specials.length)];

  while (pass.length < 12) {
    pass += all[Math.floor(Math.random() * all.length)];
  }

  return pass;
}
