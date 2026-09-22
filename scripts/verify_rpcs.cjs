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

async function verifyRPCs() {
  const rpcsToCheck = [
    'upsert_client_team_assignment',
    'upsert_client_brief',
    'approve_client_brief_strategy',
    'review_client_brief_operational',
    'decide_review_round',
    'set_task_waiting_state',
    'submit_task_deliverable',
    'approve_copywriting_and_unlock_downstream',
    'set_workspace_invitations_paused',
    'create_workspace_invitation',
    'accept_workspace_invitation'
  ];

  console.log('--- VERIFYING RPC FUNCTIONS ON PRODUCTION ---');
  for (const rpc of rpcsToCheck) {
    // Attempting to call with dummy invalid uuid to see if Postgres recognizes the function signature
    const { error } = await supabase.rpc(rpc, {});
    const funcExists = !error || (error.code !== 'PGRST202' && !error.message?.includes('Could not find the function'));
    console.log(`✓ RPC [${rpc}]: Exists in database: ${funcExists} (Response code: ${error ? error.code : 'success'}, Message: ${error ? error.message : 'OK'})`);
  }
}

verifyRPCs().catch(console.error);
