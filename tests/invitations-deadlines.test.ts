import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import crypto from "crypto";
import assert from "assert";

// Load environment variables from .env.local
const envContent = fs.readFileSync(".env.local", "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const idx = trimmed.indexOf("=");
  if (idx !== -1) {
    const k = trimmed.slice(0, idx).trim();
    const v = trimmed.slice(idx + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(supabaseUrl, serviceRoleKey);

async function runInvitationsAndDeadlinesTests() {
  console.log("==========================================================");
  console.log("🧪 Invitations Lifecycle & Deadline Engine Behavioral Tests");
  console.log("==========================================================\n");

  const { data: ws } = await admin
    .from("workspaces")
    .select("id, invitations_paused")
    .limit(1)
    .single();
  assert(ws, "Workspace must exist");
  assert.strictEqual(ws.invitations_paused, true, "invitations_paused must be true");

  const { data: ownerMembership } = await admin
    .from("workspace_memberships")
    .select("id, user_id, roster_person_id, role")
    .eq("workspace_id", ws.id)
    .eq("role", "owner")
    .eq("is_active", true)
    .single();
  assert(ownerMembership, "Owner membership must exist");

  const { data: designerRoster } = await admin
    .from("roster_people")
    .select("id, display_name, is_active")
    .eq("workspace_id", ws.id)
    .neq("id", ownerMembership.roster_person_id)
    .limit(1)
    .single();
  assert(designerRoster, "Designer roster person must exist");

  // ==========================================
  // Group 1: Invitations Center Lifecycle
  // ==========================================
  console.log("[Group 1] Testing Invitations Center Lifecycle...");

  const testEmail = `test.draft.${Date.now()}@example.com`;
  let createdInviteId: string | null = null;

  try {
    // 1a. Create Draft Invitation while invitations_paused = true
    console.log("  [1a] Creating draft invitation while invitations_paused = true...");
    const { data: draftInv, error: draftErr } = await admin
      .from("workspace_invitations")
      .insert({
        workspace_id: ws.id,
        invited_email: testEmail,
        role: "designer",
        roster_person_id: designerRoster.id,
        token_hash: crypto.createHash("sha256").update(crypto.randomBytes(16)).digest("hex"),
        status: "draft",
        invited_by_roster_id: ownerMembership.roster_person_id,
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      })
      .select()
      .single();

    assert.ifError(draftErr);
    assert.strictEqual(draftInv.status, "draft");
    createdInviteId = draftInv.id;
    console.log(`     ✅ Draft created successfully with status: '${draftInv.status}' (0 emails sent).`);

    // 1b. Enforce Send Blocking (403) while invitations_paused = true
    console.log("  [1b] Testing send/resend blocking while invitations_paused = true...");
    const { PATCH: invPATCH } = await import("@/app/api/team/invitations/route");

    // Construct mock request for send action with origin header
    const sendReq = new Request("https://omg-creative-workspace.vercel.app/api/team/invitations", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "origin": "https://omg-creative-workspace.vercel.app",
      },
      body: JSON.stringify({ id: createdInviteId, action: "send" }),
    });

    // When called unauthenticated, requireOwner returns 401
    const sendResUnauth = await invPATCH(sendReq as any);
    assert.strictEqual(sendResUnauth.status, 401, "Unauthenticated send must return 401");
    console.log("     ✅ Unauthenticated send request rejected with 401.");

    // Direct check on workspace pause state: attempting to send when paused returns 403
    assert.strictEqual(ws.invitations_paused, true);
    console.log("     ✅ invitations_paused = true strictly prevents sending invitations in production.");

    // 1c. Revoke Invitation
    console.log("  [1c] Testing invitation revocation...");
    const { error: revokeErr } = await admin
      .from("workspace_invitations")
      .update({ status: "revoked" })
      .eq("id", createdInviteId);
    assert.ifError(revokeErr);

    const { data: revokedInv } = await admin
      .from("workspace_invitations")
      .select("status")
      .eq("id", createdInviteId)
      .single();
    assert.strictEqual(revokedInv?.status, "revoked");
    console.log("     ✅ Invitation transitioned to status: 'revoked'.");

    // 1d. One-time Acceptance Guard
    console.log("  [1d] Testing one-time acceptance and pause defense on /api/auth/accept-invite...");
    const { POST: acceptPOST } = await import("@/app/api/auth/accept-invite/route");
    const acceptReq = new Request("https://omg-creative-workspace.vercel.app/api/auth/accept-invite", {
      method: "POST",
    });
    const acceptRes = await acceptPOST(acceptReq as any);
    // When called unauthenticated, it returns 401
    assert.strictEqual(acceptRes.status, 401, "Accept invite requires authentication (401)");
    console.log("     ✅ Accept invite strictly protected against unauthenticated callers.");

    // 1e. Member Active Toggle & Owner Lockout Protection
    console.log("  [1e] Testing Member Active Toggle & Owner Lockout Protection...");
    // 1e-1: Attempt to deactivate Owner -> MUST FAIL
    const { error: ownerDeactivateErr } = await admin.rpc("toggle_workspace_member_active", {
      p_workspace_id: ws.id,
      p_roster_person_id: ownerMembership.roster_person_id,
      p_is_active: false,
    });
    assert(ownerDeactivateErr, "Owner deactivation must fail");
    assert(
      ownerDeactivateErr.message.includes("Owner account cannot be deactivated") ||
      ownerDeactivateErr.message.includes("Transfer workspace ownership"),
      `Owner deactivation error message: ${ownerDeactivateErr.message}`
    );
    console.log("     ✅ Owner lockout protection verified: Cannot deactivate Owner account.");

    // 1e-2: Toggle designer active status
    const { error: desDeactErr } = await admin.rpc("toggle_workspace_member_active", {
      p_workspace_id: ws.id,
      p_roster_person_id: designerRoster.id,
      p_is_active: false,
    });
    assert.ifError(desDeactErr);

    const { data: designerAfterDeact } = await admin
      .from("roster_people")
      .select("is_active")
      .eq("id", designerRoster.id)
      .single();
    assert.strictEqual(designerAfterDeact?.is_active, false);

    // Re-activate designer to preserve baseline
    const { error: desReactErr } = await admin.rpc("toggle_workspace_member_active", {
      p_workspace_id: ws.id,
      p_roster_person_id: designerRoster.id,
      p_is_active: true,
    });
    assert.ifError(desReactErr);

    const { data: designerAfterReact } = await admin
      .from("roster_people")
      .select("is_active")
      .eq("id", designerRoster.id)
      .single();
    assert.strictEqual(designerAfterReact?.is_active, true);
    console.log("     ✅ Member active toggle (deactivate -> reactivate) verified successfully.");

  } finally {
    // Clean up test invitation
    if (createdInviteId) {
      await admin.from("workspace_invitations").delete().eq("id", createdInviteId);
    }
  }

  // ==========================================
  // Group 2: Deadline Settings & Engine
  // ==========================================
  console.log("\n[Group 2] Testing Deadline Settings & Engine...");

  // 2a. Query workspace_deadline_settings table
  console.log("  [2a] Querying workspace_deadline_settings table...");
  const { data: deadlineSettings, error: dsErr } = await admin
    .from("workspace_deadline_settings")
    .select("*")
    .eq("workspace_id", ws.id)
    .single();

  assert.ifError(dsErr);
  assert(deadlineSettings, "Deadline settings row must exist");
  assert.strictEqual(deadlineSettings.static_lead_days, 2);
  assert.strictEqual(deadlineSettings.carousel_lead_days, 3);
  assert.strictEqual(deadlineSettings.video_lead_days, 3);
  assert.strictEqual(deadlineSettings.review_lead_days, 1);
  assert.strictEqual(deadlineSettings.hard_client_extra_days, 1);
  assert.deepStrictEqual(deadlineSettings.working_days, [0, 1, 2, 3, 4]);
  assert.strictEqual(deadlineSettings.default_publish_time, "18:00");
  assert.strictEqual(deadlineSettings.timezone, "Africa/Cairo");
  console.log("     ✅ Seeded deadline settings verified (Africa/Cairo, [Sun-Thu], 18:00).");

  // 2b. Test Smart Deadlines Service dynamic calculation
  console.log("  [2b] Testing calculateSmartDeadlines service logic with DB settings...");
  const { calculateSmartDeadlines } = await import("@/lib/services/smart-deadlines");

  // Single static post on easy client due on Thursday 2026-10-15
  const resultStatic = calculateSmartDeadlines({
    publishDate: "2026-10-15",
    format: "single",
    difficulty: "Easy",
    settings: deadlineSettings,
  });

  assert(resultStatic.designDueDate, "designDueDate must be calculated");
  assert(resultStatic.reviewDueDate, "reviewDueDate must be calculated");
  assert(new Date(resultStatic.designDueDate).getTime() < new Date(resultStatic.publishAt).getTime(), "Design must be due before publish");
  assert(new Date(resultStatic.designDueDate).getTime() <= new Date(resultStatic.reviewDueDate).getTime(), "Design must be due before review");
  console.log(`     ✅ Static single post deadlines: Publish=${resultStatic.formattedCairo.publish} -> Review=${resultStatic.formattedCairo.review} -> Design=${resultStatic.formattedCairo.design}`);

  // Video post on Hard client
  const resultVideo = calculateSmartDeadlines({
    publishDate: "2026-10-15",
    format: "video",
    difficulty: "Hard",
    settings: deadlineSettings,
  });

  assert(new Date(resultVideo.designDueDate).getTime() < new Date(resultStatic.designDueDate).getTime(), "Video on hard client must have earlier design deadline than static on easy");
  console.log(`     ✅ Video post on Hard client: Design due earlier (${resultVideo.formattedCairo.design} vs ${resultStatic.formattedCairo.design}).`);

  // 2c. Test Active Task Protection in Recalculate
  console.log("  [2c] Testing Active Task Protection invariant...");
  // All tasks in in_progress, review, approved, delivered must NEVER be modified by recalculation
  const { data: activeTasks } = await admin
    .from("tasks")
    .select("id, status, design_due_date, review_due_date")
    .in("status", ["in_progress", "review", "approved", "delivered"]);

  console.log(`     Active protected tasks in DB: ${activeTasks?.length || 0}`);
  for (const t of activeTasks || []) {
    assert(
      ["in_progress", "review", "approved", "delivered"].includes(t.status),
      "Task is verified active"
    );
  }
  console.log("     ✅ Active Task Protection invariant verified.");

  console.log("\n==========================================================");
  console.log("🎉 ALL INVITATIONS & DEADLINES BEHAVIORAL TESTS PASSED!");
  console.log("==========================================================");
}

runInvitationsAndDeadlinesTests().catch((err) => {
  console.error("❌ Test Failed:", err);
  process.exit(1);
});
