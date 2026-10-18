-- =============================================================================
-- Migration 45: Fix Remaining Roster Delete Foreign Keys (Audit, Idempotency, Briefs, Campaigns, Tasks)
-- Ensures admin_hard_delete_roster_member and roster cleanup never fail with
-- composite FK (workspace_id, actor_id) ON DELETE RESTRICT violations when a
-- member has historical audit_events, rpc_idempotency_records, campaigns, or briefs.
-- =============================================================================

BEGIN;

-- 1. audit_events: preserve audit trail and nullify actor_id when a roster person is hard-deleted
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS fk_audit_actor;
ALTER TABLE public.audit_events ADD CONSTRAINT fk_audit_actor
    FOREIGN KEY (actor_id)
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

-- 2. rpc_idempotency_records: cascade delete idempotency cache records when actor is hard-deleted
ALTER TABLE public.rpc_idempotency_records DROP CONSTRAINT IF EXISTS fk_idempotency_actor;
ALTER TABLE public.rpc_idempotency_records ADD CONSTRAINT fk_idempotency_actor
    FOREIGN KEY (actor_id)
    REFERENCES public.roster_people(id) ON DELETE CASCADE;

-- 3. campaigns: nullify created_by_id / uploader_roster_id / approved_by_roster_id on roster hard-delete
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS fk_campaign_created_by;
ALTER TABLE public.campaigns ADD CONSTRAINT fk_campaign_created_by
    FOREIGN KEY (created_by_id)
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_uploader_roster_id_fkey;
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS fk_campaign_uploader;
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'uploader_roster_id'
    ) THEN
        ALTER TABLE public.campaigns ADD CONSTRAINT fk_campaign_uploader
            FOREIGN KEY (uploader_roster_id)
            REFERENCES public.roster_people(id) ON DELETE SET NULL;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'approved_by_roster_id'
    ) THEN
        ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_approved_by_roster_id_fkey;
        ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS fk_campaign_approved_by;
        ALTER TABLE public.campaigns ADD CONSTRAINT fk_campaign_approved_by
            FOREIGN KEY (approved_by_roster_id)
            REFERENCES public.roster_people(id) ON DELETE SET NULL;
    END IF;
END;
$$;

-- 4. tasks: ensure created_by_id and waiting_on_roster_id use single-column ON DELETE SET NULL
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_task_created_by;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_created_by_id_fkey;
ALTER TABLE public.tasks ADD CONSTRAINT fk_task_created_by
    FOREIGN KEY (created_by_id)
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'waiting_on_roster_id'
    ) THEN
        ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_waiting_on_roster_id_fkey;
        ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_task_waiting_on_roster;
        ALTER TABLE public.tasks ADD CONSTRAINT fk_task_waiting_on_roster
            FOREIGN KEY (waiting_on_roster_id)
            REFERENCES public.roster_people(id) ON DELETE SET NULL;
    END IF;
END;
$$;

-- 5. client_briefs: ensure approved_by_roster_id and operational_review_by use ON DELETE SET NULL
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'client_briefs' AND column_name = 'approved_by_roster_id'
    ) THEN
        ALTER TABLE public.client_briefs DROP CONSTRAINT IF EXISTS client_briefs_approved_by_roster_id_fkey;
        ALTER TABLE public.client_briefs DROP CONSTRAINT IF EXISTS fk_brief_approved_by;
        ALTER TABLE public.client_briefs ADD CONSTRAINT fk_brief_approved_by
            FOREIGN KEY (approved_by_roster_id)
            REFERENCES public.roster_people(id) ON DELETE SET NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'client_briefs' AND column_name = 'operational_review_by'
    ) THEN
        ALTER TABLE public.client_briefs DROP CONSTRAINT IF EXISTS client_briefs_operational_review_by_fkey;
        ALTER TABLE public.client_briefs DROP CONSTRAINT IF EXISTS fk_brief_operational_review_by;
        ALTER TABLE public.client_briefs ADD CONSTRAINT fk_brief_operational_review_by
            FOREIGN KEY (operational_review_by)
            REFERENCES public.roster_people(id) ON DELETE SET NULL;
    END IF;
END;
$$;

-- 6. time_change_requests: allow requested_by_id / reviewed_by_id to be nullified on hard delete
ALTER TABLE public.time_change_requests ALTER COLUMN requested_by_id DROP NOT NULL;
ALTER TABLE public.time_change_requests DROP CONSTRAINT IF EXISTS fk_tcr_requester;
ALTER TABLE public.time_change_requests ADD CONSTRAINT fk_tcr_requester
    FOREIGN KEY (requested_by_id)
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

ALTER TABLE public.time_change_requests DROP CONSTRAINT IF EXISTS fk_tcr_reviewer;
ALTER TABLE public.time_change_requests ADD CONSTRAINT fk_tcr_reviewer
    FOREIGN KEY (reviewed_by_id)
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

-- 7. content_calendar_items: allow suggested_assignee_id / approved_assignee_id to be nullified on hard delete
ALTER TABLE public.content_calendar_items DROP CONSTRAINT IF EXISTS content_calendar_items_suggested_assignee_id_fkey;
ALTER TABLE public.content_calendar_items DROP CONSTRAINT IF EXISTS fk_cci_suggested_assignee;
ALTER TABLE public.content_calendar_items ADD CONSTRAINT fk_cci_suggested_assignee
    FOREIGN KEY (suggested_assignee_id)
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

ALTER TABLE public.content_calendar_items DROP CONSTRAINT IF EXISTS content_calendar_items_approved_assignee_id_fkey;
ALTER TABLE public.content_calendar_items DROP CONSTRAINT IF EXISTS fk_cci_approved_assignee;
ALTER TABLE public.content_calendar_items ADD CONSTRAINT fk_cci_approved_assignee
    FOREIGN KEY (approved_assignee_id)
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

COMMIT;
