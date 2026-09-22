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
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('workspace_invitations')
    .update({ status: 'expired', updated_at: now })
    .eq('status', 'pending')
    .lt('expires_at', now)
    .select('id, invited_email, status');

  console.log('Expired invitations updated:', data, error);
}

main().catch(console.error);
