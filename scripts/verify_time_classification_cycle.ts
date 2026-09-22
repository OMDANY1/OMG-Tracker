import { createClient } from "@supabase/supabase-js";
import assert from "assert";
import fs from "fs";
import path from "path";

let SUPABASE_URL = "http://127.0.0.1:54321";
let SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
let ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

try {
  const envContent = fs.readFileSync(".env.local", "utf-8");
  envContent.split("\n").forEach((line) => {
    const [k, ...v] = line.trim().split("=");
    if (k && v.length) {
      const val = v.join("=").trim();
      if (k === "NEXT_PUBLIC_SUPABASE_URL") SUPABASE_URL = val;
      if (k === "SUPABASE_SERVICE_ROLE_KEY") SERVICE_ROLE_KEY = val;
      if (k === "NEXT_PUBLIC_SUPABASE_ANON_KEY") ANON_KEY = val;
    }
  });
} catch {}

async function main() {
  console.log("================================================================================");
  console.log("TIME CLASSIFICATION, DECOUPLING & WAITING VERIFICATION SUITE");
  console.log("================================================================================");

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Authenticate as Owner Emad
  const ownerClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: ownerAuth, error: authErr } = await ownerClient.auth.signInWithPassword({
    email: "test-owner@omg-staging.test",
    password: "TestPassword123!",
  });
  assert(!authErr && !!ownerAuth.session, "Owner authenticated successfully");
  const ownerToken = ownerAuth.session?.access_token || "";

  // ----------------------------------------------------------------------------
  // TEST PART 1: Verify PostgreSQL Enum and Decoupled Schema
  // ----------------------------------------------------------------------------
  console.log("\n--- [Step 1] Verifying Database Enum and Schema ---");

  // Verify active non-voided time entries
  const { data: activeEntries, error: teErr } = await adminClient
    .from("time_entries")
    .select(`
      id,
      category,
      duration_seconds,
      started_at,
      ended_at,
      note,
      is_voided,
      person:roster_people!fk_time_person(display_name, job_title),
      task:tasks!fk_time_task(id, title, work_stage)
    `)
    .eq("is_voided", false)
    .order("started_at", { ascending: true });

  if (teErr) console.error("teErr details:", teErr);
  assert(!teErr && activeEntries, "Successfully fetched active time entries");
  console.log(`Found ${activeEntries.length} active time entries in test cycle:`);
  activeEntries.forEach((e: any) => {
    console.log(` - [${e.category}] ${e.person?.display_name} (${e.person?.job_title}) | ` +
      `Duration: ${e.duration_seconds}s (${(e.duration_seconds / 60).toFixed(0)}m) | Note: ${e.note}`);
  });

  // ----------------------------------------------------------------------------
  // TEST PART 2: Verify Exact Target Test Cycle
  // ----------------------------------------------------------------------------
  console.log("\n--- [Step 2] Verifying Exact Test Cycle Figures ---");
  const mirhanWriting = activeEntries.find((e: any) => e.category === "content_writing");
  const tasneemReview = activeEntries.find((e: any) => e.category === "review");
  const mirhanRevision = activeEntries.find((e: any) => e.category === "internal_revision");
  const waitingEntry = activeEntries.find((e: any) => e.category === "waiting");

  assert(mirhanWriting, "Found Mirhan content writing entry (category: content_writing)");
  assert(mirhanWriting.duration_seconds === 1800, `Mirhan writing duration is exactly 1800s / 30m (found: ${mirhanWriting.duration_seconds}s)`);
  assert(mirhanWriting.person?.display_name === "ميرهان", "Writing session attributed to Mirhan");

  assert(tasneemReview, "Found Tasneem review entry (category: review)");
  assert(tasneemReview.duration_seconds === 600, `Tasneem review duration is exactly 600s / 10m (found: ${tasneemReview.duration_seconds}s)`);
  assert(tasneemReview.person?.display_name === "تسنيم", "Review session attributed to Tasneem");

  assert(mirhanRevision, "Found Mirhan revision entry (category: internal_revision)");
  assert(mirhanRevision.duration_seconds === 300, `Mirhan revision duration is exactly 300s / 5m (found: ${mirhanRevision.duration_seconds}s)`);
  assert(mirhanRevision.person?.display_name === "ميرهان", "Revision session attributed to Mirhan");

  assert(waitingEntry, "Found separate waiting entry (category: waiting)");
  assert(waitingEntry.duration_seconds === 3600, `Waiting duration is exactly 3600s / 60m (found: ${waitingEntry.duration_seconds}s)`);

  const totalDirectSeconds = mirhanWriting.duration_seconds + tasneemReview.duration_seconds + mirhanRevision.duration_seconds;
  assert(totalDirectSeconds === 2700, `Total direct work is exactly 2700s (45 minutes, 0.75h) (found: ${totalDirectSeconds}s)`);
  console.log("✓ Exact test cycle durations validated in seconds:");
  console.log(`  Writing: ${mirhanWriting.duration_seconds}s (30m)`);
  console.log(`  Review: ${tasneemReview.duration_seconds}s (10m)`);
  console.log(`  Revision: ${mirhanRevision.duration_seconds}s (5m)`);
  console.log(`  Total Direct Work: ${totalDirectSeconds}s (45m = 0.75h)`);
  console.log(`  Waiting: ${waitingEntry.duration_seconds}s (60m = 1.00h)`);

  // ----------------------------------------------------------------------------
  // TEST PART 3: Verify Monthly Report Aggregates API
  // ----------------------------------------------------------------------------
  console.log("\n--- [Step 3] Verifying Monthly Report API Aggregates ---");
  const reportRes = await fetch("http://localhost:3000/api/reports/monthly?monthKey=2026-09", {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(reportRes.status === 200, `Report API returned 200 (found: ${reportRes.status})`);
  const reportJson = await reportRes.json();
  const summary = reportJson.report.executiveSummary;
  console.log("Executive Summary from API:", summary);

  assert(summary.totalLoggedHours === 0.75, `totalLoggedHours is exactly 0.75 (found: ${summary.totalLoggedHours})`);
  assert(summary.totalReviewHours === 0.17, `totalReviewHours is exactly 0.17 (found: ${summary.totalReviewHours})`);
  assert(summary.totalRevisionHours === 0.08, `totalRevisionHours is exactly 0.08 (found: ${summary.totalRevisionHours})`);
  assert(summary.totalWaitingHours === 1.00 || summary.totalWaitingHours === 1, `totalWaitingHours is exactly 1.00 (found: ${summary.totalWaitingHours})`);
  console.log("✓ All 4 KPI Cards in Executive Summary match exact cycle numbers without double counting!");

  // Verify designer breakdown
  const designerSummary = reportJson.report.designerSummary;
  const tasneemRow = designerSummary.find((d: any) => d.displayName === "تسنيم");
  const mirhanRow = designerSummary.find((d: any) => d.displayName === "ميرهان");

  assert(tasneemRow, "Found Tasneem in designer breakdown");
  assert(tasneemRow.reviewHours === 0.17, `Tasneem reviewHours is 0.17h (found: ${tasneemRow.reviewHours})`);
  assert(tasneemRow.revisionHours === 0, `Tasneem revisionHours is 0h (found: ${tasneemRow.revisionHours})`);

  assert(mirhanRow, "Found Mirhan in designer breakdown");
  assert(mirhanRow.loggedHours === 0.58, `Mirhan loggedHours is 0.58h (35m) (found: ${mirhanRow.loggedHours})`);
  assert(mirhanRow.revisionHours === 0.08, `Mirhan revisionHours is 0.08h (5m) (found: ${mirhanRow.revisionHours})`);
  assert(mirhanRow.reviewHours === 0, `Mirhan reviewHours is 0h (found: ${mirhanRow.reviewHours})`);
  console.log("✓ Designer breakdown properly decouples review and revision hours for team members!");

  // ----------------------------------------------------------------------------
  // TEST PART 4: Verify Timesheet CSV Export (Arabic UTF-8 BOM, Headers, Columns)
  // ----------------------------------------------------------------------------
  console.log("\n--- [Step 4] Verifying Timesheet CSV Export ---");
  const csvRes = await fetch("http://localhost:3000/api/reports/export-csv?type=timesheet&monthKey=2026-09", {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(csvRes.status === 200, `CSV Export API returned 200 (found: ${csvRes.status})`);

  const csvBuffer = Buffer.from(await csvRes.arrayBuffer());
  assert(
    csvBuffer[0] === 0xef && csvBuffer[1] === 0xbb && csvBuffer[2] === 0xbf,
    "Timesheet CSV starts with UTF-8 BOM (0xEF, 0xBB, 0xBF)"
  );

  const csvText = csvBuffer.toString("utf-8");
  const lines = csvText.trim().split("\n");
  console.log(`CSV contains ${lines.length} lines (1 header + ${lines.length - 1} session records)`);

  const header = lines[0];
  assert(header.includes("ساعات العمل الفعلي (ساعة)"), "Header contains ساعات العمل الفعلي");
  assert(header.includes("ساعات المراجعة (ساعة)"), "Header contains ساعات المراجعة");
  assert(header.includes("ساعات التعديل (ساعة)"), "Header contains ساعات التعديل");
  assert(header.includes("ساعات الانتظار والتعطيل (مفصولة)"), "Header contains ساعات الانتظار والتعطيل");

  // Validate writing line
  const writingLine = lines.find((l) => l.includes("كتابة أولية"));
  assert(writingLine, "Found row with activity category 'كتابة أولية' (decoupled from job title)");
  assert(!writingLine.includes("التصميم المبدئي"), "Writing session does NOT show 'التصميم المبدئي'");
  assert(writingLine.includes("0.50"), "Writing session has 0.50 in work hours");

  // Validate review line
  const reviewLine = lines.find((l) => l.includes(",مراجعة,") || l.includes("مراجعة السكريبت"));
  assert(reviewLine, "Found row with activity category 'مراجعة'");
  assert(reviewLine.includes("0.17"), "Review session has 0.17 in review hours");

  // Validate revision line
  const revisionLine = lines.find((l) => l.includes("تعديلات داخلية"));
  assert(revisionLine, "Found row with activity category 'تعديلات داخلية'");
  assert(revisionLine.includes("0.08"), "Revision session has 0.08 in revision hours");

  // Validate waiting line
  const waitingLine = lines.find((l) => l.includes("ساعات انتظار وتعطيل"));
  assert(waitingLine, "Found row with activity category 'ساعات انتظار وتعطيل'");
  assert(waitingLine.includes("1.00"), "Waiting session has 1.00 in waiting hours");

  console.log("✓ CSV lines verified:");
  console.log("  Writing row:", writingLine);
  console.log("  Review row:", reviewLine);
  console.log("  Waiting row:", waitingLine);
  console.log("  Revision row:", revisionLine);

  // Save CSV artifacts for delivery
  const artifactPath = path.join(
    "C:\\Users\\elwady\\.gemini\\antigravity\\brain\\4f958e1c-479f-453e-888c-49e86530171c",
    "sample_timesheet_export_arabic.csv"
  );
  const evidencePath = path.join("scripts", "evidence", "sample_timesheet_export_arabic.csv");
  fs.writeFileSync(artifactPath, csvBuffer);
  fs.writeFileSync(evidencePath, csvBuffer);
  console.log(`✓ Saved verified CSV to artifacts: ${artifactPath}`);

  // ----------------------------------------------------------------------------
  // TEST PART 5: Prove New Session Recording (Without Guessing Dates)
  // ----------------------------------------------------------------------------
  console.log("\n--- [Step 5] Proving New Session Recording Logic ---");

  // 1. Create a temporary in_progress task with work_stage = 'copywriting'
  const { data: tempTask, error: taskErr } = await adminClient
    .from("tasks")
    .insert({
      workspace_id: "014073cf-bba7-44a2-8fdb-993ee0c21dbe",
      client_id: "2eba7fd6-1e94-4cb0-8131-daab11474deb",
      title: "تاسك اختبار مؤقت لتسجيل الجلسات الجديدة",
      work_stage: "copywriting",
      status: "in_progress",
      primary_assignee_id: "90e32720-f989-4573-b770-c5d83a6745f5",
      deliverable_number: 999,
    })
    .select()
    .single();

  assert(!taskErr && tempTask, `Created temporary in_progress copywriting task: ${taskErr?.message}`);

  // 2. Start timer via API as Owner on behalf of Mirhan without category
  const newTimerRes = await fetch("http://localhost:3000/api/timer/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ownerToken}`,
      Origin: "http://localhost:3000",
    },
    body: JSON.stringify({
      taskId: tempTask.id,
      targetRosterId: "90e32720-f989-4573-b770-c5d83a6745f5",
      // No category provided: should automatically infer content_writing!
    }),
  });

  const newTimerJson = await newTimerRes.json();
  console.log("New Timer Start Result:", newTimerJson);

  // 3. Verify newly created time entry category
  const { data: newEntry } = await adminClient
    .from("time_entries")
    .select("id, category, started_at, ended_at, task_id")
    .eq("task_id", tempTask.id)
    .is("ended_at", null)
    .single();

  assert(newEntry, "Found active timer entry for temporary task");
  console.log(`✓ New session automatically inferred and assigned category: ${newEntry.category}`);
  assert(
    newEntry.category === "content_writing",
    `New session category is 'content_writing' (found: ${newEntry.category})`
  );

  // Clean up temporary task and its entries immediately
  await adminClient.from("time_entries").delete().eq("task_id", tempTask.id);
  await adminClient.from("tasks").delete().eq("id", tempTask.id);
  console.log("✓ Successfully cleaned up temporary task and its session entries");

  console.log("\n================================================================================");
  console.log("ALL TESTS PASSED: Time classification, decoupling, and waiting fully verified!");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("\n❌ VERIFICATION FAILED:", err);
  process.exit(1);
});
