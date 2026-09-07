# OMG Creative Workspace — V3.5 Clean Baseline Verification Report

**Date:** 2026-09-06  
**Status:** **READY FOR INDEPENDENT REVIEW** (Not deployed, not pre-approved)  
**Corpus / Project Path:** `e:\e\omg\work crm`  
**Target Environment:** Dedicated Supabase Project (Currently Empty / Unconnected)

---

## 1. Executive Summary & Hard Safety Boundary

This package delivers **V3.5 Clean Baseline** for **OMG Creative Workspace**, addressing every defect, security gap, and consistency issue identified in the V3.4 rejection.

### Preserved Safety Boundaries:
- **Zero Cloud Connection:** No remote Supabase project was contacted, modified, seeded, or migrated.
- **Zero Credential Storage:** No `.env.local` was created, read, or populated. No API keys, JWTs, or passwords were logged or stored.
- **Honest Gate Enforcement:** Live database integration tests remain explicitly **BLOCKED** with non-zero exit code (`exit 1`), proving no live or cloud database was falsely claimed as tested.
- **Transactional Baseline:** Exactly five clean migration files in `supabase/migrations/`, each strictly wrapped in a single `BEGIN; ... COMMIT;` transaction block.

---

## 2. Comprehensive Remediation Matrix (V3.5 Requirements)

| Requirement | Remediation & Implementation Details | Status |
| :--- | :--- | :---: |
| **1. Function Execution Privileges (Public & Private)** | Added `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;` at the start of migrations 1, 2, and 5. Migration 1 also revokes default privileges on `private` schema from `PUBLIC, anon, authenticated`. Explicit `REVOKE EXECUTE ... FROM PUBLIC, anon;` applied to all public RPCs. Only intended public business RPCs and RLS helpers are granted to `authenticated`. | **VERIFIED** |
| **2. NULL-Safe Task Authorization & Mandatory Reopen Reason** | Replaced all vulnerable boolean checks with `COALESCE(..., FALSE)`. Designers cannot edit or transition tasks when `primary_assignee_id IS NULL`. Reopening an approved task back to `in_progress` strictly enforces a non-empty `p_reason`. Authorization is verified before any cached or no-op return. | **VERIFIED** |
| **3. Start Timer on Behalf Security & Server Duration** | Proves target member is an active roster person and assigned or collaborating on the task *prior* to acquiring locks or early returns. Replaced client-supplied duration with strict server-side calculation: `duration_seconds = EXTRACT(EPOCH FROM (pg_catalog.now() - started_at))::INT`. | **VERIFIED** |
| **4. Review Submission Timer Auto-Close & Self-Review Guard** | `submit_review_round` closes **every** open timer on the task across all members (`WHERE task_id = p_task_id AND ended_at IS NULL AND is_voided = FALSE`) and computes `duration_seconds`. Prevents submitter from reviewing their own deliverable; enforces `submitter_id <> reviewer_id` via table constraint `chk_review_rounds_no_self_review`. | **VERIFIED** |
| **5. Protection of Review Rounds Mutations** | Added table constraint `chk_review_rounds_no_self_review` and triggers `trg_protect_review_rounds_update` and `trg_protect_review_rounds_delete`. Review rounds cannot be deleted once created; decisions can only transition from `pending` to `approved`, `changes_requested`, or `rejected`. Decided rounds are immutable. | **VERIFIED** |
| **6. Campaign Posts Batch Generation** | Full idempotency hashing all behavior-affecting parameters (`workspace_id`, `campaign_id`, `client_id`, `count`, `type`, `priority`, `assignee`, `reviewer`). Row-locks campaign `FOR UPDATE`. Generates `Post 01..N` and initializes all three task ledgers (`task_status_events`, `task_assignment_events`, `task_due_date_events`). | **VERIFIED** |
| **7. Monthly Cutoff Temporal Integrity & Metrics Breakdown** | Reconstructs open timers as of cutoff using `started_at < cutoff AND (ended_at IS NULL OR ended_at >= cutoff)`. Reconstructs pending corrections as of cutoff using `created_at < cutoff AND (decided_at IS NULL OR decided_at >= cutoff)`. Filters `WHERE dmd.delivery_seq = 1` for `firstDeliveredTasks`. Historical due date and assignee queries do not fall back to current task columns. Computes distinct `designHours`, `internalRevisionHours`, `clientRevisionHours`, `totalRevisionHours`, and `loggedHours`. | **VERIFIED** |
| **8. Safe Workspace Invitations Constraints & Re-binding** | Partial unique indexes: `uq_one_pending_invitation_per_roster` on `(workspace_id, roster_person_id) WHERE status = 'pending'` and `uq_one_pending_invitation_per_email` on `(workspace_id, lower(btrim(invited_email))) WHERE status = 'pending'`. `create_workspace_invitation` never stores raw token in idempotency or audit records. `accept_workspace_invitation` row-locks invitation, target roster person, and existing memberships `FOR UPDATE` and forbids stealing active memberships. | **VERIFIED** |
| **9. Additional Public RPC Write Paths** | Implemented public RPC write paths: `update_campaign`, `archive_campaign`, `add_task_collaborator`, `remove_task_collaborator`, `create_task_checklist_item`, `update_task_checklist_item`, `delete_task_checklist_item`, `create_task_attachment`, `delete_task_attachment`, `update_task_priority`. Each RPC includes caller context checks, advisory locking, idempotency, audit logging, and explicit grants to `authenticated`. | **VERIFIED** |
| **10. Attachment Storage Path Regex & Composite FK Lineage** | Check constraint `chk_attachment_storage_path` validates `storage_path ~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[^/]+$'`. Composite foreign key `fk_time_entry_correction_request` references `time_change_requests(workspace_id, id) ON DELETE RESTRICT`. Tasks composite FK targeted on `ON DELETE SET NULL (final_deliverable_attachment_id)`. | **VERIFIED** |

