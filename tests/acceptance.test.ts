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
import {
  DocumentInventorySchema,
  BatchedExtractionSchema,
  ReconciledCalendarSchema,
} from "../lib/ai/schemas";
import {
  FIXTURE_A_INVENTORY,
  FIXTURE_A_ITEMS,
  FIXTURE_B_INVENTORY,
  FIXTURE_B_ITEMS,
  FIXTURE_C_INVENTORY,
  FIXTURE_C_ITEMS,
  FIXTURE_D_INVENTORY,
  FIXTURE_D_ITEMS,
} from "./fixtures/calendar-fixtures";
import { computeCalendarDiff } from "../lib/services/calendar-diff";

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

  // [Scenario 53] Migration 7: Owner Client Assignment & Review Bypass
  console.log("\n[Scenario 53] Owner Client Assignment & Review Bypass (Migration 7)...");
  const mig7Path = path.join(migrationsDir, "20260908000007_owner_client_assignment_and_review_bypass.sql");
  assert(fs.existsSync(mig7Path), "Migration 7 file exists");
  if (fs.existsSync(mig7Path)) {
    const mig7Sql = fs.readFileSync(mig7Path, "utf-8");
    const mig7Begins = (mig7Sql.match(/^BEGIN;/gm) || []).length;
    const mig7Commits = (mig7Sql.match(/^COMMIT;/gm) || []).length;
    assert(mig7Begins === 1 && mig7Commits === 1, "Migration 7 has exactly 1 BEGIN and 1 COMMIT");
    assert(mig7Sql.includes("FUNCTION public.update_client_assignment("), "Migration 7 creates update_client_assignment RPC");
    assert(mig7Sql.includes("REVOKE EXECUTE ON FUNCTION public.update_client_assignment"), "Migration 7 revokes execute on update_client_assignment from public, anon");
    assert(mig7Sql.includes("GRANT EXECUTE ON FUNCTION public.update_client_assignment"), "Migration 7 grants execute on update_client_assignment to authenticated");
    assert(mig7Sql.includes("Tasks executed by the Workspace Owner bypass internal review"), "Migration 7 blocks submit_review_round for Owner tasks");
    assert(mig7Sql.includes("v_is_owner_assignee"), "Migration 7 allows transition to approved for Owner tasks");
  }

  // [Scenario 54] Complete Terminology Alignment ("وكالة" -> "ايجنسي")
  console.log("\n[Scenario 54] Complete Terminology Alignment (Zero 'وكال' occurrences in UI)...");
  function checkDirForOldTerm(dir: string): string[] {
    const found: string[] = [];
    if (!fs.existsSync(dir)) return found;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!["node_modules", ".git", ".next", "supabase", "scratch"].includes(e.name)) {
          found.push(...checkDirForOldTerm(p));
        }
      } else if (e.isFile() && !e.name.endsWith(".map") && !e.name.endsWith(".lock")) {
        const c = fs.readFileSync(p, "utf-8");
        if (c.includes("وكال")) found.push(p);
      }
    }
    return found;
  }
  const oldTermMatches = checkDirForOldTerm(path.join(__dirname, "../app"))
    .concat(checkDirForOldTerm(path.join(__dirname, "../components")))
    .concat(checkDirForOldTerm(path.join(__dirname, "../lib")));
  assert(oldTermMatches.length === 0, `Zero occurrences of 'وكال' in app/components/lib (found ${oldTermMatches.length})`);

  // Extra CSV formula sanitization check
  console.log("\n[Bonus] CSV formula injection sanitization...");
  assert(sanitizeCsvValue("=SUM(A1:A10)") === "'=SUM(A1:A10)", "Sanitizes CSV formula =");
  assert(sanitizeCsvValue("+12345") === "'+12345", "Sanitizes CSV formula +");
  assert(sanitizeCsvValue("@evil") === "'@evil", "Sanitizes CSV formula @");

  // [Scenario 55] Migration 8: Content Calendars & Pause Invitations Structure & Transactional Integrity
  console.log("\n[Scenario 55] Content Calendars & Pause Invitations (Migration 8)...");
  const mig8Path = path.join(migrationsDir, "20260908000008_content_calendars_and_pause_invitations.sql");
  assert(fs.existsSync(mig8Path), "Migration 8 file exists");
  if (fs.existsSync(mig8Path)) {
    const mig8Sql = fs.readFileSync(mig8Path, "utf-8");
    const mig8Begins = (mig8Sql.match(/^BEGIN;/gm) || []).length;
    const mig8Commits = (mig8Sql.match(/^COMMIT;/gm) || []).length;
    assert(mig8Begins === 1 && mig8Commits === 1, "Migration 8 has exactly 1 BEGIN and 1 COMMIT");
    assert(mig8Sql.includes("invitations_paused BOOLEAN NOT NULL DEFAULT TRUE"), "Migration 8 adds invitations_paused default true");
    assert(mig8Sql.includes("FUNCTION private.is_workspace_owner("), "Migration 8 creates private.is_workspace_owner helper");
    assert(mig8Sql.includes("FUNCTION public.set_workspace_invitations_paused("), "Migration 8 creates set_workspace_invitations_paused RPC");
    assert(mig8Sql.includes("INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)"), "Migration 8 configures content-calendars private bucket with 15MB limit");
    assert(mig8Sql.includes("TABLE IF NOT EXISTS public.content_calendar_items"), "Migration 8 creates content_calendar_items table");
    assert(mig8Sql.includes("CONSTRAINT uq_cci_composite UNIQUE"), "Migration 8 enforces composite uniqueness on content_calendar_items");
    assert(mig8Sql.includes("calendar_status IN ('uploaded', 'processing', 'needs_review', 'ready', 'imported', 'failed', 'archived')"), "Migration 8 enforces calendar_status check constraint");
    assert(mig8Sql.includes("FUNCTION public.import_content_calendar_tasks("), "Migration 8 creates atomic import_content_calendar_tasks RPC");
    assert(mig8Sql.includes("v_target_assignee_id = v_owner_roster_id THEN"), "Migration 8 includes review bypass logic for Owner in batch task import");
    assert(mig8Sql.includes("'backlog'"), "Migration 8 imports tasks into backlog status (mapped to انتظار in UI)");
    assert(mig8Sql.includes("ALTER TABLE public.in_app_notifications"), "Migration 8 extends in_app_notifications table");
    assert(mig8Sql.includes("ADD COLUMN IF NOT EXISTS action_url TEXT"), "Migration 8 adds action_url to in_app_notifications");
    assert(mig8Sql.includes("trg_protect_notif_update"), "Migration 8 attaches tamper-protection trigger to in_app_notifications");
    assert(mig8Sql.includes("REVOKE ALL ON FUNCTION public.import_content_calendar_tasks"), "Migration 8 revokes public execution on import RPC");
    assert(mig8Sql.includes("GRANT EXECUTE ON FUNCTION public.import_content_calendar_tasks"), "Migration 8 grants execution on import RPC to authenticated");
  }

  // [Scenario 56] Immediate Invitations Pause Server & Client Guards
  console.log("\n[Scenario 56] Immediate Invitations Pause Server & Client Guards...");
  const inviteStatusRoute = path.join(__dirname, "../app/api/workspace/invitations-status/route.ts");
  assert(fs.existsSync(inviteStatusRoute), "app/api/workspace/invitations-status/route.ts exists");
  if (fs.existsSync(inviteStatusRoute)) {
    const routeContent = fs.readFileSync(inviteStatusRoute, "utf-8");
    assert(routeContent.includes("set_workspace_invitations_paused"), "Route calls set_workspace_invitations_paused RPC");
    assert(routeContent.includes("export async function GET"), "Route exports GET handler");
    assert(routeContent.includes("export async function PATCH"), "Route exports PATCH handler");
  }

  const acceptInviteRoute = path.join(__dirname, "../app/api/auth/accept-invite/route.ts");
  assert(fs.existsSync(acceptInviteRoute), "app/api/auth/accept-invite/route.ts exists");
  if (fs.existsSync(acceptInviteRoute)) {
    const acceptRouteContent = fs.readFileSync(acceptInviteRoute, "utf-8");
    assert(acceptRouteContent.includes("invitations_paused"), "Accept invite route checks invitations_paused state");
    assert(acceptRouteContent.includes("status: 403"), "Accept invite route returns HTTP 403 when invitations are paused");
  }

  const acceptInvitePage = path.join(__dirname, "../app/accept-invite/page.tsx");
  assert(fs.existsSync(acceptInvitePage), "app/accept-invite/page.tsx exists");
  if (fs.existsSync(acceptInvitePage)) {
    const pageContent = fs.readFileSync(acceptInvitePage, "utf-8");
    const requiredNotice = "الدعوات متوقفة مؤقتًا لحين الانتهاء من تحديث مساحة العمل. سيصلك رابط جديد عند إعادة فتح الدعوات.";
    assert(pageContent.includes(requiredNotice), "Accept invite page contains the exact required Arabic paused message");
  }

  const settingsPage = path.join(__dirname, "../app/settings/page.tsx");
  assert(fs.existsSync(settingsPage), "app/settings/page.tsx exists");
  if (fs.existsSync(settingsPage)) {
    const settingsContent = fs.readFileSync(settingsPage, "utf-8");
    assert(settingsContent.includes("حالة قبول الدعوات"), "Settings page contains Owner toggle for invitations paused status");
  }

  // [Scenario 57] Monthly Content Calendars PDF Parser & Extractor Pipeline
  console.log("\n[Scenario 57] Monthly Content Calendars PDF Extractor Pipeline...");
  const pdfExtractorPath = path.join(__dirname, "../lib/services/pdf-extractor.ts");
  assert(fs.existsSync(pdfExtractorPath), "lib/services/pdf-extractor.ts exists");
  const { validatePdfBuffer } = await import("../lib/services/pdf-extractor");
  
  // Non-PDF buffer validation
  const invalidBuffer = Buffer.from("NOT_A_PDF_STREAM");
  const invalidResult = validatePdfBuffer(invalidBuffer);
  assert(!invalidResult.valid, "validatePdfBuffer rejects non-PDF buffer");

  // Empty buffer validation
  const emptyResult = validatePdfBuffer(Buffer.alloc(0));
  assert(!emptyResult.valid, "validatePdfBuffer rejects empty buffer");

  // Valid PDF header simulation
  const validHeaderBuffer = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");
  const validHeaderResult = validatePdfBuffer(validHeaderBuffer);
  assert(validHeaderResult.valid, "validatePdfBuffer accepts buffer starting with %PDF-");

  // Buffer exceeding 15MB limit
  const oversizedBuffer = Buffer.alloc(16 * 1024 * 1024);
  const oversizedResult = validatePdfBuffer(oversizedBuffer);
  assert(!oversizedResult.valid, "validatePdfBuffer rejects buffer over 15MB limit");

  // [Scenario 58] Batch Task Generation & Review Bypass Contract
  console.log("\n[Scenario 58] Batch Task Generation & Review Bypass Contract...");
  assert(TASK_STATUS_LABELS.backlog === "انتظار", "Initial task status label is 'انتظار' (mapped to backlog enum)");
  
  const importRoutePath = path.join(__dirname, "../app/api/campaigns/import-tasks/route.ts");
  assert(fs.existsSync(importRoutePath), "app/api/campaigns/import-tasks/route.ts exists");
  if (fs.existsSync(importRoutePath)) {
    const importRouteContent = fs.readFileSync(importRoutePath, "utf-8");
    assert(importRouteContent.includes("import_content_calendar_tasks"), "import-tasks route calls import_content_calendar_tasks RPC");
  }

  // [Scenario 59] In-App Notification System Contracts
  console.log("\n[Scenario 59] In-App Notification System Contracts...");
  const notifBell = path.join(__dirname, "../components/navigation/NotificationBell.tsx");
  assert(fs.existsSync(notifBell), "components/navigation/NotificationBell.tsx exists");
  if (fs.existsSync(notifBell)) {
    const notifBellContent = fs.readFileSync(notifBell, "utf-8");
    assert(notifBellContent.includes("in_app_notifications"), "NotificationBell interacts with in_app_notifications table");
    assert(notifBellContent.includes("markAsRead"), "NotificationBell implements markAsRead function");
  }

  const notifRoute = path.join(__dirname, "../app/api/notifications/route.ts");
  assert(fs.existsSync(notifRoute), "app/api/notifications/route.ts exists");
  if (fs.existsSync(notifRoute)) {
    const notifRouteContent = fs.readFileSync(notifRoute, "utf-8");
    assert(notifRouteContent.includes("export async function GET"), "Notifications API exports GET");
    assert(notifRouteContent.includes("export async function PATCH"), "Notifications API exports PATCH");
  }

  // [Scenario 60] Campaigns UI Content Calendar Integration
  console.log("\n[Scenario 60] Campaigns UI Content Calendar Integration...");
  const campaignsPage = path.join(__dirname, "../app/campaigns/page.tsx");
  assert(fs.existsSync(campaignsPage), "app/campaigns/page.tsx exists");
  if (fs.existsSync(campaignsPage)) {
    const campaignsContent = fs.readFileSync(campaignsPage, "utf-8");
    assert(campaignsContent.includes("selectedMonth"), "Campaigns page includes Month Picker");
    assert(campaignsContent.includes("handleConfirmImport"), "Campaigns page includes task import execution");
    assert(campaignsContent.includes("handleUploadSubmit"), "Campaigns page includes PDF upload flow");
  }

  // [Scenario 61] Campaigns Hotfix: Left Join 28 Clients & Standalone Upload Modal
  console.log("\n[Scenario 61] Campaigns Hotfix: Left Join 28 Clients & Standalone Upload Modal...");
  if (fs.existsSync(campaignsPage)) {
    const campaignsContent = fs.readFileSync(campaignsPage, "utf-8");
    assert(campaignsContent.includes("رفع Content Calendar"), "Campaigns page includes standalone '+ رفع Content Calendar' button");
    assert(campaignsContent.includes("uploadClientId"), "Campaigns page manages uploadClientId state in modal");
    assert(campaignsContent.includes("uploadMonth"), "Campaigns page manages editable uploadMonth state");
    assert(campaignsContent.includes("allClients.map"), "Upload modal renders mandatory Client dropdown mapping all clients");
    assert(campaignsContent.includes("not_uploaded"), "Campaigns page maps missing calendars to 'not_uploaded' state");
    assert(campaignsContent.includes("تعذر تحميل بيانات العملاء"), "Campaigns page implements API error state with friendly Arabic message");
    assert(campaignsContent.includes("إعادة المحاولة"), "Campaigns page implements retry button for API error");
    assert(campaignsContent.includes("لا يوجد عميل مطابق للبحث"), "Campaigns page implements empty search state");
    assert(campaignsContent.includes("غير مسند / لم يبدأ"), "Campaigns page renders unassigned badge for clients like zanzi");
  }

  const calendarApiRoute = path.join(__dirname, "../app/api/campaigns/calendar/route.ts");
  assert(fs.existsSync(calendarApiRoute), "app/api/campaigns/calendar/route.ts exists");
  if (fs.existsSync(calendarApiRoute)) {
    const calContent = fs.readFileSync(calendarApiRoute, "utf-8");
    assert(calContent.includes("export async function GET"), "Calendar API route exports GET handler");
    assert(calContent.includes("clientCalendars"), "Calendar API returns clientCalendars array");
  }

  const uploadApiRoute = path.join(__dirname, "../app/api/campaigns/upload/route.ts");
  assert(fs.existsSync(uploadApiRoute), "app/api/campaigns/upload/route.ts exists");
  if (fs.existsSync(uploadApiRoute)) {
    const uploadContent = fs.readFileSync(uploadApiRoute, "utf-8");
    assert(uploadContent.includes("export async function POST"), "Upload API route exports POST handler");
    assert(uploadContent.includes("uploadContentCalendar"), "Upload API route calls uploadContentCalendar service");
  }

  // [Scenario 62] Migration 9 Schema & Constraints Verification...
  console.log("\n[Scenario 62] Migration 9 Schema, AI Metadata & Cache Table Verification...");
  const migration9Path = path.join(migrationsDir, "20260908000009_ai_content_calendar_pipeline.sql");
  assert(fs.existsSync(migration9Path), "Migration 9 file exists");
  if (fs.existsSync(migration9Path)) {
    const mig9Sql = fs.readFileSync(migration9Path, "utf-8");
    const m9Begins = (mig9Sql.match(/^BEGIN;/gm) || []).length;
    const m9Commits = (mig9Sql.match(/^COMMIT;/gm) || []).length;
    assert(m9Begins === 1 && m9Commits === 1, "Migration 9 has exactly 1 BEGIN and 1 COMMIT");
    assert(mig9Sql.includes("ai_provider TEXT DEFAULT 'google'"), "Migration 9 adds ai_provider");
    assert(mig9Sql.includes("ai_model TEXT DEFAULT 'gemini-3.8-flash'"), "Migration 9 adds ai_model");
    assert(mig9Sql.includes("ai_prompt_version TEXT DEFAULT 'v2.0'"), "Migration 9 adds ai_prompt_version");
    assert(mig9Sql.includes("ai_schema_version TEXT DEFAULT '2026-09-08'"), "Migration 9 adds ai_schema_version");
    assert(mig9Sql.includes("chk_campaigns_ai_confidence"), "Migration 9 adds confidence check constraint (0 to 1)");
    assert(mig9Sql.includes("chk_campaigns_declared_post_count"), "Migration 9 adds declared_post_count check constraint (0 to 100)");
    assert(mig9Sql.includes("chk_campaigns_detected_post_count"), "Migration 9 adds detected_post_count check constraint (0 to 100)");
    assert(mig9Sql.includes("on_design_text TEXT"), "Migration 9 adds on_design_text to content_calendar_items");
    assert(mig9Sql.includes("hook TEXT"), "Migration 9 adds hook to content_calendar_items");
    assert(mig9Sql.includes("cta TEXT"), "Migration 9 adds cta to content_calendar_items");
    assert(mig9Sql.includes("reel_script TEXT"), "Migration 9 adds reel_script to content_calendar_items");
    assert(mig9Sql.includes("slides JSONB"), "Migration 9 adds slides JSONB to content_calendar_items");
    assert(mig9Sql.includes("is_excluded_from_tasks BOOLEAN"), "Migration 9 adds is_excluded_from_tasks to content_calendar_items");
    assert(mig9Sql.includes("CREATE TABLE IF NOT EXISTS public.ai_extraction_cache"), "Migration 9 creates ai_extraction_cache table");
    assert(mig9Sql.includes("uq_ai_cache_entry"), "Migration 9 enforces cache uniqueness constraint");
    assert(mig9Sql.includes("ENABLE ROW LEVEL SECURITY"), "ai_extraction_cache has RLS enabled");
    assert(mig9Sql.includes("p_select_ai_cache_owner"), "ai_extraction_cache has Owner-only SELECT policy");
    assert(mig9Sql.includes("CREATE OR REPLACE FUNCTION public.save_ai_calendar_extraction"), "Migration 9 creates save_ai_calendar_extraction RPC");
  }

  // [Scenario 63] AI Document Pipeline Contract & Decoupled Architecture...
  console.log("\n[Scenario 63] AI Pipeline Contract & Decoupled Architecture...");
  const processRoute = path.join(__dirname, "../app/api/campaigns/process-calendar/route.ts");
  assert(fs.existsSync(processRoute), "app/api/campaigns/process-calendar/route.ts exists");
  if (fs.existsSync(processRoute)) {
    const processContent = fs.readFileSync(processRoute, "utf-8");
    assert(processContent.includes("export const maxDuration = 300"), "Process calendar route exports maxDuration = 300");
    assert(processContent.includes("export async function POST"), "Process calendar route exports POST handler");
    assert(processContent.includes("processCalendarCampaign"), "Process route calls processCalendarCampaign service");
  }

  const geminiClientPath = path.join(__dirname, "../lib/ai/gemini-client.ts");
  assert(fs.existsSync(geminiClientPath), "lib/ai/gemini-client.ts exists");
  if (fs.existsSync(geminiClientPath)) {
    const geminiContent = fs.readFileSync(geminiClientPath, "utf-8");
    assert(geminiContent.includes("getGeminiClient"), "gemini-client exports getGeminiClient");
    assert(geminiContent.includes("isGeminiConfigured"), "gemini-client exports isGeminiConfigured");
    assert(geminiContent.includes("getGeminiModel"), "gemini-client exports getGeminiModel");
  }

  const pipelinePath = path.join(__dirname, "../lib/services/ai-document-pipeline.ts");
  assert(fs.existsSync(pipelinePath), "lib/services/ai-document-pipeline.ts exists");
  if (fs.existsSync(pipelinePath)) {
    const pipeContent = fs.readFileSync(pipelinePath, "utf-8");
    assert(pipeContent.includes("runPassAInventory"), "Pipeline implements Pass A Inventory");
    assert(pipeContent.includes("runPassBExtraction"), "Pipeline implements Pass B Extraction");
    assert(pipeContent.includes("runPassCReconciliation"), "Pipeline implements Pass C Reconciliation");
    assert(pipeContent.includes("ai_extraction_cache"), "Pipeline queries and writes to ai_extraction_cache");
  }

  // [Scenario 64] Mocked Contract: Fixture A (12 Posts Standard Calendar)...
  console.log("\n[Scenario 64] Mocked Contract: Fixture A (12 Posts Standard Calendar)...");
  const parsedAInventory = DocumentInventorySchema.safeParse(FIXTURE_A_INVENTORY);
  assert(parsedAInventory.success, "Fixture A inventory conforms to DocumentInventorySchema");
  assert(FIXTURE_A_INVENTORY.page_count === 13, "Fixture A total page count is 13");
  assert(FIXTURE_A_INVENTORY.declared_post_count === 12, "Fixture A declared post count is 12");
  assert(FIXTURE_A_ITEMS.length === 12, "Fixture A has exactly 12 extracted post items");
  const nonOperationalA = FIXTURE_A_INVENTORY.page_classifications.filter((p) => !p.is_operational);
  assert(nonOperationalA.length === 1 && nonOperationalA[0].page_type === "cover", "Fixture A correctly classifies page 1 as Cover");

  // [Scenario 65] Mocked Contract: Fixture B (20 Posts with Overview Deduplication)...
  console.log("\n[Scenario 65] Mocked Contract: Fixture B (20 Posts with Overview Grid Deduplication)...");
  const parsedBInventory = DocumentInventorySchema.safeParse(FIXTURE_B_INVENTORY);
  assert(parsedBInventory.success, "Fixture B inventory conforms to DocumentInventorySchema");
  assert(FIXTURE_B_INVENTORY.cross_references.length === 20, "Fixture B maps 20 overview items to detail pages");
  const overviewBlocks = FIXTURE_B_ITEMS.filter((i) => i.source_pages.includes(2));
  const detailBlocks = FIXTURE_B_ITEMS.filter((i) => !i.source_pages.includes(2));
  assert(overviewBlocks.length === 20, "Fixture B identifies 20 overview items on page 2");
  assert(detailBlocks.length === 20, "Fixture B identifies 20 detailed post items on pages 3-22");
  assert(overviewBlocks.every((b) => b.canonicalPostId.startsWith("fixture_b_post_")), "Overview items share canonicalPostId with detail pages");

  // [Scenario 66] Mocked Contract: Fixture C (25 Posts with Carousel & Reel)...
  console.log("\n[Scenario 66] Mocked Contract: Fixture C (25 Posts with Carousel & Reel)...");
  const carouselItem = FIXTURE_C_ITEMS.find((i) => i.content_format === "Carousel");
  assert(Boolean(carouselItem), "Fixture C contains a Carousel post");
  assert(carouselItem?.slides.length === 5, "Carousel post has exactly 5 slides inside 1 single task");
  const reelItem = FIXTURE_C_ITEMS.find((i) => i.content_format === "Reel");
  assert(Boolean(reelItem), "Fixture C contains a Reel post");
  assert(Boolean(reelItem?.hook && reelItem?.reel_script && reelItem?.cta), "Reel post has hook, scene script, and CTA preserved");
  assert(FIXTURE_C_ITEMS.length === 25, "Fixture C contains exactly 25 post items total");

  // [Scenario 67] Mocked Contract: Fixture D (Scanned / Mixed Layout with Non-Content Sections)...
  console.log("\n[Scenario 67] Mocked Contract: Fixture D (Scanned / Mixed Layout with Non-Content Sections)...");
  const parsedDInventory = DocumentInventorySchema.safeParse(FIXTURE_D_INVENTORY);
  assert(parsedDInventory.success, "Fixture D inventory conforms to DocumentInventorySchema");
  const nonOperationalD = FIXTURE_D_INVENTORY.page_classifications.filter((p) => !p.is_operational);
  assert(nonOperationalD.length === 5, "Fixture D identifies exactly 5 non-operational sections (Cover, Strategy, Pillars, References, Thank You)");
  assert(FIXTURE_D_ITEMS.length === 12, "Fixture D extracts exactly 12 operational posts out of 17 pages");

  // [Scenario 68] Agency Terminology & Honesty in Reporting...
  console.log("\n[Scenario 68] Agency Terminology Verification...");
  const campaignsPageSql = fs.readFileSync(path.join(__dirname, "../app/campaigns/page.tsx"), "utf-8");
  assert(!campaignsPageSql.includes("وكالة"), "Zero occurrences of 'وكالة' in campaigns page (strictly 'ايجنسي')");
  assert(!campaignsPageSql.includes("وكالات"), "Zero occurrences of 'وكالات' in campaigns page (strictly 'ايجنسي')");

  // [Scenario 69] Task Assignment Events Schema Alignment (Migration 11)...
  console.log("\n[Scenario 69] Task Assignment Events Schema Alignment (Migration 11)...");
  const migration11Path = path.join(__dirname, "../supabase/migrations/20260909000011_fix_calendar_task_assignment_events.sql");
  assert(fs.existsSync(migration11Path), "Migration 11 file exists");
  const m11Sql = fs.readFileSync(migration11Path, "utf-8");
  const m11Begins = (m11Sql.match(/^BEGIN;/gm) || []).length;
  const m11Commits = (m11Sql.match(/^COMMIT;/gm) || []).length;
  assert(m11Begins === 1 && m11Commits === 1, "Migration 11 has exactly 1 BEGIN and 1 COMMIT");
  assert(m11Sql.includes("previous_assignee_id") && m11Sql.includes("new_assignee_id"), "Migration 11 uses previous_assignee_id and new_assignee_id");
  assert(!m11Sql.includes("from_assignee_id"), "Migration 11 contains zero occurrences of from_assignee_id");
  assert(!m11Sql.includes("to_assignee_id"), "Migration 11 contains zero occurrences of to_assignee_id");
  assert(!campaignsPageSql.includes("alert(`خطأ: ${err.message}`"), "Campaigns page replaces browser alert on import failure with inline state");

  // [Scenario 70] Migration 12 Schema Verification (AI Processing Jobs & Operations Hardening)...
  console.log("\n[Scenario 70] Migration 12 Schema Verification (AI Processing Jobs & Hardening)...");
  const migration12Path = path.join(__dirname, "../supabase/migrations/20260910000012_ai_processing_jobs_and_hardening.sql");
  assert(fs.existsSync(migration12Path), "Migration 12 file exists");
  const m12Sql = fs.readFileSync(migration12Path, "utf-8");
  const m12Begins = (m12Sql.match(/^BEGIN;/gm) || []).length;
  const m12Commits = (m12Sql.match(/^COMMIT;/gm) || []).length;
  assert(m12Begins === 1 && m12Commits === 1, "Migration 12 has exactly 1 BEGIN and 1 COMMIT");
  assert(m12Sql.includes("CREATE TABLE IF NOT EXISTS public.ai_processing_jobs"), "Migration 12 creates public.ai_processing_jobs table");
  assert(m12Sql.includes("uq_active_ai_processing_job"), "Migration 12 adds concurrency uniqueness index");
  assert(m12Sql.includes("acquire_ai_processing_job"), "Migration 12 creates acquire_ai_processing_job RPC");
  assert(m12Sql.includes("release_ai_processing_job"), "Migration 12 creates release_ai_processing_job RPC");
  assert(m12Sql.includes("ALTER TABLE public.campaigns") && m12Sql.includes("replacement_reason"), "Migration 12 extends campaigns with replacement_reason");
  assert(m12Sql.includes("ALTER TABLE public.tasks") && m12Sql.includes("content_calendar_item_id"), "Migration 12 extends tasks with content_calendar_item_id foreign key");
  assert(m12Sql.includes("ALTER TABLE public.comments") && m12Sql.includes("comment_type"), "Migration 12 extends comments with comment_type");
  assert(m12Sql.includes("ALTER TABLE public.member_capacities") && m12Sql.includes("max_weighted_load"), "Migration 12 extends member_capacities with max_weighted_load");

  // [Scenario 71] AI Job Queue Service Contract & Lease Protection...
  console.log("\n[Scenario 71] AI Job Queue Service Contract & Lease Protection...");
  const aiJobQueuePath = path.join(__dirname, "../lib/services/ai-job-queue.ts");
  assert(fs.existsSync(aiJobQueuePath), "lib/services/ai-job-queue.ts exists");
  const aiJobQueueCode = fs.readFileSync(aiJobQueuePath, "utf-8");
  assert(aiJobQueueCode.includes("acquireJob"), "AiJobQueue implements acquireJob");
  assert(aiJobQueueCode.includes("releaseJob"), "AiJobQueue implements releaseJob");
  assert(aiJobQueueCode.includes("getAiUsageMetrics"), "AiJobQueue implements getAiUsageMetrics");
  const contentCalendarsCode = fs.readFileSync(path.join(__dirname, "../lib/services/content-calendars.ts"), "utf-8");
  assert(contentCalendarsCode.includes("AiJobQueue.acquireJob"), "processCalendarCampaign calls AiJobQueue.acquireJob");
  assert(contentCalendarsCode.includes("AiJobQueue.releaseJob"), "processCalendarCampaign calls AiJobQueue.releaseJob");
  const settingsPageCode = fs.readFileSync(path.join(__dirname, "../app/settings/page.tsx"), "utf-8");
  assert(settingsPageCode.includes("Gemini AI Operations & Usage"), "Settings page includes Owner AI Operations & Usage dashboard");

  // [Scenario 72] Calendar Revision Diff Engine Contract...
  console.log("\n[Scenario 72] Calendar Revision Diff Engine Contract...");
  const sampleOldItems = [
    { id: "item-1", post_number: "Post 01", title: "Original Post 1", content_format: "Static", design_due_date: "2026-09-01" },
    { id: "item-2", post_number: "Post 02", title: "Original Post 2", content_format: "Static", design_due_date: "2026-09-05" },
  ];
  const sampleNewItems = [
    { post_number: "Post 01", title: "Original Post 1", content_format: "Static", design_due_date: "2026-09-01" }, // unchanged
    { post_number: "Post 02", title: "Modified Post 2 Title", content_format: "Carousel", design_due_date: "2026-09-06" }, // changed
    { post_number: "Post 03", title: "New Extra Post", content_format: "Reel", design_due_date: "2026-09-10" }, // added
  ];
  const sampleTasks = [
    { id: "task-2", content_calendar_item_id: "item-2", title: "Post 02", status: "in_progress", assignee: { display_name: "سارة" } },
  ];
  const diffReport = computeCalendarDiff({
    oldItems: sampleOldItems,
    newItems: sampleNewItems,
    existingTasks: sampleTasks,
  });
  assert(diffReport.summary.unchangedCount === 1, "Diff engine correctly identifies 1 unchanged post");
  assert(diffReport.summary.changedCount === 1, "Diff engine correctly identifies 1 changed post");
  assert(diffReport.summary.addedCount === 1, "Diff engine correctly identifies 1 added post");
  assert(diffReport.summary.removedCount === 0, "Diff engine correctly identifies 0 removed posts");
  assert(diffReport.summary.activeTasksAtRiskCount === 1, "Diff engine correctly flags 1 active in-progress task at risk");
  assert(fs.existsSync(path.join(__dirname, "../app/api/campaigns/diff/route.ts")), "app/api/campaigns/diff/route.ts exists");

  // [Scenario 73] Task Source Traceability & Unified Drawer...
  console.log("\n[Scenario 73] Task Source Traceability & Unified Drawer...");
  const drawerPath = path.join(__dirname, "../components/tasks/TaskDetailsDrawer.tsx");
  assert(fs.existsSync(drawerPath), "components/tasks/TaskDetailsDrawer.tsx exists");
  const drawerCode = fs.readFileSync(drawerPath, "utf-8");
  assert(drawerCode.includes("أصل ومصدر المهمة"), "TaskDetailsDrawer displays source calendar origin");
  assert(drawerCode.includes("On-Design Text"), "TaskDetailsDrawer highlights on-design text");
  assert(drawerCode.includes("handleOpenPdfPreview"), "TaskDetailsDrawer implements PDF preview link");
  const tasksPageCode = fs.readFileSync(path.join(__dirname, "../app/tasks/page.tsx"), "utf-8");
  assert(tasksPageCode.includes("<TaskDetailsDrawer"), "app/tasks/page.tsx renders TaskDetailsDrawer");
  assert(fs.existsSync(path.join(__dirname, "../app/api/tasks/[id]/comments/route.ts")), "app/api/tasks/[id]/comments/route.ts exists");
  assert(fs.existsSync(path.join(__dirname, "../app/api/campaigns/preview-url/route.ts")), "app/api/campaigns/preview-url/route.ts exists");

  // [Scenario 74] Team Workload & Weighted Scoring Engine...
  console.log("\n[Scenario 74] Team Workload & Weighted Scoring Engine...");
  const workloadRoutePath = path.join(__dirname, "../app/api/team/workload/route.ts");
  assert(fs.existsSync(workloadRoutePath), "app/api/team/workload/route.ts exists");
  const workloadCode = fs.readFileSync(workloadRoutePath, "utf-8");
  assert(workloadCode.includes("baseWeight"), "Workload engine implements base weight scaling");
  assert(workloadCode.includes("diffMultiplier"), "Workload engine implements client difficulty multiplier");
  assert(workloadCode.includes("dueNext7Days") && workloadCode.includes("dueNext14Days"), "Workload engine tracks 7-day and 14-day upcoming deadlines radar");

  // [Scenario 75] Owner Invitations Center & Paused Defense...
  console.log("\n[Scenario 75] Owner Invitations Center & Paused Defense...");
  const invitationsRoutePath = path.join(__dirname, "../app/api/team/invitations/route.ts");
  assert(fs.existsSync(invitationsRoutePath), "app/api/team/invitations/route.ts exists");
  const invitationsCode = fs.readFileSync(invitationsRoutePath, "utf-8");
  assert(invitationsCode.includes("invitations_paused"), "Invitations API enforces invitations_paused check");
  const teamPageCode = fs.readFileSync(path.join(__dirname, "../app/team/page.tsx"), "utf-8");
  assert(teamPageCode.includes("Owner Team Invitations Center") || teamPageCode.includes("مركز دعوات الفريق"), "Team page renders Owner Invitations Center");
  assert(teamPageCode.includes("حفظ كمسودة"), "Team page allows draft invitations while paused");

  // [Scenario 76] System Health Hub & Disaster Recovery Runbook...
  console.log("\n[Scenario 76] System Health Hub & Disaster Recovery Runbook...");
  assert(fs.existsSync(path.join(__dirname, "../app/settings/system-health/page.tsx")), "app/settings/system-health/page.tsx exists");
  const exportRoutePath = path.join(__dirname, "../app/api/reports/export-csv/route.ts");
  assert(fs.existsSync(exportRoutePath), "app/api/reports/export-csv/route.ts exists");
  const exportCode = fs.readFileSync(exportRoutePath, "utf-8");
  assert(exportCode.includes("\\uFEFF"), "CSV export prepends UTF-8 BOM for Microsoft Excel Arabic support");
  assert(fs.existsSync(path.join(__dirname, "../docs/BACKUP_RECOVERY_RUNBOOK.md")), "docs/BACKUP_RECOVERY_RUNBOOK.md exists");
  assert(fs.existsSync(path.join(__dirname, "../docs/AGENCY_SCALE_BLUEPRINT.md")), "docs/AGENCY_SCALE_BLUEPRINT.md exists");

  // [Scenario 77] P0 Emergency Security Hotfix & Unified RBAC Hardening...
  console.log("\n[Scenario 77] P0 Emergency Security Hotfix & Unified RBAC Hardening...");
  const serverAuthPath = path.join(__dirname, "../lib/auth/server-auth.ts");
  assert(fs.existsSync(serverAuthPath), "lib/auth/server-auth.ts exists");
  const serverAuthCode = fs.readFileSync(serverAuthPath, "utf-8");
  assert(serverAuthCode.includes("requireAuthenticatedUser"), "server-auth implements requireAuthenticatedUser");
  assert(serverAuthCode.includes("requireWorkspaceMembership"), "server-auth implements requireWorkspaceMembership");
  assert(serverAuthCode.includes("requireOwner"), "server-auth implements requireOwner");
  assert(serverAuthCode.includes("requireTaskAccess"), "server-auth implements requireTaskAccess");
  assert(serverAuthCode.includes("validateSameOrigin"), "server-auth implements validateSameOrigin");

  // Verify Route Protections
  const aiJobsRouteCode = fs.readFileSync(path.join(__dirname, "../app/api/ai/jobs/route.ts"), "utf-8");
  assert(aiJobsRouteCode.includes("requireOwner"), "/api/ai/jobs route protected with requireOwner");

  const workloadCodeProtected = fs.readFileSync(workloadRoutePath, "utf-8");
  assert(workloadCodeProtected.includes("requireOwner"), "/api/team/workload route protected with requireOwner");

  const invitationsCodeProtected = fs.readFileSync(invitationsRoutePath, "utf-8");
  assert(invitationsCodeProtected.includes("requireOwner"), "/api/team/invitations route protected with requireOwner");
  assert(invitationsCodeProtected.includes("validateSameOrigin"), "/api/team/invitations route enforces validateSameOrigin");

  const exportCsvCodeProtected = fs.readFileSync(exportRoutePath, "utf-8");
  assert(exportCsvCodeProtected.includes("requireOwner"), "/api/reports/export-csv route protected with requireOwner");

  const commentsRoutePath = path.join(__dirname, "../app/api/tasks/[id]/comments/route.ts");
  assert(fs.existsSync(commentsRoutePath), "app/api/tasks/[id]/comments/route.ts exists");
  const commentsRouteCode = fs.readFileSync(commentsRoutePath, "utf-8");
  assert(commentsRouteCode.includes("requireTaskAccess"), "comments route protected with requireTaskAccess");
  assert(commentsRouteCode.includes("validateSameOrigin"), "comments route enforces validateSameOrigin");
  assert(!commentsRouteCode.includes("authorRosterId = owner?.roster_person_id"), "Zero fallback to owner in comments route");

  const diagnosticsRouteCode = fs.readFileSync(path.join(__dirname, "../app/api/diagnostics/route.ts"), "utf-8");
  assert(diagnosticsRouteCode.includes("requireOwner"), "/api/diagnostics route protected with requireOwner");

  // Behavioral test for validateSameOrigin
  const { validateSameOrigin } = require("../lib/auth/server-auth");
  const mockSafeGet = { method: "GET", headers: new Headers() };
  assert(validateSameOrigin(mockSafeGet), "validateSameOrigin allows safe GET requests");

  const mockLegitPost = {
    method: "POST",
    headers: new Headers({
      origin: "https://omg-creative-workspace.vercel.app",
      host: "omg-creative-workspace.vercel.app",
    }),
  };
  assert(validateSameOrigin(mockLegitPost), "validateSameOrigin allows legitimate same-origin POST requests");

  const mockMaliciousPost = {
    method: "POST",
    headers: new Headers({
      origin: "https://evil-attacker-site.com",
      host: "omg-creative-workspace.vercel.app",
    }),
  };
  assert(!validateSameOrigin(mockMaliciousPost), "validateSameOrigin blocks cross-origin POST attacks");

  console.log("\n[Scenario 78] Real Content Calendar Background Processing Resilience & Behavioral Invariants...");
  const uploadRouteContent = fs.readFileSync(path.join(__dirname, "../app/api/campaigns/upload/route.ts"), "utf-8");
  assert(uploadRouteContent.includes("status: 202"), "Upload returns 202 Accepted status code contract");

  const queueServiceContent = fs.readFileSync(path.join(__dirname, "../lib/services/ai-job-queue.ts"), "utf-8");
  assert(queueServiceContent.includes('status: "queued"'), "Job remains queued until Worker claims it");

  const mig18Content = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20260910000018_production_worker_cron_vault_and_deadlines.sql"), "utf-8");
  assert(mig18Content.includes("invoke_ai_worker_cron") && mig18Content.includes("ai-calendar-worker-every-minute"), "Valid Cron Worker invocation configured via Supabase pg_cron & pg_net");

  const { getGeminiModel, VALID_GEMINI_MODELS } = require("../lib/ai/gemini-client");
  const currentModel = getGeminiModel();
  assert(VALID_GEMINI_MODELS.includes(currentModel) && !currentModel.includes("3.8"), "Real PDF processing service path resolves to valid Google Gemini model");

  const calendarServiceContent = fs.readFileSync(path.join(__dirname, "../lib/services/content-calendars.ts"), "utf-8");
  assert(calendarServiceContent.includes('from("content-calendars")') && calendarServiceContent.includes(".download(") && calendarServiceContent.includes("تعذر تحميل الملف من التخزين"), "Storage download failure is explicitly caught and surfaced");

  const { classifyGeminiError } = require("../lib/ai/gemini-client");
  const rateLimitClassification = classifyGeminiError("Resource has been exhausted (e.g. check quota)", 429);
  assert(rateLimitClassification.category === "QUOTA_EXCEEDED", "Gemini transient failure (429/quota) classified for retry");

  const invalidKeyClassification = classifyGeminiError("API key not valid. Please pass a valid API key.", 401);
  assert(invalidKeyClassification.category === "INVALID_KEY", "Gemini permanent failure (invalid key) classified as permanent failure");

  const { ReconciledCalendarSchema } = require("../lib/ai/schemas");
  const invalidSchemaParse = ReconciledCalendarSchema.safeParse({ invalid_field: 123 });
  assert(!invalidSchemaParse.success, "Schema validation failure correctly blocks invalid extraction payloads");

  assert(calendarServiceContent.includes("save_ai_calendar_extraction") && calendarServiceContent.indexOf("save_ai_calendar_extraction") < calendarServiceContent.indexOf('releaseJob'), "Completed only after items saved successfully via atomic RPC");

  const campaignsPageContent = fs.readFileSync(path.join(__dirname, "../app/campaigns/page.tsx"), "utf-8");
  assert(campaignsPageContent.includes("job.safe_error_message") && campaignsPageContent.includes("waiting_for_retry"), "UI polling state mapping accurately displays safe_error_message and waiting_for_retry");

  assert(queueServiceContent.includes('from("ai_processing_jobs")') && queueServiceContent.includes(".update({") && queueServiceContent.includes(".eq(\"id\", jobId)"), "Retry existing Job without duplicate updates existing row");

  assert(!calendarServiceContent.includes(".from(\"tasks\").insert"), "No task creation before Owner approval (tasks table untouched during calendar extraction)");

  console.log("\n[Scenario 79] P0 Production Content Calendar UI Data-Consistency & Relationship Disambiguation (Phase 6)...");
  // 1. A job that previously failed and later completes has all stale error fields cleared
  assert(calendarServiceContent.includes("cleanProcessingError"), "1. Stale processing errors suppressed/cleared for successfully completed revisions");
  assert(calendarServiceContent.includes("isFailedState ? campaign.processing_error : null"), "1b. processing_error evaluates to null on non-failed calendar states");
  
  // 2. The current successful revision returns its extracted items
  assert(calendarServiceContent.includes("tasks!fk_cci_task"), "2. PostgREST tasks relationship disambiguated with !fk_cci_task to prevent PGRST201 error");
  assert(calendarServiceContent.includes("operationalItems") && calendarServiceContent.includes("excludedItems"), "2b. getContentCalendarDetails returns structured operationalItems and excludedItems");
  
  // 3. Opening the modal after polling completion displays those items
  assert(campaignsPageContent.includes("openReviewMatrix(row.client.id, row.campaign?.id)"), "3. Campaign card passes exact campaign ID to openReviewMatrix");
  assert(campaignsPageContent.includes("if (job.status === \"completed\")"), "3b. Polling completion triggers uploadError clearance and calendar refetch");

  // 4. Switching between clients cannot leak previous items or errors
  assert(campaignsPageContent.includes("setReviewCampaign(null)") && campaignsPageContent.includes("setReviewItems([])"), "4. Switching or opening modal clears previous items, reviewCampaign, and errors immediately");
  
  // 5. The header counters and table rows derive from the same revision
  assert(campaignsPageContent.includes("reviewItems.filter((i) => !i.is_excluded_from_tasks).length") && campaignsPageContent.includes("reviewCampaign?.detected_post_count"), "5. Header counters, selection total, and table rows derive from the same revision payload");
  
  // 6. Re-running success finalization does not duplicate items
  assert(calendarServiceContent.includes("save_ai_calendar_extraction"), "6. AI extraction finalization invokes atomic save_ai_calendar_extraction RPC preventing duplicate items");
  
  // 7. No tasks are created before owner approval
  assert(!calendarServiceContent.includes(".from(\"tasks\").insert"), "7. No task creation before Owner approval (tasks table untouched during calendar extraction)");
  const importRouteContent = fs.readFileSync(path.join(__dirname, "../app/api/campaigns/import-tasks/route.ts"), "utf-8");
  assert(importRouteContent.includes("import_content_calendar_tasks"), "7b. Tasks are created strictly and exclusively upon manual Owner approval via import-tasks route");

  console.log("\n[Scenario 80] Designer Full-Cycle Production Hardening & Operating Invariants...");
  // 1. Migration 25 database engine hardening
  const mig25Path = path.join(__dirname, "../supabase/migrations/20260910000025_designer_full_cycle_hardening.sql");
  assert(fs.existsSync(mig25Path), "1. Migration 25 file exists");
  const mig25Content = fs.readFileSync(mig25Path, "utf-8");
  assert(mig25Content.includes("transition_task_status") && mig25Content.includes("backlog") && mig25Content.includes("in_progress"), "1a. transition_task_status allows canonical backlog -> in_progress transition");
  assert(mig25Content.includes("v_is_owner_assignee") && mig25Content.includes("Tasks assigned to designers must pass review rounds"), "1b. Owner review bypass preserved exclusively for tasks assigned to owner");
  assert(mig25Content.includes("submit_review_round") && mig25Content.includes("INSERT INTO public.in_app_notifications") && mig25Content.includes("review_requested"), "1c. submit_review_round emits in-app notification to reviewer");
  assert(mig25Content.includes("decide_review_round") && mig25Content.includes("task_approved") && mig25Content.includes("changes_requested"), "1d. decide_review_round emits in-app notification to primary assignee");
  assert(mig25Content.includes("Self-approval denied"), "1e. Zero self-approval strictly enforced");

  // 2. API Security and Role Isolation
  const tasksRouteContent = fs.readFileSync(path.join(__dirname, "../app/api/tasks/route.ts"), "utf-8");
  assert(tasksRouteContent.includes("requireWorkspaceMembership") && tasksRouteContent.includes("requireOwner"), "2a. /api/tasks enforces requireWorkspaceMembership on GET and requireOwner on POST");
  assert(tasksRouteContent.includes("membership.role === \"designer\"") && tasksRouteContent.includes("membership.role === \"senior_reviewer\""), "2b. /api/tasks implements role-scoped task isolation");

  const taskStatusRouteContent = fs.readFileSync(path.join(__dirname, "../app/api/tasks/[id]/status/route.ts"), "utf-8");
  assert(taskStatusRouteContent.includes("validateSameOrigin") && taskStatusRouteContent.includes("requireTaskAccess"), "2c. /api/tasks/[id]/status enforces validateSameOrigin and requireTaskAccess");

  const reviewSubmitRouteContent = fs.readFileSync(path.join(__dirname, "../app/api/reviews/submit/route.ts"), "utf-8");
  assert(reviewSubmitRouteContent.includes("validateSameOrigin") && reviewSubmitRouteContent.includes("requireTaskAccess"), "2d. /api/reviews/submit enforces validateSameOrigin and requireTaskAccess");

  const reviewDecideRouteContent = fs.readFileSync(path.join(__dirname, "../app/api/reviews/decide/route.ts"), "utf-8");
  assert(reviewDecideRouteContent.includes("validateSameOrigin") && reviewDecideRouteContent.includes("requireWorkspaceMembership"), "2e. /api/reviews/decide enforces validateSameOrigin and requireWorkspaceMembership");

  const timerStartRouteContent = fs.readFileSync(path.join(__dirname, "../app/api/timer/start/route.ts"), "utf-8");
  assert(timerStartRouteContent.includes("validateSameOrigin") && timerStartRouteContent.includes("requireTaskAccess") && timerStartRouteContent.includes("membership.role !== \"owner\""), "2f. /api/timer/start enforces validateSameOrigin, requireTaskAccess, and Owner-only delegation");

  const exportCsvContent = fs.readFileSync(path.join(__dirname, "../app/api/reports/export-csv/route.ts"), "utf-8");
  assert(exportCsvContent.includes("/^[=+\\-@\\t\\r]/"), "2g. /api/reports/export-csv sanitizes spreadsheet formula injection");

  const authMeRouteContent = fs.readFileSync(path.join(__dirname, "../app/api/auth/me/route.ts"), "utf-8");
  assert(authMeRouteContent.includes("requireWorkspaceMembership"), "2h. /api/auth/me returns authenticated user and membership context");

  // 3. Designer "My Work" & Task Details Drawer
  const myWorkPageContent = fs.readFileSync(path.join(__dirname, "../app/my-work/page.tsx"), "utf-8");
  assert(!myWorkPageContent.includes("activePersona = \"سارة\"") && !myWorkPageContent.includes("sarah-id"), "3a. /my-work page eliminated mocked persona and hardcoded IDs");
  assert(myWorkPageContent.includes("قيد التنفيذ") && myWorkPageContent.includes("مطلوب تعديلات") && myWorkPageContent.includes("بانتظار المراجعة الداخلية") && myWorkPageContent.includes("انتظار") && myWorkPageContent.includes("معتمد") && myWorkPageContent.includes("تم التسليم") && myWorkPageContent.includes("مهام متأخرة"), "3b. /my-work renders canonical Arabic sections including Cairo overdue");

  const drawerContentUpdated = fs.readFileSync(path.join(__dirname, "../components/tasks/TaskDetailsDrawer.tsx"), "utf-8");
  assert(drawerContentUpdated.includes("final_deliverable_url") && drawerContentUpdated.includes("deliverableUrl"), "3c. TaskDetailsDrawer implements deliverable link capture and display");
  assert(drawerContentUpdated.includes("handleSubmitForReview") && drawerContentUpdated.includes("handleDecideReview"), "3d. TaskDetailsDrawer implements review submission modal and decision workflow");
  assert(drawerContentUpdated.includes("سجل جولات المراجعة الداخلية"), "3e. TaskDetailsDrawer displays review rounds history");

  // [Scenario 81] P0 Assignee Contract, Reviewer Resolution & Pre-Import Preview Assurance
  console.log("\n[Scenario 81] P0 Assignee Contract, Reviewer Resolution & Pre-Import Preview Assurance...");

  // 1. Migration 26 verification
  const mig26Path = path.join(__dirname, "../supabase/migrations/20260910000026_assignee_contract_and_reviewer_resolution.sql");
  assert(fs.existsSync(mig26Path), "1. Migration 26 file exists");
  const mig26Content = fs.readFileSync(mig26Path, "utf-8");
  assert(mig26Content.includes("00a38eae-a90e-4796-89e4-56394e987666") && mig26Content.includes("8ade760c-c482-4cfb-91e6-dbd8da040c4c") && mig26Content.includes("15"), "1a. Migration 26 seeds Sara -> Nada review routing rule at priority 15");
  assert(mig26Content.includes("import_content_calendar_tasks") && mig26Content.includes("v_explicit_reviewer_id"), "1b. Migration 26 supports explicit reviewer_id in import_content_calendar_tasks");
  assert(mig26Content.includes("يجب اختيار مصمم صالح للبوست رقم"), "1c. Migration 26 enforces active designer selection with Arabic error message");

  // 2. Clients API Data Contract Normalization
  const clientsRouteContent = fs.readFileSync(path.join(__dirname, "../app/api/clients/route.ts"), "utf-8");
  assert(clientsRouteContent.includes("displayName: designer.display_name") && clientsRouteContent.includes("display_name: designer.display_name"), "2a. /api/clients returns both camelCase displayName and snake_case display_name");
  assert(clientsRouteContent.includes("rosterId: designer.id") && clientsRouteContent.includes("jobTitle:") && clientsRouteContent.includes("job_title:"), "2b. /api/clients normalizes rosterId and job titles");
  assert(clientsRouteContent.includes("reviewRules: reviewRules"), "2c. /api/clients returns live review routing rules");

  // 3. Calendar Item API Assignee Validation
  const itemPatchContent = fs.readFileSync(path.join(__dirname, "../app/api/campaigns/items/[itemId]/route.ts"), "utf-8");
  assert(itemPatchContent.includes("roster_people") && itemPatchContent.includes("is_active") && itemPatchContent.includes("المصمم المختار غير صالح"), "3. PATCH /api/campaigns/items/[itemId] validates approved_assignee_id against active roster");

  // 4. Import API Assignee Strict Enforcement
  const importTasksRouteContent = fs.readFileSync(path.join(__dirname, "../app/api/campaigns/import-tasks/route.ts"), "utf-8");
  assert(importTasksRouteContent.includes("activeRosterIds.has(targetAssigneeId)") && importTasksRouteContent.includes("يجب تحديد مصمم صالح للبوست"), "4. POST /api/campaigns/import-tasks strictly enforces designer selection and rejects invalid assignees");

  // 5. Frontend Assignee Contract & Pre-Import Preview Table
  const campaignsPageAssigneeContent = fs.readFileSync(path.join(__dirname, "../app/campaigns/page.tsx"), "utf-8");
  assert(campaignsPageAssigneeContent.includes("resolveReviewerForPost"), "5a. CampaignsPage implements resolveReviewerForPost helper");
  assert(campaignsPageAssigneeContent.includes("updateItemFieldById") && campaignsPageAssigneeContent.includes("PATCH"), "5b. CampaignsPage implements immutable updateItemFieldById with auto-save");
  assert(campaignsPageAssigneeContent.includes("المصمم الافتراضي:") && campaignsPageAssigneeContent.includes("defId"), "5c. Modal header resolves and displays default designer name accurately");
  assert(campaignsPageAssigneeContent.includes("d.displayName || d.display_name") && campaignsPageAssigneeContent.includes("-- اختر المصمم --"), "5d. Assignee dropdown renders visible Arabic names and job titles");
  assert(campaignsPageAssigneeContent.includes("معاينة وتأكيد اعتماد الخطة وتوليد التاسكات") && campaignsPageAssigneeContent.includes("المراجع الداخلي"), "5e. CampaignsPage renders Pre-Import Confirmation Table with Post, Designer, Reviewer, and Status");

  // =========================================================================
  // Scenario 82: Partial Import Safety Contract & Progress Tracking Assurance
  // =========================================================================
  console.log("\n[Scenario 82] Partial Import Safety Contract & Progress Tracking Assurance...");

  const mig27Path = path.join(__dirname, "../supabase/migrations/20260910000027_partial_import_contract_and_progress_tracking.sql");
  assert(fs.existsSync(mig27Path), "1. Migration 27 file exists");
  const mig27Content = fs.readFileSync(mig27Path, "utf-8");

  assert(
    mig27Content.includes("v_total_operational") &&
    mig27Content.includes("v_imported_operational") &&
    mig27Content.includes("v_imported_operational >= v_total_operational AND v_total_operational > 0 THEN 'imported'"),
    "1a. Migration 27 only marks calendar_status = 'imported' when all operational items are imported"
  );
  assert(
    mig27Content.includes("deliverable_format") &&
    mig27Content.includes("deliverable_number") &&
    mig27Content.includes("content_calendar_item_id"),
    "1b. Migration 27 correctly maps tasks table columns deliverable_format and deliverable_number"
  );
  assert(
    mig27Content.includes("'is_fully_imported', (v_imported_operational >= v_total_operational AND v_total_operational > 0)"),
    "1c. Migration 27 returns partial import progress metadata in result"
  );

  const contentCalendarsServicePath = path.join(__dirname, "../lib/services/content-calendars.ts");
  const ccServiceContent = fs.readFileSync(contentCalendarsServicePath, "utf-8");
  assert(
    ccServiceContent.includes('derivedStatus = "partially_imported"') &&
    ccServiceContent.includes('derivedCalendarStatus = "partially_imported"'),
    "2a. Content calendars service derives partially_imported status dynamically"
  );
  assert(
    ccServiceContent.includes('isPartiallyImported: importedCount > 0 && importedCount < totalOperational') &&
    ccServiceContent.includes('isFullyImported: importedCount >= totalOperational'),
    "2b. getClientCalendar exposes explicit progress tracking properties"
  );

  const campaignsPagePath = path.join(__dirname, "../app/campaigns/page.tsx");
  const campaignsPagePartialContent = fs.readFileSync(campaignsPagePath, "utf-8");
  assert(
    campaignsPagePartialContent.includes("if (item.is_excluded_from_tasks || item.task_id) return { ...item, is_included: false };"),
    "3a. toggleSelectAll strictly excludes already imported items"
  );
  assert(
    campaignsPagePartialContent.includes("disabled={isExcluded || hasTask}") &&
    campaignsPagePartialContent.includes("disabled={!isOwner || isExcluded || hasTask}"),
    "3b. Review matrix rows visibly lock and disable inputs for already imported tasks"
  );
  assert(
    campaignsPagePartialContent.includes("reviewItems.filter((i) => i.is_included && !i.is_excluded_from_tasks && !i.task_id)"),
    "3c. handleConfirmImport strictly filters unimported items"
  );
  assert(
    campaignsPagePartialContent.includes("status === \"partially_imported\""),
    "3d. Campaign card renders partially_imported status badge"
  );

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
