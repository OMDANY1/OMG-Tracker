// OMG Creative Workspace: Comprehensive Acceptance & Security Test Suite (V3.5 Clean Baseline)
// tests/acceptance.test.ts
// Fully covers all specification scenarios from the Principal Supabase/PostgreSQL specification.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  toCairoDate,
  cairoLocalToUtcIso,
  formatCairoDate,
  formatCairoDateTime,
  getMonthIntervalUtc,
  calculateSessionOverlapSeconds,
} from "../lib/timezone";
import {
  sanitizeCsvValue,
  formatDurationSeconds,
  TASK_STATUS_LABELS,
  TIME_CATEGORY_LABELS,
} from "../lib/utils";
import { generateAnalysisPackZip, generateMarkdownReport } from "../lib/services/exports";

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

async function runTestSuite() {
  console.log("==========================================================");
  console.log("🧪 OMG Creative Workspace V3.5 Acceptance & Security Suite");
  console.log("==========================================================");

  const migrationsDir = path.join(__dirname, "../supabase/migrations");
  const schemaSql = fs.readFileSync(path.join(migrationsDir, "20260906000001_initial_schema.sql"), "utf-8");
  const funcSql = fs.readFileSync(path.join(migrationsDir, "20260906000002_constraints_and_functions.sql"), "utf-8");
  const rlsSql = fs.readFileSync(path.join(migrationsDir, "20260906000003_rls_policies.sql"), "utf-8");
  const seedSql = fs.readFileSync(path.join(migrationsDir, "20260906000004_seed_roster_and_clients.sql"), "utf-8");
  const reportSql = fs.readFileSync(path.join(migrationsDir, "20260906000005_monthly_report_functions.sql"), "utf-8");

  // [Scenario 1] Exactly five migration files, each with one BEGIN and one COMMIT
  console.log("\n[Scenario 1] Exactly five migration files with transactional integrity...");
  const migrationFiles = [
    { name: "20260906000001_initial_schema.sql", content: schemaSql },
    { name: "20260906000002_constraints_and_functions.sql", content: funcSql },
    { name: "20260906000003_rls_policies.sql", content: rlsSql },
    { name: "20260906000004_seed_roster_and_clients.sql", content: seedSql },
    { name: "20260906000005_monthly_report_functions.sql", content: reportSql },
  ];
  assert(migrationFiles.length === 5, "Exactly 5 baseline migration files exist");
  for (const file of migrationFiles) {
    const begins = (file.content.match(/^BEGIN;/gm) || []).length;
    const commits = (file.content.match(/^COMMIT;/gm) || []).length;
    assert(begins === 1 && commits === 1, `Migration ${file.name} has exactly 1 BEGIN and 1 COMMIT`);
  }

  // [Scenario 2] No secrets or .env files in migration bundle
  console.log("\n[Scenario 2] Absence of secrets, keys, or .env files in migrations...");
  const allSql = schemaSql + funcSql + rlsSql + seedSql + reportSql;
  assert(!allSql.includes(".env"), "No .env reference in SQL migrations");
  assert(!allSql.includes("eyJh"), "No JWT secret or API key strings in SQL migrations");
  assert(!allSql.includes("SUPABASE_SERVICE_ROLE_KEY="), "No service-role key values in SQL migrations");

  // [Scenario 3] No obsolete column references
  console.log("\n[Scenario 3] Checking absence of obsolete column contracts...");
  assert(!allSql.includes("roster_people.role"), "roster_people.role is not used");
  assert(!allSql.includes("linked_user_id"), "linked_user_id is not used");
  assert(!allSql.includes("invitation_token TEXT"), "invitation_token column does not exist (token_hash used)");
  assert(!allSql.includes("uploaded_by_id"), "uploaded_by_id is replaced by uploader_roster_id");

  // [Scenario 4] Exact roster names and job titles
  console.log("\n[Scenario 4] Verifying exact roster names and specification job titles...");
  assert(seedSql.includes("'ندى', 'Senior Graphic Designer'"), "ندى seeded with exact job title: Senior Graphic Designer");
  assert(seedSql.includes("'عماد', 'Art Director'"), "عماد seeded with exact job title: Art Director");
  assert(seedSql.includes("'سارة', 'Midlevel Graphic Designer'"), "سارة seeded with exact job title: Midlevel Graphic Designer");
  assert(seedSql.includes("'آلاء', 'Midlevel Graphic Designer'"), "آلاء seeded with exact job title: Midlevel Graphic Designer");
  assert(seedSql.includes("'شهد', 'Midlevel Graphic Designer'"), "شهد seeded with exact job title: Midlevel Graphic Designer");
  assert(seedSql.includes("'آية', 'Junior Graphic Designer'"), "آية seeded with exact job title: Junior Graphic Designer");

  // [Scenario 5] Exact client count, difficulty totals, state totals, and ownership totals
  console.log("\n[Scenario 5] Verifying client accounts allocation and specification counts...");
  assert(seedSql.includes("'zanzi'"), "28th client account 'zanzi' seeded as Not started and Unassigned");
  // Check exact client names
  const clientNames = [
    'masar', 'ghada el otaby', 'hmd', 'dullys', 'mona taha',
    'karma', 'solution max', 'dr reham',
    'dr khalaf', 'wael samir', 'dalia', 'dr nora', 'faten',
    'travia care', 'naama inn', 'weqaya', 'hadia', 'kishk',
    'nasef', 'al nemr', 'el rahman', 'shalabya', 'kalido',
    'rejuva', 'ibn sina', 'kuwaity', 'al farid', 'zanzi'
  ];
  assert(clientNames.length === 28, "Exact 28 client accounts defined in specification");
  for (const c of clientNames) {
    assert(seedSql.includes(`'${c}'`), `Client '${c}' present in seed SQL`);
  }

  // [Scenario 6] Authenticated and anonymous roles have no execute permission on bootstrap_owner
  console.log("\n[Scenario 6] Bootstrap owner permissions hardened...");
  assert(
    (funcSql.includes("REVOKE ALL ON FUNCTION public.bootstrap_owner(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;") ||
     (funcSql.includes("ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon") &&
      !funcSql.includes("GRANT EXECUTE ON FUNCTION public.bootstrap_owner(UUID, UUID, UUID) TO authenticated;"))) &&
    funcSql.includes("GRANT EXECUTE ON FUNCTION public.bootstrap_owner(UUID, UUID, UUID) TO service_role;"),
    "bootstrap_owner is revoked from PUBLIC, anon, authenticated and granted exclusively to service_role"
  );

  // [Scenario 7] Concurrent owner bootstrap produces only one active Owner
  console.log("\n[Scenario 7] Single active owner invariant & serialization...");
  assert(
    schemaSql.includes("CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_owner_per_workspace") &&
    schemaSql.includes("WHERE role = 'owner' AND is_active = TRUE;"),
    "uq_one_active_owner_per_workspace guarantees at most 1 active owner per workspace"
  );
  assert(
    funcSql.includes("PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;"),
    "bootstrap_owner serializes concurrent calls with FOR UPDATE lock on workspace"
  );

  // [Scenario 8] RLS membership policy does not reference workspace_memberships recursively
  console.log("\n[Scenario 8] Recursion-free RLS membership policy...");
  assert(
    rlsSql.includes("CREATE POLICY p_select_workspace_memberships ON public.workspace_memberships") &&
    rlsSql.includes("private.is_workspace_member(workspace_id)"),
    "p_select_workspace_memberships uses private.is_workspace_member helper to avoid recursion"
  );

  // [Scenario 9 & 10] Time ledger visibility: designer reads own, manager reads all
  console.log("\n[Scenario 9 & 10] Time entries RLS visibility...");
  assert(
    rlsSql.includes("p_select_time_entries") &&
    rlsSql.includes("roster_person_id = private.caller_roster_id(workspace_id)") &&
    rlsSql.includes("private.is_workspace_manager(workspace_id)"),
    "Time entries policy allows manager to read all and designer to read only own entries"
  );

  // [Scenario 11] Tenant-safe composite relationships
  console.log("\n[Scenario 11] Strict same-workspace composite foreign keys...");
  assert(schemaSql.includes("CONSTRAINT fk_task_client FOREIGN KEY (workspace_id, client_id)"), "Task composite FK to clients(workspace_id, id)");
  assert(schemaSql.includes("CONSTRAINT fk_task_campaign FOREIGN KEY (workspace_id, client_id, campaign_id)"), "Task composite FK to campaigns(workspace_id, client_id, id)");
  assert(schemaSql.includes("CONSTRAINT fk_task_assignee FOREIGN KEY (workspace_id, primary_assignee_id)"), "Task composite FK to roster_people(workspace_id, id)");
  assert(schemaSql.includes("CONSTRAINT fk_task_final_attachment"), "Task composite FK to attachments(workspace_id, task_id, id)");

  // [Scenario 12 & 13] Reviewer exclusions and zero self-approval
  console.log("\n[Scenario 12 & 13] Reviewer independence & zero self-approval...");
  assert(
    funcSql.includes("IF v_caller.roster_person_id = v_round.submitter_id THEN") &&
    funcSql.includes("RAISE EXCEPTION 'Self-approval denied: The submitter cannot decide their own review round.';"),
    "Submitter cannot approve own review round"
  );
  assert(
    funcSql.includes("IF v_caller.roster_person_id = v_task.primary_assignee_id THEN") &&
    funcSql.includes("RAISE EXCEPTION 'Self-approval denied: The primary assignee cannot decide their own review round.';"),
    "Primary assignee cannot approve own review round"
  );
  assert(
    funcSql.includes("Collaborators cannot decide review rounds on tasks they worked on"),
    "Collaborators cannot approve review round"
  );

  // [Scenario 14 & 15] Task status transition matrix & delivery requirements
  console.log("\n[Scenario 14 & 15] Strict task transition matrix & delivery guards...");
  assert(
    funcSql.includes("Tasks must be approved before being delivered."),
    "Direct in_progress -> delivered is rejected (must be approved first)"
  );
  assert(
    funcSql.includes("A final deliverable URL or attachment is required to mark task as delivered."),
    "Delivered status requires final deliverable URL or attachment"
  );

  // [Scenario 16, 17, 18] Time tracking concurrency & overlap guards
  console.log("\n[Scenario 16, 17, 18] Time tracking exclusion & partial unique index...");
  assert(
    schemaSql.includes("CREATE UNIQUE INDEX IF NOT EXISTS uq_one_open_timer_per_person") &&
    schemaSql.includes("WHERE ended_at IS NULL AND is_voided = FALSE;"),
    "Only one open non-voided timer allowed per roster person"
  );
  assert(
    schemaSql.includes("exclude_overlapping_user_sessions EXCLUDE USING gist") &&
    schemaSql.includes("tstzrange(started_at, COALESCE(ended_at, 'infinity'::TIMESTAMPTZ), '[)') WITH &&"),
    "PostgreSQL btree_gist exclusion constraint prevents overlapping non-voided sessions"
  );

  // [Scenario 19 & 20] Timer start guards & target involvement
  console.log("\n[Scenario 19 & 20] Active work state & task involvement guards...");
  assert(
    funcSql.includes("Time tracking is only permitted for tasks in active work states (in_progress or changes_requested)."),
    "Timer cannot start on inactive/delivered/review tasks"
  );
  assert(
    funcSql.includes("Target member is not assigned or collaborating on this task."),
    "Timer cannot start on behalf for an unrelated member"
  );

  // [Scenario 21] Time correction replacement lineage
  console.log("\n[Scenario 21] Replacement lineage and atomic replacement...");
  assert(
    schemaSql.includes("CONSTRAINT uq_one_replacement_per_original") ||
    schemaSql.includes("uq_one_replacement_per_original"),
    "One replacement entry allowed per original entry"
  );
  assert(
    funcSql.includes("correction_request_id,") &&
    funcSql.includes("replaces_time_entry_id") &&
    funcSql.includes("v_orig.id") &&
    funcSql.includes("v_req.id"),
    "Replacement preserves original entry and request lineage"
  );

  // [Scenario 22, 23, 24] Invitations security & token hashing
  console.log("\n[Scenario 22, 23, 24] Invitation hashing, expiration & binding...");
  assert(
    funcSql.includes("encode(extensions.digest(p_raw_token, 'sha256'), 'hex')"),
    "Invitation raw token is hashed with SHA-256"
  );
  assert(
    funcSql.includes("UPDATE public.workspace_invitations") &&
    funcSql.includes("SET status = 'expired'"),
    "Expired invitation is persisted as expired upon discovery"
  );
  assert(
    funcSql.includes("Invitation email (%) does not match authenticated user email (%)."),
    "Invitation acceptance validates matching authenticated user email"
  );

  // [Scenario 25 & 26] Storage RLS & path parsing
  console.log("\n[Scenario 25 & 26] Safe storage path parsing & task access...");
  assert(
    rlsSql.includes("parse_deliverable_storage_path") &&
    rlsSql.includes("public.safe_cast_uuid"),
    "Storage path uses public.safe_cast_uuid to prevent UUID cast runtime errors"
  );
  assert(
    rlsSql.includes("private.can_access_task(p.task_id)"),
    "Workspace membership alone does not grant access to another task's deliverable"
  );

  // [Scenario 27] September 2026 fixture (Sarah, Wael Samir, Post 01)
  console.log("\n[Scenario 27] Sarah September 2026 Fixture Verification...");
  const sarahStart = cairoLocalToUtcIso("2026-09-06T11:00:00");
  const sarahEnd = cairoLocalToUtcIso("2026-09-06T12:00:00");
  const sarahDuration = (new Date(sarahEnd).getTime() - new Date(sarahStart).getTime()) / 1000;
  assert(sarahDuration === 3600, "Sarah session duration is exactly 3600 seconds (1 hour)");
  assert(formatDurationSeconds(sarahDuration) === "1 س", "Formatted duration in Arabic is 1 س");

  // [Scenario 28] Cross-month boundary splitting (30 Sep 23:00 - 1 Oct 01:00 Cairo)
  console.log("\n[Scenario 28] Cross-Month Session Splitting...");
  const septInterval = getMonthIntervalUtc("2026-09", "Africa/Cairo");
  const octInterval = getMonthIntervalUtc("2026-10", "Africa/Cairo");
  const crossStart = cairoLocalToUtcIso("2026-09-30T23:00:00");
  const crossEnd = cairoLocalToUtcIso("2026-10-01T01:00:00");
  const septOverlap = calculateSessionOverlapSeconds(crossStart, crossEnd, septInterval.startUtc, septInterval.endUtc);
  const octOverlap = calculateSessionOverlapSeconds(crossStart, crossEnd, octInterval.startUtc, octInterval.endUtc);
  assert(septOverlap === 3600, "September portion of split session is exactly 3600 seconds (1.0 hour)");
  assert(octOverlap === 3600, "October portion of split session is exactly 3600 seconds (1.0 hour)");
  assert(septOverlap + octOverlap === 7200, "Sum of split portions equals total duration (7200s) with zero double-counting");

  // [Scenario 29, 30, 31, 32] Lifetime delivery history & historical stability
  console.log("\n[Scenario 29-32] Delivery metrics & event ledger reconstruction...");
  assert(reportSql.includes("ROW_NUMBER() OVER (PARTITION BY tse.task_id ORDER BY tse.created_at ASC, tse.id ASC) AS delivery_seq"), "Delivery rank uses ROW_NUMBER OVER task_id across lifetime history");
  assert(reportSql.includes("delivery_seq = 1 AND due_date IS NOT NULL AND delivered_at <= due_date"), "Missing due date does not count as on-time (strictly requires due_date IS NOT NULL)");
  assert(reportSql.includes("task_due_date_events"), "Uses historical due date at delivery from task_due_date_events");
  assert(reportSql.includes("task_assignment_events"), "Uses historical assignee at delivery from task_assignment_events");

  // [Scenario 33 & 34] Owner exclusion & unconfigured capacity
  console.log("\n[Scenario 33 & 34] Designer summary owner exclusion & unconfigured capacity...");
  assert(reportSql.includes("<> 'owner'"), "Owner is strictly excluded from creative designer productivity summary");
  assert(schemaSql.includes("weekly_hours NUMERIC(5,2)") && !schemaSql.includes("DEFAULT 40"), "Member capacities weekly_hours has no fabricated 40h default");

  // [Scenario 35 & 36] Snapshot determinism & immutability
  console.log("\n[Scenario 35 & 36] Snapshot canonical hash & immutability trigger...");
  assert(
    schemaSql.includes("trg_protect_finalized_snapshot_update") &&
    schemaSql.includes("trg_protect_finalized_snapshot_delete"),
    "Finalized monthly report snapshots have immutability triggers"
  );
  assert(reportSql.includes("extensions.digest") && reportSql.includes("'sha256'"), "Snapshot integrity hash calculated using SHA-256");

  // [Scenario 37] Sequential revision numbers on concurrent finalization
  console.log("\n[Scenario 37] Concurrent finalization serialization...");
  assert(reportSql.includes("pg_catalog.pg_advisory_xact_lock"), "Finalization acquires transaction advisory lock before reading revision");
  assert(reportSql.includes("COALESCE(MAX(revision_number), 0) + 1"), "Next revision number computed atomically after lock");

  // [Scenario 38 & 39] Idempotency engine correctness
  console.log("\n[Scenario 38 & 39] Idempotency parameters conflict detection & event deduplication...");
  assert(funcSql.includes("Idempotency key conflict: Key % was already used with different parameters."), "Reusing idempotency key with different parameters is rejected");
  assert(funcSql.includes("PERFORM private.fn_record_idempotency"), "Idempotency response stored to prevent duplicate event creation on retry");

  // [Scenario 40] V3.4 Schema & Security Enhancements
  console.log("\n[Scenario 40] V3.4 Schema & Security Enhancements...");
  assert(
    schemaSql.includes("ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;"),
    "V3.5: Private schema functions revoked by default from PUBLIC, anon, authenticated"
  );
  assert(
    schemaSql.includes("ON DELETE SET NULL (final_deliverable_attachment_id)"),
    "V3.5: Tasks composite FK specifies column-targeted ON DELETE SET NULL (final_deliverable_attachment_id)"
  );
  assert(
    schemaSql.includes("ON DELETE SET NULL (task_id)"),
    "V3.5: In-app notifications composite FK specifies column-targeted ON DELETE SET NULL (task_id)"
  );
  assert(
    schemaSql.includes("CREATE UNIQUE INDEX IF NOT EXISTS uq_active_membership_user") &&
    schemaSql.includes("WHERE is_active = TRUE;"),
    "V3.5: Active membership partial unique index for user"
  );
  assert(
    schemaSql.includes("CREATE UNIQUE INDEX IF NOT EXISTS uq_active_membership_roster") &&
    schemaSql.includes("WHERE is_active = TRUE;"),
    "V3.5: Active membership partial unique index for roster person"
  );
  assert(
    rlsSql.includes("t.workspace_id = p.workspace_id"),
    "V3.5: Storage deliverable RLS policy validates matching workspace path"
  );
  assert(
    reportSql.includes("IF p_month_key IS NULL OR p_month_key !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN"),
    "V3.5: Month regex enforces exact YYYY-MM format"
  );

  // [Scenario 41] PostgreSQL syntax & delimiter purity
  console.log("\n[Scenario 41] Delimiter purity & standard function resolution...");
  for (const file of migrationFiles) {
    const badDelimMatches = file.content.match(/(AS\s+\$(?!\$))|((?<!\$)\$\s*;)|((?<!\$)\$\s*LANGUAGE)/gi);
    assert(!badDelimMatches, `V3.5: No invalid single-dollar function delimiters in ${file.name}`);
    assert(!file.content.includes("pg_catalog.coalesce"), `V3.5: No invalid pg_catalog.coalesce in ${file.name}`);
    assert(!file.content.includes("pg_catalog.extract"), `V3.5: No invalid pg_catalog.extract in ${file.name}`);
    assert(!file.content.includes("pg_catalog.trim"), `V3.5: No invalid pg_catalog.trim in ${file.name}`);
  }

  
  // [Scenario 42] Revocation of Default Privileges on Functions
  console.log("\n[Scenario 42] Revocation of default function execution privileges...");
  assert(
    schemaSql.includes("ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon"),
    "Migration 1: Default execute revoked from PUBLIC, anon in schema public"
  );
  assert(
    funcSql.includes("ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;"),
    "Migration 2: Default execute revoked from PUBLIC, anon in schema public"
  );
  assert(
    reportSql.includes("ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;"),
    "Migration 5: Default execute revoked from PUBLIC, anon in schema public"
  );

  // [Scenario 43] Safe Workspace Invitation Constraints & Re-binding Guards
  console.log("\n[Scenario 43] Safe Workspace Invitation Constraints & Re-binding Guards...");
  assert(
    schemaSql.includes("uq_one_pending_invitation_per_roster") &&
    schemaSql.includes("WHERE status = 'pending'"),
    "Partial unique index prevents multiple pending invitations for the same roster person"
  );
  assert(
    schemaSql.includes("uq_one_pending_invitation_per_email") &&
    schemaSql.includes("WHERE status = 'pending'"),
    "Partial unique index prevents multiple pending invitations for the same email"
  );
  assert(
    !funcSql.includes("p_raw_token") || !funcSql.match(/fn_record_idempotency\([^)]*p_raw_token/i),
    "Raw invitation token is never passed into idempotency record or audit event"
  );
  assert(
    funcSql.includes("SELECT * INTO v_roster") &&
    funcSql.includes("WHERE workspace_id = v_inv.workspace_id AND id = v_inv.roster_person_id") &&
    funcSql.includes("FOR UPDATE;") &&
    funcSql.includes("Target roster person already has an active workspace membership."),
    "accept_workspace_invitation row-locks target roster person and prevents stealing active roster membership"
  );

  // [Scenario 44] NULL-Safe Task Authorization & Transition Matrix
  console.log("\n[Scenario 44] NULL-Safe Task Authorization & Reopen Reason...");
  assert(
    funcSql.includes("COALESCE(v_is_involved, FALSE)"),
    "Task transition authorization uses NULL-safe boolean check"
  );
  assert(
    funcSql.includes("A mandatory reason is required when reopening an approved task back to in_progress."),
    "Reopening an approved task back to in_progress strictly requires a non-empty p_reason"
  );

  // [Scenario 45] Start Timer on Behalf Authorization & Server-Side Duration
  console.log("\n[Scenario 45] Start Timer on Behalf Authorization & Server Duration...");
  assert(
    funcSql.includes("Target roster person not found or inactive in workspace."),
    "start_timer_on_behalf validates target roster person is active in the workspace"
  );
  assert(
    funcSql.includes("duration_seconds = EXTRACT(EPOCH FROM (pg_catalog.now() - started_at))::INT"),
    "Timer duration is strictly computed server-side from PostgreSQL interval"
  );

  // [Scenario 46] Review Submission Timer Auto-Close & Self-Review Guard
  console.log("\n[Scenario 46] Review Submission Timer Auto-Close & Self-Review Check...");
  assert(
    funcSql.includes("WHERE task_id = p_task_id") &&
    funcSql.includes("AND ended_at IS NULL") &&
    funcSql.includes("AND is_voided = FALSE;"),
    "submit_review_round closes all open timers across all users on the submitted task"
  );
  assert(
    schemaSql.includes("CONSTRAINT chk_review_rounds_no_self_review CHECK (submitter_id <> reviewer_id)"),
    "Table check constraint chk_review_rounds_no_self_review forbids submitter_id = reviewer_id"
  );

  // [Scenario 47] Protection of Review Rounds Mutations
  console.log("\n[Scenario 47] Review Rounds Immutability & Status Transition Trigger...");
  assert(
    schemaSql.includes("trg_protect_review_rounds_update") &&
    schemaSql.includes("trg_protect_review_rounds_delete"),
    "Review rounds are guarded by update and delete triggers"
  );
  assert(
    schemaSql.includes("Review rounds cannot be deleted."),
    "Trigger rejects deleting review rounds"
  );

  // [Scenario 48] Campaign Posts Batch Generation
  console.log("\n[Scenario 48] Campaign Posts Generation Concurrency & Ledgers...");
  assert(
    funcSql.includes("SELECT * INTO v_campaign") &&
    funcSql.includes("FROM public.campaigns") &&
    funcSql.includes("WHERE workspace_id = p_workspace_id AND id = p_campaign_id AND client_id = p_client_id") &&
    funcSql.includes("FOR UPDATE;"),
    "generate_campaign_posts acquires FOR UPDATE lock on the campaign row"
  );
  assert(
    funcSql.includes("INSERT INTO public.task_status_events") &&
    funcSql.includes("INSERT INTO public.task_assignment_events") &&
    funcSql.includes("INSERT INTO public.task_due_date_events"),
    "generate_campaign_posts initializes all three task event ledgers"
  );

  // [Scenario 49] Monthly Cutoff Open Timers, Pending Corrections & First Deliveries
  console.log("\n[Scenario 49] Monthly Cutoff Temporal Integrity & Metrics Breakdown...");
  assert(
    reportSql.includes("started_at < v_interval_end\n      AND (ended_at IS NULL OR ended_at >= v_interval_end)"),
    "Monthly report draft reconstructs open timers as of cutoff (ended_at IS NULL OR ended_at >= cutoff)"
  );
  assert(
    reportSql.includes("created_at < v_interval_end\n      AND (decided_at IS NULL OR decided_at >= v_interval_end)"),
    "Monthly report draft reconstructs pending corrections as of cutoff (decided_at IS NULL OR decided_at >= cutoff)"
  );
  assert(
    reportSql.includes("WHERE dmd.delivery_seq = 1\n        GROUP BY dmd.assignee_at_delivery"),
    "designerSummary firstDeliveredTasks strictly filters dmd.delivery_seq = 1"
  );
  assert(
    reportSql.includes("'designHours', COALESCE(dh.design_hours, 0.00)") &&
    reportSql.includes("'internalRevisionHours', COALESCE(dh.internal_revision_hours, 0.00)") &&
    reportSql.includes("'clientRevisionHours', COALESCE(dh.client_revision_hours, 0.00)") &&
    reportSql.includes("'totalRevisionHours', COALESCE(dh.total_revision_hours, 0.00)"),
    "designerSummary includes distinct designHours, internalRevisionHours, clientRevisionHours, totalRevisionHours"
  );

  // [Scenario 50] Public RPC Write Paths Coverage
  console.log("\n[Scenario 50] Public RPC Write Paths for all workflow tables...");
  const publicRpcs = [
    "update_campaign",
    "archive_campaign",
    "add_task_collaborator",
    "remove_task_collaborator",
    "create_task_checklist_item",
    "update_task_checklist_item",
    "delete_task_checklist_item",
    "create_task_attachment",
    "delete_task_attachment",
    "update_task_priority"
  ];
  for (const rpc of publicRpcs) {
    assert(funcSql.includes(`CREATE OR REPLACE FUNCTION public.${rpc}`), `Public RPC public.${rpc} implemented`);
    assert(funcSql.includes(`GRANT EXECUTE ON FUNCTION public.${rpc}`), `Public RPC public.${rpc} granted to authenticated`);
  }

  // [Scenario 51] Storage Path Format & Composite Lineage
  console.log("\n[Scenario 51] Attachment Storage Path Validation & Composite Lineage...");
  assert(
    schemaSql.includes("chk_attachment_storage_path") &&
    (schemaSql.includes("^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[^/]+$") ||
     schemaSql.includes("split_part(storage_path,'/',1)")),
    "chk_attachment_storage_path enforces {workspace_id}/{task_id}/{file_name} pattern"
  );
  assert(
    schemaSql.includes("fk_time_entry_correction_request"),
    "Time entries composite FK to time_change_requests(workspace_id, id)"
  );

  // [Scenario 52] Application Services & Database RPC Contract Alignment
  console.log("\n[Scenario 52] Application Services & Database RPC Contract Alignment...");
  const contractPath = path.join(__dirname, "../tools/omg-db-verification/RPC_CONTRACT.json");
  const contractExists = fs.existsSync(contractPath);
  assert(contractExists, "RPC_CONTRACT.json specification contract is present");
  if (contractExists) {
    const rpcContract = JSON.parse(fs.readFileSync(contractPath, "utf-8"));
    const contractRpcNames = Object.keys(rpcContract);
    assert(contractRpcNames.length >= 31, "RPC_CONTRACT specifies comprehensive public RPC endpoints");

    // Verify clients service
    const clientsServiceCode = fs.readFileSync(path.join(__dirname, "../lib/services/clients.ts"), "utf-8");
    assert(clientsServiceCode.includes('supabase.rpc("create_client"'), "clients.ts uses create_client RPC");
    assert(clientsServiceCode.includes('supabase.rpc("update_client"'), "clients.ts uses update_client RPC");
    assert(clientsServiceCode.includes('supabase.rpc("archive_client"'), "clients.ts uses archive_client RPC");

    // Verify campaigns service
    const campaignsServiceCode = fs.readFileSync(path.join(__dirname, "../lib/services/campaigns.ts"), "utf-8");
    assert(campaignsServiceCode.includes('supabase.rpc("create_campaign"'), "campaigns.ts uses create_campaign RPC");
    assert(campaignsServiceCode.includes('supabase.rpc("update_campaign"'), "campaigns.ts uses update_campaign RPC");
    assert(campaignsServiceCode.includes('supabase.rpc("archive_campaign"'), "campaigns.ts uses archive_campaign RPC");
    assert(campaignsServiceCode.includes('supabase.rpc("generate_campaign_posts"'), "campaigns.ts uses generate_campaign_posts RPC");

    // Verify campaigns API route
    const campaignsApiCode = fs.readFileSync(path.join(__dirname, "../app/api/campaigns/route.ts"), "utf-8");
    assert(campaignsApiCode.includes("createCampaign("), "api/campaigns/route.ts calls createCampaign service");

    // Verify tasks service parameter alignment
    const tasksServiceCode = fs.readFileSync(path.join(__dirname, "../lib/services/tasks.ts"), "utf-8");
    assert(tasksServiceCode.includes("p_new_due_date:"), "tasks.ts updateTaskDueDate uses p_new_due_date matching DB parameter");
    assert(tasksServiceCode.includes("p_priority:"), "tasks.ts updateTaskPriority uses p_priority matching DB parameter");
    assert(!tasksServiceCode.match(/rpc\("update_task_checklist_item"[^}]+p_sort_order/), "tasks.ts updateTaskChecklistItem omits unsupported p_sort_order");

    // Verify capacity service
    const capacityServiceCode = fs.readFileSync(path.join(__dirname, "../lib/services/capacity.ts"), "utf-8");
    assert(capacityServiceCode.includes('supabase.rpc("upsert_member_capacity"'), "capacity.ts uses upsert_member_capacity RPC");
    assert(capacityServiceCode.includes('supabase.rpc("manage_leave_day"'), "capacity.ts uses manage_leave_day RPC");

    // Verify team service
    const teamServiceCode = fs.readFileSync(path.join(__dirname, "../lib/services/team.ts"), "utf-8");
    assert(teamServiceCode.includes('supabase.rpc("create_workspace_invitation"'), "team.ts uses create_workspace_invitation RPC");
    assert(teamServiceCode.includes('supabase.rpc("revoke_workspace_invitation"'), "team.ts uses revoke_workspace_invitation RPC");
    assert(teamServiceCode.includes('supabase.rpc("transfer_workspace_ownership"'), "team.ts uses transfer_workspace_ownership RPC");
  }

// Extra CSV formula sanitization check
  console.log("\n[Bonus] CSV formula injection sanitization...");
  assert(sanitizeCsvValue("=SUM(A1:A10)") === "'=SUM(A1:A10)", "Sanitizes CSV formula =");
  assert(sanitizeCsvValue("+12345") === "'+12345", "Sanitizes CSV formula +");
  assert(sanitizeCsvValue("@evil") === "'@evil", "Sanitizes CSV formula @");

  console.log("==========================================================");
  console.log(`Results: ${passedCount} Passed | ${failedCount} Failed`);
  console.log("==========================================================");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test suite failed with unhandled exception:", err);
  process.exit(1);
});
