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

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: auditActors } = await supabase.from('audit_events').select('actor_id');
  const uniqueActors = [...new Set((auditActors || []).map(a => a.actor_id))];
  console.log('Unique audit event actors:', uniqueActors);

  const { data: people } = await supabase.from('roster_people').select('id, display_name, job_title');
  const actorMap = Object.fromEntries((people || []).map(p => [p.id, p.display_name]));
  console.log('Actor names in audit events:');
  for (const a of uniqueActors) {
    console.log(`- ${a}: ${actorMap[a] || 'Unknown/None'}`);
  }
}

check();
