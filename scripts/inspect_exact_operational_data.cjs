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

const ALL_TABLES = [
  'workspaces',
  'workspace_memberships',
  'workspace_invitations',
  'roster_people',
  'workspace_deadline_settings',
  'review_routing_rules',
  'member_capacities',
  'leave_days',
  'clients',
  'client_team_assignments',
  'client_briefs',
  'campaigns',
  'content_calendar_items',
  'tasks',
  'task_collaborators',
  'task_checklist_items',
  'review_rounds',
  'comments',
  'attachments',
  'in_app_notifications',
  'task_status_events',
  'task_assignment_events',
  'task_due_date_events',
  'time_entries',
  'time_change_requests',
  'monthly_report_snapshots',
  'ai_extraction_cache',
  'ai_processing_jobs',
  'rpc_idempotency_records',
  'audit_events',
  'task_deliverables'
];

async function main() {
  console.log('--- EXACT TABLE COUNTS ON PRODUCTION ---');
  const results = {};
  for (const table of ALL_TABLES) {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
    if (error) {
      results[table] = `ERROR: ${error.code} - ${error.message}`;
    } else {
      results[table] = count;
    }
  }
  console.table(results);

  console.log('\n--- STORAGE FILES ---');
  const buckets = ['deliverables', 'workspace-assets', 'content-calendars'];
  for (const b of buckets) {
    const { data: files, error } = await supabase.storage.from(b).list('', { limit: 100 });
    if (error) {
      console.log(`Bucket ${b}: ERROR - ${error.message}`);
    } else {
      console.log(`Bucket ${b}: ${files.length} items`);
      for (const f of files) {
        console.log(`  - ${f.name} (${f.id || 'dir/file'})`);
        // If it's a folder, list children
        const { data: subFiles } = await supabase.storage.from(b).list(f.name, { limit: 100 });
        if (subFiles && subFiles.length > 0) {
          for (const sf of subFiles) {
            console.log(`     * ${f.name}/${sf.name}`);
          }
        }
      }
    }
  }
}

main().catch(console.error);
