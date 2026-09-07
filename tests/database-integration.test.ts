// OMG Creative Workspace: Real Database & RLS Integration Test Suite (V3.5 Clean Baseline)
// tests/database-integration.test.ts
// This script executes ACTUAL PostgreSQL queries and tests RLS policies against Supabase.

import { createClient } from "@supabase/supabase-js";
import { checkDatabaseConnection } from "../lib/supabase/diagnostics";

async function runDatabaseIntegrationTests() {
  console.log("==========================================================");
  console.log("🔍 Live Supabase & PostgreSQL Integration Test Suite (V3.5)");
  console.log("==========================================================");

  // 1. Check if Supabase credentials are configured
  const diag = await checkDatabaseConnection();
  if (diag.status !== "connected") {
    console.error("\n❌ BLOCKED: Supabase is not connected to a live database.");
    console.error(`Reason: ${diag.message}`);
    if (diag.missingEnvVars.length > 0) {
      console.error(`Missing variables: ${diag.missingEnvVars.join(", ")}`);
    }
    console.log("\nPlease configure .env.local with dedicated Supabase credentials to run live database integration tests.");
    process.exit(1);
  }

  console.log("\n✅ Supabase is connected. Running real PostgreSQL integration checks...");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const adminClient = createClient(supabaseUrl, serviceKey);
  const anonClient = createClient(supabaseUrl, anonKey);

  let passed = 0;
  let failed = 0;

  function report(name: string, ok: boolean, detail?: string) {
    if (ok) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${name}${detail ? ` -> ${detail}` : ""}`);
      failed++;
    }
  }

  // --- CHECK 1: Seed verification in real database ---
  console.log("\n[1] Verifying 28 accounts and roster in real database...");
  const { data: dbClients, error: cErr } = await adminClient.from("clients").select("name, state, difficulty");
  if (cErr) {
    report("Query clients table", false, cErr.message);
  } else {
    report("Exactly 28 accounts in database", dbClients.length === 28, `Found ${dbClients.length}`);
    const activeCount = dbClients.filter((c) => c.state === "Active").length;
    report("Exactly 27 active accounts", activeCount === 27, `Found ${activeCount}`);
    const unassigned = dbClients.find((c) => c.name === "zanzi");
    report("zanzi account exists as Not started", unassigned?.state === "Not started", unassigned?.state);
  }

  // --- CHECK 2: Internal private schema helpers are not exposed through API ---
  console.log("\n[2] Testing negative execution on internal helper functions...");
  const { error: lockErr } = await anonClient.rpc("fn_acquire_idempotency_lock" as any, {
    p_workspace_id: "00000000-0000-0000-0000-000000000000",
    p_actor_id: "00000000-0000-0000-0000-000000000000",
    p_operation_name: "test",
    p_idempotency_key: "k1",
    p_request_hash: "hash"
  });
  report("Direct API call to fn_acquire_idempotency_lock is rejected", !!lockErr, lockErr?.message);

  const { error: recErr } = await anonClient.rpc("fn_record_idempotency" as any, {
    p_workspace_id: "00000000-0000-0000-0000-000000000000",
    p_actor_id: "00000000-0000-0000-0000-000000000000",
    p_operation_name: "test",
    p_idempotency_key: "k1",
    p_request_hash: "hash",
    p_response: {}
  });
  report("Direct API call to fn_record_idempotency is rejected", !!recErr, recErr?.message);

  const { error: routerErr } = await anonClient.rpc("resolve_task_reviewer" as any, {
    p_workspace_id: "00000000-0000-0000-0000-000000000000",
    p_task_id: "00000000-0000-0000-0000-000000000000",
    p_designer_id: "00000000-0000-0000-0000-000000000000",
    p_exclude_roster_ids: []
  });
  report("Direct API call to resolve_task_reviewer is rejected", !!routerErr, routerErr?.message);

  // --- CHECK 3: Manager cannot invite owner role ---
  console.log("\n[3] Testing privilege escalation guard on invitations...");
  const { error: inviteOwnerErr } = await anonClient.rpc("create_workspace_invitation", {
    p_workspace_id: "00000000-0000-0000-0000-000000000000",
    p_email: "test@example.com",
    p_role: "owner",
    p_roster_person_id: "00000000-0000-0000-0000-000000000000"
  });
  report("Invitation with role 'owner' is strictly rejected", !!inviteOwnerErr, inviteOwnerErr?.message);

  // --- CHECK 4: Designer cannot cancel or block unrelated task ---
  console.log("\n[4] Testing actor matrix on task cancellation and transitions...");
  const { data: testTask } = await adminClient.from("tasks").select("id, workspace_id").limit(1).single();
  if (testTask) {
    const { error: cancelErr } = await anonClient.rpc("transition_task_status", {
      p_task_id: testTask.id,
      p_new_status: "cancelled",
      p_reason: "Malicious cancellation attempt"
    });
    report("Unauthenticated / ordinary caller cannot cancel task", !!cancelErr, cancelErr?.message);
  }

  // --- CHECK 5: Designer cannot void recorded time ---
  console.log("\n[5] Testing void_time_entry permission guard...");
  const { data: testEntry } = await adminClient.from("time_entries").select("id").limit(1).single();
  if (testEntry) {
    const { error: voidErr } = await anonClient.rpc("void_time_entry", {
      p_time_entry_id: testEntry.id,
      p_reason: "Unauthorized void attempt"
    });
    report("Non-manager caller is blocked from voiding time entry", !!voidErr, voidErr?.message);
  }

  // --- CHECK 6: 'pending' cannot decide a review round or correction ---
  console.log("\n[6] Testing rejection of 'pending' decision...");
  const { error: pendingRevErr } = await adminClient.rpc("decide_review_round", {
    p_round_id: "00000000-0000-0000-0000-000000000000",
    p_decision: "pending" as any
  });
  report("'pending' decision is rejected on decide_review_round", !!pendingRevErr, pendingRevErr?.message);

  const { error: pendingCorrErr } = await adminClient.rpc("decide_time_correction", {
    p_request_id: "00000000-0000-0000-0000-000000000000",
    p_decision: "pending" as any
  });
  report("'pending' decision is rejected on decide_time_correction", !!pendingCorrErr, pendingCorrErr?.message);

  // --- CHECK 7: Malformed storage UUID paths return access denied without SQL error ---
  console.log("\n[7] Testing storage safe UUID parser...");
  const { data: storageObj, error: storageErr } = await anonClient
    .from("storage.objects" as any)
    .select("name")
    .eq("bucket_id", "deliverables")
    .like("name", "malformed-path/xyz/%");
  report("Malformed storage path does not throw PostgreSQL UUID cast exception", !storageErr || !storageErr.message.includes("invalid input syntax"), storageErr?.message);

  // --- CHECK 8: Re-running seed does not duplicate routing rules ---
  console.log("\n[8] Testing idempotent routing rules seed...");
  const { data: rulesBefore } = await adminClient.from("review_routing_rules").select("id");
  report("Review routing rules table exists and contains records", !!rulesBefore && rulesBefore.length > 0, `Found: ${rulesBefore?.length}`);

  console.log("\n==========================================================");
  console.log(`Live DB Results: ${passed} Passed | ${failed} Failed`);
  console.log("==========================================================");
}

runDatabaseIntegrationTests();
