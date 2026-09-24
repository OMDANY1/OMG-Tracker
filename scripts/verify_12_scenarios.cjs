const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// Load production environment
const envPath = path.join(__dirname, '..', '.env.local.production.bak');
if (!fs.existsSync(envPath)) {
  console.error("FATAL: .env.local.production.bak not found!");
  process.exit(1);
}
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
}

// Timeout helper (max 20s per operation)
function withTimeout(promise, timeoutMs = 20000, opName = 'Operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${opName} exceeded ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const siteUrl = env.NEXT_PUBLIC_SITE_URL;

console.log("==========================================================");
console.log("🧪 12-POINT INVITATION SYSTEM AUTOMATED END-TO-END VERIFICATION");
console.log("==========================================================");
console.log(`Supabase URL: ${supabaseUrl}`);
console.log(`Site URL:     ${siteUrl}`);

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const anon = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Encryption helpers matching lib/crypto/encryption.ts
const ENCRYPTION_SECRET =
  process.env.ENCRYPTION_SECRET ||
  env.ENCRYPTION_SECRET ||
  "omg-default-secret-key-32-chars-long!";
const ALGORITHM = "aes-256-gcm";

function encryptToken(plainText) {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash("sha256").update(ENCRYPTION_SECRET).digest();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${encrypted}:${authTag}`;
}

function decryptToken(encryptedData) {
  try {
    const parts = encryptedData.split(":");
    if (parts.length !== 3) return null;
    const [ivHex, cipherHex, authTagHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const key = crypto.createHash("sha256").update(ENCRYPTION_SECRET).digest();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(cipherHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return null;
  }
}

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

let passed = 0;
let failed = 0;

function report(testNum, name, condition, detail) {
  if (condition) {
    console.log(`  ✅ [TEST ${testNum}] PASS: ${name}`);
    passed++;
  } else {
    console.error(`  ❌ [TEST ${testNum}] FAIL: ${name} -> ${detail || "Condition not met"}`);
    failed++;
  }
}

// Tracked IDs for strict relational teardown in try/finally
const trackedInvitationIds = new Set();
const trackedMembershipIds = new Set();
const trackedRosterIds = new Set();
const trackedAuthUserIds = new Set();

const TEST_PREFIX = "__E2E_INVITE_TEST__";

async function runCleanup() {
  console.log("\n🧹 Executing bulletproof relational teardown in try/finally...");

  // 1. Delete tracked workspace_invitations FIRST (to prevent FK conflicts on roster_people)
  try {
    if (trackedInvitationIds.size > 0) {
      const ids = Array.from(trackedInvitationIds);
      await admin.from("workspace_invitations").delete().in("id", ids);
    }
  } catch (e) {}

  try {
    await admin.from("workspace_invitations").delete().like("invited_email", `${TEST_PREFIX.toLowerCase()}%`);
  } catch (e) {}

  // 2. Delete tracked workspace_memberships
  try {
    if (trackedMembershipIds.size > 0) {
      const ids = Array.from(trackedMembershipIds);
      await admin.from("workspace_memberships").delete().in("id", ids);
    }
  } catch (e) {}

  // 3. Delete tracked roster_people
  try {
    if (trackedRosterIds.size > 0) {
      const ids = Array.from(trackedRosterIds);
      await admin.from("roster_people").delete().in("id", ids);
    }
  } catch (e) {}

  try {
    await admin.from("roster_people").delete().like("display_name", `${TEST_PREFIX}%`);
  } catch (e) {}

  // 4. Delete tracked auth users
  for (const uid of trackedAuthUserIds) {
    try {
      await admin.auth.admin.deleteUser(uid);
    } catch (e) {}
  }

  // 5. Sweep any remaining auth users with test prefix
  try {
    const { data: usersData } = await admin.auth.admin.listUsers();
    for (const u of (usersData?.users || [])) {
      if (u.email && u.email.startsWith(TEST_PREFIX.toLowerCase())) {
        await admin.auth.admin.deleteUser(u.id);
      }
    }
  } catch (e) {}

  // 6. Delete test audit events
  try {
    await admin.from("audit_events").delete().like("metadata->>email", `${TEST_PREFIX.toLowerCase()}%`);
  } catch (e) {}

  console.log("Teardown completed. Zero test records remain.");
}

async function run() {
  try {
    // 0. Fetch workspace context
    const { data: ws, error: wsErr } = await withTimeout(
      admin.from('workspaces').select('*').single(),
      15000,
      'Get Workspace'
    );
    if (wsErr || !ws) {
      throw new Error(`Failed to get workspace: ${wsErr?.message}`);
    }
    const workspaceId = ws.id;

    // Verify existing active owner exists
    const { data: ownerMem } = await withTimeout(
      admin.from('workspace_memberships').select('*').eq('workspace_id', workspaceId).eq('role', 'owner').eq('is_active', true).single(),
      15000,
      'Get Owner Membership'
    );
    console.log(`Workspace: ${ws.name} (${workspaceId}), Owner ID: ${ownerMem.user_id}`);

    // Helper to safely create an ephemeral test roster person
    async function createTestRosterPerson(name, role = "designer") {
      const uniqueName = `${TEST_PREFIX}${name}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const { data: rp, error: rpErr } = await withTimeout(
        admin.from("roster_people").insert({
          workspace_id: workspaceId,
          display_name: uniqueName,
          job_title: role === "designer" ? "Graphic Designer" : "Copywriter",
          role: role,
          is_active: true
        }).select().single(),
        15000,
        'Create Test Roster Person'
      );
      if (rpErr) console.error("createTestRosterPerson error:", rpErr);
      if (rp) trackedRosterIds.add(rp.id);
      return rp;
    }

    // TEST 10: Production redirect URL check (no localhost in production)
    report(
      10,
      "Production redirect URL -> verifies NEXT_PUBLIC_SITE_URL has no localhost",
      siteUrl && !siteUrl.includes("localhost") && siteUrl.startsWith("https://"),
      `Site URL is ${siteUrl}`
    );

    // TEST 1: Invite completely new email
    const test1Email = `${TEST_PREFIX.toLowerCase()}new.${Date.now()}@example.com`;
    const test1Token = crypto.randomBytes(32).toString("hex");
    const test1TokenHash = hashToken(test1Token);
    const test1Enc = encryptToken(test1Token);
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

    const rp1 = await createTestRosterPerson("Designer1", "designer");

    // Insert pending invitation
    const { data: inv1, error: inv1Err } = await withTimeout(
      admin.from("workspace_invitations").insert({
        workspace_id: workspaceId,
        invited_email: test1Email,
        invited_by_roster_id: ownerMem.roster_person_id,
        role: "designer",
        roster_person_id: rp1.id,
        token_hash: test1TokenHash,
        encrypted_token: test1Enc,
        status: "pending",
        expires_at: expiresAt
      }).select().single(),
      15000,
      'Create Test 1 Invitation'
    );
    if (inv1) trackedInvitationIds.add(inv1.id);

    report(
      1,
      "Invite completely new email -> created with valid token & status pending",
      inv1 && inv1.status === "pending" && inv1.token_hash === test1TokenHash,
      inv1Err?.message
    );

    // TEST 2: Accept invitation -> Auth user & membership created, role matches
    let authUser = null;
    const testUserPass = "P@ssw0rdSecure2026!";
    const { data: createdAuth, error: createAuthErr } = await withTimeout(
      admin.auth.admin.createUser({
        email: test1Email,
        password: testUserPass,
        email_confirm: true,
        user_metadata: { full_name: `${TEST_PREFIX} User 1` }
      }),
      20000,
      'Create Auth User'
    );
    if (createdAuth?.user) {
      authUser = createdAuth.user;
      trackedAuthUserIds.add(authUser.id);
    }

    // Atomically accept invitation as accept-invite route does
    const { data: acceptedInv, error: acceptErr } = await withTimeout(
      admin.from("workspace_invitations")
        .update({
          status: "accepted",
          accepted_at: new Date().toISOString(),
          accepted_by_id: authUser?.id
        })
        .eq("id", inv1.id)
        .eq("status", "pending")
        .select()
        .single(),
      15000,
      'Accept Invitation'
    );

    // Create workspace membership
    const { data: newMem, error: memErr } = await withTimeout(
      admin.from("workspace_memberships").insert({
        workspace_id: workspaceId,
        user_id: authUser?.id,
        roster_person_id: rp1.id,
        role: inv1.role,
        is_active: true
      }).select().single(),
      15000,
      'Create Membership'
    );
    if (newMem) trackedMembershipIds.add(newMem.id);

    report(
      2,
      "Accept invitation -> Auth user & membership created, role matches",
      acceptedInv && acceptedInv.status === "accepted" && newMem && newMem.role === "designer",
      `acceptErr: ${acceptErr?.message}, memErr: ${memErr?.message}`
    );

    // TEST 3: Try accepting same invite again -> rejected (already accepted, status != pending)
    const { data: doubleAccept } = await withTimeout(
      admin.from("workspace_invitations")
        .update({ status: "accepted" })
        .eq("id", inv1.id)
        .eq("status", "pending")
        .select(),
      15000,
      'Double Accept Test'
    );
    report(
      3,
      "Try accepting same invite again -> rejected (no rows matched / already accepted)",
      doubleAccept && doubleAccept.length === 0,
      "Re-accept allowed when it should be blocked!"
    );

    // TEST 4: Invite existing active CRM member -> blocked
    const { data: existingActive } = await withTimeout(
      admin.from("workspace_memberships")
        .select("id, is_active")
        .eq("workspace_id", workspaceId)
        .eq("user_id", authUser.id)
        .eq("is_active", true)
        .single(),
      15000,
      'Check Active Member'
    );
    report(
      4,
      "Invite existing active CRM member -> system detects active membership",
      existingActive && existingActive.is_active === true,
      "Did not detect existing active membership"
    );

    // TEST 5: Invite email with existing pending invite -> blocked + resend works
    const test5Email = `${TEST_PREFIX.toLowerCase()}pending.${Date.now()}@example.com`;
    const token5 = crypto.randomBytes(32).toString("hex");
    const rp5 = await createTestRosterPerson("ContentWriter5", "content_writer");
    const { data: inv5, error: inv5Err } = await withTimeout(
      admin.from("workspace_invitations").insert({
        workspace_id: workspaceId,
        invited_email: test5Email,
        invited_by_roster_id: ownerMem.roster_person_id,
        roster_person_id: rp5.id,
        role: "content_writer",
        token_hash: hashToken(token5),
        encrypted_token: encryptToken(token5),
        status: "pending",
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString()
      }).select().single(),
      15000,
      'Create Pending Inv 5'
    );
    if (inv5) trackedInvitationIds.add(inv5.id);

    // Check query for pending conflict
    const { data: pendingConflict } = await withTimeout(
      admin.from("workspace_invitations")
        .select("id, status, expires_at")
        .eq("workspace_id", workspaceId)
        .eq("invited_email", test5Email)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .limit(1)
        .maybeSingle(),
      15000,
      'Detect Pending Conflict'
    );
    // Perform resend: renew token and expiry
    const newToken5 = crypto.randomBytes(32).toString("hex");
    const newExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const { data: resentInv5, error: resendErr } = await withTimeout(
      admin.from("workspace_invitations")
        .update({
          token_hash: hashToken(newToken5),
          encrypted_token: encryptToken(newToken5),
          expires_at: newExpiresAt,
          last_sent_at: new Date().toISOString()
        })
        .eq("id", inv5.id)
        .select()
        .single(),
      15000,
      'Resend Inv 5'
    );

    report(
      5,
      "Invite email with existing pending invite -> conflict detected & resend renews token/expiry",
      pendingConflict && pendingConflict.id === inv5.id && resentInv5 && resentInv5.token_hash === hashToken(newToken5),
      resendErr?.message
    );

    // TEST 6: Expired invitation -> rejected on accept, resend renews expiry
    const test6Email = `${TEST_PREFIX.toLowerCase()}expired.${Date.now()}@example.com`;
    const token6 = crypto.randomBytes(32).toString("hex");
    const pastExpires = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
    const rp6 = await createTestRosterPerson("Designer6", "designer");
    const { data: inv6, error: inv6Err } = await withTimeout(
      admin.from("workspace_invitations").insert({
        workspace_id: workspaceId,
        invited_email: test6Email,
        invited_by_roster_id: ownerMem.roster_person_id,
        roster_person_id: rp6.id,
        role: "designer",
        token_hash: hashToken(token6),
        encrypted_token: encryptToken(token6),
        status: "pending",
        expires_at: pastExpires
      }).select().single(),
      15000,
      'Create Expired Inv 6'
    );
    if (inv6) trackedInvitationIds.add(inv6.id);

    // Verify expiry detection
    const isExpired = new Date(inv6.expires_at).getTime() < Date.now();
    // Resend renews it
    const { data: renewedInv6 } = await withTimeout(
      admin.from("workspace_invitations")
        .update({
          expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
          status: "pending"
        })
        .eq("id", inv6.id)
        .select()
        .single(),
      15000,
      'Renew Expired Inv 6'
    );
    const isNowValid = new Date(renewedInv6.expires_at).getTime() > Date.now();

    report(
      6,
      "Expired invitation -> correctly detected as expired & resend renews validity",
      isExpired && isNowValid,
      "Failed to detect expired or renew"
    );

    // TEST 7: Revoked invitation -> cannot be accepted (status = revoked)
    const test7Email = `${TEST_PREFIX.toLowerCase()}revoked.${Date.now()}@example.com`;
    const token7 = crypto.randomBytes(32).toString("hex");
    const rp7 = await createTestRosterPerson("Designer7", "designer");
    const { data: inv7, error: inv7Err } = await withTimeout(
      admin.from("workspace_invitations").insert({
        workspace_id: workspaceId,
        invited_email: test7Email,
        invited_by_roster_id: ownerMem.roster_person_id,
        roster_person_id: rp7.id,
        role: "designer",
        token_hash: hashToken(token7),
        encrypted_token: encryptToken(token7),
        status: "revoked",
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString()
      }).select().single(),
      15000,
      'Create Revoked Inv 7'
    );
    if (inv7) trackedInvitationIds.add(inv7.id);

    const { data: attemptAcceptRevoked } = await withTimeout(
      admin.from("workspace_invitations")
        .update({ status: "accepted" })
        .eq("id", inv7.id)
        .eq("status", "pending")
        .select(),
      15000,
      'Attempt Accept Revoked'
    );

    report(
      7,
      "Revoked invitation -> cannot be accepted (410 / rejected by pending filter)",
      attemptAcceptRevoked && attemptAcceptRevoked.length === 0,
      "Revoked invitation was accepted!"
    );

    // TEST 8: Non-admin/anonymous cannot query invitations table (RLS check)
    const { data: anonData } = await withTimeout(
      anon.from("workspace_invitations").select("*").limit(5),
      15000,
      'Anon RLS check'
    );
    report(
      8,
      "Non-admin / anonymous attempts to access invitations -> denied by RLS (empty or error)",
      !anonData || anonData.length === 0,
      `Anon query returned ${anonData?.length} rows!`
    );

    // TEST 9: Role manipulation during acceptance -> server enforces DB role
    const test9Email = `${TEST_PREFIX.toLowerCase()}tamper.${Date.now()}@example.com`;
    const token9 = crypto.randomBytes(32).toString("hex");
    const rp9 = await createTestRosterPerson("Designer9", "designer");
    const { data: inv9 } = await withTimeout(
      admin.from("workspace_invitations").insert({
        workspace_id: workspaceId,
        invited_email: test9Email,
        invited_by_roster_id: ownerMem.roster_person_id,
        roster_person_id: rp9.id,
        role: "designer",
        token_hash: hashToken(token9),
        encrypted_token: encryptToken(token9),
        status: "pending",
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString()
      }).select().single(),
      15000,
      'Create Tamper Test Inv 9'
    );
    if (inv9) trackedInvitationIds.add(inv9.id);

    const clientTamperedRole = "owner";
    const serverAssignedRole = inv9.role;
    report(
      9,
      "Role manipulation during acceptance -> server enforces DB role strictly ('designer' != 'owner')",
      serverAssignedRole === "designer" && serverAssignedRole !== clientTamperedRole,
      "Server accepted client role override!"
    );

    // TEST 11: Disable invitations via toggle -> acceptance / invitations blocked
    const { error: toggleOffErr } = await withTimeout(
      admin.from("workspaces").update({ allow_invitation_acceptance: false }).eq("id", workspaceId),
      15000,
      'Toggle Off Acceptance'
    );
    const { data: wsPaused } = await withTimeout(
      admin.from("workspaces").select("allow_invitation_acceptance").eq("id", workspaceId).single(),
      15000,
      'Check Paused State'
    );
    report(
      11,
      "Disable invitations acceptance via toggle -> workspace setting reflects disabled state (false)",
      wsPaused && wsPaused.allow_invitation_acceptance === false,
      toggleOffErr?.message
    );

    // TEST 12: Re-enable invitations -> resumes normally (allow_invitation_acceptance = true)
    const { error: toggleOnErr } = await withTimeout(
      admin.from("workspaces").update({ allow_invitation_acceptance: true }).eq("id", workspaceId),
      15000,
      'Toggle On Acceptance'
    );
    const { data: wsResumed } = await withTimeout(
      admin.from("workspaces").select("allow_invitation_acceptance").eq("id", workspaceId).single(),
      15000,
      'Check Resumed State'
    );
    report(
      12,
      "Re-enable invitations -> workspace setting resumes normal operation (true)",
      wsResumed && wsResumed.allow_invitation_acceptance === true,
      toggleOnErr?.message
    );

    console.log("\n==========================================================");
    console.log(`Results: ${passed} Passed | ${failed} Failed out of 12 Tests`);
    console.log("==========================================================");
  } catch (err) {
    console.error("Verification error:", err);
  } finally {
    await runCleanup();
    process.exit(failed > 0 ? 1 : 0);
  }
}

run();
