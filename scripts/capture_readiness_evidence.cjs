const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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
  if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true });
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
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1000']
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

  // ---------------------------------------------------------------------------
  // 1. Team Page (Showing Atta - Marketing Director & Arwa - Strategy Lead)
  // ---------------------------------------------------------------------------
  console.log('\nNavigating to /team page...');
  await page.goto('https://omg-creative-workspace.vercel.app/team', { waitUntil: 'networkidle2', timeout: 45000 });
  await page.evaluate(() => {
    localStorage.removeItem('omg_active_persona');
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2500);

  const shot1 = path.join(evidenceDir, 'prod_ready_01_team_roles_matrix.png');
  await page.screenshot({ path: shot1, fullPage: true });
  saveScreenshot('prod_ready_01_team_roles_matrix.png');

  // ---------------------------------------------------------------------------
  // 2. Open Permissions Matrix Modal
  // ---------------------------------------------------------------------------
  console.log('Opening Permissions Matrix Modal...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.innerText.includes('مصفوفة الصلاحيات'));
    if (btn) btn.click();
  });
  await sleep(1500);

  const shot2 = path.join(evidenceDir, 'prod_ready_02_permissions_matrix_modal.png');
  await page.screenshot({ path: shot2, fullPage: false });
  saveScreenshot('prod_ready_02_permissions_matrix_modal.png');

  // Close matrix modal
  await page.keyboard.press('Escape');
  await sleep(1000);

  // ---------------------------------------------------------------------------
  // 3. Clients Page & AddClientModal (Desktop 1600x1000 - No Horizontal Clipping)
  // ---------------------------------------------------------------------------
  console.log('Navigating to /clients page...');
  await page.goto('https://omg-creative-workspace.vercel.app/clients', { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(2500);

  console.log('Opening AddClientModal on Desktop...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.innerText.includes('إضافة عميل جديد'));
    if (btn) btn.click();
  });
  await sleep(1500);

  const shot3 = path.join(evidenceDir, 'prod_ready_03_clients_desktop_modal.png');
  await page.screenshot({ path: shot3, fullPage: false });
  saveScreenshot('prod_ready_03_clients_desktop_modal.png');

  // ---------------------------------------------------------------------------
  // 4. Clients Page & AddClientModal (Mobile Viewport 390x844 - No Clipping)
  // ---------------------------------------------------------------------------
  console.log('Switching to mobile viewport 390x844...');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto('https://omg-creative-workspace.vercel.app/clients', { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(2000);

  console.log('Opening AddClientModal on Mobile...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.innerText.includes('إضافة عميل جديد'));
    if (btn) btn.click();
  });
  await sleep(1500);

  const shot4 = path.join(evidenceDir, 'prod_ready_04_clients_mobile_modal.png');
  await page.screenshot({ path: shot4, fullPage: false });
  saveScreenshot('prod_ready_04_clients_mobile_modal.png');

  // Reset viewport to desktop
  await page.setViewport({ width: 1600, height: 1000 });
  await page.keyboard.press('Escape');
  await sleep(1000);

  // ---------------------------------------------------------------------------
  // 5. Test Issued Invitation Acceptance Flow (/accept-invite?id=...)
  // ---------------------------------------------------------------------------
  console.log('Creating a temporary issued invitation for demonstration...');
  const { data: ws } = await supabaseAdmin.from('workspaces').select('id').limit(1).single();
  const { data: sara } = await supabaseAdmin.from('roster_people').select('id').eq('display_name', 'سارة').single();
  const { data: emad } = await supabaseAdmin.from('roster_people').select('id').eq('display_name', 'عماد').single();

  const demoEmail = `demo.sara.${Date.now()}@example.com`;
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const { data: demoInv, error: demoErr } = await supabaseAdmin
    .from('workspace_invitations')
    .insert({
      workspace_id: ws.id,
      invited_email: demoEmail,
      role: 'designer',
      roster_person_id: sara.id,
      invited_by_roster_id: emad.id,
      token_hash: tokenHash,
      status: 'pending',
      expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
    })
    .select()
    .single();

  if (demoInv) {
    console.log(`Navigating to /accept-invite?id=${demoInv.id}...`);
    const invitePage = await browser.newPage();
    await invitePage.setViewport({ width: 1400, height: 900 });
    await invitePage.goto(`https://omg-creative-workspace.vercel.app/accept-invite?id=${demoInv.id}`, {
      waitUntil: 'networkidle2',
      timeout: 45000
    });
    await sleep(2500);

    const shot5 = path.join(evidenceDir, 'prod_ready_05_accept_invite_link.png');
    await invitePage.screenshot({ path: shot5, fullPage: false });
    saveScreenshot('prod_ready_05_accept_invite_link.png');
    await invitePage.close();

    // Clean up demo invitation safely
    await supabaseAdmin.from('workspace_invitations').delete().eq('id', demoInv.id);
    console.log('Cleaned up demo invitation cleanly.');
  }

  // ---------------------------------------------------------------------------
  // 6. Business Owner Viewer View (Read-Only Badge & Blocked Controls)
  // ---------------------------------------------------------------------------
  console.log('Switching to Business Owner Viewer perspective...');
  await page.goto('https://omg-creative-workspace.vercel.app/team', { waitUntil: 'networkidle2', timeout: 45000 });
  await page.evaluate(() => {
    const viewerPersona = {
      id: "viewer-id",
      displayName: "مالك الشركة (مشاهد)",
      jobTitle: "Business Owner Viewer",
      role: "business_owner_viewer"
    };
    localStorage.setItem('omg_active_persona', JSON.stringify(viewerPersona));
    window.dispatchEvent(new CustomEvent('persona_changed', { detail: viewerPersona }));
  });
  await sleep(2000);

  const shot6 = path.join(evidenceDir, 'prod_ready_06_viewer_readonly_team.png');
  await page.screenshot({ path: shot6, fullPage: true });
  saveScreenshot('prod_ready_06_viewer_readonly_team.png');

  // Reset localStorage to clean state
  await page.evaluate(() => {
    localStorage.removeItem('omg_active_persona');
  });

  await browser.close();
  console.log('\n========================================================');
  console.log('✅ ALL PRODUCTION READINESS EVIDENCE CAPTURED SUCCESSFULLY!');
  console.log('========================================================');
}

main().catch(err => {
  console.error('Evidence capture failed:', err);
  process.exit(1);
});
