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
  const workspaceId = 'a180f3ab-33bb-4431-88a4-592add7c773e';
  const emadRosterId = 'bcfa3baa-7045-4262-abd6-bdb0be8210fd';

  // Enable invitations
  const { data: ws, error: errWs } = await supabase
    .from('workspaces')
    .update({ invitations_paused: false, updated_at: new Date().toISOString() })
    .eq('id', workspaceId)
    .select('id, name, invitations_paused')
    .single();

  if (errWs) {
    console.error('Error enabling invitations:', errWs);
    return;
  }
  console.log('✓ Invitations status updated:', ws);

  // Record Audit Event under Emad (real executor)
  const { data: audit, error: errAudit } = await supabase
    .from('audit_events')
    .insert({
      workspace_id: workspaceId,
      actor_id: emadRosterId,
      action: 'enable_invitations_acceptance',
      entity_type: 'workspaces',
      entity_id: workspaceId,
      metadata: {
        invitations_paused: false,
        reason: 'Approved production rollout and team onboarding activation',
        activated_by: 'عماد',
        timestamp: new Date().toISOString()
      }
    })
    .select('id, action, created_at')
    .single();

  if (errAudit) {
    console.error('Error logging audit event:', errAudit);
  } else {
    console.log('✓ Audit event recorded successfully:', audit);
  }
}

main().catch(console.error);
