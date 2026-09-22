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

async function main() {
  const res1 = await supabase.from('client_team_assignments').select('*').limit(1);
  console.log('client_team_assignments:', res1.error || 'SUCCESS:', res1.data);

  const res2 = await supabase.from('client_briefs').select('*').limit(1);
  console.log('client_briefs:', res2.error || 'SUCCESS:', res2.data);

  const res3 = await supabase.from('task_deliverables').select('*').limit(1);
  console.log('task_deliverables:', res3.error || 'SUCCESS:', res3.data);
}

main().catch(console.error);
