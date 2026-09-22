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

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });

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

  await page.goto('https://omg-creative-workspace.vercel.app/clients', {
    waitUntil: 'networkidle2',
    timeout: 30000
  });

  await page.waitForSelector('h1', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 2000));

  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.textContent.includes('توزيع فريق العميل') || b.textContent.includes('توزيع فريق'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1200));

  // Click the second radio button: "يتطلب إنتاج ومونتاج فيديو"
  console.log('Activating video track...');
  await page.evaluate(() => {
    const radios = Array.from(document.querySelectorAll('input[name="modalRequiresVideo"]'));
    if (radios.length > 1) {
      radios[1].click();
    }
  });
  await new Promise(r => setTimeout(r, 1000));

  const modalPath = path.join(evidenceDir, 'prod_08_client_team_modal_video_active.png');
  await page.screenshot({ path: modalPath, fullPage: false });
  fs.copyFileSync(modalPath, path.join(artifactDir, 'prod_08_client_team_modal_video_active.png'));
  console.log('✓ Captured prod_08_client_team_modal_video_active.png');

  await browser.close();
}

main().catch(console.error);
