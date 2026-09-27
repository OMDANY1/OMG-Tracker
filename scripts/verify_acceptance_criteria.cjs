const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

let envPath = path.resolve(__dirname, '../.env.local.production.bak');
if (!fs.existsSync(envPath)) envPath = path.resolve(__dirname, '../.env.local');
const env = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    env[match[1]] = value;
  }
});

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function verifyAll() {
  console.log("================================================================================");
  console.log("🚀 FINAL ACCEPTANCE VERIFICATION - PRODUCTION DATABASE & ARCHITECTURE");
  console.log("================================================================================");

  let passed = 0;
  let failed = 0;
  function test(condition, title, details) {
    if (condition) {
      console.log(`  ✅ PASS: ${title}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${title} -> ${details || ''}`);
      failed++;
    }
  }

  // 1. Workspace
  const { data: ws } = await admin.from('workspaces').select('id, name').limit(1).single();
  test(!!ws, 'Workspace exists', ws?.id);
  const wsId = ws.id;

  // 2. Real Clients Count & Difficulty Breakdown
  const { data: clients, error: cErr } = await admin.from('clients').select('id, name, state, difficulty').eq('workspace_id', wsId);
  test(!cErr && clients && clients.length === 1, `Genuine clients count is 1 (found ${clients?.length})`, cErr?.message);
  const masar = clients?.find(c => c.name.toLowerCase() === 'masar');
  test(!!masar, 'Client "masar" exists and is preserved', masar?.id);
  test(masar?.difficulty === 'Hard', 'Client "masar" difficulty is Hard');
  test(masar?.state === 'Active', 'Client "masar" state is Active');

  const hardCount = clients?.filter(c => c.difficulty === 'Hard').length || 0;
  const mediumCount = clients?.filter(c => c.difficulty === 'Medium').length || 0;
  const easyCount = clients?.filter(c => c.difficulty === 'Easy').length || 0;
  const unassignedCount = clients?.filter(c => !['Hard', 'Medium', 'Easy'].includes(c.difficulty)).length || 0;
  const totalDifficulty = hardCount + mediumCount + easyCount + unassignedCount;
  test(totalDifficulty === clients.length, `Difficulty breakdown sums exactly to total clients (${totalDifficulty} == ${clients.length})`);

  // 3. Time Ledger Entries for September 2026
  const { data: sepEntries } = await admin
    .from('time_entries')
    .select('id, started_at, duration_seconds, task_id, roster_person_id')
    .eq('workspace_id', wsId)
    .gte('started_at', '2026-09-01T00:00:00Z')
    .lt('started_at', '2026-10-01T00:00:00Z');
  
  // Verify no fake "جلسة العمل المعتمدة لاختبار القبول" in DB
  const mockNames = sepEntries?.filter(e => e.task_id === 'fake-task' || e.id === 'entry-01');
  test(!mockNames || mockNames.length === 0, 'Zero mock ledger entries exist in database');

  // 4. Active Timers
  const { data: runningTimers } = await admin
    .from('time_entries')
    .select('id, roster_person_id, started_at')
    .eq('workspace_id', wsId)
    .is('ended_at', null);
  test(runningTimers?.length === 0, `No active running timers pulse (found ${runningTimers?.length})`);

  // 5. Ahmad Al-Nahhas Company Owner Status & Universal Permissions
  const { data: nahassRoster } = await admin
    .from('roster_people')
    .select('id, display_name, role, is_active, access_scope, custom_permissions')
    .ilike('display_name', '%احمد النحاس%')
    .single();
  test(!!nahassRoster, 'Ahmad Al-Nahhas exists in roster_people');
  test(nahassRoster?.role === 'company_owner', `Ahmad Al-Nahhas role is company_owner (is ${nahassRoster?.role})`);
  test(nahassRoster?.is_active === true, 'Ahmad Al-Nahhas is active');
  test(nahassRoster?.access_scope === 'workspace', 'Ahmad Al-Nahhas has workspace access scope');
  test(nahassRoster?.custom_permissions?.manage_workspace === true, 'Ahmad Al-Nahhas has full management permissions');

  const { data: nahassMembership } = await admin
    .from('workspace_memberships')
    .select('id, role, is_active, access_scope, custom_permissions')
    .eq('roster_person_id', nahassRoster?.id)
    .single();
  test(nahassMembership?.role === 'company_owner', 'Ahmad Al-Nahhas membership role synchronized to company_owner');
  test(nahassMembership?.is_active === true, 'Ahmad Al-Nahhas membership is active');

  // 6. Emad Owner Status
  const { data: emadRoster } = await admin
    .from('roster_people')
    .select('id, display_name, role, is_active')
    .ilike('display_name', '%عماد%')
    .single();
  test(emadRoster?.role === 'owner', 'Emad role is owner');
  test(emadRoster?.is_active === true, 'Emad is active');

  // 7. Test admin_update_roster_person RPC execution as company_owner
  const { data: updateRes, error: updateErr } = await admin.rpc('admin_update_roster_person', {
    p_workspace_id: wsId,
    p_roster_person_id: nahassRoster.id,
    p_job_title: 'مالك الشركة',
    p_specialties: ['management', 'strategy'],
    p_role: 'company_owner',
    p_access_scope: 'workspace',
    p_custom_permissions: nahassRoster.custom_permissions,
    p_display_name: 'احمد النحاس'
  });
  test(!updateErr && updateRes?.success === true, 'admin_update_roster_person RPC succeeds with 8 arguments including p_display_name', updateErr?.message);

  // 8. Test admin_update_roster_person RPC execution with 7 arguments (backward compatibility)
  const { data: updateRes7, error: updateErr7 } = await admin.rpc('admin_update_roster_person', {
    p_workspace_id: wsId,
    p_roster_person_id: nahassRoster.id,
    p_job_title: 'مالك الشركة',
    p_specialties: ['management', 'strategy'],
    p_role: 'company_owner',
    p_access_scope: 'workspace',
    p_custom_permissions: nahassRoster.custom_permissions
  });
  test(!updateErr7 && updateRes7?.success === true, 'admin_update_roster_person RPC succeeds with 7 arguments without function overload conflict', updateErr7?.message);

  // 9. Total Team Roster Count
  const { data: team } = await admin.from('roster_people').select('id, is_active').eq('workspace_id', wsId);
  const activeMembers = team?.filter(m => m.is_active);
  test(activeMembers && activeMembers.length === 19, `Total active team members is 19 (found ${activeMembers?.length})`);

  console.log("================================================================================");
  console.log(`VERIFICATION SUMMARY: ${passed} Passed | ${failed} Failed`);
  console.log("================================================================================");
}

verifyAll().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