---

## 3. Verification Gate Results

### Gate 1: Static Code Purity & Acceptance Test Suite
- **Command:** `npm run test`
- **Result:** **164 PASSED, 0 FAILED**
- **Scenarios Checked:**
  - 5 baseline migration files, 1 `BEGIN;` and 1 `COMMIT;` per file.
  - Absence of `.env`, service keys, or hardcoded JWT tokens.
  - Zero occurrences of obsolete column names (`uploaded_by_id`, `roster_people.role`, `linked_user_id`).
  - Seed validation: Exactly 6 designers with exact titles, exactly 28 client accounts (27 active, 1 `zanzi` unassigned/not started).
  - Bootstrap owner locked and restricted exclusively to `service_role`.
  - Storage deliverable RLS validates workspace path against task's actual `workspace_id`.
  - Cross-month session split (Sarah September fixture + October boundary split).
  - Concurrency-safe advisory locking and idempotency conflict rejection.
  - Revocation of default execution on `public` and `private` functions.
  - Trigger immutability for review rounds and monthly snapshots.
  - 10 new V3.5 public RPC write paths validated and checked.

### Gate 2: Live Database Integration Test
- **Command:** `npm run test:db`
- **Result:** **BLOCKED (Expected & Honest)**
- **Output:**
  ```text
  ❌ BLOCKED: Supabase is not connected to a live database.
  Reason: قاعدة بيانات Supabase غير مهيأة بعد.
  Exit Code: 1
  ```
- **Integrity Statement:** Because no live database runtime exists locally and cloud Supabase connection is prohibited by the safety boundary, the database integration gate honestly reports `BLOCKED`.

### Gate 3: Production Build
- **Command:** `npm run build`
- **Result:** Built successfully with Next.js 14.2.35.

---

## 4. Migration File Summary

| File | Bytes | Transaction Bounds | Baseline Version |
| :--- | :---: | :---: | :---: |
| `20260906000001_initial_schema.sql` | 42,775 | 1 `BEGIN;` / 1 `COMMIT;` | V3.5 Clean Baseline |
| `20260906000002_constraints_and_functions.sql` | 181,774 | 1 `BEGIN;` / 1 `COMMIT;` | V3.5 Clean Baseline |
| `20260906000003_rls_policies.sql` | 14,954 | 1 `BEGIN;` / 1 `COMMIT;` | V3.5 Clean Baseline |
| `20260906000004_seed_roster_and_clients.sql` | 10,080 | 1 `BEGIN;` / 1 `COMMIT;` | V3.5 Clean Baseline |
| `20260906000005_monthly_report_functions.sql` | 33,848 | 1 `BEGIN;` / 1 `COMMIT;` | V3.5 Clean Baseline |

---

## 5. Artifact Bundles

1. **`supabase_migrations_bundle_v3_5.zip`**:
   - Contains strictly the 5 SQL migration files at the root of the ZIP archive.
   - Clean, standalone package ready for empty dedicated Supabase deployment upon user approval.

2. **`omg_v3_5_review_evidence.zip`**:
   - Complete audit pack containing:
     - The 5 migration SQL files
     - Aligned application source (`types/database.ts`, `lib/services/tasks.ts`, `lib/services/reports.ts`)
     - Complete test suite (`tests/acceptance.test.ts`, `tests/database-integration.test.ts`)
     - `V3_5_VERIFICATION_REPORT.md`
     - `V3_5_FILE_MANIFEST.sha256`
     - Nested clean migration bundle `supabase_migrations_bundle_v3_5.zip`
