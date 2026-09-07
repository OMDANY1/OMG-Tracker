# OMG Creative Workspace — Antigravity Build Prompt

انسخ البرومبت بالكامل إلى Antigravity داخل مشروع جديد. المطلوب تطبيق يعمل بقاعدة بيانات حقيقية، وليس مجرد تصميم للواجهات.

---

You are the lead product engineer, UX designer, and QA engineer implementing **OMG Creative Workspace** for an advertising agency. Build the working application described below, connect its persistent data layer, validate its critical workflows, and provide a preview with clear setup instructions. Do not stop at a plan, scaffold, or static dashboard.

## 1. Product goal

One internal workspace to manage six designers, 28 client accounts, campaigns, individual design tasks, explicit work sessions, reviews, and monthly management reports.

The owner must be able to answer:

- Who owns each client and task?
- Which campaign and deliverable is each designer working on?
- When did work start and stop, and how much active time was logged?
- What is assigned, due, overdue, blocked, under review, or delivered?
- How much effort went into each client, campaign, task, designer, and revision category this month?
- Which accounts need redistribution based on measured work and available capacity?

Concrete acceptance example: Sarah opens Wael Samir → a campaign → “Post 01”, records a session from 11:00 to 12:00 on Sunday, 6 September 2026 in Africa/Cairo. The owner can see the designer, client, campaign, task, date, start, end, and **60 minutes** in the activity view, task details, and the September report. This is a test example, not real historical agency work. Include it only in an isolated test/demo environment.

## 2. Implementation approach

- If the working directory already contains a project, inspect it and its instructions before making changes. Preserve unrelated functionality and user files.
- For a new project use Next.js App Router, TypeScript, Tailwind CSS, accessible reusable UI components, and Supabase for PostgreSQL, Auth, and private file storage. Use compatible stable dependencies, a lockfile, and official documentation as needed. Avoid experimental dependencies.
- Use a normal deployment flow compatible with Vercel. Do not introduce another backend platform without a concrete need.
- One agency workspace initially, with workspace_id on business records and membership-aware authorization. This is not a commercial multi-tenant SaaS MVP: do not add billing or subscriptions.
- Arabic-first interface with correct RTL, Arabic labels, readable English client names, and Africa/Cairo as the default editable workspace timezone.
- Responsive and practical on mobile. Owners use a full dashboard; designers primarily use “My Work” and the task timer.
- Financial billing, payroll, screenshots of employees, keystroke monitoring, background surveillance, and automatic productivity scores are out of scope.
- Real persistence is mandatory. Local storage may store harmless UI preferences, never the authoritative tasks or time ledger.

## 3. Required navigation and UX

Create the following sections:

1. **نظرة عامة** — owner/manager dashboard.
2. **شغلي** — personal assigned tasks, deadlines, and current timer.
3. **التاسكات** — shared task board and table with creation, assignment, filters, and bulk actions.
4. **العملاء** — account ownership, difficulty, extra workload, active status, and campaigns.
5. **الكامبينز** — campaign scope, tasks, progress, assets, and dates.
6. **سجل الشغل** — searchable time entries, manual sessions, and corrections.
7. **التيم** — membership, roles, capacity settings, account distribution, and measured workload.
8. **التقارير الشهرية** — month selection, analysis, exports, and finalized snapshots.
9. **الإعدادات** — timezone, workweek, availability, labels, and account configuration.

Use a clean premium internal-tool design with off-white surfaces, restrained navy/teal accents, clear typography, calm status colors, and generous readable spacing. Display relevant actions progressively; do not show every control at once. On mobile use compact task cards and an accessible task detail sheet/page; reserve wide tables for desktop and exports. Do not leave essential actions available only on hover or drag-and-drop.

Always implement loading, empty, validation, permission-denied, disconnected, and retry states. Never show fake success if the server rejected a write. Do not display invented charts or fabricated agency statistics to fill empty states.

## 4. People and permissions

Create six roster records using these display names, without inventing their email addresses or creating fake authenticated accounts:

| Display name | Job title | Intended application role |
|---|---|---|
| ندى | Senior Graphic Designer | Senior reviewer + designer |
| عماد | Art Director | Manager + reviewer + designer |
| سارة | Midlevel Graphic Designer | Designer |
| آلاء | Midlevel Graphic Designer | Designer |
| شهد | Midlevel Graphic Designer | Designer |
| آية | Junior Graphic Designer | Designer |

