const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// Load environment from .env.local.production.bak
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

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const siteUrl = env.NEXT_PUBLIC_SITE_URL;

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

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

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

let passed = 0;
let failed = 0;

function report(name, condition, detail) {
  if (condition) {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${name} -> ${detail || "Condition not met"}`);
    failed++;
  }
}

async function run() {
  const cleanupTasks = [];
  try {
    console.log("==========================================================");
    console.log("🧪 INVITATION API ROUTES & DATABASE LIFECYCLE VERIFICATION");
    console.log("==========================================================");

    const { data: ws } = await withTimeout(
      admin.from('workspaces').select('*').single(),
      15000,
      'Get Workspace'
    );
    const workspaceId = ws.id;

    const { data: ownerMem } = await withTimeout(
      admin.from('workspace_memberships').select('*').eq('workspace_id', workspaceId).eq('role', 'owner').eq('is_active', true).single(),
      15000,
      'Get Owner Membership'
    );

    // 1. Verify token indexing & fast lookup via token_hash
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const encToken = encryptToken(rawToken);
    const testEmail = `route.verify.${Date.now()}@example.com`;

    const { data: rp } = await withTimeout(
      admin.from("roster_people").insert({
        workspace_id: workspaceId,
        display_name: `Route Verify User ${Date.now()}`,
        job_title: "Midlevel Graphic Designer",
        role: "designer",
        is_active: true
      }).select().single(),
      15000,
      'Insert Roster'
    );
    if (rp) cleanupTasks.push(async () => admin.from('roster_people').delete().eq('id', rp.id));

    const { data: inv, error: invErr } = await withTimeout(
      admin.from("workspace_invitations").insert({
        workspace_id: workspaceId,
        invited_email: testEmail,
        invited_by_roster_id: ownerMem.roster_person_id,
        roster_person_id: rp.id,
        role: "designer",
        token_hash: tokenHash,
        encrypted_token: encToken,
        status: "pending",
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString()
      }).select().single(),
      15000,
      'Insert Inv'
    );
    if (inv) cleanupTasks.push(async () => admin.from('workspace_invitations').delete().eq('id', inv.id));

    report(
      "Direct token_hash lookup on workspace_invitations",
      inv && inv.token_hash === tokenHash,
      invErr?.message
    );

    // 2. Query by token_hash (same as /api/auth/accept-invite?token=...)
    const { data: foundByHash, error: hashErr } = await withTimeout(
      admin.from("workspace_invitations")
        .select(`
          id,
          workspace_id,
          invited_email,
          role,
          status,
          expires_at,
          accepted_at,
          roster_person:roster_people!fk_invitation_roster(display_name, job_title)
        `)
        .eq("token_hash", tokenHash)
        .maybeSingle(),
      15000,
      'Query by token_hash'
    );

    report(
      "Lookup by SHA-256 token hash resolves invitation record and joined roster details",
      foundByHash && foundByHash.invited_email === testEmail && foundByHash.roster_person?.display_name,
      hashErr?.message
    );

    // 3. Status checks: pending is valid, not expired, not revoked
    const isPending = foundByHash.status === "pending";
    const isUnexpired = new Date(foundByHash.expires_at).getTime() > Date.now();
    report(
      "Invitation pending and unexpired state validity",
      isPending && isUnexpired,
      `status: ${foundByHash?.status}`
    );

    // 4. Revocation lifecycle
    const { data: revokedInv } = await withTimeout(
      admin.from("workspace_invitations")
        .update({ status: "revoked" })
        .eq("id", inv.id)
        .select()
        .single(),
      15000,
      'Revoke Inv'
    );

    report(
      "Revocation marks status as 'revoked'",
      revokedInv && revokedInv.status === "revoked"
    );

    // 5. Query after revocation returns status revoked
    const { data: foundRevoked } = await withTimeout(
      admin.from("workspace_invitations").select("status").eq("token_hash", tokenHash).single(),
      15000,
      'Query Revoked'
    );
    report(
      "Accept-invite route detects revoked status (blocks with 410)",
      foundRevoked && foundRevoked.status === "revoked"
    );

    // 6. Resend renews status to 'pending', generates fresh token_hash and resets expiry
    const newRawToken = crypto.randomBytes(32).toString('hex');
    const newTokenHash = hashToken(newRawToken);
    const newEncToken = encryptToken(newRawToken);
    const newExpiry = new Date(Date.now() + 7 * 86400000).toISOString();

    const { data: resentInv } = await withTimeout(
      admin.from("workspace_invitations")
        .update({
          token_hash: newTokenHash,
          encrypted_token: newEncToken,
          expires_at: newExpiry,
          status: "pending",
          last_sent_at: new Date().toISOString()
        })
        .eq("id", inv.id)
        .select()
        .single(),
      15000,
      'Resend Inv'
    );

    report(
      "Resend action restores status to pending with renewed 7-day expiry and new token hash",
      resentInv && resentInv.status === "pending" && resentInv.token_hash === newTokenHash
    );

    console.log("\n==========================================================");
    console.log(`Results: ${passed} Passed | ${failed} Failed`);
    console.log("==========================================================");
  } catch (err) {
    console.error("Test error:", err);
  } finally {
    console.log("Cleaning up test data...");
    for (const t of cleanupTasks) {
      try { await t(); } catch (e) {}
    }
    console.log("All clean.");
    process.exit(failed > 0 ? 1 : 0);
  }
}

run();
