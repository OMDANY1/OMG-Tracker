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

async function listFolder(bucket, prefix) {
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 100 });
  if (error) {
    console.error(`Error listing ${bucket}/${prefix}:`, error.message);
    return;
  }
  for (const item of data || []) {
    const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
    if (!item.id) {
      // Subdirectory
      console.log(`[DIR] ${bucket}/${fullPath}`);
      await listFolder(bucket, fullPath);
    } else {
      console.log(`[FILE] ${bucket}/${fullPath} (id: ${item.id}, size: ${item.metadata?.size || 'unknown'})`);
      const { data: fileData, error: fErr } = await supabase.storage.from(bucket).download(fullPath);
      if (fErr) {
        console.error(`Download error for ${fullPath}:`, fErr.message);
      } else {
        const buf = Buffer.from(await fileData.arrayBuffer());
        console.log(`✓ Downloaded ${fullPath}: ${buf.length} bytes`);
      }
    }
  }
}

async function main() {
  console.log('--- RECURSIVE STORAGE INSPECTION ---');
  await listFolder('content-calendars', '');
  await listFolder('deliverables', '');
  await listFolder('workspace-assets', '');
}

main().catch(console.error);
