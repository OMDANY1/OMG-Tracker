const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

let envPath = path.resolve(__dirname, '../.env.local.production.bak');
if (!fs.existsSync(envPath)) envPath = path.resolve(__dirname, '../.env.local');
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

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
  console.log("=== 1. CHECK WORKSPACES ===");
  const { data: workspaces } = await supabase.from('workspaces').select('*');
  console.log("Workspaces:", workspaces);

  console.log("\n=== 2. CHECK CLIENTS ===");
  const { data: clients, error: clientErr } = await supabase.from('clients').select('*');
  console.log(`Total clients in DB: ${clients?.length || 0}`, clientErr || '');
  if (clients) {
    clients.forEach(c => {
      console.log(`Client: id=${c.id} | name="${c.name}" | state=${c.state} | difficulty=${c.difficulty} | workspace_id=${c.workspace_id} | owner_roster_id=${c.owner_roster_id}`);
    });
  }

  console.log("\n=== 3. SEARCH SPECIFICALLY FOR 'masar' IN ALL TABLES ===");
  const { data: masarClient } = await supabase.from('clients').select('*').ilike('name', '%masar%');
  console.log("Clients matching '%masar%':", masarClient);

  const { data: masarAr } = await supabase.from('clients').select('*').ilike('name', '%مسار%');
  console.log("Clients matching '%مسار%':", masarAr);

  console.log("\n=== 4. CHECK TIME ENTRIES IN DB ===");
  const { data: timeEntries, error: teErr } = await supabase.from('time_entries').select('id, task_id, roster_person_id, started_at, ended_at, duration_seconds, category, source, worker_name_snapshot, created_at');
  console.log(`Total time entries in DB: ${timeEntries?.length || 0}`, teErr || '');
  if (timeEntries) {
    timeEntries.forEach(te => {
      console.log("Time Entry:", te);
    });
  }

  console.log("\n=== 5. CHECK TASKS IN DB ===");
  const { data: tasks, error: taskErr } = await supabase.from('tasks').select('id, title, status, client_id, primary_assignee_id, created_at');
  console.log(`Total tasks in DB: ${tasks?.length || 0}`, taskErr || '');
  if (tasks) {
    tasks.forEach(t => {
      console.log("Task:", t);
    });
  }

  console.log("\n=== 6. CHECK CAMPAIGNS IN DB ===");
  const { data: campaigns } = await supabase.from('campaigns').select('*');
  console.log(`Total campaigns in DB: ${campaigns?.length || 0}`);
  if (campaigns) {
    campaigns.forEach(cmp => console.log("Campaign:", { id: cmp.id, title: cmp.title, client_id: cmp.client_id }));
  }

  console.log("\n=== 7. CHECK CLIENT TEAM ASSIGNMENTS & BRIEFS ===");
  const { data: assignments } = await supabase.from('client_team_assignments').select('*');
  console.log(`Total client team assignments in DB: ${assignments?.length || 0}`);
  const { data: briefs } = await supabase.from('client_briefs').select('*');
  console.log(`Total client briefs in DB: ${briefs?.length || 0}`);
}

main().catch(console.error).finally(() => process.exit(0));
