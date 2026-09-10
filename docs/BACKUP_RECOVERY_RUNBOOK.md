# OMG Creative Workspace — Backup & Disaster Recovery Runbook
**Version:** 1.0.0  
**Effective Date:** September 2026  
**Target Environment:** Production (`omg-creative-workspace.vercel.app`)  
**Primary Database:** Supabase PostgreSQL (`whzkpuovqllybxlyoikk`)  

---

## 1. Overview & Operational Principles

This runbook establishes standard operating procedures for data protection, backups, emergency rollbacks, and disaster recovery for **OMG Creative Workspace**.

### Critical Constraints & Truths
1. **Zero Secret Exposure**: Database connection strings, service role keys, and Gemini API keys must never be committed to source control or logged in plaintext.
2. **Production Integrity**: Live clients (28 active accounts), roster members (Emad, Nada, Sarah, Alaa, Shahd, Aya), and confirmed tasks must never be deleted in batch without full snapshot backups.
3. **Invitations Guard**: The setting `workspaces.invitations_paused = true` is the default defensive posture whenever maintenance or upgrades are underway.

---

## 2. Backup Procedures

### 2.1 Automated Platform Backups
- **Supabase Automated Daily Backups**: Managed by Supabase infrastructure with WAL archiving and daily snapshot retention.
- **Vercel Deployment Snapshots**: Every Git push creates an immutable build deployment reachable via direct preview URL before promoting to production.

### 2.2 On-Demand Pre-Migration Operational Backup
Before executing any structural database migration (`supabase db push`) or high-impact batch data mutation:

```bash
# From workspace root:
node --env-file=.env.local -e "
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

async function snapshot() {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const tables = ['workspaces', 'roster_people', 'clients', 'campaigns', 'content_calendar_items', 'tasks', 'member_capacities', 'workspace_invitations'];
  const data = {};
  for (const t of tables) {
    const res = await s.from(t).select('*');
    data[t] = res.data || [];
  }
  const file = 'backups/backup_operational_' + Date.now() + '.json';
  if (!fs.existsSync('backups')) fs.mkdirSync('backups');
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log('Snapshot written to:', file);
}
snapshot();
"
```

---

## 3. Disaster Recovery Runbooks

### Scenario A: Accidental Task Overwrite or Calendar Corruption
**Symptoms:** Tasks altered by an unintended batch import or revision sync.
**Resolution Steps:**
1. Immediately verify that `workspaces.invitations_paused = true` to prevent concurrent team actions.
2. Locate the latest pre-migration operational snapshot in `backups/`.
3. Query audit events table `public.audit_events` to identify the timestamps and actor who performed the modification.
4. Extract the affected records from the JSON backup.
5. Upsert the original records back into `public.tasks` or `public.content_calendar_items` via administrative script.
6. Verify record counts via `/settings/system-health`.

### Scenario B: AI Processing Stuck in "Processing" State
**Symptoms:** A PDF campaign has status `processing` for more than 5 minutes due to serverless timeout or client disconnection.
**Resolution Steps:**
1. The durable queue table `public.ai_processing_jobs` automatically expires leases after 300 seconds (`lease_expires_at < now()`).
2. Any subsequent extraction request for the same file or campaign automatically recovers the expired lease via `acquire_ai_processing_job` RPC without manual SQL intervention.
3. If immediate manual release is needed:
```sql
UPDATE public.ai_processing_jobs
SET status = 'failed',
    safe_error_message = 'Job cancelled by Owner during maintenance',
    updated_at = now()
WHERE status = 'processing' AND lease_expires_at < now();
```

### Scenario C: Production Migration Rollback
**Symptoms:** A new database migration caused application-level errors.
**Resolution Steps:**
1. Check Vercel build logs to identify the failing query or schema mismatch.
2. Revert the commit in Git or redeploy the previous stable Vercel deployment from the Vercel Dashboard (Instant Rollback).
3. If a table or column needs rollback in PostgreSQL, prepare a compensating migration (e.g. `20260910000013_rollback_xyz.sql`) and push via:
```bash
npx supabase db push
```

---

## 4. Verification Checklist Post-Recovery
- [ ] Database connection: `GET /api/diagnostics` returns status `connected`.
- [ ] Invitations guard: `workspaces.invitations_paused` is confirmed true.
- [ ] Gemini AI: `GET /api/ai/jobs` returns configured models and zero rate-limit blocks.
- [ ] Roster & Clients: 28 clients and 6 roster people verified.
- [ ] Tasks intact: All existing tasks visible in `/tasks`.
