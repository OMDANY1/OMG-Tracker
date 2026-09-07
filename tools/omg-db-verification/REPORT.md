# OMG database repair R1 — evidence and scope

Source: the supplied `supabase_migrations_bundle_v3_5.zip`.

Result: five repaired migrations committed and **39 SQL behavior scenarios passed, zero failed**, under PostgreSQL 18.3 / PGlite 0.5.8. This is a local integration result for the tested SQL paths. It is not a complete application or hosted Supabase verification.

## Why the loop happened

The V3.5 report explicitly acknowledged an unconnected cloud backend. Its claim that every repair was verified nevertheless contradicted the shipped SQL. Therefore the evidence supports a missing SQL execution gate and contract drift, not a proven belief that the cloud database was connected. Repeated broad rewrite requests amplified the problem. This repair executes SQL directly and supplies a reproducible gate.

The original initial migration was executed with minimal Supabase prerequisites and failed with PostgreSQL error `42830`: no unique constraint matching the referenced keys in `time_change_requests`. See `evidence/original-failure.log`. Original source files were not altered.

## Concrete changes

1. Added the required unique `(workspace_id,id)` key for the correction-request composite foreign key; made extensions-schema creation explicit.
2. Removed malformed literal `... COMMIT;` and pre-transaction statements from migration 02. All five migrations have a real top-level transaction.
3. Replaced conflicting GRANT declarations with one set generated from the actual function declarations. Revoked inherited default/explicit execution and table privileges before granting the deliberate API, including under permissive authenticated defaults.
4. Corrected the reviewer resolver call to pass a designer UUID, not a review-type enum.
5. Removed nonexistent `rejected` from review-decision validation and nonexistent `design` from the time-category calculation (`initial_design` is canonical).
6. Closed the NULL-assignee content-edit authorization hole and the content-edit route around manager-only task priority changes.
7. Protected review identity/content during pending-to-decided updates, enforced valid decision timestamps, and rejected null review/correction decisions explicitly.
8. Closed active timers when general task transitions leave active work. Review submission continues to close all task timers. Reopen reason/timestamp now cover the permitted cancelled-to-backlog/ready transitions.
9. Serialized workspace mutations with the workspace row lock to use one lock order across task, time, review, invitation and snapshot mutations. This is a deliberate correctness-first choice for a six-person workspace. Genuine simultaneous independent connections were not tested by PGlite.
10. Implemented previously ignored supplied idempotency keys in 11 mutation RPCs; hashes now include all supplied behavior parameters. Preserved optional-null defaults for existing application compatibility, rejected blank supplied keys, and kept invitation creation's existing mandatory-key contract.
11. Moved invitation replay before state checks invalidated by its first success; retained raw-token-once responses and safe cached responses. Existing inactive membership selection is now deterministic and favors active/same-user mappings.
12. Made checklist/attachment deletion retryable after the resource disappears, rechecking current identity/task access. Added missing update audit events and explicit workspace mismatch checks. Selected final-deliverable metadata deletion is rejected.
13. Added private Storage bucket definitions, strengthened attachment workspace/task path checks, rejected empty parser filenames, and aligned metadata/checklist write permission with task work access.
14. Prevented report duplication from inactive historical memberships, corrected first-delivery time categories, and stored the snapshot's own metadata/commentary. The hash now covers the complete stored snapshot JSON, including finalization time and commentary.
15. Retained the original 28-client allocation, six designers plus separate Owner, and unconfigured capacities. No test sessions or fake Auth identities enter the migrations.

## Executed gates

| Gate | Result | Evidence |
|---|---|---|
| Original SQL execution | FAILED as expected | `evidence/original-failure.log`, SQLSTATE 42830 |
| Repaired migrations 01 through 05 | PASSED | COMMITTED lines in `evidence/test-results.log` |
| SQL workflow / authorization / reporting scenarios | 39 PASSED, 0 FAILED | `verification/test.mjs` and complete log |
| Catalog RPC signatures and privileges | EXPORTED from executed SQL | `RPC_CONTRACT.json` |
| Application build / actual service-call compatibility | NOT RUN: source not supplied | Handed off as a bounded alignment task |
| Supabase Auth, PostgREST and Storage HTTP | NOT RUN | No cloud connection or service credentials used |
| Multi-session concurrent transaction behavior | NOT RUN | PGlite uses a single local database connection |
| Connected browser and deployment | NOT RUN | Outside this SQL repair and no app source available |

The runtime uses real Postgres SQL, enums, constraints, roles, RLS and PL/pgSQL. Minimal local `auth.users`, `auth.uid()`, `storage.buckets`, and `storage.objects` test fixtures supply service prerequisites. They are **not** a running Supabase Auth or Storage service. A SQL policy test is not a signed-URL/upload/API/browser integration test. See the [official PGlite description](https://pglite.dev/docs/about).

## Commands and reproduction

From `verification/`:

```sh
npm ci --ignore-scripts
npm test
npm run catalog
```

The test executes the SQL files from disk verbatim; it does not replace migration fragments with stubs. The original failing package is documented in evidence, not offered as a second deployment candidate. The test deliberately uses administrative fixtures for future month-boundary examples; user-facing time RPCs still reject future time.

## Limits and the next gate

This is a targeted repair of demonstrated defects and affected paths, not a claim that every possible SQL/UI workflow has been audited. For example, one-time invitation acceptance rejects replay, and nullable optional fields generally preserve the existing COALESCE update behavior. The application must use the published contract and surface those semantics.

The Windows application source was not provided, so no claim is made about its TypeScript types, API routes, UI behavior, exports, or build. Do not infer cloud readiness solely from the local SQL result. Next, align the real application with the repaired contract and run its existing build/tests. Hosted Auth/Storage/PostgREST, real concurrent sessions, and a connected browser are a later integration gate on the dedicated project.

When implementing file removal, coordinate actual object deletion and metadata cleanup; metadata deletion alone does not delete a stored blob. Supabase bucket configuration and hosted object ownership/policies must be checked during Storage integration. Preserve finalized report content rather than rebuilding it on read.

No cloud database was connected or modified; no production migration was applied; no deployment, Git push, or credentials file was created by this repair.
