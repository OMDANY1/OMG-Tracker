const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { createServerClient } = require('@supabase/ssr');

const envPath = path.join(__dirname, '..', '.env.local.production.bak');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
}

const supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const evidenceDir = path.join(__dirname, 'evidence');
  const artifactDir = path.join('C:', 'Users', 'elwady', '.gemini', 'antigravity', 'brain', '4f958e1c-479f-453e-888c-49e86530171c');

  if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true });

  console.log('1. Generating magic link for Emad (0 emails sent)...');
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: 'emadadelgd@gmail.com'
  });
  if (linkErr) throw linkErr;

  const tempClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data: verifyData, error: verifyErr } = await tempClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink'
  });
  if (verifyErr) throw verifyErr;

  console.log('2. Session verified for user:', verifyData.user?.email);

  const cookiesToSet = [];
  const ssrClient = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() { return cookiesToSet; },
      setAll(toSet) { cookiesToSet.push(...toSet); }
    }
  });

  await ssrClient.auth.setSession({
    access_token: verifyData.session.access_token,
    refresh_token: verifyData.session.refresh_token
  });

  console.log('3. Launching browser...');
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });

  // Set auth cookies for the domain
  const puppeteerCookies = cookiesToSet.map(c => ({
    name: c.name,
    value: c.value,
    domain: 'omg-creative-workspace.vercel.app',
    path: '/',
    httpOnly: false,
    secure: true,
    sameSite: 'Lax'
  }));

  await page.setCookie(...puppeteerCookies);
  console.log('4. Auth cookies set in browser.');

  // Navigate to /clients
  console.log('5. Navigating to https://omg-creative-workspace.vercel.app/clients...');
  await page.goto('https://omg-creative-workspace.vercel.app/clients', {
    waitUntil: 'networkidle2',
    timeout: 30000
  });

  // Wait for clients to load
  await page.waitForSelector('h1', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 2000));

  // Check URL
  console.log('Current page URL:', page.url());

  // Capture 1: All Clients View
  console.log('Capturing: 03_clients_all_view...');
  const allViewPath = path.join(evidenceDir, 'prod_03_clients_all_view.png');
  await page.screenshot({ path: allViewPath, fullPage: false });
  fs.copyFileSync(allViewPath, path.join(artifactDir, 'prod_03_clients_all_view.png'));
  console.log('✓ Captured prod_03_clients_all_view.png');

  // Capture 2: Design View (Click "فريق التصميم")
  console.log('Switching to Design view...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const designBtn = buttons.find(b => b.textContent.includes('فريق التصميم'));
    if (designBtn) designBtn.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  const designAllPath = path.join(evidenceDir, 'prod_04_clients_design_all.png');
  await page.screenshot({ path: designAllPath, fullPage: false });
  fs.copyFileSync(designAllPath, path.join(artifactDir, 'prod_04_clients_design_all.png'));
  console.log('✓ Captured prod_04_clients_design_all.png');

  // Capture 3: Design View with Shahd filter
  console.log('Selecting Shahd filter...');
  await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('div, span, button'));
    const shahdEl = elements.find(el => el.textContent.trim() === 'شهد' && el.parentElement?.textContent?.includes('عملاء'));
    if (shahdEl) {
      (shahdEl.parentElement || shahdEl).click();
    } else {
      const fallback = elements.find(el => el.textContent.includes('شهد') && el.textContent.includes('عملاء'));
      if (fallback) fallback.click();
    }
  });
  await new Promise(r => setTimeout(r, 1000));

  const shahdFilterPath = path.join(evidenceDir, 'prod_05_clients_design_shahd_filter.png');
  await page.screenshot({ path: shahdFilterPath, fullPage: false });
  fs.copyFileSync(shahdFilterPath, path.join(artifactDir, 'prod_05_clients_design_shahd_filter.png'));
  console.log('✓ Captured prod_05_clients_design_shahd_filter.png');

  // Capture 4: Video Team View
  console.log('Switching to Video Team view...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const videoBtn = buttons.find(b => b.textContent.includes('فريق الفيديو والمونتاج'));
    if (videoBtn) videoBtn.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  const videoViewPath = path.join(evidenceDir, 'prod_06_clients_video_view.png');
  await page.screenshot({ path: videoViewPath, fullPage: false });
  fs.copyFileSync(videoViewPath, path.join(artifactDir, 'prod_06_clients_video_view.png'));
  console.log('✓ Captured prod_06_clients_video_view.png');

  // Capture 5: Client Team Modal
  console.log('Opening Client Team Modal...');
  await page.evaluate(() => {
    // Switch to all view first to pick a client
    const buttons = Array.from(document.querySelectorAll('button'));
    const allBtn = buttons.find(b => b.textContent.includes('جميع العملاء'));
    if (allBtn) allBtn.click();
  });
  await new Promise(r => setTimeout(r, 800));

  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const teamBtn = buttons.find(b => b.textContent.includes('توزيع الفريق'));
    if (teamBtn) teamBtn.click();
  });
  await new Promise(r => setTimeout(r, 1200));

  const modalPath = path.join(evidenceDir, 'prod_07_client_team_modal.png');
  await page.screenshot({ path: modalPath, fullPage: false });
  fs.copyFileSync(modalPath, path.join(artifactDir, 'prod_07_client_team_modal.png'));
  console.log('✓ Captured prod_07_client_team_modal.png');

  await browser.close();
  console.log('ALL LIVE PRODUCTION SCREENSHOTS CAPTURED SUCCESSFULLY!');
}

main().catch(console.error);
