const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const SCREENSHOT_DIR = 'C:\\Users\\elwady\\.gemini\\antigravity\\brain\\4f958e1c-479f-453e-888c-49e86530171c\\scratch\\evidence';
const ARTIFACT_DIR = 'C:\\Users\\elwady\\.gemini\\antigravity\\brain\\4f958e1c-479f-453e-888c-49e86530171c';

async function capture() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,950']
  });

  try {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1440, height: 950 });

    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[type="email"]');
    await page.type('input[type="email"]', 'test-owner@omg-staging.test');
    await page.type('input[type="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');

    await page.waitForFunction(() => !window.location.pathname.startsWith('/login'), { timeout: 15000 });
    console.log('✅ Owner logged in successfully, redirected to:', page.url());

    await page.evaluate(() => {
      localStorage.setItem('omg_active_persona', JSON.stringify({
        role: 'owner',
        displayName: 'عماد',
        jobTitle: 'Owner & Art Director'
      }));
    });

    await page.goto('http://localhost:3000/reports', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 3000));

    const path11_scratch = path.join(SCREENSHOT_DIR, '11_reports_owner_view.png');
    const path11_art = path.join(ARTIFACT_DIR, '11_reports_owner_view.png');
    await page.screenshot({ path: path11_scratch });
    fs.copyFileSync(path11_scratch, path11_art);
    console.log('📸 Captured: 11_reports_owner_view.png');

    await context.close();
  } catch (err) {
    console.error('Capture owner reports error:', err);
  } finally {
    await browser.close();
  }
}

capture();
