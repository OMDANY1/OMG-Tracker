const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables from .env.local.production.bak or .env.local
let envPath = path.resolve(__dirname, '../.env.local.production.bak');
if (!fs.existsSync(envPath)) {
  envPath = path.resolve(__dirname, '../.env.local');
}
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    env[match[1]] = value;
  }
});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function run() {
  console.log("=== STARTING COMPREHENSIVE E2E OPERATIONAL HARDENING VERIFICATION ===\n");
  let passedChecks = 0;
  let totalChecks = 0;

  function assert(condition, message) {
    totalChecks++;
    if (condition) {
      console.log(`[PASS] ${message}`);
      passedChecks++;
    } else {
      console.error(`[FAIL] ${message}`);
    }
  }

  // -------------------------------------------------------------
  // TEST 1: ROLE SIMULATION ELIMINATION (CODE AUDIT)
  // -------------------------------------------------------------
  console.log("--- 1. Testing Role Simulation Elimination ---");
  const navbarCode = fs.readFileSync(path.resolve(__dirname, '../components/navigation/Navbar.tsx'), 'utf8');
  assert(!navbarCode.includes('<RoleSwitcher'), "RoleSwitcher component is NOT rendered in Navbar");

  const layoutCode = fs.readFileSync(path.resolve(__dirname, '../app/layout.tsx'), 'utf8');
  assert(!layoutCode.includes('RoleSwitcher'), "RoleSwitcher is NOT in root layout");

  const userMenuCode = fs.readFileSync(path.resolve(__dirname, '../components/navigation/UserMenu.tsx'), 'utf8');
  assert(userMenuCode.includes('/api/auth/me'), "UserMenu retrieves authentic profile from /api/auth/me");
  assert(userMenuCode.includes('localStorage.removeItem("omg_active_persona")'), "UserMenu cleans up any legacy omg_active_persona");

  const reportsCode = fs.readFileSync(path.resolve(__dirname, '../app/reports/page.tsx'), 'utf8');
  assert(reportsCode.includes('/api/auth/me'), "Reports page relies strictly on /api/auth/me for role and identity");

  // -------------------------------------------------------------
  // TEST 2: COMPANY OWNER & AUTHENTIC ROLES VERIFICATION
  // -------------------------------------------------------------
  console.log("\n--- 2. Testing Company Owner Role & Accounts Configuration ---");
  
  // 2.1 Check Ahmad Al-Nahhas (Company Owner)
  const { data: nahassRoster } = await supabase
    .from('roster_people')
    .select('id, display_name, role, is_active, access_scope, custom_permissions')
    .eq('id', '82a6a25a-3dad-4c6a-960c-6ace8389985a')
    .single();

  assert(nahassRoster && nahassRoster.role === 'company_owner', `Ahmad Al-Nahhas roster role is 'company_owner' (Actual: ${nahassRoster?.role})`);
  assert(nahassRoster && nahassRoster.is_active === true, "Ahmad Al-Nahhas roster is active");

  const { data: nahassMember } = await supabase
    .from('workspace_memberships')
    .select('id, role, is_active, custom_permissions')
    .eq('roster_person_id', nahassRoster.id)
    .single();

  assert(nahassMember && nahassMember.role === 'company_owner', `Ahmad Al-Nahhas workspace membership role is 'company_owner' (Actual: ${nahassMember?.role})`);
  assert(nahassMember && nahassMember.custom_permissions?.manage_workspace === true, "Ahmad Al-Nahhas has manage_workspace = true");
  assert(nahassMember && nahassMember.custom_permissions?.export_reports === true, "Ahmad Al-Nahhas has export_reports = true");

  // 2.2 Check Emad (Owner)
  const { data: emadRoster } = await supabase
    .from('roster_people')
    .select('id, display_name, role, is_active')
    .eq('id', 'bcfa3baa-7045-4262-abd6-bdb0be8210fd')
    .single();

  assert(emadRoster && emadRoster.role === 'owner', `Emad retains 'owner' role (Actual: ${emadRoster?.role})`);

  // 2.3 Check Ata (Marketing Director)
  const { data: ataRoster } = await supabase
    .from('roster_people')
    .select('id, display_name, role, is_active')
    .ilike('display_name', '%عطا%')
    .single();

  assert(ataRoster && ataRoster.role === 'marketing_director', `Ata retains 'marketing_director' role (Actual: ${ataRoster?.role})`);

  // -------------------------------------------------------------
  // TEST 3: SAFE HARD DELETE VS DEACTIVATE & CASCADE VERIFICATION
  // -------------------------------------------------------------
  console.log("\n--- 3. Testing Hard Delete vs Deactivation & Data Decoupling ---");

  const testSuffix = Math.floor(Math.random() * 100000);
  const { data: workspace } = await supabase.from('workspaces').select('id').limit(1).single();
  const workspaceId = workspace.id;
  const emadPersonId = 'bcfa3baa-7045-4262-abd6-bdb0be8210fd';

  let testPersonId = null;
  let reassignPersonId = null;
  let testClientId = null;
  let testTaskId = null;
  let testTimeId = null;

  try {
    // 3.1 Create test roster member to be deleted
    const { data: testPerson, error: pErr } = await supabase.from('roster_people').insert({
      workspace_id: workspaceId,
      display_name: `__E2E_Test_Delete_Target_${testSuffix}`,
      job_title: 'Junior Test Specialist',
      role: 'designer',
      is_active: true
    }).select().single();
    if (pErr) throw pErr;
    testPersonId = testPerson.id;

    // 3.2 Create test roster member to receive reassigned tasks
    const { data: reassignPerson, error: rErr } = await supabase.from('roster_people').insert({
      workspace_id: workspaceId,
      display_name: `__E2E_Test_Reassign_Receiver_${testSuffix}`,
      job_title: 'Senior Test Specialist',
      role: 'designer',
      is_active: true
    }).select().single();
    if (rErr) throw rErr;
    reassignPersonId = reassignPerson.id;

    // 3.3 Create test client
    const { data: testClient, error: cErr } = await supabase.from('clients').insert({
      workspace_id: workspaceId,
      name: `__E2E_Test_Client_${testSuffix}`,
      owner_roster_id: testPersonId,
      difficulty: 'Easy',
      extra_workload: 'None',
      state: 'Active'
    }).select().single();
    if (cErr) throw cErr;
    testClientId = testClient.id;

    // 3.4 Create a task assigned to testPerson
    const { data: testTask, error: tErr } = await supabase.from('tasks').insert({
      workspace_id: workspaceId,
      client_id: testClientId,
      title: `__E2E_Test_Task_${testSuffix}`,
      status: 'in_progress',
      primary_assignee_id: testPersonId,
      reviewer_id: emadPersonId
    }).select().single();
    if (tErr) throw tErr;
    testTaskId = testTask.id;

    // 3.5 Create an active timer entry for testPerson
    const { data: testTime, error: teErr } = await supabase.from('time_entries').insert({
      workspace_id: workspaceId,
      roster_person_id: testPersonId,
      task_id: testTaskId,
      started_at: new Date(Date.now() - 300000).toISOString(),
      category: 'initial_design',
      source: 'timer'
    }).select().single();
    if (teErr) throw teErr;
    testTimeId = testTime.id;

    // 3.6 Test get_member_delete_impact RPC
    const { data: impactData, error: impErr } = await supabase.rpc('get_member_delete_impact', {
      p_workspace_id: workspaceId,
      p_roster_person_id: testPersonId
    });
    assert(!impErr, `get_member_delete_impact executed: ${impErr?.message || 'Success'}`);
    assert(impactData && impactData.open_tasks_count === 1, `Impact analysis accurately found 1 open task (Actual: ${impactData?.open_tasks_count})`);
    assert(impactData && impactData.assigned_clients_count === 1, `Impact analysis accurately found 1 assigned client (Actual: ${impactData?.assigned_clients_count})`);
    assert(impactData && impactData.has_active_timer === true, `Impact analysis accurately detected active running timer (Actual: ${impactData?.has_active_timer})`);
    assert(impactData && impactData.is_last_admin === false, "Impact analysis accurately determined member is NOT last admin");

    // 3.7 Test admin_hard_delete_roster_member RPC with reassignment
    const { data: delResult, error: delErr } = await supabase.rpc('admin_hard_delete_roster_member', {
      p_workspace_id: workspaceId,
      p_roster_person_id: testPersonId,
      p_reassign_to_roster_id: reassignPersonId
    });
    assert(!delErr, `admin_hard_delete_roster_member executed cleanly: ${delErr?.message || 'Success'}`);
    assert(delResult && delResult.success === true, "Hard delete returned success = true");

    // 3.8 Verify person is completely erased from roster_people
    const { data: deletedCheck } = await supabase
      .from('roster_people')
      .select('id')
      .eq('id', testPersonId)
      .maybeSingle();
    assert(deletedCheck === null, "Deleted member no longer exists in roster_people");

    // 3.9 Verify task was reassigned to reassignPersonId
    const { data: reassignedTask } = await supabase
      .from('tasks')
      .select('primary_assignee_id')
      .eq('id', testTaskId)
      .single();
    assert(reassignedTask?.primary_assignee_id === reassignPersonId, "Open task was successfully reassigned to the target roster person");

    // 3.10 Verify client owner was reassigned to reassignPersonId
    const { data: reassignedClient } = await supabase
      .from('clients')
      .select('owner_roster_id')
      .eq('id', testClientId)
      .single();
    assert(reassignedClient?.owner_roster_id === reassignPersonId, "Client owner was successfully reassigned to target roster person");

    // 3.11 Verify timer was stopped, duration recorded, and snapshot preserved
    const { data: preservedTime } = await supabase
      .from('time_entries')
      .select('id, roster_person_id, worker_name_snapshot, duration_seconds, ended_at')
      .eq('id', testTimeId)
      .single();
    assert(preservedTime !== null, "Historical time entry is preserved");
    assert(preservedTime?.roster_person_id === null, "Historical time entry foreign key is nullified");
    assert(preservedTime?.ended_at !== null, "Running timer was cleanly stopped automatically upon member deletion");
    assert(preservedTime?.duration_seconds > 0, `Elapsed duration seconds was calculated: ${preservedTime?.duration_seconds}s`);
    assert(preservedTime?.worker_name_snapshot?.includes('__E2E_Test_Delete_Target_'), `Historical time entry preserved worker_name_snapshot: '${preservedTime?.worker_name_snapshot}'`);

  } finally {
    // Teardown test artifacts
    if (testTimeId) await supabase.from('time_entries').delete().eq('id', testTimeId);
    if (testTaskId) await supabase.from('tasks').delete().eq('id', testTaskId);
    if (testClientId) await supabase.from('clients').delete().eq('id', testClientId);
    if (testPersonId) await supabase.from('roster_people').delete().eq('id', testPersonId);
    if (reassignPersonId) await supabase.from('roster_people').delete().eq('id', reassignPersonId);
  }

  // -------------------------------------------------------------
  // TEST 4: REALTIME & VERSION BROADCAST VERIFICATION
  // -------------------------------------------------------------
  console.log("\n--- 4. Testing Realtime Data Sync & App Version Propagation ---");

  // Check version endpoint file exists and returns expected format
  const versionRoutePath = path.resolve(__dirname, '../app/api/version/route.ts');
  assert(fs.existsSync(versionRoutePath), "Version API route file /api/version/route.ts exists");

  const realtimeProviderPath = path.resolve(__dirname, '../components/common/RealtimeSyncProvider.tsx');
  assert(fs.existsSync(realtimeProviderPath), "RealtimeSyncProvider component exists");

  const versionBannerPath = path.resolve(__dirname, '../components/common/VersionUpdateBanner.tsx');
  assert(fs.existsSync(versionBannerPath), "VersionUpdateBanner component exists");

  // Check layout integration
  assert(layoutCode.includes('<RealtimeSyncProvider>'), "RealtimeSyncProvider wraps children in layout");
  assert(layoutCode.includes('<VersionUpdateBanner'), "VersionUpdateBanner is included in layout");

  // Check database connectivity
  const { data: pubCheck } = await supabase.from('tasks').select('id').limit(1);
  assert(pubCheck !== null, "Database connectivity is operational and responsive");

  console.log(`\n=== SUMMARY: ${passedChecks}/${totalChecks} VERIFICATION CHECKS PASSED ===`);
  if (passedChecks === totalChecks) {
    console.log(">>> ALL VERIFICATIONS COMPLETED SUCCESSFULLY! <<<");
  } else {
    console.error(">>> SOME CHECKS FAILED! <<<");
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Fatal error during verification:", err);
  process.exit(1);
});
