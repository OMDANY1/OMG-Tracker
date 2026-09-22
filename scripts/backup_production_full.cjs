const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
  const timestamp = Date.now();
  console.log(`=== FULL PRODUCTION PRE-RESET BACKUP [${new Date().toISOString()}] ===`);
  
  const backupDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const storageBackupDir = path.join(backupDir, `storage_pre_reset_${timestamp}`);
  if (!fs.existsSync(storageBackupDir)) fs.mkdirSync(storageBackupDir, { recursive: true });

  const artifactDir = path.join('C:', 'Users', 'elwady', '.gemini', 'antigravity', 'brain', '4f958e1c-479f-453e-888c-49e86530171c');

  const backupData = {
    timestamp: new Date().toISOString(),
    epoch: timestamp,
    source_project: 'whzkpuovqllybxlyoikk',
    tables: {},
    table_counts: {},
    storage_files: []
  };

  // 1. Backup all 31 tables
  console.log('\n--- 1. BACKING UP ALL 31 TABLES ---');
  for (const table of ALL_TABLES) {
    const { data, error } = await supabase.from(table).select('*');
    if (error) {
      console.warn(`Table [${table}] ERROR:`, error.message);
      backupData.tables[table] = { error: error.message };
      backupData.table_counts[table] = `ERROR: ${error.message}`;
    } else {
      backupData.tables[table] = data || [];
      backupData.table_counts[table] = (data || []).length;
      console.log(`✓ Table [${table}]: ${(data || []).length} rows`);
    }
  }

  // 2. Backup storage files recursively
  console.log('\n--- 2. BACKING UP STORAGE BUCKETS RECURSIVELY ---');
  const buckets = ['content-calendars', 'deliverables', 'workspace-assets'];

  async function downloadRecursive(bucket, prefix) {
    const { data: items, error } = await supabase.storage.from(bucket).list(prefix, { limit: 100 });
    if (error || !items) return;
    for (const item of items) {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (!item.id) {
        // Subdirectory
        await downloadRecursive(bucket, fullPath);
      } else {
        // File
        const { data: fileData, error: fErr } = await supabase.storage.from(bucket).download(fullPath);
        if (!fErr && fileData) {
          const buffer = Buffer.from(await fileData.arrayBuffer());
          const localTarget = path.join(storageBackupDir, bucket, path.dirname(fullPath));
          if (!fs.existsSync(localTarget)) fs.mkdirSync(localTarget, { recursive: true });
          const localFilePath = path.join(storageBackupDir, bucket, fullPath);
          fs.writeFileSync(localFilePath, buffer);
          console.log(`✓ Downloaded storage file: ${bucket}/${fullPath} (${buffer.length} bytes)`);
          backupData.storage_files.push({
            bucket,
            path: fullPath,
            sizeBytes: buffer.length,
            sha256: crypto.createHash('sha256').update(buffer).digest('hex')
          });
        }
      }
    }
  }

  for (const bucket of buckets) {
    await downloadRecursive(bucket, '');
  }

  // 3. Compute Checksum of JSON data
  const jsonString = JSON.stringify(backupData, null, 2);
  const dataChecksum = crypto.createHash('sha256').update(jsonString).digest('hex');
  backupData.checksum = dataChecksum;

  const finalJson = JSON.stringify(backupData, null, 2);
  const backupFilePath = path.join(backupDir, `production_pre_reset_${timestamp}.json`);
  fs.writeFileSync(backupFilePath, finalJson, 'utf8');
  console.log(`\n✓ Full JSON Backup saved: ${backupFilePath}`);
  console.log(`✓ SHA-256 Checksum: ${dataChecksum}`);

  // Copy to artifacts
  const artifactFilePath = path.join(artifactDir, `production_pre_reset_${timestamp}.json`);
  try {
    fs.writeFileSync(artifactFilePath, finalJson, 'utf8');
    console.log(`✓ Copied to artifacts directory: ${artifactFilePath}`);
  } catch (e) {
    console.warn('Artifact copy failed:', e.message);
  }

  console.log('\n=== BACKUP COMPLETED SUCCESSFULLY ===');
}

main().catch(console.error);
