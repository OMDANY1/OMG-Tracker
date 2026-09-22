const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const SCREENSHOT_DIR = 'C:\\Users\\elwady\\.gemini\\antigravity\\brain\\4f958e1c-479f-453e-888c-49e86530171c\\scratch\\evidence';
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function capture() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,950']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 950 });

    // Login as Owner (Emad)
    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[type="email"]');
    await page.type('input[type="email"]', 'test-owner@omg-staging.test');
    await page.type('input[type="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 3000));

    // Navigate to /clients
    await page.goto('http://localhost:3000/clients', { waitUntil: 'networkidle2' });
    // Wait until client cards are loaded
    await page.waitForFunction(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => b.textContent && b.textContent.includes('فريق العمل'));
    }, { timeout: 15000 });

    console.log('✅ Client cards loaded successfully');

    // 1. Click "فريق العمل"
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const teamBtn = btns.find(b => b.textContent && b.textContent.includes('فريق العمل'));
      if (teamBtn) teamBtn.click();
    });

    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '08_client_team_reconciled.png') });
    console.log('📸 Captured: 08_client_team_reconciled.png');

    // Close team modal
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 1000));

    // 2. Click "الـ Brief"
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const briefBtn = btns.find(b => b.textContent && b.textContent.includes('الـ Brief'));
      if (briefBtn) briefBtn.click();
    });

    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '09_client_brief_strategy_modal.png') });
    console.log('📸 Captured: 09_client_brief_strategy_modal.png');

  } catch (err) {
    console.error('Capture error:', err);
  } finally {
    await browser.close();
  }
}

capture();
