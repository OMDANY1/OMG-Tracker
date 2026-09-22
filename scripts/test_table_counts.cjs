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

async function main() {
  // Query all tables in public schema via rpc or select
  // We can query pg_tables or run an rpc, or query via supabase postgrest:
  // Let's test tables directly by selecting 1 row from each
  const candidateTables = [
    'workspaces', 'workspace_members', 'workspace_invitations', 'roster_people',
    'clients', 'client_team_assignments', 'client_briefs', 'campaigns', 'campaign_items',
    'tasks', 'task_reviews', 'task_comments', 'task_deliverables', 'time_entries',
    'audit_events', 'ai_jobs', 'notifications', 'evaluations', 'roles', 'permissions'
  ];

  console.log('Testing select count from candidate tables:');
  for (const t of candidateTables) {
    const { data, count, error } = await supabase.from(t).select('*', { count: 'exact' });
    if (error) {
      console.log(`Table '${t}': ${error.code} - ${error.message}`);
    } else {
      console.log(`Table '${t}': EXISTS, count = ${data.length}`);
    }
  }

  // Let's also check workspace_members specifically
  const { data: members, error: mErr } = await supabase.from('workspace_members').select('*');
  console.log('workspace_members:', mErr || members);

  // Check audit_events
  const { data: audits, error: aErr } = await supabase.from('audit_events').select('*').limit(3);
  console.log('audit_events sample:', aErr || audits);
}

main().catch(console.error);
