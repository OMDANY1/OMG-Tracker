const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.join(__dirname, '..', '.env.local.production.bak');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const outDir = path.join(__dirname, 'evidence');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log('Generating magic link for Emad (0 emails sent)...');
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: 'emadadelgd@gmail.com',
    options: {
      redirectTo: 'https://omg-creative-workspace.vercel.app/accept-invite'
    }
  });

  if (error || !data?.properties?.action_link) {
    console.error('Failed to generate link:', error);
    return;
  }

  const actionLink = data.properties.action_link;
  console.log('Action link generated:', actionLink);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  console.log('Navigating to actionLink...');
  await page.goto(actionLink, { waitUntil: 'networkidle2', timeout: 30000 });

  console.log('Current URL after actionLink:', page.url());
  const screenshotPath = path.join(outDir, 'test_after_login.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Screenshot saved to:', screenshotPath);

  // Check if we are on /clients
  if (!page.url().includes('/clients')) {
    console.log('Navigating directly to /clients...');
    await page.goto('https://omg-creative-workspace.vercel.app/clients', { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('Current URL now:', page.url());
    await page.screenshot({ path: path.join(outDir, 'test_clients.png'), fullPage: true });
  }

  await browser.close();
}

main().catch(console.error);