The user is the workspace owner, separate from these six people. Keep job title separate from application permissions. Allow roster records to be linked to real users through an owner-controlled invitation process once actual emails are supplied. Unlinked roster records can own planned tasks but cannot log in. An owner may enter work on behalf of someone else only through an explicit labeled action with actor/subject auditing.

Role rules:

- Owner: manage membership, settings, all clients/campaigns/tasks, review, reports, approved corrections, and snapshots.
- Manager (Emad): manage team work and assignments, review creative work, and view team activity/reports. No ownership transfer or privilege escalation.
- Senior reviewer (Nada): manage her own work and review explicitly routed tasks, including Aya’s work. This does not grant unrestricted organization administration or all private personnel activity.
- Designer: view assigned clients/campaign context, own tasks, required collaborators' task context, and own time entries; upload work, comment, change permitted task states, and submit for review. No arbitrary reassignment, self-approval, editing others’ time, or organization-wide exports.
- Keep collaborator access explicit. A review assignment grants only the context necessary to review the task, not blanket access to the team’s time ledger.

Enforce permissions on the server and with Supabase RLS, including storage objects. Hiding buttons is insufficient. Test both permitted access and denied access through direct requests.

## 5. Client allocation — seed exactly

Seed these 28 accounts idempotently. Do not rename or silently redistribute them.

| Client | Owner | Difficulty | Extra workload | State |
|---|---|---|---|---|
| masar | ندى | Hard | None | Active |
| ghada el otaby | ندى | Hard | None | Active |
| hmd | ندى | Medium | None | Active |
| dullys | ندى | Medium | None | Active |
| mona taha | ندى | Easy | None | Active |
| karma | عماد | Hard | None | Active |
| solution max | عماد | Medium | None | Active |
| dr reham | عماد | Easy | None | Active |
| dr khalaf | سارة | Hard | None | Active |
| wael samir | سارة | Medium | None | Active |
| dalia | سارة | Medium | None | Active |
| dr nora | سارة | Medium | None | Active |
| faten | سارة | Easy | None | Active |
| travia care | آلاء | Medium | Many requests | Active |
| naama inn | آلاء | Medium | None | Active |
| weqaya | آلاء | Medium | None | Active |
| hadia | آلاء | Medium | None | Active |
| kishk | آلاء | Easy | None | Active |
| nasef | شهد | Medium | Many revisions | Active |
| al nemr | شهد | Medium | None | Active |
| el rahman | شهد | Medium | None | Active |
| shalabya | شهد | Medium | None | Active |
| kalido | شهد | Medium | None | Active |
| rejuva | آية | Easy | None | Active |
| ibn sina | آية | Easy | None | Active |
| kuwaity | آية | Easy | None | Active |
| al farid | آية | Easy | None | Active |
| zanzi | Unassigned | Unknown | Unknown | Not started |

Seed checks: 27 active accounts; 8 easy, 15 medium, 4 hard; one not-started account; active ownership counts Nada 5, Emad 3, Sarah 5, Alaa 5, Shahd 5, Aya 4.

Client record fields: name, owner, difficulty, request/revision workload flag, state, notes, brief/brand-guide links, archived_at. Account ownership is the default for newly created tasks; changing it must not silently reassign existing tasks or rewrite historical logs. Offer a separately confirmed bulk reassignment of selected open tasks with a reviewable list.

## 6. Data model and persistence

Provide SQL migrations, indexes, constraints, RLS policies, storage rules, and idempotent seeds. Use UUIDs, created_at, updated_at, and actor fields where appropriate. Separate live mutable records from immutable historical report snapshots.

Suggested entities:

- workspaces, workspace_settings, memberships, roster_people, invitations
- clients, campaigns
- tasks, task_collaborators, task_checklist_items
- review_rounds, task_status_events, assignment_events
- time_entries, time_entry_adjustments, time_change_requests
- comments, attachments
- availability_overrides / leave_days and member_capacity_settings
- in_app_notifications
- monthly_report_snapshots, audit_events

Campaign belongs to one client. Task belongs to one campaign and inherits its client; avoid contradictory duplicated client references. Exports and queries must preserve that relationship.

Task fields: stable ID, title, brief, campaign, primary assignee, optional collaborators, reviewer, deliverable type, deliverable number, priority, status, due_at, estimated_minutes (optional), completion checklist, working-file/reference links, final deliverable link, block reason, created_by, archived_at. Use normalized statuses and enums with Arabic display labels.

A task can have multiple work sessions and revisions. Keep who actually logged a session separate from the current assignee. Reassigning a task must not transfer another person’s historical hours.

## 7. Campaigns and task distribution

Campaign fields: title, client, objective, brief, start date, due date, campaign status, planned deliverables, and reference/asset links.

