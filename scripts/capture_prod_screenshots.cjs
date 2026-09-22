const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

async function captureProd() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const outDir = path.join(__dirname, 'evidence');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const artifactDir = path.join('C:', 'Users', 'elwady', '.gemini', 'antigravity', 'brain', '4f958e1c-479f-453e-888c-49e86530171c');

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  console.log('Navigating to production login...');
  await page.goto('https://omg-creative-workspace.vercel.app/login', { waitUntil: 'networkidle2' });
  const loginPath = path.join(outDir, 'prod_01_login_page.png');
  await page.screenshot({ path: loginPath, fullPage: true });
  console.log('✓ Captured:', loginPath);

  // Copy to artifacts
  fs.copyFileSync(loginPath, path.join(artifactDir, 'prod_01_login_page.png'));

  console.log('Navigating to production accept-invite...');
  await page.goto('https://omg-creative-workspace.vercel.app/accept-invite', { waitUntil: 'networkidle2' });
  const invitePath = path.join(outDir, 'prod_02_accept_invite_page.png');
  await page.screenshot({ path: invitePath, fullPage: true });
  console.log('✓ Captured:', invitePath);

  // Copy to artifacts
  fs.copyFileSync(invitePath, path.join(artifactDir, 'prod_02_accept_invite_page.png'));

  await browser.close();
  console.log('Done capturing production screenshots.');
}

captureProd().catch(console.error);
