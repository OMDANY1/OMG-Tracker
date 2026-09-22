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

async function testFunctionSignatures() {
  const dummyUUID = '00000000-0000-0000-0000-000000000000';

  console.log('--- TESTING RPC FUNCTION SIGNATURES ---');

  const res1 = await supabase.rpc('approve_client_brief_strategy', {
    p_workspace_id: dummyUUID,
    p_client_id: dummyUUID,
    p_approved_content: 'Test content'
  });
  console.log('approve_client_brief_strategy:', res1.error ? `EXECUTED (Error: ${res1.error.message})` : 'SUCCESS');

  const res2 = await supabase.rpc('review_client_brief_operational', {
    p_workspace_id: dummyUUID,
    p_client_id: dummyUUID,
    p_decision: 'approved'
  });
  console.log('review_client_brief_operational:', res2.error ? `EXECUTED (Error: ${res2.error.message})` : 'SUCCESS');

  const res3 = await supabase.rpc('set_task_waiting_state', {
    p_task_id: dummyUUID,
    p_is_waiting: false
  });
  console.log('set_task_waiting_state:', res3.error ? `EXECUTED (Error: ${res3.error.message})` : 'SUCCESS');

  const res4 = await supabase.rpc('upsert_client_team_assignment', {
    p_workspace_id: dummyUUID,
    p_client_id: dummyUUID
  });
  console.log('upsert_client_team_assignment:', res4.error ? `EXECUTED (Error: ${res4.error.message})` : 'SUCCESS');

  const res5 = await supabase.rpc('upsert_client_brief', {
    p_workspace_id: dummyUUID,
    p_client_id: dummyUUID
  });
  console.log('upsert_client_brief:', res5.error ? `EXECUTED (Error: ${res5.error.message})` : 'SUCCESS');
}

testFunctionSignatures().catch(console.error);
