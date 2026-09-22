const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { createServerClient } = require('@supabase/ssr');

const envPath = path.join(__dirname, '..', '.env.local.production.bak');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
}

const supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: 'emadadelgd@gmail.com'
  });
  if (linkErr) throw linkErr;

  const hashedToken = linkData.properties.hashed_token;
  console.log('Hashed token:', hashedToken);

  // Exchange hashed token for session using a temporary client
  const tempClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data: verifyData, error: verifyErr } = await tempClient.auth.verifyOtp({
    token_hash: hashedToken,
    type: 'magiclink'
  });
  if (verifyErr) throw verifyErr;

  console.log('Verify successful! User ID:', verifyData.user?.id);
  console.log('Session access_token length:', verifyData.session?.access_token.length);

  // Now let's see how createServerClient sets the cookies
  const cookies = [];
  const ssrClient = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() { return cookies; },
      setAll(toSet) {
        cookies.push(...toSet);
      }
    }
  });

  await ssrClient.auth.setSession({
    access_token: verifyData.session.access_token,
    refresh_token: verifyData.session.refresh_token
  });

  console.log('Generated SSR cookies:', cookies.map(c => ({ name: c.name, valLen: c.value.length, options: c.options })));
}

main().catch(console.error);
