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
  const { data: entries, error } = await admin
    .from('time_entries')
    .select(`
      id,
      started_at,
      ended_at,
      person:roster_people!fk_time_person(id, display_name, job_title),
      task:tasks(id, title, campaign:campaigns(title, client:clients(name)))
    `)
    .limit(5);

  console.log("Direct DB test for time_entries with fk_time_person:", { count: entries?.length, error });
}

main().catch(console.error).finally(() => process.exit(0));