Allow an owner or manager to create a campaign and generate tasks from a previewable batch such as “Post 01 … Post 12”, selecting deliverable type, default assignee, reviewer, and due dates. Generated drafts remain editable before saving. Do not invent campaign content.

Task creation defaults to the client owner but can be explicitly overridden. Provide bulk assign, reviewer, priority, and due-date changes with a preview and confirmation of selected records.

Views: Kanban, filterable/sortable table, and personal task list. Filters: person, client, campaign, status, reviewer, due period, priority, blocked, and overdue. Save personal filter preferences.

Task statuses:

- Backlog / قائمة الانتظار
- Ready / جاهز للتنفيذ
- In progress / قيد التنفيذ
- Internal review / مراجعة داخلية
- Changes requested / مطلوب تعديل
- Client review / مراجعة العميل
- Approved / معتمد
- Delivered / تم التسليم
- Blocked / متوقف بسبب عائق
- Cancelled / ملغي

Implement explicit transitions and status-event history. Require a reason when blocking, cancelling, reopening, or requesting revisions. Reviewers approve internal review; designers cannot approve their own tasks. Owner/manager records client approval and final delivery. A valid final deliverable link or attachment is required before Delivered. Reopened work retains prior delivery/review events.

Starting a timer must never bypass approval rules or silently move a task from a review/approved state. Prompt for the appropriate permitted transition or work category when necessary. For tasks leaving an active work state, handle any open timer explicitly.

## 8. Time tracking — primary feature

Each task supports Start, Pause, Resume, Stop, plus a manual “Add work session” action. Each active interval is its own time entry; pause closes the interval and resume creates a new one. Waiting and breaks must not count as active work.

Each time entry stores task_id, person_id, started_at, ended_at, category, note, entry_source (timer/manual/on-behalf), created_by, correction metadata, and optional review_round_id. Duration is derived from timestamps rather than independently editable totals.

Work categories: research/references, initial design, internal revision, client revision, final preparation/export. Labels must make these understandable in Arabic.

Requirements:

- Server-authoritative timestamps for timer actions; store UTC timestamptz. Convert local manual input using the selected IANA workspace timezone and handle ambiguous/nonexistent local times explicitly.
- One open timer per person enforced transactionally in the database, not just in the UI. Include a partial unique index and conflict handling for simultaneous tabs/devices.
- Starting a new task while a timer is running offers to stop the existing timer and switch, or cancel. The switch is atomic.
- Prevent overlapping non-voided sessions for the same person, including concurrent manual edits and open intervals. Validate end > start and disallow future completed sessions. Enforce database integrity, not only browser checks.
- Closing the browser does not erase or silently stop a timer. On return retrieve the actual open session; show a clear running indicator and recovery/edit flow. Warn about unusually long sessions using a visible configurable threshold, but do not fabricate or auto-deduct time.
- Do not implement offline elapsed time as an authoritative new record. Show reconnection status, reconcile with the server, and use idempotency keys so retries/double-clicks cannot duplicate starts or stops.
- Designers can add their own manual sessions with notes. Once submitted, corrections to recorded sessions require a reason and an owner/manager approval workflow. Preserve the original, proposed correction, decision, reviewer, and timestamps. Owners/managers’ direct corrections are also audited and reasoned.
- No silent destructive deletion of time. Void erroneous entries with a reason and exclude them from totals while retaining auditability.
- A working session measures recorded active time, not proof of output quality or attention. Do not infer productivity from time alone.

Time ledger columns: date, person, client, campaign, task/deliverable number, local start, local end, duration, category, source, review/correction state, notes. Support day/week/month/custom ranges, filtering, drill-down, and CSV export with the timezone labeled.

## 9. Review routing

- Aya’s tasks default to Nada for internal review.
- Hard-client tasks default to Emad for direction/first-design review and major revisions. Allow a manager to select another authorized reviewer; if Emad is also the assignee, route approval to the owner to avoid self-approval.
- Other tasks require an explicit reviewer or configurable owner/manager default. Do not permanently assume that all tasks need two layers of review.
- Review submission includes the working preview/link and a note. Reviewer can approve or request changes, with actionable feedback.
- Persist each review round separately. Differentiate internal revisions, client revisions, and additional/out-of-scope requests; log time in the appropriate category. Do not call every file version a client revision.
- Show reviewer queues and waiting time separately from design time.
- In-app notifications for assignments, due changes, review requests, feedback, and mentions. Do not send outbound email or messages to real people during development or testing. Actual invitations are sent only through an owner-triggered action with a recipient preview.

