const fs = require('fs');
const path = require('path');
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

async function verifyProduction() {
  console.log('====================================================');
  console.log('POST-MIGRATION VERIFICATION ON PRODUCTION SUPABASE');
  console.log('Project:', env.NEXT_PUBLIC_SUPABASE_URL.split('//')[1].split('.')[0]);
  console.log('====================================================');

  // 1. Roster verification
  const { data: roster, error: errRoster } = await supabase
    .from('roster_people')
    .select('id, display_name, job_title, specialties, is_active')
    .order('created_at', { ascending: true });

  if (errRoster) {
    console.error('❌ Error fetching roster:', errRoster);
  } else {
    console.log(`\n✓ Total Roster Members: ${roster.length}`);
    for (const r of roster) {
      console.log(`  - [${r.display_name}] | Title: ${r.job_title} | Specialties: ${JSON.stringify(r.specialties)} | Active: ${r.is_active}`);
    }
  }

  // 2. Confirm video editor fixture is NOT present
  const videoFixture = roster?.find(r => r.display_name.includes('فيديو إيديتور (تجريبي)'));
  if (videoFixture) {
    console.error('❌ ERROR: Found video fixture in production roster!');
  } else {
    console.log('✓ Confirmed: No test video editor fixture exists in production roster.');
  }

  // 3. Check new tables
  const { count: ctaCount, error: errCta } = await supabase.from('client_team_assignments').select('*', { count: 'exact', head: true });
  console.log(`✓ Table [client_team_assignments]: ${ctaCount} records (Table exists: ${!errCta})`);

  const { count: briefCount, error: errBrief } = await supabase.from('client_briefs').select('*', { count: 'exact', head: true });
  console.log(`✓ Table [client_briefs]: ${briefCount} records (Table exists: ${!errBrief})`);

  const { count: delivCount, error: errDeliv } = await supabase.from('task_deliverables').select('*', { count: 'exact', head: true });
  console.log(`✓ Table [task_deliverables]: ${delivCount} records (Table exists: ${!errDeliv})`);

  // 4. Check tasks table columns
  const { data: sampleTask, error: errTask } = await supabase
    .from('tasks')
    .select('id, title, work_stage, is_waiting, dependency_task_id')
    .limit(3);

  if (errTask) {
    console.error('❌ Error reading tasks columns:', errTask);
  } else {
    console.log(`✓ Tasks table successfully extended with work_stage & waiting fields:`);
    for (const t of sampleTask) {
      console.log(`  - Task [${t.title}] | work_stage: ${t.work_stage} | is_waiting: ${t.is_waiting}`);
    }
  }

  // 5. Check baseline numbers preservation
  const { count: tasksCount } = await supabase.from('tasks').select('*', { count: 'exact', head: true });
  const { count: clientsCount } = await supabase.from('clients').select('*', { count: 'exact', head: true });
  const { count: timeCount } = await supabase.from('time_entries').select('*', { count: 'exact', head: true });
  const { count: memberCount } = await supabase.from('workspace_memberships').select('*', { count: 'exact', head: true });

  console.log('\n--- BASELINE PRESERVATION CHECK ---');
  console.log(`  - Tasks: ${tasksCount} (Expected: 18) -> ${tasksCount === 18 ? 'PASSED' : 'CHANGED'}`);
  console.log(`  - Clients: ${clientsCount} (Expected: 28) -> ${clientsCount === 28 ? 'PASSED' : 'CHANGED'}`);
  console.log(`  - Time Entries: ${timeCount} (Expected: 1) -> ${timeCount === 1 ? 'PASSED' : 'CHANGED'}`);
  console.log(`  - Memberships: ${memberCount} (Expected: 3) -> ${memberCount === 3 ? 'PASSED' : 'CHANGED'}`);

  // 6. Check invitations
  const { data: invitations } = await supabase.from('workspace_invitations').select('id, invited_email, role, status, expires_at');
  console.log('\n--- WORKSPACE INVITATIONS ---');
  for (const inv of (invitations || [])) {
    console.log(`  - ID: ${inv.id} | Email: ${inv.invited_email} | Role: ${inv.role} | Status: ${inv.status} | Expires: ${inv.expires_at}`);
  }
}

verifyProduction().catch(console.error);
