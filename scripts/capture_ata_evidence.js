const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const SCREENSHOT_DIR = path.resolve(__dirname, 'evidence');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function capture() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  try {
    // -------------------------------------------------------------
    // Session 1: Emad (Owner) opens /clients -> ClientTeamModal
    // -------------------------------------------------------------
    console.log('--- [1] Capturing Client Team Modal (Reconciled Names) ---');
    const page1 = await browser.newPage();
    await page1.setViewport({ width: 1440, height: 900 });
    await page1.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
    await page1.waitForSelector('input[type="email"]');
    await page1.type('input[type="email"]', 'test-owner@omg-staging.test');
    await page1.type('input[type="password"]', 'TestPassword123!');
    await page1.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 3500));

    await page1.goto('http://localhost:3000/clients', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 3500));

    // Open Team modal
    const teamBtns = await page1.$$('button');
    for (const b of teamBtns) {
      const text = await page1.evaluate(el => el.textContent, b);
      if (text && text.includes('فريق العمل')) {
        await b.click();
        await new Promise(r => setTimeout(r, 2000));
        await page1.screenshot({ path: path.join(SCREENSHOT_DIR, '08_client_team_reconciled.png') });
        console.log('  📸 Screenshot: 08_client_team_reconciled.png');
        break;
      }
    }

    // Also capture Brief modal
    await page1.goto('http://localhost:3000/clients', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 3000));
    const briefBtns = await page1.$$('button');
    for (const b of briefBtns) {
      const text = await page1.evaluate(el => el.textContent, b);
      if (text && text.includes('الـ Brief')) {
        await b.click();
        await new Promise(r => setTimeout(r, 2000));
        await page1.screenshot({ path: path.join(SCREENSHOT_DIR, '09_client_brief_strategy_modal.png') });
        console.log('  📸 Screenshot: 09_client_brief_strategy_modal.png');
        break;
      }
    }

    // Owner view on /reports
    await page1.goto('http://localhost:3000/reports', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 3500));
    await page1.screenshot({ path: path.join(SCREENSHOT_DIR, '11_reports_owner_view.png') });
    console.log('  📸 Screenshot: 11_reports_owner_view.png');
    await page1.close();

    // -------------------------------------------------------------
    // Session 2: Ata (Marketing Director) on /reports
    // -------------------------------------------------------------
    console.log('--- [2] Capturing Reports Page as Ata (Marketing Director) ---');
    const page2 = await browser.newPage();
    await page2.setViewport({ width: 1440, height: 900 });
    await page2.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
    await page2.waitForSelector('input[type="email"]');
    await page2.type('input[type="email"]', 'test-marketing-dir@omg-staging.test');
    await page2.type('input[type="password"]', 'TestPassword123!');
    await page2.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 3500));

    await page2.goto('http://localhost:3000/reports', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 3500));
    await page2.screenshot({ path: path.join(SCREENSHOT_DIR, '10_reports_ata_view.png') });
    console.log('  📸 Screenshot: 10_reports_ata_view.png');
    await page2.close();

  } catch (err) {
    console.error('Puppeteer capture error:', err);
  } finally {
    await browser.close();
  }
}

capture();
