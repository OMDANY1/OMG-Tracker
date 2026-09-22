import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const supabaseUrl = "http://127.0.0.1:54321";
const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const serviceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function run() {
  console.log("================================================================================");
  console.log("🧪 VERIFICATION SUITE: ROSTER RECONCILIATION & MARKETING DIRECTOR RESTRICTIONS");
  console.log("================================================================================");

  // 1. Get Workspace
  const { data: ws, error: wsErr } = await adminClient.from("workspaces").select("id, name").limit(1).single();
  if (wsErr || !ws) {
    throw new Error(`Failed to load workspace: ${wsErr?.message}`);
  }
  const wsId = ws.id;
  console.log(`🏢 Workspace: ${ws.name} (${wsId})\n`);

  // ============================================================================
  // TEST 1: Roster Integrity & Zero Duplicates / Question Marks
  // ============================================================================
  console.log("--- [Test 1] Verifying Active Roster Integrity & Zero Duplicates ---");
  const { data: roster, error: rosterErr } = await adminClient
    .from("roster_people")
    .select("id, display_name, job_title, specialties, is_active")
    .eq("is_active", true)
    .order("display_name");

  if (rosterErr || !roster) {
    throw new Error(`Failed to query roster: ${rosterErr?.message}`);
  }

  console.log(`  Total Active Roster Members: ${roster.length}`);
  assert(roster.length === 15, `Expected exactly 15 active roster members, found ${roster.length}`);

  const names = roster.map((r) => r.display_name);
  const uniqueNames = new Set(names);
  assert(uniqueNames.size === names.length, `Expected unique names with 0 duplicates, found ${uniqueNames.size}/${names.length}`);

  const questionMarkRows = roster.filter((r) => r.display_name.includes("?"));
  assert(questionMarkRows.length === 0, `Expected 0 names with '?', found ${questionMarkRows.length}`);

  const duplicateTestRows = roster.filter((r) => r.display_name.includes("(تجريبي)") && !r.display_name.includes("فيديو إيديتور"));
  assert(duplicateTestRows.length === 0, `Expected 0 duplicate '(تجريبي)' rows, found ${duplicateTestRows.length}`);

  const requiredNames = [
    "عماد",
    "عطا",
    "أروى",
    "تسنيم",
    "هند",
    "هاجر حسن",
    "ميرهان",
    "ميار",
    "ريهام",
    "ندى",
    "سارة",
    "آلاء",
    "شهد",
    "آية",
    "فيديو إيديتور (تجريبي)",
  ];

  for (const reqName of requiredNames) {
    assert(names.includes(reqName), `Required team member exists: "${reqName}"`);
  }

  // ============================================================================
  // TEST 2: Auth Logins & Token Acquisition
  // ============================================================================
  console.log("\n--- [Test 2] Authenticating Personas ---");

  const ataClient = createClient(supabaseUrl, anonKey);
  const { data: ataAuth, error: ataAuthErr } = await ataClient.auth.signInWithPassword({
    email: "test-marketing-dir@omg-staging.test",
    password: "TestPassword123!",
  });
  assert(!ataAuthErr && !!ataAuth.session, "Ata (Marketing Director) authenticated successfully");
  const ataToken = ataAuth.session?.access_token || "";

  const ownerClient = createClient(supabaseUrl, anonKey);
  const { data: ownerAuth, error: ownerAuthErr } = await ownerClient.auth.signInWithPassword({
    email: "test-owner@omg-staging.test",
    password: "TestPassword123!",
  });
  assert(!ownerAuthErr && !!ownerAuth.session, "Emad (Owner) authenticated successfully");
  const ownerToken = ownerAuth.session?.access_token || "";

  const arwaClient = createClient(supabaseUrl, anonKey);
  const { data: arwaAuth, error: arwaAuthErr } = await arwaClient.auth.signInWithPassword({
    email: "test-strategy-lead@omg-staging.test",
    password: "TestPassword123!",
  });
  assert(!arwaAuthErr && !!arwaAuth.session, "Arwa (Strategy Lead) authenticated successfully");

  // Verify Ata's technical role in workspace_memberships
  const { data: ataMem } = await adminClient
    .from("workspace_memberships")
    .select("role, roster_person:roster_people(display_name, job_title)")
    .eq("user_id", ataAuth.user?.id)
    .single();
  assert(ataMem?.role === "marketing_director", `Ata role is strictly 'marketing_director' (found: ${ataMem?.role})`);
  assert(
    (ataMem?.roster_person as any)?.job_title === "Marketing Director",
    `Ata job title is 'Marketing Director' (found: ${(ataMem?.roster_person as any)?.job_title})`
  );

  // ============================================================================
  // TEST 3: Ata's ALLOWED Capabilities (Time Tracking & Reports Viewing/Export)
  // ============================================================================
  console.log("\n--- [Test 3] Testing Ata's ALLOWED Capabilities ---");

  // A. View time entries across workspace
  const { data: ataTimeEntries, error: ataTeErr } = await ataClient
    .from("time_entries")
    .select("id, duration_seconds, category, task_id")
    .limit(5);
  assert(!ataTeErr && Array.isArray(ataTimeEntries), `Ata can view time entries across workspace (count: ${ataTimeEntries?.length})`);

  // B. Export Timesheet CSV via API with UTF-8 BOM
  try {
    const timesheetRes = await fetch("http://localhost:3000/api/reports/export-csv?type=timesheet&monthKey=2026-09", {
      headers: {
        Authorization: `Bearer ${ataToken}`,
      },
    });
    assert(timesheetRes.status === 200, `Ata can export Timesheet CSV (Status: ${timesheetRes.status})`);

    const timesheetArr = await timesheetRes.arrayBuffer();
    const timesheetBuf = Buffer.from(timesheetArr);
    assert(
      timesheetBuf[0] === 0xef && timesheetBuf[1] === 0xbb && timesheetBuf[2] === 0xbf,
      "Timesheet CSV starts with UTF-8 BOM (0xEF, 0xBB, 0xBF) for Excel compatibility"
    );

    const timesheetText = timesheetBuf.toString("utf-8");
    assert(timesheetText.includes("اسم العضو") && timesheetText.includes("المسمى الوظيفي"), "Timesheet CSV includes Arabic headers");
    assert(
      timesheetText.includes("ساعات العمل الفعلي") && timesheetText.includes("ساعات الانتظار والتعطيل"),
      "Timesheet CSV clearly separates work from waiting hours"
    );

    // Save sample file for evidence
    const evidenceDir = "C:\\Users\\elwady\\.gemini\\antigravity\\brain\\4f958e1c-479f-453e-888c-49e86530171c\\scratch\\evidence";
    if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, "sample_timesheet_export_arabic.csv"), timesheetBuf);
    console.log("  📁 Saved sample Timesheet CSV to evidence/sample_timesheet_export_arabic.csv");
  } catch (err: any) {
    assert(false, `Ata timesheet export failed: ${err.message}`);
  }

  // C. Export Evaluations CSV via API with UTF-8 BOM
  try {
    const evalRes = await fetch("http://localhost:3000/api/reports/export-csv?type=evaluations&monthKey=2026-09", {
      headers: {
        Authorization: `Bearer ${ataToken}`,
      },
    });
    assert(evalRes.status === 200, `Ata can export Evaluations CSV (Status: ${evalRes.status})`);

    const evalArr = await evalRes.arrayBuffer();
    const evalBuf = Buffer.from(evalArr);
    assert(
      evalBuf[0] === 0xef && evalBuf[1] === 0xbb && evalBuf[2] === 0xbf,
      "Evaluations CSV starts with UTF-8 BOM (0xEF, 0xBB, 0xBF) for Excel compatibility"
    );

    const evalText = evalBuf.toString("utf-8");
    assert(evalText.includes("القرار والتقييم الفعلي") && evalText.includes("وقت الاستجابة للمراجعة"), "Evaluations CSV includes actual review decisions & turnaround times");

    const evidenceDir = "C:\\Users\\elwady\\.gemini\\antigravity\\brain\\4f958e1c-479f-453e-888c-49e86530171c\\scratch\\evidence";
    fs.writeFileSync(path.join(evidenceDir, "sample_evaluations_export_arabic.csv"), evalBuf);
    console.log("  📁 Saved sample Evaluations CSV to evidence/sample_evaluations_export_arabic.csv");
  } catch (err: any) {
    assert(false, `Ata evaluations export failed: ${err.message}`);
  }

  // ============================================================================
  // TEST 4: Ata's STRICTLY FORBIDDEN Actions (RBAC Security Enforcement)
  // ============================================================================
  console.log("\n--- [Test 4] Testing Ata's FORBIDDEN Actions (Must be blocked) ---");

  // Find a client with brief
  const { data: client } = await adminClient.from("clients").select("id, name").limit(1).single();
  const clientId = client?.id;

  // A. Forbidden: approve_client_brief_strategy
  const { error: ataBriefErr } = await ataClient.rpc("approve_client_brief_strategy", {
    p_workspace_id: wsId,
    p_client_id: clientId,
    p_approved_content: "Attempted approval by Ata",
  });
  assert(
    !!ataBriefErr && ataBriefErr.message.includes("Access denied: Only Workspace Owner"),
    `Ata blocked from approve_client_brief_strategy: "${ataBriefErr?.message}"`
  );

  // B. Forbidden: decide_review_round
  // Find any pending review round
  let roundId: string | null = null;
  const { data: round } = await adminClient.from("review_rounds").select("id").limit(1).maybeSingle();
  if (round) {
    roundId = round.id;
  } else {
    // create a dummy round for testing
    const { data: task } = await adminClient.from("tasks").select("id").limit(1).single();
    const { data: newRound } = await adminClient.from("review_rounds").insert({
      workspace_id: wsId,
      task_id: task!.id,
      round_number: 99,
      round_type: "internal",
      decision: "pending",
    }).select("id").single();
    roundId = newRound!.id;
  }

  const { error: ataReviewErr } = await ataClient.rpc("decide_review_round", {
    p_workspace_id: wsId,
    p_round_id: roundId,
    p_decision: "approved",
    p_feedback: "Ata approving round",
  });
  assert(
    !!ataReviewErr && ataReviewErr.message.includes("Permission denied: Marketing Director cannot decide review rounds"),
    `Ata blocked from decide_review_round: "${ataReviewErr?.message}"`
  );

  // C. Forbidden: upsert_client_team_assignment
  const { error: ataAssignErr } = await ataClient.rpc("upsert_client_team_assignment", {
    p_workspace_id: wsId,
    p_client_id: clientId,
    p_marketing_director_id: ataMem?.roster_person ? (ataMem.roster_person as any).id : null,
  });
  assert(
    !!ataAssignErr && ataAssignErr.message.includes("Access denied: Only Workspace Owner"),
    `Ata blocked from configuring client team assignments: "${ataAssignErr?.message}"`
  );

  // D. Forbidden: reassign_task
  const { data: sampleTask } = await adminClient.from("tasks").select("id").limit(1).single();
  const { error: ataReassignErr } = await ataClient.rpc("reassign_task", {
    p_workspace_id: wsId,
    p_task_id: sampleTask!.id,
    p_new_assignee_id: sampleTask!.id,
    p_reason: "Unauthorized reassign",
  });
  assert(
    !!ataReassignErr && ataReassignErr.message.includes("Permission denied: Only Owner or Manager"),
    `Ata blocked from reassigning tasks: "${ataReassignErr?.message}"`
  );

  // E. Forbidden: Finalizing monthly report snapshot via API
  try {
    const freezeRes = await fetch("http://localhost:3000/api/reports/monthly", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ataToken}`,
      },
      body: JSON.stringify({
        workspaceId: wsId,
        monthKey: "2026-09",
        commentary: { whatWentWell: "Unauthorized test" },
      }),
    });
    assert(freezeRes.status === 403, `Ata blocked from finalizing report snapshot via API (Status: ${freezeRes.status})`);
  } catch (err: any) {
    assert(false, `Snapshot test error: ${err.message}`);
  }

  // ============================================================================
  // TEST 5: Correct Strategy Lifecycle (Arwa Operational Review -> Emad Workspace Approval)
  // ============================================================================
  console.log("\n--- [Test 5] Strategy Workflow: Arwa (Operational) -> Emad (Workspace Owner) ---");

  // Ensure brief exists and is in in_review state
  await adminClient.from("client_briefs").upsert({
    workspace_id: wsId,
    client_id: clientId,
    strategy_summary: "استراتيجية تسويقية متكاملة لمشروع سبتمبر",
    status: "in_review",
    updated_at: new Date().toISOString(),
  }, { onConflict: "workspace_id,client_id" });

  // Step 1: Arwa performs operational review
  const { data: arwaRev, error: arwaRevErr } = await arwaClient.rpc("review_client_brief_operational", {
    p_workspace_id: wsId,
    p_client_id: clientId,
    p_feedback: "مراجعة تشغيلية معتمدة ومطابقة للمستهدفات",
    p_decision: "approved",
  });
  assert(!arwaRevErr && arwaRev?.success === true, "Arwa successfully completed operational strategy review");

  // Step 2: Emad grants final workspace strategy approval
  const { data: emadApp, error: emadAppErr } = await ownerClient.rpc("approve_client_brief_strategy", {
    p_workspace_id: wsId,
    p_client_id: clientId,
    p_approved_content: "الاستراتيجية معتمدة نهائيًا من المالك عماد",
  });
  assert(!emadAppErr && emadApp?.success === true, "Emad (Owner) successfully granted final workspace strategy approval");

  // Verify brief is now approved and approved_by_roster_id is Emad
  const { data: updatedBrief } = await adminClient
    .from("client_briefs")
    .select("status, strategy_version, approved_by:roster_people!client_briefs_approved_by_roster_id_fkey(display_name)")
    .eq("client_id", clientId)
    .single();
  assert(updatedBrief?.status === "approved", `Brief status is 'approved' (actual: ${updatedBrief?.status})`);
  assert(
    (updatedBrief?.approved_by as any)?.display_name === "عماد",
    `Brief approver is 'عماد' (actual: ${(updatedBrief?.approved_by as any)?.display_name})`
  );

  console.log("\n================================================================================");
  console.log(`📊 SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("FATAL ERROR in test execution:", err);
  process.exit(1);
});
