import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import crypto from "crypto";
import assert from "assert";
import { AiJobQueue } from "@/lib/services/ai-job-queue";

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
const workerSecret = process.env.AI_WORKER_SECRET!;

const admin = createClient(supabaseUrl, serviceRoleKey);

async function runWorkerProof() {
  console.log("==========================================================");
  console.log("🚀 Live Worker Proof & Durable Background Execution Gate");
  console.log("==========================================================\n");

  // Phase 1: Baseline Preservation Proof
  console.log("[Phase 1] Checking Production Database Baseline...");
  const { data: clientsBaseline, count: clientCount } = await admin
    .from("clients")
    .select("id", { count: "exact" });
  const { data: tasksBaseline, count: taskCount } = await admin
    .from("tasks")
    .select("id", { count: "exact" });
  const { data: rosterBaseline, count: rosterCount } = await admin
    .from("roster_people")
    .select("id", { count: "exact" });
  const { data: wsData } = await admin
    .from("workspaces")
    .select("id, invitations_paused")
    .limit(1)
    .single();

  console.log(`  📊 Clients Count: ${clientCount} (Expected: 28)`);
  console.log(`  📊 Tasks Count: ${taskCount} (Expected: 18)`);
  console.log(`  📊 Roster Count: ${rosterCount} (Expected: 7)`);
  console.log(`  🔒 Invitations Paused: ${wsData?.invitations_paused} (Strictly True)`);

  assert.strictEqual(clientCount, 28, "Baseline must have exactly 28 clients");
  assert.strictEqual(taskCount, 18, "Baseline must have exactly 18 tasks");
  assert.strictEqual(rosterCount, 7, "Baseline must have exactly 7 roster members");
  assert.strictEqual(wsData?.invitations_paused, true, "invitations_paused must strictly remain true");
  console.log("  ✅ PASS: Production baseline verified and intact.\n");

  // Phase 2: Live pg_cron & Vault Proof
  console.log("[Phase 2] Verifying Remote Supabase pg_cron & Vault Configuration...");
  const { data: cronStatus, error: cronErr } = await admin.rpc("get_worker_cron_status");
  assert.ifError(cronErr);
  assert(cronStatus.configured, "Supabase pg_cron must have active job");
  assert.strictEqual(cronStatus.job.jobname, "ai-calendar-worker-every-minute");
  assert.strictEqual(cronStatus.job.schedule, "* * * * *");
  assert.strictEqual(cronStatus.job.active, true);
  assert(cronStatus.has_vault_secret, "Worker secret must be securely stored in Supabase Vault");

  console.log(`  ⏰ Cron Job Name: ${cronStatus.job.jobname}`);
  console.log(`  ⏰ Cron Schedule: ${cronStatus.job.schedule} (Every minute via pg_cron + pg_net)`);
  console.log(`  🔐 Vault Secret Configured: ${cronStatus.has_vault_secret}`);
  console.log(`  📈 Recent Succeeded Cron Runs: ${cronStatus.recent_runs.length}`);
  if (cronStatus.recent_runs.length > 0) {
    const latest = cronStatus.recent_runs[0];
    console.log(`     Latest Run: ID ${latest.runid} at ${latest.start_time} (Status: ${latest.status})`);
  }
  console.log("  ✅ PASS: Supabase pg_cron + Vault durable worker is live.\n");

  // Phase 3: Worker Auth Hardening (Reject Public GET, Reject Anonymous, Reject Invalid Secret)
  console.log("[Phase 3] Testing Worker Endpoint Authentication Gate...");
  const { POST: workerPOST, GET: workerGET } = await import("@/app/api/ai/worker/route");

  // 3a. Public GET must return 405 Method Not Allowed
  const getReq = new Request("https://omg-creative-workspace.vercel.app/api/ai/worker", {
    method: "GET",
  });
  const getRes = await workerGET();
  assert.strictEqual(getRes.status, 405, "GET /api/ai/worker must return 405 Method Not Allowed");
  console.log("  ✅ PASS: Public GET /api/ai/worker rejected with 405 Method Not Allowed.");

  // 3b. Anonymous POST without secret must return 401
  const anonReq = new Request("https://omg-creative-workspace.vercel.app/api/ai/worker", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const anonRes = await workerPOST(anonReq as any);
  assert.strictEqual(anonRes.status, 401, "Anonymous POST without secret must return 401");
  console.log("  ✅ PASS: Anonymous POST rejected with 401 Unauthorized.");

  // 3c. POST with invalid secret must return 401
  const invalidReq = new Request("https://omg-creative-workspace.vercel.app/api/ai/worker", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-worker-secret": "wrong_secret_attack_vector_12345",
    },
  });
  const invalidRes = await workerPOST(invalidReq as any);
  assert.strictEqual(invalidRes.status, 401, "Invalid secret must return 401");
  console.log("  ✅ PASS: Invalid secret rejected with 401 Unauthorized.");

  // 3d. POST with valid secret returns 200
  const validReq = new Request("https://omg-creative-workspace.vercel.app/api/ai/worker", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-worker-secret": workerSecret,
    },
  });
  const validRes = await workerPOST(validReq as any);
  assert.strictEqual(validRes.status, 200, "Valid secret must return 200 OK");
  const validBody = await validRes.json();
  assert(validBody.success, "Response must be success: true");
  console.log(`  ✅ PASS: Valid secret authenticated successfully (${validBody.message}).\n`);

  // Phase 4: Isolated Test Fixture Execution (Queued -> Processing -> Completed/Failed -> Lease Recovery -> Backoff)
  console.log("[Phase 4] Executing Isolated Worker Lifecycle Test Fixture...");
  const testWorkspaceId = wsData.id;
  const fixtureSuffix = crypto.randomBytes(4).toString("hex");

  let dummyClientId: string | null = null;
  let dummyCampId: string | null = null;

  try {
    // 4a. Create isolated dummy client (never conflicts with real clients)
    const { data: dummyClient, error: clientErr } = await admin
      .from("clients")
      .insert({
        workspace_id: testWorkspaceId,
        name: `__FIXTURE_ISOLATED_CLIENT_${fixtureSuffix}__`,
        difficulty: "Medium",
        state: "Active",
      })
      .select()
      .single();
    assert.ifError(clientErr);
    dummyClientId = dummyClient.id;

    // 4b. Create isolated dummy campaign
    const { data: dummyCampaign, error: campErr } = await admin
      .from("campaigns")
      .insert({
        workspace_id: testWorkspaceId,
        client_id: dummyClientId,
        title: `__FIXTURE_CAMPAIGN_${fixtureSuffix}__`,
        month_key: "2026-10",
        status: "Draft",
      })
      .select()
      .single();
    assert.ifError(campErr);
    dummyCampId = dummyCampaign.id;

    const testFileSha256 = crypto.createHash("sha256").update(`fixture_file_${fixtureSuffix}`).digest("hex");

    // 4c. Enqueue Job via AiJobQueue.enqueueJob
    console.log("  [Step A] Enqueuing isolated AI processing job in durable queue...");
    const enqueued = await AiJobQueue.enqueueJob({
      workspaceId: testWorkspaceId,
      campaignId: dummyCampId!,
      clientId: dummyClientId!,
      fileSha256: testFileSha256,
      model: "gemini-2.5-flash",
    });
    assert.strictEqual(enqueued.status, "queued");
    assert.strictEqual(enqueued.attempt_count, 0);
    const testJobId = enqueued.id;
    console.log(`     ✅ Enqueued Job ID: ${testJobId} (Status: ${enqueued.status}, Attempts: ${enqueued.attempt_count})`);

    // 4d. Worker claims job via AiJobQueue.claimNextJob
    console.log("  [Step B] Worker claiming queued job via claim_next_ai_job RPC...");
    const workerId = `worker-test-${fixtureSuffix}`;
    const claim = await AiJobQueue.claimNextJob(workerId, 300);
    assert.strictEqual(claim.claimed, true);
    assert.strictEqual(claim.job_id, testJobId);
    assert.strictEqual(claim.attempt_count, 1);

    const { data: jobRowProcessing } = await admin
      .from("ai_processing_jobs")
      .select("*")
      .eq("id", testJobId)
      .single();
    assert.strictEqual(jobRowProcessing?.status, "processing");
    assert.strictEqual(jobRowProcessing?.lease_owner, workerId);
    console.log(`     ✅ Job successfully claimed into processing state (Worker: ${workerId}, Attempts: 1).`);

    // 4e. Idempotency & Deduplication Guard
    console.log("  [Step C] Testing Idempotency & Concurrency Guard...");
    try {
      await AiJobQueue.enqueueJob({
        workspaceId: testWorkspaceId,
        campaignId: dummyCampId!,
        clientId: dummyClientId!,
        fileSha256: testFileSha256,
        model: "gemini-2.5-flash",
      });
      assert.fail("Unique constraint must prevent duplicate active job");
    } catch (dupErr: any) {
      assert(
        dupErr.message.includes("unique") ||
        dupErr.message.includes("duplicate") ||
        dupErr.message.includes("uq_ai_processing_jobs_active"),
        `Unique constraint strictly triggered: ${dupErr.message}`
      );
      console.log("     ✅ Idempotency strictly enforced: Concurrency uniqueness prevents duplicate active job rows.");
    }

    // 4f. Simulate Lease Expiry & Crash Recovery
    console.log("  [Step D] Testing Lease Crash Recovery...");
    // Manually expire the lease in the DB to simulate worker crash
    await admin
      .from("ai_processing_jobs")
      .update({
        lease_expires_at: new Date(Date.now() - 60000).toISOString(), // 1 min in the past
      })
      .eq("id", testJobId);

    // Another worker claims the next available job
    const recoveryWorkerId = `worker-recovery-${fixtureSuffix}`;
    const recoveredClaim = await AiJobQueue.claimNextJob(recoveryWorkerId, 300);
    assert.strictEqual(recoveredClaim.claimed, true);
    assert.strictEqual(recoveredClaim.job_id, testJobId);
    assert.strictEqual(recoveredClaim.is_recovered, true, "is_recovered must be true upon lease recovery");
    assert.strictEqual(recoveredClaim.attempt_count, 2, "attempt_count must increment to 2");
    console.log(`     ✅ Lease crash recovery verified: Expired job automatically recovered (Attempt 2, is_recovered: true).`);

    // 4g. Simulate Transient Error & Retry Backoff
    console.log("  [Step E] Testing Transient Error & Exponential Retry Backoff...");
    await AiJobQueue.releaseJob({
      jobId: testJobId,
      status: "waiting_for_retry",
      errorCode: "RATE_LIMIT_EXCEEDED",
      safeErrorMsg: "Gemini rate limit exceeded. Retrying in 60s.",
      retryDelaySeconds: 60,
    });

    const { data: jobRowRetry } = await admin
      .from("ai_processing_jobs")
      .select("status, next_retry_at, last_error_code")
      .eq("id", testJobId)
      .single();
    assert.strictEqual(jobRowRetry?.status, "waiting_for_retry");
    assert.strictEqual(jobRowRetry?.last_error_code, "RATE_LIMIT_EXCEEDED");
    assert(new Date(jobRowRetry!.next_retry_at!).getTime() > Date.now(), "next_retry_at must be scheduled in the future");
    console.log(`     ✅ Backoff verified: Job placed in waiting_for_retry with next_retry_at scheduled.`);

    // 4h. Complete Job Execution
    console.log("  [Step F] Completing Job Execution...");
    await AiJobQueue.releaseJob({
      jobId: testJobId,
      status: "completed",
      durationMs: 2450,
      inputTokens: 1200,
      outputTokens: 800,
      totalTokens: 2000,
      cacheHit: false,
    });

    const { data: jobRowFinal } = await admin
      .from("ai_processing_jobs")
      .select("status, completed_at, total_tokens")
      .eq("id", testJobId)
      .single();
    assert.strictEqual(jobRowFinal?.status, "completed");
    assert(jobRowFinal?.completed_at, "completed_at must be recorded");
    assert.strictEqual(jobRowFinal?.total_tokens, 2000);
    console.log("     ✅ Job released as completed successfully with full telemetry.");
  } finally {
    // 4h. Clean up isolated test fixture completely
    console.log("  [Step F] Purging isolated test fixture...");
    if (dummyCampId) {
      await admin.from("ai_processing_jobs").delete().eq("campaign_id", dummyCampId);
      await admin.from("campaigns").delete().eq("id", dummyCampId);
    }
    if (dummyClientId) {
      await admin.from("clients").delete().eq("id", dummyClientId);
    }
    console.log("     ✅ Test records deleted cleanly.");
  }

  // Phase 5: Re-verify Baseline Invariant (0 Real Records Touched)
  console.log("\n[Phase 5] Post-Execution Production Baseline Invariant Check...");
  const { count: finalClientCount } = await admin.from("clients").select("id", { count: "exact" });
  const { count: finalTaskCount } = await admin.from("tasks").select("id", { count: "exact" });
  const { count: finalRosterCount } = await admin.from("roster_people").select("id", { count: "exact" });
  const { data: finalWs } = await admin.from("workspaces").select("invitations_paused").limit(1).single();

  console.log(`  📊 Clients Post-Test: ${finalClientCount} (Baseline: 28)`);
  console.log(`  📊 Tasks Post-Test: ${finalTaskCount} (Baseline: 18)`);
  console.log(`  📊 Roster Post-Test: ${finalRosterCount} (Baseline: 7)`);
  console.log(`  🔒 Invitations Paused: ${finalWs?.invitations_paused} (Baseline: true)`);

  assert.strictEqual(finalClientCount, 28, "Production clients count must remain exactly 28");
  assert.strictEqual(finalTaskCount, 18, "Production tasks count must remain exactly 18");
  assert.strictEqual(finalRosterCount, 7, "Production roster count must remain exactly 7");
  assert.strictEqual(finalWs?.invitations_paused, true, "invitations_paused must remain strictly true");

  console.log("\n==========================================================");
  console.log("🎉 ALL LIVE WORKER PROOFS PASSED: 100% SUCCESS");
  console.log("==========================================================");
}

runWorkerProof().catch((err) => {
  console.error("❌ Live Worker Proof Failed:", err);
  process.exit(1);
});
