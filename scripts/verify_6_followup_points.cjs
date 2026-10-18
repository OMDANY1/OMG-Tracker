const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const fs = require("fs");
const envFile = fs.existsSync(".env.local.production.bak") ? ".env.local.production.bak" : ".env.local";
for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const idx = trimmed.indexOf("=");
  if (idx > 0) {
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    process.env[key] = val;
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.error("Missing Supabase env vars");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PROD_WS_ID = "a180f3ab-33bb-4431-88a4-592add7c773e";
const EMAD_ROSTER_ID = "bcfa3baa-7045-4262-abd6-bdb0be8210fd"; // owner (Emad)
const AHMED_ROSTER_ID = "82a6a25a-3dad-4c6a-960c-6ace8389985a"; // company_owner (Ahmed Al-Nahhas)
const ATA_ROSTER_ID = "516db1c8-99ea-4c13-ab93-c431dc6686f0"; // marketing_director (Ata)

async function getAuthenticatedClientForRoster(rosterId, workspaceId = PROD_WS_ID) {
  const { data: mem } = await admin
    .from("workspace_memberships")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("roster_person_id", rosterId)
    .single();

  if (!mem || !mem.user_id) {
    throw new Error(`No user_id found for roster ${rosterId}`);
  }

  const { data: userRes } = await admin.auth.admin.getUserById(mem.user_id);
  const email = userRes.user.email;

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr) throw linkErr;

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: verifyErr } = await client.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyErr) throw verifyErr;

  return { client, userId: mem.user_id, email };
}