## 10. Dashboards and workload

Owner dashboard:

- Assigned open tasks, in progress, awaiting internal review, awaiting client review, blocked, overdue, and tasks delivered in the selected period.
- “Logged work today” grouped by person with task and elapsed/closed-session time. Use “timer running” rather than claiming the person is online or actively working.
- Upcoming due dates, review queue, and blockers with drill-down.
- Current client allocation and difficulty composition.
- Actual recorded hours by client/person/campaign, with revision hours separately visible.

Designer home:

- Today’s priorities, upcoming deadlines, tasks requiring changes, quick timer controls, current running task, and own weekly logged sessions.

Capacity:

- Configure each person’s workweek, available hours, leave/overrides, and reserved review/management time. Do not assume everyone has equal production capacity; Emad manages/reviews and Nada reviews Aya.
- Until configured show “Capacity not configured”, not fabricated overload percentages.
- Let managers enter remaining estimates for open tasks. Planned load ratio = sum of explicitly estimated remaining task time assigned to the selected period / configured production capacity for that period. Clearly label this as planned load and show missing estimates.
- Distinguish client count, task count, estimated remaining work, actual logged time, and capacity. Do not combine them into an arbitrary score or automatically rank designers by speed.
- Review the initial allocation after two weeks using measured delivery volume, revisions, logged hours, and management/review time. Provide redistribution tools, not automatic reassignment.

## 11. Monthly report workspace

Owner selects a local calendar month, for example September 2026. Show a draft report based on live records, editable management commentary, and an action list for next month. Allow the owner to finalize an immutable snapshot. Corrections later require a new labeled report revision; do not overwrite the prior snapshot.

Report sections:

1. Executive summary: deliveries, logged time, overdue/backlog at month-end, review bottlenecks, blocked work, and data completeness.
2. Per designer: tasks first delivered in the month, work sessions/hours in the month, revision hours, worked-on campaigns, and outstanding workload. Keep task-delivery ownership distinct from contributors’ logged hours.
3. Per client: delivered tasks, recorded hours, internal/client revision hours, revision rounds, request volume, and open tasks.
4. Per campaign: planned vs delivered tasks, due dates, recorded hours, and current/month-end state.
5. Timing: on-time delivery ratio, cycle time where available, review waiting time, and estimation variance only for tasks with estimates.
6. Management analysis: what went well, blockers, causes needing discussion, proposed redistribution, development/support needs, and next-month action items with owner/due date.
7. Audit notes: timezone, generation timestamp, definition version, pending corrections, running sessions, missing due dates/estimates/time logs, and coverage limits.

Metric definitions must be implemented and visible through help text or a report definitions page:

- Month = local calendar interval [month start, next month start), converted to UTC using the workspace timezone.
- Hours = sum of non-voided closed-session overlap with the reporting interval. Split sessions logically at period boundaries; never count an entire cross-month session in both months. Show running sessions separately as provisional and exclude them from finalized closed-session totals.
- Delivered tasks = unique tasks whose first Delivered event falls within the interval. Re-delivery after reopening is reported separately and is not another unique new deliverable. A task completed before the month can still contribute revision hours this month.
- Per-person delivered task attribution uses the assignee recorded at the first delivery event, not today’s mutable assignee. Actual hours belong to the person who logged them.
- Campaigns worked on = distinct campaigns with valid recorded work in the interval; it is not proof that the campaign was completed.
- On-time ratio = first deliveries by their due timestamp / deliveries with a due timestamp, using the due date recorded at delivery; include due-date change history so moving deadlines is visible. Missing due dates are excluded and disclosed. Zero denominator displays N/A.
- Overdue at month-end = tasks whose due date was before the reporting cutoff and which were not delivered/cancelled at that cutoff, reconstructed from status and due-date events. Current backlog is shown separately.
- Revision time is classified session time; review waiting time is elapsed status time and must not be added to worked hours.
- Ratios show their numerator/denominator. Use consistent rounding for display and precise underlying durations for sums.

Exports:

- A polished Arabic printable monthly report with working RTL and selectable text; support Save as PDF through a print layout or reliable server PDF generation.
- CSV exports for time entries, task events/deliveries, designer summaries, and client summaries, with UTF-8 BOM and spreadsheet-formula-injection protection.
- An “Export analysis pack” that downloads a ZIP containing those CSVs plus a Markdown report with metric definitions and management notes. The owner can upload this pack to ChatGPT for monthly collaborative analysis. Do not imply that ChatGPT is automatically connected to the system.
- Enforce authorization on report generation, exports, and private download routes. Final snapshots include underlying aggregates and source record/version identifiers so future live changes do not alter their figures.

