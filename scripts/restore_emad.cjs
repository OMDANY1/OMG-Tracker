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

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function fixEmad() {
  const { data: people, error } = await supabase.from('roster_people').select('id, display_name, role, is_active');
  console.log('People in DB:', people?.length, error);
  const emad = people?.find(p => p.display_name.includes('عماد') || p.role === 'owner');
  console.log('Found Emad:', emad);
  if (emad) {
    const { error: err1 } = await supabase.from('roster_people').update({ is_active: true, role: 'owner' }).eq('id', emad.id);
    console.log('Restored roster_people:', err1 ? err1.message : 'SUCCESS');
    const { error: err2 } = await supabase.from('workspace_memberships').update({ is_active: true, role: 'owner' }).eq('roster_person_id', emad.id);
    console.log('Restored workspace_memberships:', err2 ? err2.message : 'SUCCESS');
  }
}

fixEmad().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
