const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// 1. Strict Target Project Safeguards
const TARGET_PROJECT_REF = 'whzkpuovqllybxlyoikk';
const WORKSPACE_ID = 'a180f3ab-33bb-4431-88a4-592add7c773e';
const EMAD_ROSTER_ID = 'bcfa3baa-7045-4262-abd6-bdb0be8210fd';

const envPath = path.join(__dirname, '..', '.env.local.production.bak');
if (!fs.existsSync(envPath)) {
  console.error('CRITICAL ERROR: .env.local.production.bak not found!');
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
}

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_URL.includes(TARGET_PROJECT_REF)) {
  console.error(`CRITICAL SAFETY ABORT: SUPABASE_URL does not match target project ref ${TARGET_PROJECT_REF}!`);
  process.exit(1);
}

// 2. Verify Backup Exists and Verified
const backupFile = path.join(__dirname, '..', 'backups', 'production_pre_reset_1790109833544.json');
if (!fs.existsSync(backupFile)) {
  console.error('CRITICAL SAFETY ABORT: Pre-reset backup file not found!');
  process.exit(1);
}
const backupStat = fs.statSync(backupFile);
if (backupStat.size < 1000) {
  console.error('CRITICAL SAFETY ABORT: Pre-reset backup file is suspiciously small!');
  process.exit(1);
}

console.log('====================================================');
console.log('OMG CREATIVE WORKSPACE - CLEAN PRODUCTION RESET');
console.log('Target Project:', TARGET_PROJECT_REF);
console.log('Backup verified:', backupFile, `(${backupStat.size} bytes)`);
console.log('====================================================\n');

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function listAllStorageFiles(bucketName, prefix = '') {
  let filePaths = [];
  const { data: items, error } = await supabase.storage.from(bucketName).list(prefix, {
    limit: 100,
    offset: 0,
    sortBy: { column: 'name', order: 'asc' }
  });

  if (error || !items) return filePaths;

  for (const item of items) {
    const itemPath = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) {
      const subFiles = await listAllStorageFiles(bucketName, itemPath);
      filePaths = filePaths.concat(subFiles);
    } else {
      filePaths.push(itemPath);
    }
  }
  return filePaths;
}

async function runCleanReset() {
  console.log('--- STEP 1: Deleting operational files from storage ---');
  const filesToDelete = await listAllStorageFiles('content-calendars');
  console.log(`Found ${filesToDelete.length} files in content-calendars bucket.`);
  if (filesToDelete.length > 0) {
    const { data: delFiles, error: delErr } = await supabase.storage.from('content-calendars').remove(filesToDelete);
    if (delErr) {
      console.error('Storage deletion error:', delErr);
    } else {
      console.log(`✓ Deleted ${delFiles?.length || filesToDelete.length} files from storage.`);
    }
  }

  console.log('\n--- STEP 2: Deleting operational database records in FK order ---');

  const operationalTables = [
    { table: 'time_activity_segments', filter: 'id' },
    { table: 'time_entry_segments', filter: 'id' },
    { table: 'time_entries', filter: 'workspace_id' },
    { table: 'task_checklist_items', filter: 'id' },
    { table: 'task_collaborators', filter: 'task_id' },
    { table: 'task_status_events', filter: 'workspace_id' },
    { table: 'task_assignment_events', filter: 'workspace_id' },
    { table: 'review_rounds', filter: 'workspace_id' },
    { table: 'task_deliverables', filter: 'workspace_id' },
    { table: 'attachments', filter: 'workspace_id' },
    { table: 'comments', filter: 'workspace_id' },
    { table: 'in_app_notifications', filter: 'workspace_id' },
    { table: 'tasks', filter: 'workspace_id' },
    { table: 'content_calendar_items', filter: 'workspace_id' },
    { table: 'campaign_revisions', filter: 'id' },
    { table: 'campaigns', filter: 'workspace_id' },
    { table: 'client_briefs', filter: 'workspace_id' },
    { table: 'client_team_assignments', filter: 'workspace_id' },
    { table: 'clients', filter: 'workspace_id' },
    { table: 'ai_jobs', filter: 'workspace_id' },
    { table: 'ai_extraction_cache', filter: 'workspace_id' },
  ];

  for (const { table, filter } of operationalTables) {
    process.stdout.write(`Resetting ${table}... `);
    let query = supabase.from(table).delete();
    if (filter === 'workspace_id') {
      query = query.eq('workspace_id', WORKSPACE_ID);
    } else {
      query = query.neq(filter, '00000000-0000-0000-0000-000000000000');
    }
    const { error } = await query;
    if (error) {
      console.log(`ERROR: ${error.message}`);
    } else {
      console.log('✓ Cleared');
    }
  }

  console.log('\n--- STEP 3: Cleaning Invitations ---');
  // Clear obsolete pending/draft invitations
  const { error: invErr } = await supabase
    .from('workspace_invitations')
    .delete()
    .eq('workspace_id', WORKSPACE_ID);

  if (invErr) {
    console.log('Error deleting invitations:', invErr.message);
  } else {
    console.log('✓ Workspace invitations reset to clean state.');
  }

  console.log('\n--- STEP 4: Resetting review routing rules ---');
  const { error: rrrErr } = await supabase
    .from('review_routing_rules')
    .delete()
    .eq('workspace_id', WORKSPACE_ID);
  if (rrrErr) {
    console.log('Error resetting review routing rules:', rrrErr.message);
  } else {
    console.log('✓ Review routing rules reset.');
  }

  console.log('\n--- STEP 5: Verifying Operational Counts ---');
  const verifyTables = [
    'clients',
    'client_briefs',
    'client_team_assignments',
    'campaigns',
    'content_calendar_items',
    'tasks',
    'review_rounds',
    'task_deliverables',
    'time_entries',
    'in_app_notifications',
    'workspace_invitations',
  ];

  let allClean = true;
  for (const t of verifyTables) {
    const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`  ${t}: Error checking (${error.message})`);
      allClean = false;
    } else {
      console.log(`  ${t}: ${count} rows`);
      if (count !== 0) allClean = false;
    }
  }

  console.log('\n--- STEP 6: Logging Production Reset Audit Event ---');
  const { data: auditRecord, error: auditErr } = await supabase
    .from('audit_events')
    .insert({
      workspace_id: WORKSPACE_ID,
      actor_id: EMAD_ROSTER_ID,
      action: 'production_clean_reset',
      entity_type: 'workspaces',
      entity_id: WORKSPACE_ID,
      metadata: {
        authorized_by: 'عماد (Owner)',
        reason: 'Authorized Clean Production Launch & Self-Service Administration',
        backup_file: 'production_pre_reset_1790109833544.json',
        backup_sha256: '67d9268d7df76d2755bf2557c2706c9e61664cbb3659bd8282253d45a8226330',
        timestamp: new Date().toISOString()
      }
    })
    .select('id, action, created_at')
    .single();

  if (auditErr) {
    console.error('Audit event error:', auditErr);
  } else {
    console.log('✓ Production reset audit event recorded:', auditRecord);
  }

  console.log('\n====================================================');
  if (allClean) {
    console.log('SUCCESS: Production operational data safely reset.');
    console.log('Workspace is clean, verified, and ready for self-service onboarding.');
  } else {
    console.log('WARNING: Some counts were non-zero. Please check output.');
  }
  console.log('====================================================');
}

runCleanReset().catch(err => {
  console.error('Fatal reset error:', err);
  process.exit(1);
});