## 12. Security, assets, and operational details

- No real credentials in code, Git, logs, screenshots, or client bundles. Provide .env.example with descriptive placeholders. Only the Supabase publishable browser key is public; service-role secrets remain server-side if used.
- Never reuse credentials from another agency project. Ask for a dedicated Supabase project/configuration if missing. Do not claim the backend is connected before checking real reads/writes.
- Authenticated, invite-only workspace membership. Bootstrap the owner through a one-time documented server-side process or explicit allowlisted identity. No “first random signup becomes owner” behavior, default passwords, or public admin registration.
- Use private asset storage with validated file type/size, authorized signed URLs, and workspace/task-scoped access. External design links must use safe URL schemes.
- Archive clients/campaigns/tasks with history rather than cascading away work logs. Block archive actions that would strand an active timer; guide the user to stop it first.
- Persist status/assignment/due-date events and correction history with actor attribution. Audit logs must not be editable by ordinary members.
- Use real pagination, appropriate indexes, server-side filtering, and loading feedback. Avoid fetching the whole ledger to every browser.
- Provide clear error messages, accessibility, keyboard-friendly controls, and mobile touch targets. Store timestamps and numeric durations as typed values, not formatted strings.
- Do not put real confidential files or agency activity in demo fixtures.

## 13. Delivery phases — implement, do not merely describe

Work in an order that produces functioning vertical slices:

1. Inspect project, document concise implementation plan, create schema/auth/membership/RLS and idempotent roster/client seed.
2. Build client → campaign → task creation/assignment and My Work with real CRUD.
3. Implement transactional timers, manual sessions, corrections, and activity ledger.
4. Implement review routing, status history, task views, and dashboards.
5. Implement monthly queries, report snapshots, exports, and capacity inputs.
6. Validate critical workflows, polish responsive RTL UI, and prepare deployment/setup documentation.

If external setup is missing, complete everything that can be implemented locally and state the exact remaining setup step. Do not disguise missing configuration with production-looking fake data. Do not request approval for routine implementation decisions. Do not send invitations, publish publicly, or modify unrelated production projects as an incidental development step.

## 14. Meaningful acceptance tests

Use a separate test environment/fixtures, not fabricated production activity. Add and run focused tests for these material risks:

- Seed rerun remains idempotent and the 28-account allocation reconciles to the given counts.
- Owner creates Wael Samir campaign and Post 01 assigned to Sarah; Sarah sees it after signing in.
- Sarah records 6 September 2026, 11:00–12:00 Africa/Cairo: ledger and September report show 60 minutes and the correct relationships.
- Two sessions separated by a break total only actual intervals; crossing midnight/month boundaries splits reporting time correctly.
- Concurrent timer starts from two tabs yield exactly one open session. Retry does not duplicate records.
- Manual overlaps, invalid times, unauthorized corrections, and future completed sessions are rejected server-side.
- Refresh and browser close/reopen recover the running timer from the server.
- Aya submits a task; Nada reviews it; Aya cannot approve her own work. Emad’s own hard-client task requires another authorized reviewer.
- A designer cannot read another member’s private ledger, alter another member’s time, change roles, or export all-team reports through direct API/storage requests.
- Changing account owner/task assignee does not rewrite historical session attribution or past delivery counts.
- Reopening/re-delivering does not double-count a new unique delivery. Zero denominators and tasks without due dates/estimates render correctly.
- Finalizing a monthly snapshot freezes it; subsequent corrections create a report revision and preserve the original.
- The analysis pack totals reconcile with the dashboard for the same timezone and interval; CSVs open correctly with Arabic text.
- The essential designer flow works at a 390px mobile width without horizontal page overflow; Arabic report print layout is legible and not clipped.

## 15. Final handoff

Deliver:

- Working source, SQL migrations, RLS/storage policies, and idempotent seed.
- .env.example, local run commands, and a plain-language Arabic README.
- A preview address and an honest statement of whether it is local/demo or connected to the dedicated real database.
- Simple click-by-click steps for owner bootstrap, linking/inviting the six real people, creating the first campaign, assigning tasks, tracking a session, and exporting a month.
- Deployment instructions for a private authenticated app; mark any setup that still needs real credentials or service configuration.
- Compact validation results identifying what passed and any actual blockers. Do not mark unrun tests as passed.

The finished experience should let the agency owner assign campaign deliverables, let designers record work explicitly, and produce auditable monthly reports from that same data. It must be a working operational tool, not a decorative dashboard.
