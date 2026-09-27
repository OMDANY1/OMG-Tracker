const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

let envPath = path.resolve(__dirname, '../.env.local.production.bak');
if (!fs.existsSync(envPath)) envPath = path.resolve(__dirname, '../.env.local');
const env = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    env[match[1]] = value;
  }
});

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const { data: ws } = await admin.from('workspaces').select('id').limit(1).single();
  const wsId = ws.id;

  const { data: people } = await admin.from('roster_people').select('*').eq('workspace_id', wsId);
  const emad = people.find(p => p.role === 'owner');
  const ahmad = people.find(p => p.role === 'company_owner');

  console.log('Emad:', emad?.display_name, 'Ahmad:', ahmad?.display_name);

  // Temporarily set Ahmad inactive to make Emad the sole active admin
  await admin.from('roster_people').update({ is_active: false }).eq('id', ahmad.id);
  await admin.from('workspace_memberships').update({ is_active: false }).eq('roster_person_id', ahmad.id);

  try {
    // 1. Try downgrading Emad (should fail)
    const { error: downErr } = await admin.rpc('admin_update_roster_person', {
      p_workspace_id: wsId,
      p_roster_person_id: emad.id,
      p_job_title: emad.job_title,
      p_specialties: ['management'],
      p_role: 'designer',
      p_access_scope: 'workspace',
      p_custom_permissions: {},
    });
    console.log('Downgrade error (expected):', downErr?.message);

    // 2. Try deactivating Emad (should fail)
    const { error: deactErr } = await admin.rpc('toggle_workspace_member_active', {
      p_workspace_id: wsId,
      p_roster_person_id: emad.id,
      p_is_active: false,
    });
    console.log('Deactivate error (expected):', deactErr?.message);
  } finally {
    // Always restore Ahmad to active
    await admin.from('roster_people').update({ is_active: true }).eq('id', ahmad.id);
    await admin.from('workspace_memberships').update({ is_active: true }).eq('roster_person_id', ahmad.id);
    // Always ensure Emad is active owner
    await admin.from('roster_people').update({ is_active: true, role: 'owner' }).eq('id', emad.id);
    await admin.from('workspace_memberships').update({ is_active: true, role: 'owner' }).eq('roster_person_id', emad.id);
    console.log('Restored all owners to active status successfully.');
  }
}

test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
