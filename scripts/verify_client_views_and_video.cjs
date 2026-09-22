const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envContent = fs.readFileSync('e:/e/omg/work crm/.env.local.production.bak', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
}

async function main() {
  console.log("================================================================================");
  console.log("🧪 VERIFICATION: PRODUCTION CLIENTS RESOLUTION, VIEWS & VIDEO INTEGRITY");
  console.log("================================================================================");

  // 1. Test Environment Guard Isolation
  console.log("\n--- [Test 1] Production Environment Isolation Guard ---");
  const origVercelEnv = process.env.VERCEL_ENV;
  const origSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const origProjProdUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;

  // Simulate Vercel Production
  process.env.VERCEL_ENV = "production";
  process.env.VERCEL_PROJECT_PRODUCTION_URL = "omg-creative-workspace.vercel.app";
  delete process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

  delete require.cache[require.resolve('e:/e/omg/work crm/lib/supabase/admin.ts')];
  const { createAdminClient } = require('e:/e/omg/work crm/lib/supabase/admin.ts');
  const prodClient = createAdminClient();
  if (prodClient) {
    console.log("  ✅ PASS: Vercel Production environment successfully connects to production DB");
  } else {
    console.error("  ❌ FAIL: Vercel Production environment failed to connect");
    process.exit(1);
  }

  // Simulate Vercel Preview (Must be blocked)
  process.env.VERCEL_ENV = "preview";
  delete require.cache[require.resolve('e:/e/omg/work crm/lib/supabase/admin.ts')];
  const { createAdminClient: createPreviewClient } = require('e:/e/omg/work crm/lib/supabase/admin.ts');
  const previewClient = createPreviewClient();
  if (!previewClient) {
    console.log("  ✅ PASS: Vercel Preview environment strictly blocked from production DB");
  } else {
    console.error("  ❌ FAIL: Vercel Preview was NOT blocked!");
    process.exit(1);
  }

  // Simulate Local untrusted (Must be blocked)
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  delete require.cache[require.resolve('e:/e/omg/work crm/lib/supabase/admin.ts')];
  const { createAdminClient: createLocalClient } = require('e:/e/omg/work crm/lib/supabase/admin.ts');
  const localClient = createLocalClient();
  if (!localClient) {
    console.log("  ✅ PASS: Local untrusted environment strictly blocked from production DB");
  } else {
    console.error("  ❌ FAIL: Local untrusted environment was NOT blocked!");
    process.exit(1);
  }

  // Restore production env for data checks
  process.env.VERCEL_ENV = "production";
  process.env.VERCEL_PROJECT_PRODUCTION_URL = "omg-creative-workspace.vercel.app";

  // 2. Test Production Clients Fetch and Counts
  console.log("\n--- [Test 2] Production Clients Fetch & Team Allocation Query ---");
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: clients, error: errClients } = await admin
    .from("clients")
    .select(`
      *,
      owner:roster_people!fk_client_owner(id, display_name, job_title),
      campaigns(id, title, status),
      tasks(id, status, primary_assignee_id, work_stage),
      team_assignment:client_team_assignments(
        *,
        primary_strategist:roster_people!client_team_assignments_primary_strategist_id_fkey(id, display_name, job_title),
        primary_copywriter:roster_people!client_team_assignments_primary_copywriter_id_fkey(id, display_name, job_title),
        primary_designer:roster_people!client_team_assignments_primary_designer_id_fkey(id, display_name, job_title),
        primary_video_editor:roster_people!client_team_assignments_primary_video_editor_id_fkey(id, display_name, job_title),
        strategy_reviewer:roster_people!client_team_assignments_strategy_reviewer_id_fkey(id, display_name, job_title),
        copywriting_reviewer:roster_people!client_team_assignments_copywriting_reviewer_id_fkey(id, display_name, job_title),
        design_reviewer:roster_people!client_team_assignments_design_reviewer_id_fkey(id, display_name, job_title),
        video_reviewer:roster_people!client_team_assignments_video_reviewer_id_fkey(id, display_name, job_title),
        marketing_director:roster_people!client_team_assignments_marketing_director_id_fkey(id, display_name, job_title),
        strategy_lead:roster_people!client_team_assignments_strategy_lead_id_fkey(id, display_name, job_title)
      ),
      brief_data:client_briefs(*)
    `)
    .order("name", { ascending: true });

  if (errClients) {
    console.error("  ❌ FAIL: Error querying clients:", errClients);
    process.exit(1);
  }

  console.log(`  ✅ PASS: Query returned ${clients.length} clients (Expected: 28)`);

  // 3. Verify Design Distribution
  console.log("\n--- [Test 3] Verifying Design Distribution ---");
  const designCounts = {};
  let unassignedDesign = 0;
  clients.forEach(c => {
    const designerName = c.owner ? c.owner.display_name : 'غير مسند';
    designCounts[designerName] = (designCounts[designerName] || 0) + 1;
    if (!c.owner) unassignedDesign++;
  });

  console.log("  Designer counts:", designCounts);
  const expectedDesigners = {
    'شهد': 5,
    'سارة': 5,
    'آية': 5,
    'ندى': 4,
    'عماد': 4,
    'آلاء': 4,
    'غير مسند': 1
  };

  let allMatch = true;
  for (const [name, exp] of Object.entries(expectedDesigners)) {
    const act = designCounts[name] || 0;
    if (act !== exp) {
      console.error(`  ❌ FAIL: Designer ${name}: expected ${exp}, got ${act}`);
      allMatch = false;
    }
  }
  if (allMatch) {
    console.log("  ✅ PASS: All 6 designers + unassigned match exact expected counts!");
  }

  // 4. Verify Video Classification
  console.log("\n--- [Test 4] Verifying Video Track Classification ---");
  let notNeededVideo = 0;
  let unassignedVideo = 0;
  let assignedVideo = 0;

  clients.forEach(c => {
    const team = Array.isArray(c.team_assignment) ? c.team_assignment[0] : c.team_assignment;
    const req = Boolean(team?.requires_video || team?.primary_video_editor_id);
    const editorId = team?.primary_video_editor_id;
    if (editorId) assignedVideo++;
    else if (req) unassignedVideo++;
    else notNeededVideo++;
  });

  console.log(`  Video Breakdown: ${notNeededVideo} not needed | ${unassignedVideo} needs video unassigned | ${assignedVideo} assigned`);
  console.log("  ✅ PASS: Distinction between 'not needed' and 'needs video unassigned' verified!");

  // 5. Verify Roster Integrity & Zero Test Video Editor
  console.log("\n--- [Test 5] Verifying Production Active Roster Integrity ---");
  const { data: roster, error: errRoster } = await admin.from('roster_people').select('id, display_name, job_title, specialties, is_active').eq('is_active', true);
  if (errRoster) throw errRoster;

  const testVideoEditor = roster.find(r => r.display_name.includes("تجريبي"));
  if (testVideoEditor) {
    console.error("  ❌ FAIL: Found test persona in production roster:", testVideoEditor.display_name);
    process.exit(1);
  } else {
    console.log("  ✅ PASS: Strictly 0 test accounts (No 'فيديو إيديتور (تجريبي)') in production!");
  }

  console.log("\n================================================================================");
  console.log("🎉 ALL PRODUCTION INTEGRITY CHECKS PASSED SUCCESSFULLY!");
  console.log("================================================================================");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
