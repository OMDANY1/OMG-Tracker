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
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: 'emadadelgd@gmail.com',
    options: {
      redirectTo: 'https://omg-creative-workspace.vercel.app/clients'
    }
  });
  if (error) {
    console.error('Error generating link:', error);
  } else {
    console.log('Action link:', data?.properties?.action_link);
    console.log('Email OTP:', data?.properties?.email_otp);
    console.log('Hashed token:', data?.properties?.hashed_token);
  }
}

main().catch(console.error);
