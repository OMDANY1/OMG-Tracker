-- =============================================================================
-- Migration 46: Fix review_rounds Immutability Trigger for Task Cascade Delete & Roster Hard-Delete,
-- and Drop Legacy Composite fk_task_assignee / fk_task_archived_by Constraints
-- =============================================================================

BEGIN;

-- 1. Drop legacy composite ON DELETE RESTRICT constraints on public.tasks that were named fk_task_assignee / fk_task_archived_by in Migration 01
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_task_assignee;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_task_primary_assignee;
ALTER TABLE public.tasks ADD CONSTRAINT fk_task_primary_assignee
    FOREIGN KEY (primary_assignee_id)
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_task_archived_by;
ALTER TABLE public.tasks ADD CONSTRAINT fk_task_archived_by
    FOREIGN KEY (archived_by_id)
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

-- 2. Update fn_protect_review_rounds_mutation so that:
--    (a) Cascade deletion when the parent task is deleted (or deletion by Owner/Company Owner/service_role) is permitted and returns OLD.
--    (b) Roster hard-delete decoupling (setting submitter_id/reviewer_id to NULL or snapshotting submitter_name_snapshot/reviewer_name_snapshot) is permitted without violating review decision immutability.
CREATE OR REPLACE FUNCTION public.fn_protect_review_rounds_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_jwt_role TEXT := COALESCE(
        current_setting('request.jwt.claim.role', true),
        (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
        ''
    );
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- Allow delete if parent task was deleted (ON DELETE CASCADE), or caller is workspace owner / service_role
        IF NOT EXISTS (SELECT 1 FROM public.tasks WHERE id = OLD.task_id)
           OR private.is_workspace_owner(OLD.workspace_id)
           OR v_jwt_role = 'service_role'
           OR current_user IN ('postgres', 'service_role', 'supabase_admin')
        THEN
            RETURN OLD;
        END IF;

        RAISE EXCEPTION 'Review rounds cannot be deleted.' USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Allow roster hard-delete decoupling & name snapshot preservation when all core review fields remain untouched
        IF (to_jsonb(NEW) - ARRAY['submitter_id', 'reviewer_id', 'submitter_name_snapshot', 'reviewer_name_snapshot', 'updated_at'])
           IS NOT DISTINCT FROM
           (to_jsonb(OLD) - ARRAY['submitter_id', 'reviewer_id', 'submitter_name_snapshot', 'reviewer_name_snapshot', 'updated_at'])
           AND (NEW.submitter_id IS NOT DISTINCT FROM OLD.submitter_id OR NEW.submitter_id IS NULL)
           AND (NEW.reviewer_id IS NOT DISTINCT FROM OLD.reviewer_id OR NEW.reviewer_id IS NULL)
        THEN
            RETURN NEW;
        END IF;

        -- Standard review decision state machine enforcement
        IF OLD.decision <> 'pending' THEN
            RAISE EXCEPTION 'Decided review rounds are immutable and cannot be updated.' USING ERRCODE = '42501';
        END IF;

        IF NEW.decision = 'pending' THEN
            RAISE EXCEPTION 'Review round parameters cannot be updated while pending.' USING ERRCODE = '42501';
        END IF;

        IF (to_jsonb(NEW) - ARRAY['decision','feedback','decided_at','updated_at'])
           IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['decision','feedback','decided_at','updated_at']) THEN
            RAISE EXCEPTION 'Review identity and submitted content are immutable.' USING ERRCODE = '42501';
        END IF;

        IF NEW.decided_at IS NULL OR NEW.decided_at < OLD.submitted_at THEN
            RAISE EXCEPTION 'A valid decision timestamp is required.';
        END IF;

        IF NEW.decision NOT IN ('approved', 'changes_requested') THEN
            RAISE EXCEPTION 'Invalid review decision transition.' USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_protect_review_rounds_mutation() FROM PUBLIC, anon;

COMMIT;
