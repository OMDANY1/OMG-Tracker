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

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
  const { data, error } = await admin.rpc('get_member_delete_impact', {
    p_workspace_id: 'a180f3ab-33bb-4431-88a4-592add7c773e',
    p_roster_person_id: '82a6a25a-3dad-4c6a-960c-6ace8389985a'
  });
  console.log("Delete impact for Nahass:", data, error);
}

main().catch(console.error).finally(() => process.exit(0));
