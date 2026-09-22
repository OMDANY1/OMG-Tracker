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
  console.log('--- Inspecting Production DB whzkpuovqllybxlyoikk ---');
  
  // List public tables and row counts
  const tables = [
    'workspaces',
    'workspace_members',
    'workspace_invitations',
    'roster_people',
    'clients',
    'client_team_assignments',
    'client_briefs',
    'campaigns',
    'campaign_items',
    'tasks',
    'task_reviews',
    'task_comments',
    'task_deliverables',
    'time_entries',
    'audit_events',
    'ai_jobs',
    'notifications'
  ];

  console.log('\n--- Row Counts by Table ---');
  for (const t of tables) {
    const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`${t}: ERROR -> ${error.message}`);
    } else {
      console.log(`${t}: ${count} rows`);
    }
  }

  // Check Storage Buckets
  console.log('\n--- Storage Buckets ---');
  const { data: buckets, error: bErr } = await supabase.storage.listBuckets();
  if (bErr) {
    console.log('Storage Buckets ERROR:', bErr.message);
  } else {
    console.log('Buckets found:', buckets.map(b => b.name));
    for (const b of buckets) {
      const { data: files, error: fErr } = await supabase.storage.from(b.name).list();
      if (fErr) {
        console.log(`Bucket ${b.name} list error:`, fErr.message);
      } else {
        console.log(`Bucket ${b.name} files count: ${files?.length || 0}`);
        if (files && files.length > 0) {
          console.log(`Files sample in ${b.name}:`, files.slice(0, 5).map(f => f.name));
        }
      }
    }
  }
}

main().catch(console.error);
