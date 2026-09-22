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

async function createBackup() {
  const tables = [
    'workspaces',
    'roster_people',
    'workspace_memberships',
    'workspace_invitations',
    'clients',
    'campaigns',
    'content_calendar_items',
    'tasks',
    'task_collaborators',
    'review_rounds',
    'time_entries',
    'member_capacities',
    'audit_events',
    'in_app_notifications',
    'ai_processing_jobs'
  ];

  console.log('--- STARTING PRODUCTION PRE-ROLLOUT BACKUP ---');
  const backupData = {
    timestamp: new Date().toISOString(),
    source_project: 'whzkpuovqllybxlyoikk',
    tables: {}
  };

  const recordCounts = {};

  for (const table of tables) {
    try {
      const { data, error } = await supabase.from(table).select('*');
      if (error) {
        console.warn(`Table ${table} query returned error:`, error.message);
        backupData.tables[table] = { error: error.message };
        recordCounts[table] = `ERROR: ${error.message}`;
      } else {
        backupData.tables[table] = data || [];
        recordCounts[table] = (data || []).length;
        console.log(`✓ Table [${table}]: ${(data || []).length} records captured`);
      }
    } catch (e) {
      console.warn(`Exception reading table ${table}:`, e.message);
      backupData.tables[table] = { error: e.message };
      recordCounts[table] = `EXCEPTION: ${e.message}`;
    }
  }

  const timestamp = Date.now();
  const backupDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const backupFile = path.join(backupDir, `production_pre_rollout_${timestamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf8');

  // Also save in artifacts directory for permanence
  const artifactBackupFile = path.join('C:', 'Users', 'elwady', '.gemini', 'antigravity', 'brain', '4f958e1c-479f-453e-888c-49e86530171c', `production_pre_rollout_${timestamp}.json`);
  try {
    fs.writeFileSync(artifactBackupFile, JSON.stringify(backupData, null, 2), 'utf8');
    console.log('✓ Copied backup to artifacts directory:', artifactBackupFile);
  } catch (e) {
    console.warn('Could not copy to artifact directory:', e.message);
  }

  console.log('\n--- BACKUP SUMMARY ---');
  console.log('Backup saved to:', backupFile);
  console.log('Record counts:', JSON.stringify(recordCounts, null, 2));
}

createBackup().catch(console.error);
