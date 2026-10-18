-- =============================================================================
-- Migration 47: Align PostgREST FK Constraint Names & Notification Trigger Decoupling
-- 1. Standardize tasks(primary_assignee_id) FK name to fk_task_assignee (single-column ON DELETE SET NULL)
--    so PostgREST joins !fk_task_assignee in /api/tasks, /api/reports/export-csv, /api/reports/export-pack, and /api/campaigns/diff all succeed.
-- 2. Convert composite ON DELETE SET NULL FKs on campaigns(uploaded_by_roster_id), content_calendar_items(task_id),
--    in_app_notifications(task_id), task_status_events(review_round_id), and time_entries(review_round_id)
--    to single-column ON DELETE SET NULL FKs so deleting a task, review round, or roster member never attempts to set workspace_id = NULL.
-- 3. Update fn_protect_in_app_notification_update() so ON DELETE SET NULL decoupling of actor_roster_id or task_id is permitted.
-- =============================================================================

BEGIN;

-- 1. Standardize fk_task_assignee on public.tasks(primary_assignee_id)
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_task_primary_assignee;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_task_assignee;
ALTER TABLE public.tasks ADD CONSTRAINT fk_task_assignee
    FOREIGN KEY (primary_assignee_id)
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

-- 2. Convert fk_campaign_uploaded_by on public.campaigns(uploaded_by_roster_id) to single-column ON DELETE SET NULL
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS fk_campaign_uploaded_by;
ALTER TABLE public.campaigns ADD CONSTRAINT fk_campaign_uploaded_by
    FOREIGN KEY (uploaded_by_roster_id)
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

-- 3. Convert fk_cci_task on public.content_calendar_items(task_id) to single-column ON DELETE SET NULL
ALTER TABLE public.content_calendar_items DROP CONSTRAINT IF EXISTS fk_cci_task;
ALTER TABLE public.content_calendar_items ADD CONSTRAINT fk_cci_task
    FOREIGN KEY (task_id)
    REFERENCES public.tasks(id) ON DELETE SET NULL;

-- 4. Convert fk_notif_task on public.in_app_notifications(task_id) to single-column ON DELETE SET NULL
ALTER TABLE public.in_app_notifications DROP CONSTRAINT IF EXISTS fk_notif_task;
ALTER TABLE public.in_app_notifications ADD CONSTRAINT fk_notif_task
    FOREIGN KEY (task_id)
    REFERENCES public.tasks(id) ON DELETE SET NULL;

-- 5. Convert fk_tse_round and fk_time_round to single-column ON DELETE SET NULL
ALTER TABLE public.task_status_events DROP CONSTRAINT IF EXISTS fk_tse_round;
ALTER TABLE public.task_status_events ADD CONSTRAINT fk_tse_round
    FOREIGN KEY (review_round_id)
    REFERENCES public.review_rounds(id) ON DELETE SET NULL;

ALTER TABLE public.time_entries DROP CONSTRAINT IF EXISTS fk_time_round;
ALTER TABLE public.time_entries ADD CONSTRAINT fk_time_round
    FOREIGN KEY (review_round_id)
    REFERENCES public.review_rounds(id) ON DELETE SET NULL;

-- 6. Update fn_protect_in_app_notification_update to allow ON DELETE SET NULL decoupling of actor_roster_id and task_id
CREATE OR REPLACE FUNCTION public.fn_protect_in_app_notification_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.id <> OLD.id
       OR NEW.workspace_id <> OLD.workspace_id
       OR NEW.recipient_roster_id <> OLD.recipient_roster_id
       OR (NEW.actor_roster_id IS DISTINCT FROM OLD.actor_roster_id AND NEW.actor_roster_id IS NOT NULL)
       OR NEW.title <> OLD.title
       OR NEW.message <> OLD.message
       OR (NEW.task_id IS DISTINCT FROM OLD.task_id AND NEW.task_id IS NOT NULL)
       OR NEW.action_url IS DISTINCT FROM OLD.action_url
       OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Only is_read status can be modified on notifications.';
    END IF;
    RETURN NEW;
END;
$$;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
