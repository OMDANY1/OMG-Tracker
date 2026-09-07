/**
 * OMG Creative Workspace - Owner Bootstrap CLI Tool
 * Usage: node scripts/bootstrap-owner-cli.js <email> <password> [fullName]
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const projectRoot = path.join(__dirname, '..');
const tokenPath = path.join(projectRoot, '.owner-setup-token');

// Read .env.local
const envFile = path.join(projectRoot, '.env.local');
if (!fs.existsSync(envFile)) {
  console.error("❌ Error: .env.local not found in project root.");
  process.exit(1);
}

const envContent = fs.readFileSync(envFile, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let val = match[2] || '';
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    env[match[1]] = val;
  }
}

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'];

if (!supabaseUrl || !serviceRoleKey) {
  console.error("❌ Error: Missing Supabase credentials in .env.local");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  const fullName = process.argv[4] || "المدير العام";

  if (!email || !password) {
    console.log("Usage: node scripts/bootstrap-owner-cli.js <email> <password> [fullName]");
    process.exit(1);
  }

  // Check existing owner
  const { data: owners, error: checkErr } = await admin
    .from("workspace_memberships")
    .select("id")
    .eq("role", "owner")
    .eq("is_active", true);

  if (checkErr) {
    console.error("❌ Database query error:", checkErr);
    process.exit(1);
  }

  if (owners && owners.length > 0) {
    console.error("❌ Locked: Workspace already has an active Owner membership.");
    process.exit(1);
  }

  // Check workspace
  const { data: ws, error: wsErr } = await admin.from("workspaces").select("id").limit(1);
  if (wsErr || !ws || ws.length === 0) {
    console.error("❌ Error: No workspace found in database.");
    process.exit(1);
  }
  const workspaceId = ws[0].id;

  // Check owner roster
  const { data: roster, error: rErr } = await admin
    .from("roster_people")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("display_name", "المدير العام (Owner)")
    .limit(1);

  if (rErr || !roster || roster.length === 0) {
    console.error("❌ Error: Owner roster person not found in database.");
    process.exit(1);
  }
  const rosterPersonId = roster[0].id;

  // Create user in auth.users
  console.log(`Creating/linking user for ${email}...`);
  let userId;
  const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createErr) {
    if (createErr.message.includes("already been registered") || createErr.message.includes("unique")) {
      const { data: listData } = await admin.auth.admin.listUsers();
      const existing = listData?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (!existing) {
        console.error("❌ User exists but could not be retrieved.");
        process.exit(1);
      }
      userId = existing.id;
      await admin.auth.admin.updateUserById(userId, { password, user_metadata: { full_name: fullName } });
    } else {
      console.error("❌ Failed to create auth user:", createErr.message);
      process.exit(1);
    }
  } else {
    userId = newUser.user.id;
  }

  // Invoke bootstrap_owner RPC
  console.log("Activating Owner in workspace memberships via bootstrap_owner RPC...");
  const { data: bootData, error: bootErr } = await admin.rpc("bootstrap_owner", {
    p_workspace_id: workspaceId,
    p_owner_user_id: userId,
    p_roster_person_id: rosterPersonId,
  });

  if (bootErr) {
    console.error("❌ bootstrap_owner RPC failed:", bootErr.message);
    process.exit(1);
  }

  // Consume token if it exists
  if (fs.existsSync(tokenPath)) {
    try {
      fs.unlinkSync(tokenPath);
      console.log("🔒 Consumed and removed .owner-setup-token file.");
    } catch (e) {}
  }

  console.log("\n=======================================================");
  console.log("✅ SUCCESS: Agency Owner has been configured and activated!");
  console.log(`   Email: ${email}`);
  console.log(`   Role: Owner (المدير العام)`);
  console.log(`   Workspace: OMG Creative Workspace`);
  console.log("   You can now log in at: http://localhost:3000/login");
  console.log("=======================================================");
}

main().catch(err => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
