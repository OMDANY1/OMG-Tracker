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
    // -------------------------------------------------------------------------
    // Capture 10: Ata (Marketing Director) on /reports
    // -------------------------------------------------------------------------
    console.log('--- [1] Capturing /reports as Ata (Marketing Director) ---');
    const contextAta = await browser.createBrowserContext();
    const pageAta = await contextAta.newPage();
    await pageAta.setViewport({ width: 1440, height: 950 });

    await pageAta.goto('http://localhost:3000/login', { waitUntil: 'networkidle2' });
    await pageAta.waitForSelector('input[type="email"]');
    await pageAta.type('input[type="email"]', 'test-marketing-dir@omg-staging.test');
    await pageAta.type('input[type="password"]', 'TestPassword123!');
    await pageAta.click('button[type="submit"]');

    // Wait until redirected away from /login
    await pageAta.waitForFunction(() => !window.location.pathname.startsWith('/login'), { timeout: 15000 });
    console.log('✅ Ata logged in successfully, redirected to:', pageAta.url());

    // Set persona so client components recognize Ata's role
    await pageAta.evaluate(() => {
      localStorage.setItem('omg_active_persona', JSON.stringify({
        role: 'marketing_director',
        displayName: 'عطا',
        jobTitle: 'Marketing Director'
      }));
    });

    await pageAta.goto('http://localhost:3000/reports', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 3000));

    const path10_scratch = path.join(SCREENSHOT_DIR, '10_reports_ata_view.png');
    const path10_art = path.join(ARTIFACT_DIR, '10_reports_ata_view.png');
    await pageAta.screenshot({ path: path10_scratch });
    fs.copyFileSync(path10_scratch, path10_art);
    console.log('📸 Captured: 10_reports_ata_view.png');
    await contextAta.close();

    // -------------------------------------------------------------------------
    // Capture 11: Emad (Owner) on /reports
    // -------------------------------------------------------------------------
    console.log('--- [2] Capturing /reports as Emad (Owner) ---');
    const contextOwner = await browser.createBrowserContext();
    const pageOwner = await contextOwner.newPage();
    await pageOwner.setViewport({ width: 1440, height: 950 });

    await pageOwner.goto('http://localhost:3000/login', { waitUntil: 'networkidle2' });
    await pageOwner.waitForSelector('input[type="email"]');
    await pageOwner.type('input[type="email"]', 'test-owner@omg-staging.test');
    await pageOwner.type('input[type="password"]', 'TestPassword123!');
    await pageOwner.click('button[type="submit"]');

    await pageOwner.waitForFunction(() => !window.location.pathname.startsWith('/login'), { timeout: 15000 });
    console.log('✅ Owner logged in successfully, redirected to:', pageOwner.url());

    await pageOwner.evaluate(() => {
      localStorage.setItem('omg_active_persona', JSON.stringify({
        role: 'owner',
        displayName: 'عماد',
        jobTitle: 'Owner & Art Director'
      }));
    });

    await pageOwner.goto('http://localhost:3000/reports', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 3000));

    const path11_scratch = path.join(SCREENSHOT_DIR, '11_reports_owner_view.png');
    const path11_art = path.join(ARTIFACT_DIR, '11_reports_owner_view.png');
    await pageOwner.screenshot({ path: path11_scratch });
    fs.copyFileSync(path11_scratch, path11_art);
    console.log('📸 Captured: 11_reports_owner_view.png');

    const path12_scratch = path.join(SCREENSHOT_DIR, '12_reports_full_breakdown.png');
    const path12_art = path.join(ARTIFACT_DIR, '12_reports_full_breakdown.png');
    await pageOwner.screenshot({ path: path12_scratch, fullPage: true });
    fs.copyFileSync(path12_scratch, path12_art);
    console.log('📸 Captured: 12_reports_full_breakdown.png');

    await contextOwner.close();

  } catch (err) {
    console.error('Capture reports error:', err);
  } finally {
    await browser.close();
  }
}

capture();
