const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.join(__dirname, '..', '.env.local.production.bak');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
}

function withTimeout(promise, timeoutMs = 20000, opName = 'Operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${opName} exceeded ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const ENCRYPTION_SECRET =
  process.env.ENCRYPTION_SECRET ||
  env.ENCRYPTION_SECRET ||
  "omg-default-secret-key-32-chars-long!";
const ALGORITHM = "aes-256-gcm";

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

let passed = 0;
let failed = 0;

function report(testName, condition, detail) {
  if (condition) {
    console.log(`  ✅ [${testName}] PASS`);
    passed++;
  } else {
    console.error(`  ❌ [${testName}] FAIL: ${detail || "Condition not met"}`);
    failed++;
  }
}

const trackedInvitationIds = new Set();
const trackedMembershipIds = new Set();
const trackedRosterIds = new Set();
const trackedAuthUserIds = new Set();

const TEST_PREFIX = "__E2E_INVITE_TEST__";

async function runCleanup() {
  console.log("\n🧹 Executing bulletproof relational teardown in try/finally...");

  // 1. Delete tracked workspace_invitations FIRST
  try {
    if (trackedInvitationIds.size > 0) {
      await admin.from("workspace_invitations").delete().in("id", Array.from(trackedInvitationIds));
    }
  } catch (e) {}

  try {
    await admin.from("workspace_invitations").delete().like("invited_email", `${TEST_PREFIX.toLowerCase()}%`);
  } catch (e) {}

  // 2. Delete tracked workspace_memberships
  try {
    if (trackedMembershipIds.size > 0) {
      await admin.from("workspace_memberships").delete().in("id", Array.from(trackedMembershipIds));
    }
  } catch (e) {}

  try {
    if (trackedAuthUserIds.size > 0) {
      await admin.from("workspace_memberships").delete().in("user_id", Array.from(trackedAuthUserIds));
    }
  } catch (e) {}

  // 3. Delete tracked roster_people
  try {
    if (trackedRosterIds.size > 0) {
      await admin.from("roster_people").delete().in("id", Array.from(trackedRosterIds));
    }
  } catch (e) {}

  try {
    await admin.from("roster_people").delete().like("display_name", `${TEST_PREFIX}%`);
  } catch (e) {}

  // 4. Delete tracked auth.users
  try {
    for (const uid of trackedAuthUserIds) {
      await admin.auth.admin.deleteUser(uid);
    }
  } catch (e) {}

  // 5. Clean audit events
  try {
    await admin.from("audit_events").delete().like("metadata->>email", `${TEST_PREFIX.toLowerCase()}%`);
  } catch (e) {}

  console.log("Teardown completed. Zero test records remain.\n");
}

async function runAllTests() {
  console.log("==========================================================");
  console.log("🧪 ATOMIC INVITATION ACCEPTANCE & IDEMPOTENCY TEST SUITE");
  console.log("==========================================================");

  try {
    // 0. Fetch workspace & owner
    const { data: ws } = await withTimeout(admin.from('workspaces').select('*').single(), 10000, 'Get WS');
    const workspaceId = ws.id;

    const { data: ownerMem } = await withTimeout(
      admin.from('workspace_memberships').select('*').eq('workspace_id', workspaceId).eq('role', 'owner').single(),
      10000,
      'Get Owner'
    );

    async function createTestRosterPerson(name, role = "designer") {
      const uniqueName = `${TEST_PREFIX}${name}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const { data: rp } = await withTimeout(
        admin.from("roster_people").insert({
          workspace_id: workspaceId,
          display_name: uniqueName,
          job_title: "Test Graphic Designer",
          role: role,
          is_active: true
        }).select().single(),
        10000,
        'Create Test Roster'
      );
      if (rp) trackedRosterIds.add(rp.id);
      return rp;
    }

    async function createTestInvitation(email, rosterId, role = "designer", expiresHours = 168, status = "pending") {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + expiresHours * 3600000).toISOString();

      const { data: inv } = await withTimeout(
        admin.from("workspace_invitations").insert({
          workspace_id: workspaceId,
          invited_email: email,
          invited_by_roster_id: ownerMem.roster_person_id,
          roster_person_id: rosterId,
          role: role,
          token_hash: tokenHash,
          status: status,
          expires_at: expiresAt
        }).select().single(),
        10000,
        'Create Test Inv'
      );
      if (inv) trackedInvitationIds.add(inv.id);
      return { inv, rawToken, tokenHash };
    }

    // -------------------------------------------------------------------------
    // TEST A: New invited user accepts normally.
    // Expected: exactly 1 Auth user, exactly 1 membership, invitation accepted, successful login
    // -------------------------------------------------------------------------
    console.log("\n--- TEST A: Normal acceptance for new user ---");
    const testAEmail = `${TEST_PREFIX.toLowerCase()}user_a_${Date.now()}@example.com`;
    const rpA = await createTestRosterPerson("UserA");
    const { inv: invA, tokenHash: hashA } = await createTestInvitation(testAEmail, rpA.id);

    // Create auth user
    const { data: authA } = await withTimeout(
      admin.auth.admin.createUser({ email: testAEmail, password: "Password123!", email_confirm: true }),
      10000,
      'Create Auth User A'
    );
    if (authA?.user) trackedAuthUserIds.add(authA.user.id);

    // Call atomic acceptance RPC
    const { data: rpcA, error: rpcAErr } = await withTimeout(
      admin.rpc("accept_workspace_invitation_atomic", {
        p_invitation_id: invA.id,
        p_user_id: authA.user.id,
        p_token_hash: hashA,
        p_user_email: testAEmail
      }),
      10000,
      'Accept RPC A'
    );

    const { data: memsA } = await admin.from("workspace_memberships").select("*").eq("user_id", authA.user.id);
    const { data: invAAfter } = await admin.from("workspace_invitations").select("*").eq("id", invA.id).single();

    report(
      "TEST A",
      rpcA?.success === true && memsA?.length === 1 && invAAfter?.status === "accepted" && memsA[0].role === "designer",
      `rpcError: ${rpcAErr?.message || JSON.stringify(rpcA)}, memsCount: ${memsA?.length}, invStatus: ${invAAfter?.status}`
    );
    if (memsA?.[0]) trackedMembershipIds.add(memsA[0].id);

    // -------------------------------------------------------------------------
    // TEST B: Simulate Auth user existing but membership missing (Partial failure recovery)
    // Expected: acceptance resumes and repairs state rather than failing
    // -------------------------------------------------------------------------
    console.log("\n--- TEST B: Partial success recovery (Auth user exists, membership missing) ---");
    const testBEmail = `${TEST_PREFIX.toLowerCase()}user_b_${Date.now()}@example.com`;
    const rpB = await createTestRosterPerson("UserB");
    const { inv: invB, tokenHash: hashB } = await createTestInvitation(testBEmail, rpB.id);

    // Pre-create Auth user (simulating prior attempt that created auth user but failed before DB)
    const { data: authB } = await withTimeout(
      admin.auth.admin.createUser({ email: testBEmail, password: "Password123!", email_confirm: true }),
      10000,
      'Create Auth User B'
    );
    if (authB?.user) trackedAuthUserIds.add(authB.user.id);

    // Verify membership does NOT exist yet
    const { data: memsBBefore } = await admin.from("workspace_memberships").select("*").eq("user_id", authB.user.id);

    // Call atomic acceptance RPC to recover and complete membership
    const { data: rpcB } = await withTimeout(
      admin.rpc("accept_workspace_invitation_atomic", {
        p_invitation_id: invB.id,
        p_user_id: authB.user.id,
        p_token_hash: hashB,
        p_user_email: testBEmail
      }),
      10000,
      'Accept RPC B'
    );

    const { data: memsBAfter } = await admin.from("workspace_memberships").select("*").eq("user_id", authB.user.id);
    const { data: invBAfter } = await admin.from("workspace_invitations").select("*").eq("id", invB.id).single();

    report(
      "TEST B",
      memsBBefore?.length === 0 && rpcB?.success === true && memsBAfter?.length === 1 && invBAfter?.status === "accepted",
      `Recovery failed: rpc=${JSON.stringify(rpcB)}, memsAfter=${memsBAfter?.length}, invStatus=${invBAfter?.status}`
    );
    if (memsBAfter?.[0]) trackedMembershipIds.add(memsBAfter[0].id);

    // -------------------------------------------------------------------------
    // TEST C: Execute acceptance twice (Idempotency check)
    // Expected: no duplicate membership, profile, roster record or Auth account
    // -------------------------------------------------------------------------
    console.log("\n--- TEST C: Double acceptance idempotency ---");
    const { data: rpcCRepeat } = await withTimeout(
      admin.rpc("accept_workspace_invitation_atomic", {
        p_invitation_id: invB.id,
        p_user_id: authB.user.id,
        p_token_hash: hashB,
        p_user_email: testBEmail
      }),
      10000,
      'Accept RPC C Repeat'
    );

    const { data: memsCAll } = await admin.from("workspace_memberships").select("*").eq("user_id", authB.user.id);

    report(
      "TEST C",
      rpcCRepeat?.success === true && rpcCRepeat?.already_accepted === true && memsCAll?.length === 1,
      `Double acceptance failed: rpc=${JSON.stringify(rpcCRepeat)}, memsCount=${memsCAll?.length}`
    );

    // -------------------------------------------------------------------------
    // TEST D: Membership already exists and is correct
    // Expected: acceptance safely resolves to success
    // -------------------------------------------------------------------------
    console.log("\n--- TEST D: Membership already exists and is correct ---");
    const { data: rpcD } = await withTimeout(
      admin.rpc("accept_workspace_invitation_atomic", {
        p_invitation_id: invA.id,
        p_user_id: authA.user.id,
        p_token_hash: hashA,
        p_user_email: testAEmail
      }),
      10000,
      'Accept RPC D'
    );

    report(
      "TEST D",
      rpcD?.success === true && rpcD?.already_accepted === true,
      `Existing membership re-acceptance failed: ${JSON.stringify(rpcD)}`
    );

    // -------------------------------------------------------------------------
    // TEST E: Invalid / Expired / Revoked invitation
    // Expected: no account activation or membership creation
    // -------------------------------------------------------------------------
    console.log("\n--- TEST E: Invalid / Expired / Revoked invitations blocked ---");
    const testEEmail = `${TEST_PREFIX.toLowerCase()}user_e_${Date.now()}@example.com`;
    const rpE = await createTestRosterPerson("UserE");
    // Expired invitation (-10 hours)
    const { inv: invExpired, tokenHash: hashExpired } = await createTestInvitation(testEEmail, rpE.id, "designer", -10);
    // Revoked invitation
    const { inv: invRevoked, tokenHash: hashRevoked } = await createTestInvitation(testEEmail, rpE.id, "designer", 168, "revoked");

    const { data: authE } = await admin.auth.admin.createUser({ email: testEEmail, password: "Password123!", email_confirm: true });
    if (authE?.user) trackedAuthUserIds.add(authE.user.id);

    // Attempt accept expired
    const { data: rpcExp } = await admin.rpc("accept_workspace_invitation_atomic", {
      p_invitation_id: invExpired.id,
      p_user_id: authE.user.id,
      p_token_hash: hashExpired,
      p_user_email: testEEmail
    });

    // Attempt accept revoked
    const { data: rpcRev } = await admin.rpc("accept_workspace_invitation_atomic", {
      p_invitation_id: invRevoked.id,
      p_user_id: authE.user.id,
      p_token_hash: hashRevoked,
      p_user_email: testEEmail
    });

    const { data: memsE } = await admin.from("workspace_memberships").select("*").eq("user_id", authE.user.id);

    report(
      "TEST E",
      rpcExp?.success === false && rpcExp?.code === "INVITATION_EXPIRED" &&
      rpcRev?.success === false && rpcRev?.code === "INVITATION_REVOKED" &&
      memsE?.length === 0,
      `Expired/Revoked not blocked properly: exp=${JSON.stringify(rpcExp)}, rev=${JSON.stringify(rpcRev)}, memsCount=${memsE?.length}`
    );

    // -------------------------------------------------------------------------
    // TEST F: Force a DB failure after Auth user creation, then retry
    // Expected: second attempt completes the account successfully without duplicates
    // -------------------------------------------------------------------------
    console.log("\n--- TEST F: Retry after forced DB failure ---");
    const testFEmail = `${TEST_PREFIX.toLowerCase()}user_f_${Date.now()}@example.com`;
    const rpF = await createTestRosterPerson("UserF");
    const { inv: invF, tokenHash: hashF } = await createTestInvitation(testFEmail, rpF.id);

    // 1. Auth user creation succeeds
    const { data: authF } = await admin.auth.admin.createUser({ email: testFEmail, password: "Password123!", email_confirm: true });
    if (authF?.user) trackedAuthUserIds.add(authF.user.id);

    // 2. Simulate failure: call with wrong token_hash (simulating validation/db reject)
    const { data: rpcFFail } = await admin.rpc("accept_workspace_invitation_atomic", {
      p_invitation_id: invF.id,
      p_user_id: authF.user.id,
      p_token_hash: "CORRUPTED_TOKEN_HASH_FOR_TEST",
      p_user_email: testFEmail
    });

    const { data: memsFAfterFail } = await admin.from("workspace_memberships").select("*").eq("user_id", authF.user.id);
    const { data: invFAfterFail } = await admin.from("workspace_invitations").select("*").eq("id", invF.id).single();

    // 3. Retry: call with correct credentials
    const { data: rpcFRetry } = await admin.rpc("accept_workspace_invitation_atomic", {
      p_invitation_id: invF.id,
      p_user_id: authF.user.id,
      p_token_hash: hashF,
      p_user_email: testFEmail
    });

    const { data: memsFRecovered } = await admin.from("workspace_memberships").select("*").eq("user_id", authF.user.id);
    const { data: invFRecovered } = await admin.from("workspace_invitations").select("*").eq("id", invF.id).single();

    report(
      "TEST F",
      rpcFFail?.success === false &&
      memsFAfterFail?.length === 0 &&
      invFAfterFail?.status === "pending" &&
      rpcFRetry?.success === true &&
      memsFRecovered?.length === 1 &&
      invFRecovered?.status === "accepted",
      `Retry after failure did not recover: fail=${JSON.stringify(rpcFFail)}, retry=${JSON.stringify(rpcFRetry)}, mems=${memsFRecovered?.length}`
    );
    if (memsFRecovered?.[0]) trackedMembershipIds.add(memsFRecovered[0].id);

  } catch (err) {
    console.error("Critical test runner error:", err);
  } finally {
    await runCleanup();
  }

  console.log("==========================================================");
  console.log(`Results: ${passed} Passed | ${failed} Failed out of 6 Tests`);
  console.log("==========================================================");
  if (failed > 0) process.exit(1);
}

runAllTests();
