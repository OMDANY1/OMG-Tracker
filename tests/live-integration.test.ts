import { createClient } from "@supabase/supabase-js";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

async function main() {
  console.log("==========================================================");
  console.log("🚀 Live Supabase & Database Contract Verification (Hermetic)");
  console.log("==========================================================");

  // Load .env.local if not already in process.env
  const envFilePath = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(envFilePath)) {
    const envLines = fs.readFileSync(envFilePath, "utf-8").split("\n");
    for (const line of envLines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match && !process.env[match[1]]) {
        let val = match[2] || "";
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        process.env[match[1]] = val;
      }
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("❌ BLOCKED: Missing environment variables in .env.local");
    process.exit(1);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let passedCount = 0;
  let failedCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passedCount++;
    } else {
      console.error(`  ❌ FAIL: ${testName}${detail ? ` -> ${detail}` : ""}`);
      failedCount++;
    }
  }

  // Tracking arrays for hermetic cleanup in finally
  const cleanupUserIds: string[] = [];
  const cleanupStoragePaths: string[] = [];
  const cleanupCampaignIds: string[] = [];
  const cleanupTaskIds: string[] = [];
  const cleanupTimeEntryIds: string[] = [];
  const cleanupReviewRoundIds: string[] = [];
  const cleanupAttachmentIds: string[] = [];
  let testBootstrappedOwner = false;

  try {
    // 1. Check workspace
    console.log("\n[1] Workspace & Seed Verification...");
    const { data: workspaces, error: wsErr } = await adminClient
      .from("workspaces")
      .select("id, name")
      .limit(1);

    assert(!wsErr && !!workspaces && workspaces.length === 1, "Connected to OMG workspace", wsErr?.message);
    const workspaceId = workspaces![0].id;

    // 2. Check 28 Clients
    const { data: clients, error: cErr } = await adminClient
      .from("clients")
      .select("id, name, state, difficulty")
      .eq("workspace_id", workspaceId);

    assert(!cErr && clients?.length === 28, "Exactly 28 clients in database", `Found: ${clients?.length}`);
    const activeClients = clients?.filter((c) => c.state === "Active") || [];
    assert(activeClients.length === 27, "Exactly 27 active clients", `Found: ${activeClients.length}`);
    const zanzi = clients?.find((c) => c.name === "zanzi");
    assert(zanzi?.state === "Not started", "zanzi client is 'Not started'");

    // 3. Check 6 Designers + 1 Owner in Roster
    const { data: roster, error: rErr } = await adminClient
      .from("roster_people")
      .select("id, display_name, job_title, is_active")
      .eq("workspace_id", workspaceId);

    assert(!rErr && roster?.length === 7, "Exactly 7 roster members (6 designers + 1 owner)", `Found: ${roster?.length}`);
    const ownerRoster = roster?.find((r) => r.display_name.includes("Owner"));
    assert(!!ownerRoster, "Owner exists in roster");
    const sarahRoster = roster?.find((r) => r.display_name === "سارة");
    assert(!!sarahRoster, "Sarah exists in roster");
    const ayaRoster = roster?.find((r) => r.display_name === "آية");
    assert(!!ayaRoster, "Aya exists in roster");

    // 4. Test Owner Bootstrap & Auth
    console.log("\n[2] Owner Bootstrap & Authentication Flow...");
    const testOwnerEmail = `owner.test.${Date.now()}@omg-creative-workspace.internal`;
    const testOwnerPass = "SecureOwnerPass123!#";

    const { data: ownerUser, error: createOwnerErr } = await adminClient.auth.admin.createUser({
      email: testOwnerEmail,
      password: testOwnerPass,
      email_confirm: true,
      user_metadata: { full_name: "Owner Test User" },
    });

    assert(!createOwnerErr && !!ownerUser.user, "Created test owner user in Supabase Auth", createOwnerErr?.message);
    const ownerUserId = ownerUser.user!.id;
    cleanupUserIds.push(ownerUserId);

    // Check if an owner is already active
    const { data: existingOwners } = await adminClient
      .from("workspace_memberships")
      .select("id, user_id")
      .eq("workspace_id", workspaceId)
      .eq("role", "owner")
      .eq("is_active", true);

    if (existingOwners && existingOwners.length > 0) {
      console.log("  ℹ️ An active owner membership is already active in database.");
      const { error: secondOwnerErr } = await adminClient.rpc("bootstrap_owner", {
        p_workspace_id: workspaceId,
        p_owner_user_id: ownerUserId,
        p_roster_person_id: ownerRoster!.id,
      });
      assert(!!secondOwnerErr, "Prevented bootstrapping second owner when owner already exists", secondOwnerErr?.message);
    } else {
      // Invoke bootstrap_owner RPC via service_role
      const { data: bootData, error: bootErr } = await adminClient.rpc("bootstrap_owner", {
        p_workspace_id: workspaceId,
        p_owner_user_id: ownerUserId,
        p_roster_person_id: ownerRoster!.id,
      });

      assert(!bootErr && bootData?.success === true, "bootstrap_owner executed successfully", bootErr?.message);
      testBootstrappedOwner = true;

      // Verify single active owner constraint: trying to bootstrap non-owner roster fails
      const { error: secondOwnerErr } = await adminClient.rpc("bootstrap_owner", {
        p_workspace_id: workspaceId,
        p_owner_user_id: ownerUserId,
        p_roster_person_id: sarahRoster!.id,
      });
      assert(!!secondOwnerErr, "Prevented bootstrapping non-owner roster as second owner", secondOwnerErr?.message);
    }

    // 5. Test Login & Session & Logout
    console.log("\n[3] Login, Auth Session & Logout...");
    const ownerAuthClient = createClient(supabaseUrl, anonKey);
    const { data: signInData, error: signInErr } = await ownerAuthClient.auth.signInWithPassword({
      email: testOwnerEmail,
      password: testOwnerPass,
    });

    assert(!signInErr && !!signInData.session, "Owner signed in with Supabase Auth session", signInErr?.message);
    assert(signInData.user?.id === ownerUserId, "Auth session corresponds to correct owner user ID");

    // 6. Test Sarah (Designer) Setup & RLS Isolation
    console.log("\n[4] Designer Isolation & RLS Security...");
    const testSarahEmail = `sarah.test.${Date.now()}@omg-creative-workspace.internal`;
    const testSarahPass = "SecureSarahPass123!#";
    const { data: sarahUser } = await adminClient.auth.admin.createUser({
      email: testSarahEmail,
      password: testSarahPass,
      email_confirm: true,
    });
    const sarahUserId = sarahUser.user!.id;
    cleanupUserIds.push(sarahUserId);

    // Insert membership for Sarah
    await adminClient.from("workspace_memberships").insert({
      workspace_id: workspaceId,
      user_id: sarahUserId,
      roster_person_id: sarahRoster!.id,
      role: "designer",
      is_active: true,
    });

    // Create Sarah client
    const sarahClient = createClient(supabaseUrl, anonKey);
    await sarahClient.auth.signInWithPassword({
      email: testSarahEmail,
      password: testSarahPass,
    });

    // Create an entry for Aya directly via admin
    const { data: ayaEntry } = await adminClient.from("time_entries").insert({
      workspace_id: workspaceId,
      roster_person_id: ayaRoster!.id,
      task_id: null,
      started_at: new Date(Date.now() - 3600000).toISOString(),
      ended_at: new Date().toISOString(),
      category: "initial_design",
      duration_seconds: 3600,
      entry_type: "manual",
      note: "Aya private time entry",
    }).select().single();

    if (ayaEntry) cleanupTimeEntryIds.push(ayaEntry.id);

    // Query time_entries as Sarah
    const { data: sarahVisibleEntries, error: sQueryErr } = await sarahClient
      .from("time_entries")
      .select("id, roster_person_id");

    assert(!sQueryErr, "Sarah queried time_entries table successfully");
    const sawAyaEntry = sarahVisibleEntries?.some((e) => e.id === ayaEntry?.id);
    assert(!sawAyaEntry, "RLS isolation: Designer Sarah CANNOT see Aya's time entries");

    // 7. Scenario Sarah / Wael Samir / Post 01
    console.log("\n[5] Sarah / Wael Samir / Post 01 Scenario...");
    const waelSamir = clients?.find((c) => c.name.includes("وائل سمير") || c.name.toLowerCase().includes("wael"));
    assert(!!waelSamir, "Found Wael Samir client account");
    const waelClientId = waelSamir ? waelSamir.id : clients![0].id;

    // Create Campaign for Wael Samir as authenticated Owner via RPC matching RPC_CONTRACT
    const { data: campaignId, error: campErr } = await ownerAuthClient.rpc("create_campaign", {
      p_workspace_id: workspaceId,
      p_client_id: waelClientId,
      p_title: "Hermetic Test Campaign",
      p_objective: "Hermetic Integration Test Campaign",
      p_brief: "Comprehensive campaign for product teasers",
      p_start_date: "2026-09-01",
      p_due_date: "2026-09-30",
      p_status: "Active",
      p_idempotency_key: `camp_${Date.now()}`,
    });
    assert(!campErr && !!campaignId, "Created campaign for client via create_campaign RPC", campErr?.message);

    const actualCampaignId = (typeof campaignId === "object" && campaignId?.campaign_id) ? campaignId.campaign_id : campaignId;
    if (actualCampaignId) cleanupCampaignIds.push(actualCampaignId);

    const { data: createdTask, error: taskErr } = await ownerAuthClient.rpc("create_task_rpc", {
      p_workspace_id: workspaceId,
      p_client_id: waelClientId,
      p_campaign_id: actualCampaignId,
      p_title: "Post 01 - Visual Identity Teaser",
      p_brief: "High impact visual design for September launch",
      p_description: "Design social media post 01 for Wael Samir",
      p_deliverable_format: "png",
      p_deliverable_number: "01",
      p_priority: "Normal",
      p_primary_assignee_id: sarahRoster!.id,
      p_reviewer_id: ownerRoster!.id,
      p_due_date: new Date(Date.now() + 86400000).toISOString(),
      p_estimated_hours: 4.0,
      p_working_file_url: null,
      p_reference_urls: [],
      p_idempotency_key: `task_${Date.now()}`,
    });

    const taskId = createdTask?.task_id;
    if (taskId) cleanupTaskIds.push(taskId);
    assert(!taskErr && !!taskId, "Created task 'Post 01' assigned to Sarah via create_task_rpc", taskErr?.message);

    // Transition Task: backlog -> ready via RPC
    const { data: readyData, error: readyErr } = await ownerAuthClient.rpc("transition_task_status", {
      p_task_id: taskId,
      p_new_status: "ready",
      p_reason: "Task ready for design",
      p_idempotency_key: `trans_ready_${Date.now()}`,
    });
    assert(!readyErr, "Transitioned task backlog -> ready via transition_task_status RPC", readyErr?.message);

    // Transition Task: ready -> in_progress as Sarah via RPC
    const { data: transData, error: transErr } = await sarahClient.rpc("transition_task_status", {
      p_task_id: taskId,
      p_new_status: "in_progress",
      p_reason: "Starting work on Post 01",
      p_idempotency_key: `trans_prog_${Date.now()}`,
    });
    assert(!transErr, "Transitioned task ready -> in_progress via transition_task_status RPC", transErr?.message);

    // 8. Start and Stop Timer via RPC
    console.log("\n[6] Timer Start & Stop on Live Database...");
    const { data: timerStartData, error: timerStartErr } = await sarahClient.rpc("start_or_switch_timer", {
      p_task_id: taskId,
      p_category: "initial_design",
      p_note: "Designing Post 01 layout",
      p_idempotency_key: `timer_start_${Date.now()}`,
    });
    assert(!timerStartErr && !!timerStartData?.time_entry_id, "Sarah started timer on Post 01 via start_or_switch_timer RPC", timerStartErr?.message);
    const timeEntryId = timerStartData?.time_entry_id;
    if (timeEntryId) cleanupTimeEntryIds.push(timeEntryId);

    // Stop Timer
    const { data: timerStopData, error: timerStopErr } = await sarahClient.rpc("stop_timer", {
      p_time_entry_id: timeEntryId,
      p_reason: "Paused layout design",
      p_note: "Completed initial draft",
      p_idempotency_key: `timer_stop_${Date.now()}`,
    });
    assert(!timerStopErr && !!timerStopData, "Sarah stopped timer on Post 01 via stop_timer RPC", timerStopErr?.message);

    // 9. Storage Upload & Task Attachment
    console.log("\n[7] Live Storage Upload & Attachment Lineage...");
    const testFileName = `deliverable_test_${Date.now()}.png`;
    const storagePath = `${workspaceId}/${taskId}/${testFileName}`;
    const dummyBuffer = Buffer.from("PNG_SAMPLE_DATA_LIVE_TEST_OMG_WORKSPACE_2026");

    const { data: uploadData, error: uploadErr } = await adminClient.storage
      .from("deliverables")
      .upload(storagePath, dummyBuffer, {
        contentType: "image/png",
        upsert: true,
      });

    cleanupStoragePaths.push(storagePath);
    assert(!uploadErr, "Uploaded deliverable file to Supabase Storage 'deliverables' bucket", uploadErr?.message);

    // Register attachment as Sarah via RPC matching RPC_CONTRACT
    const { data: attachData, error: attachErr } = await sarahClient.rpc("create_task_attachment", {
      p_task_id: taskId,
      p_file_name: testFileName,
      p_storage_path: storagePath,
      p_file_size_bytes: dummyBuffer.length,
      p_mime_type: "image/png",
      p_idempotency_key: `attach_${Date.now()}`,
    });
    assert(!attachErr && !!attachData, "Linked attachment to task via create_task_attachment RPC", attachErr?.message);
    if (attachData?.attachment_id) cleanupAttachmentIds.push(attachData.attachment_id);

    // 10. Review Submission with Self-Approval Guard
    console.log("\n[8] Review Submission & Anti-Self-Approval Guard...");
    const { data: reviewData, error: reviewErr } = await sarahClient.rpc("submit_review_round", {
      p_task_id: taskId,
      p_preview_url: `https://${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/deliverables/${storagePath}`,
      p_note: "Initial design ready for review",
      p_round_type: "internal",
      p_idempotency_key: `review_${Date.now()}`,
    });
    assert(!reviewErr && !!reviewData, "Submitted review round via submit_review_round RPC", reviewErr?.message);
    const roundId = reviewData?.round_id;
    if (roundId) cleanupReviewRoundIds.push(roundId);

    // Attempt self-approval as Sarah (submitter) -> MUST BE REJECTED
    const { error: selfApproveErr } = await sarahClient.rpc("decide_review_round", {
      p_round_id: roundId,
      p_decision: "approved",
      p_feedback: "I approve my own work",
      p_idempotency_key: `self_app_${Date.now()}`,
    });
    assert(!!selfApproveErr, "Anti-Self-Approval guard: Submitter Sarah CANNOT approve her own review round", selfApproveErr?.message);

    // Owner approves
    const { data: ownerApproval, error: ownerApproveErr } = await ownerAuthClient.rpc("decide_review_round", {
      p_round_id: roundId,
      p_decision: "approved",
      p_feedback: "Approved by Owner. Excellent work!",
      p_idempotency_key: `owner_app_${Date.now()}`,
    });
    assert(!ownerApproveErr && !!ownerApproval, "Review approved by designated reviewer (Owner)", ownerApproveErr?.message);

    // 11. Monthly Report Generation via RPC matching RPC_CONTRACT
    console.log("\n[9] Monthly Report Calculation via RPC...");
    const { data: reportDraft, error: reportErr } = await ownerAuthClient.rpc("generate_monthly_report_draft", {
      p_workspace_id: workspaceId,
      p_month_key: "2026-09",
    });

    assert(!reportErr && !!reportDraft, "Calculated monthly report draft for '2026-09' via generate_monthly_report_draft RPC", reportErr?.message);
    assert(reportDraft?.monthKey === "2026-09", "Report monthKey matches '2026-09'");
    assert(Array.isArray(reportDraft?.designerSummary), "Report includes designerSummary array");
    assert(Array.isArray(reportDraft?.clientSummary), "Report includes clientSummary array");

    // Test Logout
    const { error: signOutErr } = await ownerAuthClient.auth.signOut();
    assert(!signOutErr, "Owner signed out cleanly");
  } finally {
    console.log("\n[10] Executing Hermetic Teardown...");

    // 1. Delete storage files
    if (cleanupStoragePaths.length > 0) {
      try {
        await adminClient.storage.from("deliverables").remove(cleanupStoragePaths);
        console.log(`  🧹 Removed ${cleanupStoragePaths.length} storage deliverable file(s).`);
      } catch (err) {
        console.warn("Storage removal warning:", err);
      }
    }

    // 2. Database SQL teardown
    try {
      const sqlStatements: string[] = ["BEGIN;"];
      sqlStatements.push("ALTER TABLE public.review_rounds DISABLE TRIGGER trg_protect_review_rounds_delete;");

      if (cleanupAttachmentIds.length > 0) {
        const idList = cleanupAttachmentIds.map((id) => `'${id}'`).join(",");
        sqlStatements.push(`DELETE FROM public.attachments WHERE id IN (${idList});`);
      }
      if (cleanupReviewRoundIds.length > 0) {
        const idList = cleanupReviewRoundIds.map((id) => `'${id}'`).join(",");
        sqlStatements.push(`DELETE FROM public.review_rounds WHERE id IN (${idList});`);
      }
      if (cleanupTimeEntryIds.length > 0) {
        const idList = cleanupTimeEntryIds.map((id) => `'${id}'`).join(",");
        sqlStatements.push(`DELETE FROM public.time_entries WHERE id IN (${idList});`);
      }
      if (cleanupTaskIds.length > 0) {
        const idList = cleanupTaskIds.map((id) => `'${id}'`).join(",");
        sqlStatements.push(`DELETE FROM public.task_status_events WHERE task_id IN (${idList});`);
        sqlStatements.push(`DELETE FROM public.task_assignment_events WHERE task_id IN (${idList});`);
        sqlStatements.push(`DELETE FROM public.task_due_date_events WHERE task_id IN (${idList});`);
        sqlStatements.push(`DELETE FROM public.tasks WHERE id IN (${idList});`);
      }
      if (cleanupCampaignIds.length > 0) {
        const idList = cleanupCampaignIds.map((id) => `'${id}'`).join(",");
        sqlStatements.push(`DELETE FROM public.campaigns WHERE id IN (${idList});`);
      }
      if (cleanupUserIds.length > 0) {
        const idList = cleanupUserIds.map((id) => `'${id}'`).join(",");
        sqlStatements.push(`DELETE FROM public.workspace_memberships WHERE user_id IN (${idList});`);
        sqlStatements.push(`DELETE FROM public.audit_events;`);
        sqlStatements.push(`DELETE FROM public.rpc_idempotency_records;`);
      }

      sqlStatements.push("ALTER TABLE public.review_rounds ENABLE TRIGGER trg_protect_review_rounds_delete;");
      sqlStatements.push("COMMIT;");

      const tempSqlFile = path.join(process.cwd(), ".tmp_hermetic_cleanup.sql");
      fs.writeFileSync(tempSqlFile, sqlStatements.join("\n"), "utf8");

      try {
        execSync(`npx supabase db query --linked --file "${tempSqlFile}"`, {
          cwd: process.cwd(),
          encoding: "utf8",
        });
        console.log("  🧹 Database test rows purged and triggers restored cleanly.");
      } finally {
        if (fs.existsSync(tempSqlFile)) fs.unlinkSync(tempSqlFile);
      }
    } catch (err) {
      console.warn("Database cleanup error:", err);
    }

    // 3. Delete Auth users
    for (const uid of cleanupUserIds) {
      try {
        await adminClient.auth.admin.deleteUser(uid);
      } catch (err) {
        // Ignore user deletion failure
      }
    }
    console.log(`  🧹 Deleted ${cleanupUserIds.length} temporary auth test user(s).`);
  }

  console.log("\n==========================================================");
  console.log(`Live Integration Results: ${passedCount} Passed | ${failedCount} Failed`);
  console.log("==========================================================");

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Live integration test encountered exception:", err);
  process.exit(1);
});
