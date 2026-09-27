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
  console.log("=== INSPECTING AHMAD AL-NAHHAS ===");
  const { data: users } = await admin.auth.admin.listUsers();
  const nahassAuthUsers = users?.users?.filter(u => u.email?.toLowerCase().includes('nahass'));
  console.log("Auth Users matching 'nahass':", nahassAuthUsers?.map(u => ({ id: u.id, email: u.email, created_at: u.created_at, app_metadata: u.app_metadata, user_metadata: u.user_metadata })));

  const { data: rosterNahass } = await admin.from('roster_people').select('*').ilike('display_name', '%نحاس%');
  console.log("Roster People matching 'نحاس':", rosterNahass);

  const { data: allRosters } = await admin.from('roster_people').select('id, display_name, email, role, job_title, is_active, access_scope, custom_permissions');
  console.log("All Roster People:", allRosters);

  if (nahassAuthUsers && nahassAuthUsers.length > 0) {
    for (const u of nahassAuthUsers) {
      const { data: mems } = await admin.from('workspace_memberships').select('*').eq('user_id', u.id);
      console.log(`Memberships for Auth User ${u.id} (${u.email}):`, mems);
    }
  }

  const { data: allMems } = await admin.from('workspace_memberships').select('*, roster_people(display_name, role)');
  console.log("All Workspace Memberships:", JSON.stringify(allMems, null, 2));
}

main().catch(console.error).finally(() => process.exit(0));