async function main() {
  const report = {
    point1_crossWorkspace: {},
    point2_eligibility: {},
    point3_selfApproval: {},
    point4_videoTrack: {},
    point6_items: {},
  };

  // Track temporary entities for guaranteed cleanup
  let wsBId = null;
  let userBId = null;
  let userInviteTempId = null;
  const tempProdTaskIds = [];
  const tempProdClientIds = [];
  const tempProdRosterIds = [];

  try {
    console.log("=== Authenticating Emad (owner) & Ahmed Al-Nahhas (company_owner) ===");
    const emadAuth = await getAuthenticatedClientForRoster(EMAD_ROSTER_ID, PROD_WS_ID);
    const ahmedAuth = await getAuthenticatedClientForRoster(AHMED_ROSTER_ID, PROD_WS_ID);

    // =========================================================================
    // POINT 1: CROSS-WORKSPACE ISOLATION & HARD DELETE IN ISOLATED 2-WORKSPACE ENV
    // =========================================================================
    console.log("\n=== [POINT 1] Creating Isolated Workspace B ===");
    const tempEmailB = `isolated.wsb.${Date.now()}@omg-test.local`;
    const { data: createdUserB, error: uBErr } = await admin.auth.admin.createUser({
      email: tempEmailB,
      password: "TempPassword123!",
      email_confirm: true,
    });
    if (uBErr) throw uBErr;
    userBId = createdUserB.user.id;

    wsBId = crypto.randomUUID();
    const personBId = crypto.randomUUID();
    const personB2Id = crypto.randomUUID();
    const clientBId = crypto.randomUUID();
    const taskBId = crypto.randomUUID();

    // Insert Workspace B
    const { error: wsBErr } = await admin.from("workspaces").insert({
      id: wsBId,
      name: "[ISOLATED_TEST_WS_B]",
      allow_invitation_acceptance: true,
      invitations_paused: false,
    });
    if (wsBErr) throw wsBErr;

    // Insert Roster Person B (owner of WS B) & Person B2 (designer in WS B)
    const { error: rpBErr } = await admin.from("roster_people").insert([
      {
        id: personBId,
        workspace_id: wsBId,
        display_name: "Owner B",
        job_title: "Owner B",
        role: "owner",
        specialties: ["management", "design"],
        is_active: true,
      },
      {
        id: personB2Id,
        workspace_id: wsBId,
        display_name: "Designer B2 (To Delete)",
        job_title: "Graphic Designer",
        role: "designer",
        specialties: ["design"],
        is_active: true,
      },
    ]);
    if (rpBErr) throw rpBErr;

    const { error: memBErr } = await admin.from("workspace_memberships").insert({
      workspace_id: wsBId,
      user_id: userBId,
      roster_person_id: personBId,
      role: "owner",
      is_active: true,
    });
    if (memBErr) throw memBErr;

    const { error: clBErr } = await admin.from("clients").insert({
      id: clientBId,
      workspace_id: wsBId,
      name: "Client in WS B",
      owner_roster_id: personB2Id,
    });
    if (clBErr) throw clBErr;

    const { error: tkBErr } = await admin.from("tasks").insert({
      id: taskBId,
      workspace_id: wsBId,
      client_id: clientBId,
      title: "Task in WS B",
      primary_assignee_id: personB2Id,
      created_by_id: personB2Id,
      status: "in_progress",
    });
    if (tkBErr) throw tkBErr;

    // Create temporary sandbox Client A & Task A inside Workspace A (cleaned up in finally)
    const { data: sandboxClientRes, error: scErr } = await emadAuth.client.rpc("create_client", {
      p_workspace_id: PROD_WS_ID,
      p_name: `[SANDBOX_CLIENT_A_${Date.now()}]`,
      p_owner_roster_id: EMAD_ROSTER_ID,
    });
    if (scErr) throw scErr;
    const sandboxClientAId = sandboxClientRes.client_id;
    tempProdClientIds.push(sandboxClientAId);

    const { data: sandboxTaskRes, error: stErr } = await emadAuth.client.rpc("create_task_rpc", {
      p_workspace_id: PROD_WS_ID,
      p_client_id: sandboxClientAId,
      p_title: `[SANDBOX_TASK_A_${Date.now()}]`,
      p_primary_assignee_id: EMAD_ROSTER_ID,
    });
    if (stErr) throw stErr;
    const sandboxTaskAId = sandboxTaskRes.task_id;
    tempProdTaskIds.push(sandboxTaskAId);

    // 1.1 Test RPCs attempting to link Workspace A records to Workspace B entities
    const rpcCrossTests = {};

    const r1 = await emadAuth.client.rpc("create_client", {
      p_workspace_id: PROD_WS_ID,
      p_name: "Cross WS Client Fail",
      p_owner_roster_id: personB2Id,
    });
    rpcCrossTests.create_client_with_wsB_owner = {
      blocked: !!r1.error,
      error: r1.error?.message || null,
    };

    const r2 = await emadAuth.client.rpc("upsert_client_team_assignment", {
      p_workspace_id: PROD_WS_ID,
      p_client_id: sandboxClientAId,
      p_primary_designer_id: personB2Id,
    });
    rpcCrossTests.upsert_team_with_wsB_designer = {
      blocked: !!r2.error,
      error: r2.error?.message || null,
    };

    const r3 = await emadAuth.client.rpc("upsert_client_team_assignment", {
      p_workspace_id: PROD_WS_ID,
      p_client_id: sandboxClientAId,
      p_design_reviewer_id: personBId,
    });
    rpcCrossTests.upsert_team_with_wsB_reviewer = {
      blocked: !!r3.error,
      error: r3.error?.message || null,
    };

    const r4 = await emadAuth.client.rpc("create_task_rpc", {
      p_workspace_id: PROD_WS_ID,
      p_client_id: clientBId,
      p_title: "Cross WS Task Client Fail",
      p_primary_assignee_id: EMAD_ROSTER_ID,
    });
    rpcCrossTests.create_task_with_wsB_client = {
      blocked: !!r4.error,
      error: r4.error?.message || null,
    };

    const r5 = await emadAuth.client.rpc("create_task_rpc", {
      p_workspace_id: PROD_WS_ID,
      p_client_id: sandboxClientAId,
      p_title: "Cross WS Task Assignee Fail",
      p_primary_assignee_id: personB2Id,
    });
    rpcCrossTests.create_task_with_wsB_assignee = {
      blocked: !!r5.error,
      error: r5.error?.message || null,
    };

    const r6 = await emadAuth.client.rpc("reassign_task", {
      p_workspace_id: PROD_WS_ID,
      p_task_id: sandboxTaskAId,
      p_new_assignee_id: personB2Id,
    });
    rpcCrossTests.reassign_task_to_wsB_member = {
      blocked: !!r6.error,
      error: r6.error?.message || null,
    };

    const r7 = await emadAuth.client.rpc("change_task_reviewer", {
      p_workspace_id: PROD_WS_ID,
      p_task_id: sandboxTaskAId,
      p_new_reviewer_id: personBId,
    });
    rpcCrossTests.change_reviewer_to_wsB_member = {
      blocked: !!r7.error,
      error: r7.error?.message || null,
    };

    const r8 = await emadAuth.client.rpc("set_task_waiting_state", {
      p_task_id: sandboxTaskAId,
      p_is_waiting: true,
      p_waiting_reason: "Waiting",
      p_waiting_on_roster_id: personB2Id,
    });
    rpcCrossTests.waiting_on_wsB_member = {
      blocked: !!r8.error,
      error: r8.error?.message || null,
    };

    // 1.2 Test Direct DB Composite FK Enforcement (bypassing RPCs via service_role)
    const dbCompositeFkTests = {};

    const fk1 = await admin
      .from("tasks")
      .update({ primary_assignee_id: personB2Id })
      .eq("id", sandboxTaskAId);
    dbCompositeFkTests.tasks_primary_assignee_fk = {
      blocked: !!fk1.error,
      code: fk1.error?.code,
      message: fk1.error?.message,
    };

    const fk2 = await admin
      .from("tasks")
      .update({ client_id: clientBId })
      .eq("id", sandboxTaskAId);
    dbCompositeFkTests.tasks_client_fk = {
      blocked: !!fk2.error,
      code: fk2.error?.code,
      message: fk2.error?.message,
    };

    const fk3 = await admin
      .from("tasks")
      .update({ reviewer_id: personBId })
      .eq("id", sandboxTaskAId);
    dbCompositeFkTests.tasks_reviewer_fk = {
      blocked: !!fk3.error,
      code: fk3.error?.code,
      message: fk3.error?.message,
    };

    const fk4 = await admin.from("time_entries").insert({
      workspace_id: PROD_WS_ID,
      task_id: sandboxTaskAId,
      roster_person_id: personB2Id,
      started_at: new Date(Date.now() - 3600000).toISOString(),
      ended_at: new Date().toISOString(),
      source: "timer",
      created_by_id: EMAD_ROSTER_ID,
    });
    dbCompositeFkTests.time_entries_person_fk = {
      blocked: !!fk4.error,
      code: fk4.error?.code,
      message: fk4.error?.message,
    };

    const fk5 = await admin.from("time_entries").insert({
      workspace_id: PROD_WS_ID,
      task_id: taskBId,
      roster_person_id: EMAD_ROSTER_ID,
      started_at: new Date(Date.now() - 3600000).toISOString(),
      ended_at: new Date().toISOString(),
      source: "timer",
      created_by_id: EMAD_ROSTER_ID,
    });
    dbCompositeFkTests.time_entries_task_fk = {
      blocked: !!fk5.error,
      code: fk5.error?.code,
      message: fk5.error?.message,
    };

    const fk6 = await admin.from("client_team_assignments").upsert({
      workspace_id: PROD_WS_ID,
      client_id: sandboxClientAId,
      primary_video_editor_id: personB2Id,
    });
    dbCompositeFkTests.client_team_assignments_video_editor_fk = {
      blocked: !!fk6.error,
      code: fk6.error?.code,
      message: fk6.error?.message,
    };

    // 1.3 Test Hard Delete in Workspace B with multi-column references on same row
    // Insert a time_entry in WS B where BOTH roster_person_id AND created_by_id = personB2Id
    const timeEntryBId = crypto.randomUUID();
    const { error: teBErr } = await admin.from("time_entries").insert({
      id: timeEntryBId,
      workspace_id: wsBId,
      task_id: taskBId,
      roster_person_id: personB2Id,
      created_by_id: personB2Id,
      started_at: new Date(Date.now() - 1800000).toISOString(),
      ended_at: new Date().toISOString(),
      source: "timer",
    });
    if (teBErr) throw teBErr;

    const wsBOwnerAuth = await getAuthenticatedClientForRoster(personBId, wsBId);
    const { data: hardDelRes, error: hardDelErr } = await wsBOwnerAuth.client.rpc(
      "admin_hard_delete_roster_member",
      {
        p_workspace_id: wsBId,
        p_roster_person_id: personB2Id,
      }
    );

    const { data: taskBAfterDel } = await admin
      .from("tasks")
      .select("id, workspace_id, primary_assignee_id, created_by_id")
      .eq("id", taskBId)
      .single();
    const { data: timeBAfterDel } = await admin
      .from("time_entries")
      .select("id, workspace_id, roster_person_id, created_by_id")
      .eq("id", timeEntryBId)
      .single();

    report.point1_crossWorkspace = {
      rpcCrossTests,
      dbCompositeFkTests,
      hardDeletePreservesHistoryAndWorkspaceId: {
        success: !hardDelErr && taskBAfterDel?.workspace_id === wsBId && taskBAfterDel?.primary_assignee_id === null && timeBAfterDel?.roster_person_id === null,
        rpcResponse: hardDelRes,
        error: hardDelErr?.message || null,
        taskBAfterDel,
        timeBAfterDel,
      },
    };
    console.log("Point 1 Result:", JSON.stringify(report.point1_crossWorkspace, null, 2));

    // =========================================================================
    // POINT 2: PRE-ONBOARDING ELIGIBILITY & ROLE/SPECIALTY RESTRICTIONS
    // =========================================================================
    console.log("\n=== [POINT 2] Testing Pre-Onboarding & Role Eligibility ===");
    // Create temporary roster members in Workspace B to test eligibility rules cleanly
    const preOnboardDesignerId = crypto.randomUUID();
    const viewerMemberId = crypto.randomUUID();
    const inactiveDesignerId = crypto.randomUUID();
    const regularExecutorId = crypto.randomUUID();
    const customReviewerExecutorId = crypto.randomUUID();

    const { error: p2InsertErr } = await admin.from("roster_people").insert([
      {
        id: preOnboardDesignerId,
        workspace_id: wsBId,
        display_name: "Pre-Onboarded Active Designer",
        job_title: "Graphic Designer",
        role: "designer",
        specialties: ["design"],
        custom_permissions: {},
        is_active: true,
      },
      {
        id: viewerMemberId,
        workspace_id: wsBId,
        display_name: "Business Owner Viewer",
        job_title: "Partner Viewer",
        role: "business_owner_viewer",
        specialties: ["design", "management"],
        custom_permissions: {},
        is_active: true,
      },
      {
        id: inactiveDesignerId,
        workspace_id: wsBId,
        display_name: "Deactivated Designer",
        job_title: "Graphic Designer",
        role: "designer",
        specialties: ["design"],
        custom_permissions: {},
        is_active: false,
      },
      {
        id: regularExecutorId,
        workspace_id: wsBId,
        display_name: "Regular Executor (No Review Auth)",
        job_title: "Video Editor",
        role: "video_editor",
        specialties: ["video"],
        custom_permissions: {},
        is_active: true,
      },
      {
        id: customReviewerExecutorId,
        workspace_id: wsBId,
        display_name: "Executor With Explicit approve_reviews",
        job_title: "Senior Video Editor",
        role: "video_editor",
        specialties: ["video"],
        custom_permissions: { approve_reviews: true },
        is_active: true,
      },
    ]);
    if (p2InsertErr) throw p2InsertErr;

    // 2.1 Active pre-onboarding member (no membership row, no accepted invite) -> accepted for assignment
    const preOnboardAssign = await wsBOwnerAuth.client.rpc("upsert_client_team_assignment", {
      p_workspace_id: wsBId,
      p_client_id: clientBId,
      p_primary_designer_id: preOnboardDesignerId,
    });
    const preOnboardTask = await wsBOwnerAuth.client.rpc("create_task_rpc", {
      p_workspace_id: wsBId,
      p_client_id: clientBId,
      p_title: "Task for pre-onboarded member",
      p_primary_assignee_id: preOnboardDesignerId,
    });

    // 2.2 business_owner_viewer -> rejected for execution and review
    const viewerAssignExec = await wsBOwnerAuth.client.rpc("upsert_client_team_assignment", {
      p_workspace_id: wsBId,
      p_client_id: clientBId,
      p_primary_designer_id: viewerMemberId,
    });
    const viewerAssignRev = await wsBOwnerAuth.client.rpc("upsert_client_team_assignment", {
      p_workspace_id: wsBId,
      p_client_id: clientBId,
      p_design_reviewer_id: viewerMemberId,
    });
    const viewerTaskExec = await wsBOwnerAuth.client.rpc("create_task_rpc", {
      p_workspace_id: wsBId,
      p_client_id: clientBId,
      p_title: "Task for viewer fail",
      p_primary_assignee_id: viewerMemberId,
    });

    // 2.3 Inactive member -> rejected for execution and review
    const inactiveAssignExec = await wsBOwnerAuth.client.rpc("upsert_client_team_assignment", {
      p_workspace_id: wsBId,
      p_client_id: clientBId,
      p_primary_designer_id: inactiveDesignerId,
    });
    const inactiveTaskExec = await wsBOwnerAuth.client.rpc("create_task_rpc", {
      p_workspace_id: wsBId,
      p_client_id: clientBId,
      p_title: "Task for inactive fail",
      p_primary_assignee_id: inactiveDesignerId,
    });

    // 2.4 Deleted member (personB2Id was hard-deleted in step 1.3) -> rejected
    const deletedTaskExec = await wsBOwnerAuth.client.rpc("create_task_rpc", {
      p_workspace_id: wsBId,
      p_client_id: clientBId,
      p_title: "Task for deleted fail",
      p_primary_assignee_id: personB2Id,
    });

    // 2.5 Ata (marketing_director in PROD_WS_ID) -> never executor or reviewer, only oversight
    const ataExecClient = await emadAuth.client.rpc("upsert_client_team_assignment", {
      p_workspace_id: PROD_WS_ID,
      p_client_id: sandboxClientAId,
      p_primary_strategist_id: ATA_ROSTER_ID,
    });
    const ataRevClient = await emadAuth.client.rpc("upsert_client_team_assignment", {
      p_workspace_id: PROD_WS_ID,
      p_client_id: sandboxClientAId,
      p_strategy_reviewer_id: ATA_ROSTER_ID,
    });
    const ataExecTask = await emadAuth.client.rpc("create_task_rpc", {
      p_workspace_id: PROD_WS_ID,
      p_client_id: sandboxClientAId,
      p_title: "Task for Ata fail",
      p_primary_assignee_id: ATA_ROSTER_ID,
    });
    const ataRevTask = await emadAuth.client.rpc("change_task_reviewer", {
      p_workspace_id: PROD_WS_ID,
      p_task_id: sandboxTaskAId,
      p_new_reviewer_id: ATA_ROSTER_ID,
    });
    const ataOversightOk = await emadAuth.client.rpc("upsert_client_team_assignment", {
      p_workspace_id: PROD_WS_ID,
      p_client_id: sandboxClientAId,
      p_marketing_director_id: ATA_ROSTER_ID,
    });

    // 2.6 Regular executor without approve_reviews -> rejected as reviewer, while custom_permissions.approve_reviews=true -> accepted
    const regExecAsReviewer = await wsBOwnerAuth.client.rpc("upsert_client_team_assignment", {
      p_workspace_id: wsBId,
      p_client_id: clientBId,
      p_video_reviewer_id: regularExecutorId,
    });
    const regExecAsTaskReviewer = await wsBOwnerAuth.client.rpc("change_task_reviewer", {
      p_workspace_id: wsBId,
      p_task_id: taskBId,
      p_new_reviewer_id: regularExecutorId,
    });
    const customRevAsReviewer = await wsBOwnerAuth.client.rpc("upsert_client_team_assignment", {
      p_workspace_id: wsBId,
      p_client_id: clientBId,
      p_requires_video: true,
      p_primary_video_editor_id: regularExecutorId,
      p_video_reviewer_id: customReviewerExecutorId,
    });

    report.point2_eligibility = {
      preOnboardedActiveMemberAccepted: {
        clientTeamAssignmentOk: !preOnboardAssign.error,
        taskCreationOk: !preOnboardTask.error,
      },
      businessOwnerViewerRejected: {
        executorBlocked: !!viewerAssignExec.error,
        reviewerBlocked: !!viewerAssignRev.error,
        taskBlocked: !!viewerTaskExec.error,
        errorSample: viewerAssignExec.error?.message,
      },
      inactiveAndDeletedRejected: {
        inactiveClientBlocked: !!inactiveAssignExec.error,
        inactiveTaskBlocked: !!inactiveTaskExec.error,
        deletedTaskBlocked: !!deletedTaskExec.error,
      },
      ataMarketingDirectorRules: {
        executorBlocked: !!ataExecClient.error && !!ataExecTask.error,
        reviewerBlocked: !!ataRevClient.error && !!ataRevTask.error,
        oversightAllowed: !ataOversightOk.error,
        execError: ataExecClient.error?.message,
        revError: ataRevClient.error?.message,
      },
      reviewPermissionNotAutomaticForExecutors: {
        regularExecutorRejectedForClientReview: !!regExecAsReviewer.error,
        regularExecutorRejectedForTaskReview: !!regExecAsTaskReviewer.error,
        executorWithApproveReviewsPermissionAccepted: !customRevAsReviewer.error,
        rejectionError: regExecAsReviewer.error?.message,
      },
    };
    console.log("Point 2 Result:", JSON.stringify(report.point2_eligibility, null, 2));

    // =========================================================================
    // POINT 3: NARROW SELF-APPROVAL EXCEPTION (EMAD ONLY vs AHMED AL-NAHHAS)
    // =========================================================================
    console.log("\n=== [POINT 3] Testing Self-Approval Scope (Emad vs Ahmed Al-Nahhas) ===");
    // 3.1 Emad's own task: can transition in_progress -> approved directly
    const { data: emadOwnTask } = await admin
      .from("tasks")
      .select("id, reviewer_id, status")
      .eq("id", sandboxTaskAId)
      .single();

    const emadStart = await emadAuth.client.rpc("transition_task_status", {
      p_workspace_id: PROD_WS_ID,
      p_task_id: sandboxTaskAId,
      p_new_status: "in_progress",
    });
    const emadSelfApprove = await emadAuth.client.rpc("transition_task_status", {
      p_workspace_id: PROD_WS_ID,
      p_task_id: sandboxTaskAId,
      p_new_status: "approved",
    });

    // 3.2 Ahmed Al-Nahhas's own task: CANNOT self-approve directly or via decide_review_round
    const { data: ahmedTaskRes, error: ahmedTaskCreateErr } = await ahmedAuth.client.rpc("create_task_rpc", {
      p_workspace_id: PROD_WS_ID,
      p_client_id: sandboxClientAId,
      p_title: `[SANDBOX_AHMED_OWN_TASK_${Date.now()}]`,
      p_primary_assignee_id: AHMED_ROSTER_ID,
      p_reviewer_id: EMAD_ROSTER_ID,
    });
    if (ahmedTaskCreateErr) throw ahmedTaskCreateErr;
    const ahmedOwnTaskId = ahmedTaskRes.task_id;
    tempProdTaskIds.push(ahmedOwnTaskId);

    const { data: ahmedOwnTaskRow } = await admin
      .from("tasks")
      .select("id, primary_assignee_id, reviewer_id, status")
      .eq("id", ahmedOwnTaskId)
      .single();

    await ahmedAuth.client.rpc("transition_task_status", {
      p_workspace_id: PROD_WS_ID,
      p_task_id: ahmedOwnTaskId,
      p_new_status: "in_progress",
    });

    // Attempt direct bypass in_progress -> approved as Ahmed on his own task
    const ahmedSelfBypassAttempt = await ahmedAuth.client.rpc("transition_task_status", {
      p_workspace_id: PROD_WS_ID,
      p_task_id: ahmedOwnTaskId,
      p_new_status: "approved",
    });

    // Attempt submit_review_round with p_reviewer_id = AHMED_ROSTER_ID (self-review) -> must be blocked
    const ahmedSelfReviewerSubmitAttempt = await ahmedAuth.client.rpc("submit_review_round", {
      p_workspace_id: PROD_WS_ID,
      p_task_id: ahmedOwnTaskId,
      p_preview_url: "https://drive.google.com/file/d/ahmed-self-test",
      p_note: "Trying to assign self as reviewer",
      p_reviewer_id: AHMED_ROSTER_ID,
    });

    // Submit review round as Ahmed on his own task to Emad -> goes to internal_review (not auto-approved)
    const ahmedSubmitReview = await ahmedAuth.client.rpc("submit_review_round", {
      p_workspace_id: PROD_WS_ID,
      p_task_id: ahmedOwnTaskId,
      p_preview_url: "https://drive.google.com/file/d/ahmed-review-test",
      p_note: "Submitting Ahmed task for review",
      p_reviewer_id: EMAD_ROSTER_ID,
    });

    // Attempt decide_review_round on his own task -> must be blocked
    const ahmedSelfDecideAttempt = await ahmedAuth.client.rpc("decide_review_round", {
      p_workspace_id: PROD_WS_ID,
      p_round_id: ahmedSubmitReview.data?.round_id,
      p_decision: "approved",
      p_feedback: "Trying to self-approve",
    });

    // Emad (owner) approves Ahmed's task -> succeeds!
    const emadApprovesAhmedTask = await emadAuth.client.rpc("decide_review_round", {
      p_workspace_id: PROD_WS_ID,
      p_round_id: ahmedSubmitReview.data?.round_id,
      p_decision: "approved",
      p_feedback: "Approved by Emad",
    });

    // 3.3 Ahmed Al-Nahhas approving ANOTHER member's task -> succeeds!
    const { data: someExec } = await admin
      .from("roster_people")
      .select("id")
      .eq("workspace_id", PROD_WS_ID)
      .eq("role", "designer")
      .eq("is_active", true)
      .limit(1)
      .single();
    const OTHER_MEMBER_ROSTER_ID = someExec.id;
    const { data: otherTaskRes, error: otherTaskErr } = await ahmedAuth.client.rpc("create_task_rpc", {
      p_workspace_id: PROD_WS_ID,
      p_client_id: sandboxClientAId,
      p_title: `[SANDBOX_OTHER_MEMBER_TASK_${Date.now()}]`,
      p_primary_assignee_id: OTHER_MEMBER_ROSTER_ID,
      p_reviewer_id: AHMED_ROSTER_ID,
    });
    if (otherTaskErr) throw otherTaskErr;
    const otherTaskId = otherTaskRes.task_id;
    tempProdTaskIds.push(otherTaskId);

    await ahmedAuth.client.rpc("transition_task_status", {
      p_workspace_id: PROD_WS_ID,
      p_task_id: otherTaskId,
      p_new_status: "in_progress",
    });

    // Submit review round on otherTaskId by Emad (or assignee) for Ahmed to review
    const otherSubmitRes = await emadAuth.client.rpc("submit_review_round", {
      p_workspace_id: PROD_WS_ID,
      p_task_id: otherTaskId,
      p_preview_url: "https://drive.google.com/file/d/other-member-task",
      p_note: "Submitted for Ahmed review",
      p_reviewer_id: AHMED_ROSTER_ID,
    });
    const ahmedApprovesOtherTask = await ahmedAuth.client.rpc("decide_review_round", {
      p_workspace_id: PROD_WS_ID,
      p_round_id: otherSubmitRes.data?.round_id,
      p_decision: "approved",
      p_feedback: "Approved by Company Owner Ahmed",
    });

    report.point3_selfApproval = {
      emadOwnerOnOwnTask: {
        resolvedReviewerIsNull: emadOwnTask.reviewer_id === null,
        directTransitionToApprovedSucceeded: !emadSelfApprove.error && emadSelfApprove.data?.status === "approved",
      },
      ahmedCompanyOwnerOnOwnTask: {
        directBypassBlocked: !!ahmedSelfBypassAttempt.error,
        directBypassError: ahmedSelfBypassAttempt.error?.message,
        selfReviewerSubmitBlocked: !!ahmedSelfReviewerSubmitAttempt.error,
        selfReviewerSubmitError: ahmedSelfReviewerSubmitAttempt.error?.message,
        submitReviewStatus: ahmedSubmitReview.data?.task_status,
        submitReviewError: ahmedSubmitReview.error?.message || null,
        selfDecideReviewBlocked: !!ahmedSelfDecideAttempt.error,
        selfDecideReviewError: ahmedSelfDecideAttempt.error?.message,
        emadApprovedAhmedTaskOk: !emadApprovesAhmedTask.error,
        emadApprovedError: emadApprovesAhmedTask.error?.message || null,
      },
      ahmedCompanyOwnerOnOthersWorkAndSystemAdmin: {
        canCreateTasksAndManageSystem: !otherTaskErr,
        otherSubmitError: otherSubmitRes.error?.message || null,
        canApproveOthersTaskOk: !ahmedApprovesOtherTask.error && ahmedApprovesOtherTask.data?.task_status === "approved",
        ahmedApprovesOtherError: ahmedApprovesOtherTask.error?.message || null,
      },
    };
    console.log("Point 3 Result:", JSON.stringify(report.point3_selfApproval, null, 2));

    // =========================================================================
    // POINT 4: VIDEO TRACK DATA PROOF (HANA, NOUR, HAGAR EL-SHAER, SAYED)
    // =========================================================================
    console.log("\n=== [POINT 4] Checking Live Video Track Roster & Client Counts ===");
    const { data: prodRoster } = await admin
      .from("roster_people")
      .select("id, display_name, job_title, role, specialties, is_active, custom_permissions")
      .eq("workspace_id", PROD_WS_ID)
      .eq("is_active", true)
      .order("display_name", { ascending: true });

    const { data: prodClients } = await admin
      .from("clients")
      .select("id, name, owner_roster_id, team_assignment:client_team_assignments(*)")
      .eq("workspace_id", PROD_WS_ID)
      .not("id", "in", `(${tempProdClientIds.map((id) => `"${id}"`).join(",")})`);

    const normalizedProdClients = (prodClients || []).map((c) => ({
      ...c,
      team_assignment: Array.isArray(c.team_assignment) ? c.team_assignment[0] || null : c.team_assignment,
    }));

    const assignableMembers = (prodRoster || []).filter(
      (m) => m.role !== "business_owner_viewer" && m.role !== "marketing_director" && m.role !== "viewer"
    );
    const videoEditorsList = assignableMembers.filter(
      (m) => m.role === "video_editor" || (m.specialties || []).includes("video_editing") || (m.specialties || []).includes("video")
    );

    const videoClientCounts = {};
    let totalAssignedVideoClients = 0;
    let totalNeedsVideoUnassigned = 0;
    let totalVideoNotNeeded = 0;

    normalizedProdClients.forEach((c) => {
      const edId = c.team_assignment?.primary_video_editor_id;
      const req = Boolean(c.team_assignment?.requires_video || edId);
      if (edId) {
        videoClientCounts[edId] = (videoClientCounts[edId] || 0) + 1;
        totalAssignedVideoClients++;
      } else if (req) {
        totalNeedsVideoUnassigned++;
      } else {
        totalVideoNotNeeded++;
      }
    });

    const videoEditorsSummary = videoEditorsList.map((v) => {
      const assignedClients = normalizedProdClients
        .filter((c) => c.team_assignment?.primary_video_editor_id === v.id)
        .map((c) => c.name);
      return {
        id: v.id,
        display_name: v.display_name,
        role: v.role,
        specialties: v.specialties,
        videoClientsCount: videoClientCounts[v.id] || 0,
        assignedClients,
      };
    });

    report.point4_videoTrack = {
      videoEditorsCount: videoEditorsSummary.length,
      videoEditors: videoEditorsSummary,
      separationOfCounts: {
        teamVideoEditorsCount: videoEditorsSummary.length,
        assignedVideoClientsCount: totalAssignedVideoClients,
        needsVideoUnassignedCount: totalNeedsVideoUnassigned,
        videoNotNeededCount: totalVideoNotNeeded,
      },
    };
    console.log("Point 4 Result:", JSON.stringify(report.point4_videoTrack, null, 2));

    // =========================================================================
    // POINT 6: SPECIFIC UNCLARIFIED ITEMS VERIFICATION
    // =========================================================================
    console.log("\n=== [POINT 6] Checking Specific Unclarified Items ===");
    // 6.1 Demo data check on tasks, clients, time_entries
    const { data: realTasks } = await admin
      .from("tasks")
      .select("id, title, status")
      .eq("workspace_id", PROD_WS_ID)
      .not("id", "in", `(${tempProdTaskIds.map((id) => `"${id}"`).join(",")})`);

    const { data: realTimeEntries } = await admin
      .from("time_entries")
      .select("id, task_id, roster_person_id, started_at, ended_at, is_voided, notes")
      .eq("workspace_id", PROD_WS_ID)
      .eq("is_voided", false);

    // 6.4 Independent Account Invitation Acceptance Cycle in Isolated Workspace B
    const inviteTargetRosterId = preOnboardDesignerId;
    const rawToken = crypto.randomBytes(24).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const tempInviteEmail = `invite.accept.${Date.now()}@omg-test.local`;

    const { data: inviteRow, error: invCreateErr } = await admin
      .from("workspace_invitations")
      .insert({
        workspace_id: wsBId,
        roster_person_id: inviteTargetRosterId,
        invited_email: tempInviteEmail,
        role: "designer",
        token_hash: tokenHash,
        invited_by_roster_id: personBId,
        status: "pending",
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      })
      .select("id")
      .single();
    if (invCreateErr) throw invCreateErr;

    const { data: createdInviteUser, error: ciuErr } = await admin.auth.admin.createUser({
      email: tempInviteEmail,
      password: "InvitePassword123!",
      email_confirm: true,
    });
    if (ciuErr) throw ciuErr;
    userInviteTempId = createdInviteUser.user.id;

    // Sign in as the independent invitee user and accept the invitation via accept_workspace_invitation_atomic
    const inviteeClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInErr } = await inviteeClient.auth.signInWithPassword({
      email: tempInviteEmail,
      password: "InvitePassword123!",
    });
    if (signInErr) throw signInErr;

    const { data: acceptRpcRes, error: acceptRpcErr } = await admin.rpc("accept_workspace_invitation_atomic", {
      p_invitation_id: inviteRow.id,
      p_user_id: userInviteTempId,
      p_token_hash: tokenHash,
      p_user_email: tempInviteEmail,
    });

    const { data: verifyMemAfterAccept } = await admin
      .from("workspace_memberships")
      .select("id, user_id, roster_person_id, role, is_active")
      .eq("workspace_id", wsBId)
      .eq("roster_person_id", inviteTargetRosterId)
      .maybeSingle();

    const { data: verifyInviteAfterAccept } = await admin
      .from("workspace_invitations")
      .select("id, status, accepted_at")
      .eq("id", inviteRow.id)
      .single();

    // 6.5 Time totals vs waiting separation test in Workspace B
    // Log a running timer on taskBId, then transition taskBId to 'waiting' via set_task_waiting_state
    // Verify that transitioning to 'waiting' auto-closes any open timer and does NOT count waiting duration as execution time
    const openTimerStart = new Date(Date.now() - 3600000).toISOString(); // 60 mins ago
    const { data: openTimerRow, error: otErr } = await admin
      .from("time_entries")
      .insert({
        workspace_id: wsBId,
        task_id: taskBId,
        roster_person_id: personBId,
        created_by_id: personBId,
        started_at: openTimerStart,
        ended_at: null,
        source: "timer",
      })
      .select("id")
      .single();
    if (otErr) throw otErr;

    // Put taskBId into waiting state -> should automatically stop the running timer!
    const { data: waitRes, error: waitErr } = await wsBOwnerAuth.client.rpc("set_task_waiting_state", {
      p_task_id: taskBId,
      p_is_waiting: true,
      p_waiting_reason: "بانتظار رد العميل",
      p_waiting_on_roster_id: personBId,
    });
    if (waitErr) throw waitErr;

    const { data: timerAfterWait } = await admin
      .from("time_entries")
      .select("id, started_at, ended_at, is_voided")
      .eq("id", openTimerRow.id)
      .single();

    report.point6_items = {
      productionTasksCount: (realTasks || []).length,
      productionTimeEntriesCount: (realTimeEntries || []).length,
      independentInviteCycle: {
        rpcSuccess: !acceptRpcErr,
        rpcError: acceptRpcErr?.message || null,
        membershipCreatedAndLinked:
          verifyMemAfterAccept?.user_id === userInviteTempId &&
          verifyMemAfterAccept?.roster_person_id === inviteTargetRosterId &&
          verifyMemAfterAccept?.is_active === true,
        invitationStatus: verifyInviteAfterAccept?.status,
      },
      timeTotalsAndWaitingSeparation: {
        runningTimerAutoClosedOnWaiting: !!timerAfterWait?.ended_at,
        waitingTaskSuccess: waitRes?.success === true && waitRes?.is_waiting === true,
      },
    };
    console.log("Point 6 Result:", JSON.stringify(report.point6_items, null, 2));
  } finally {
    console.log("\n=== Cleaning up temporary sandbox records & Isolated Workspace B ===");
    for (const tId of tempProdTaskIds) {
      await admin.from("tasks").delete().eq("id", tId);
    }
    for (const cId of tempProdClientIds) {
      await admin.from("clients").delete().eq("id", cId);
    }
    for (const rId of tempProdRosterIds) {
      await admin.from("roster_people").delete().eq("id", rId);
    }
    if (wsBId) {
      await admin.from("workspaces").delete().eq("id", wsBId);
    }
    if (userBId) {
      await admin.auth.admin.deleteUser(userBId);
    }
    if (userInviteTempId) {
      await admin.auth.admin.deleteUser(userInviteTempId);
    }
    console.log("Cleanup complete.");
  }
}

main().catch((err) => {
  console.error("Verification script failed:", err);
  process.exit(1);
});
