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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const evidenceDir = path.join(__dirname, 'evidence');
  const artifactDir = path.join('C:', 'Users', 'elwady', '.gemini', 'antigravity', 'brain', '4f958e1c-479f-453e-888c-49e86530171c');

  console.log('1. Generating admin authentication token for Emad (0 emails sent)...');
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
  await page.setViewport({ width: 1600, height: 1000 });

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

  function saveScreenshot(filename) {
    const src = path.join(evidenceDir, filename);
    const dst = path.join(artifactDir, filename);
    fs.copyFileSync(src, dst);
    console.log(`✓ Saved and mirrored to artifacts: ${filename}`);
  }

  // 1. Reset localStorage persona to Owner
  await page.goto('https://omg-creative-workspace.vercel.app/clients', { waitUntil: 'networkidle2', timeout: 45000 });
  await page.evaluate(() => {
    localStorage.removeItem('omg_active_persona');
  });
  await page.reload({ waitUntil: 'networkidle2' });

  // Wait until loading finishes
  console.log('Waiting for clients page to load completely...');
  await page.waitForFunction(() => !document.body.innerText.includes('جاري مزامنة'), { timeout: 20000 });
  await sleep(1500);

  const shot1 = path.join(evidenceDir, 'prod_clean_01_clients_empty_state.png');
  await page.screenshot({ path: shot1, fullPage: true });
  saveScreenshot('prod_clean_01_clients_empty_state.png');

  // 2. Open AddClientModal
  console.log('Opening AddClientModal...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent.includes('إضافة عميل جديد') || b.textContent.includes('إضافة أول عميل'));
    if (btn) btn.click();
  });
  await sleep(1500);

  const shot2 = path.join(evidenceDir, 'prod_clean_02_add_client_modal.png');
  await page.screenshot({ path: shot2, fullPage: true });
  saveScreenshot('prod_clean_02_add_client_modal.png');

  // 3. Close modal and navigate to /team
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const closeBtn = btns.find(b => b.textContent.trim() === 'إلغاء');
    if (closeBtn) closeBtn.click();
  });
  await sleep(500);

  console.log('Navigating to /team...');
  await page.goto('https://omg-creative-workspace.vercel.app/team', { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(2000);

  const shot3 = path.join(evidenceDir, 'prod_clean_03_team_management.png');
  await page.screenshot({ path: shot3, fullPage: true });
  saveScreenshot('prod_clean_03_team_management.png');

  // 4. Open Add Member Modal
  console.log('Opening Add Member modal on /team...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent.includes('إضافة عضو جديد'));
    if (btn) btn.click();
  });
  await sleep(1500);

  const shot4 = path.join(evidenceDir, 'prod_clean_04_add_team_member_modal.png');
  await page.screenshot({ path: shot4, fullPage: true });
  saveScreenshot('prod_clean_04_add_team_member_modal.png');

  // Close modal
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const closeBtn = btns.find(b => b.textContent.trim() === 'إلغاء');
    if (closeBtn) closeBtn.click();
  });
  await sleep(500);

  // 5. Switch to Business Owner Viewer Role Simulation
  console.log('Switching to Business Owner Viewer role simulation...');
  await page.evaluate(() => {
    const viewerPersona = {
      id: "viewer-id",
      displayName: "مالك الشركة (مشاهد)",
      jobTitle: "Business Owner Viewer",
      role: "business_owner_viewer"
    };
    localStorage.setItem("omg_active_persona", JSON.stringify(viewerPersona));
    window.dispatchEvent(new CustomEvent("persona_changed", { detail: viewerPersona }));
  });
  await sleep(1500);

  const shot5 = path.join(evidenceDir, 'prod_clean_05_viewer_readonly_team.png');
  await page.screenshot({ path: shot5, fullPage: true });
  saveScreenshot('prod_clean_05_viewer_readonly_team.png');

  // 6. Clients in Viewer Mode
  console.log('Navigating to /clients in Viewer Mode...');
  await page.goto('https://omg-creative-workspace.vercel.app/clients', { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => !document.body.innerText.includes('جاري مزامنة'), { timeout: 20000 });
  await sleep(1000);
  await page.evaluate(() => {
    const viewerPersona = {
      id: "viewer-id",
      displayName: "مالك الشركة (مشاهد)",
      jobTitle: "Business Owner Viewer",
      role: "business_owner_viewer"
    };
    window.dispatchEvent(new CustomEvent("persona_changed", { detail: viewerPersona }));
  });
  await sleep(1000);

  const shot6 = path.join(evidenceDir, 'prod_clean_06_viewer_readonly_clients.png');
  await page.screenshot({ path: shot6, fullPage: true });
  saveScreenshot('prod_clean_06_viewer_readonly_clients.png');

  await browser.close();
  console.log('\nAll production screenshots refreshed and captured successfully!');
}

main().catch(err => {
  console.error('Evidence capture failed:', err);
  process.exit(1);
});
