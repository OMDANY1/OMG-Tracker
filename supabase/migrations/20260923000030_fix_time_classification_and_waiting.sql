-- Migration 30: Fix time classification, decouple activity from discipline, and record waiting sessions
-- 1. Ensure all activity categories exist in public.time_category enum
ALTER TYPE public.time_category ADD VALUE IF NOT EXISTS 'review';
ALTER TYPE public.time_category ADD VALUE IF NOT EXISTS 'content_writing';
ALTER TYPE public.time_category ADD VALUE IF NOT EXISTS 'strategy_research';
ALTER TYPE public.time_category ADD VALUE IF NOT EXISTS 'video_editing';
ALTER TYPE public.time_category ADD VALUE IF NOT EXISTS 'waiting';

-- 2. Remap legacy test data in copywriting tasks to correct activity categories
-- Remap initial copywriting sessions from initial_design to content_writing
UPDATE public.time_entries te
SET category = 'content_writing',
    updated_at = pg_catalog.now()
FROM public.tasks t
WHERE te.task_id = t.id
  AND t.work_stage = 'copywriting'
  AND te.category = 'initial_design';

-- Remap review sessions (which were previously logged under internal_revision) to review
UPDATE public.time_entries te
SET category = 'review',
    updated_at = pg_catalog.now()
FROM public.tasks t
WHERE te.task_id = t.id
  AND (te.note ILIKE '%مراجعة%' OR te.note ILIKE '%review%')
  AND te.category = 'internal_revision';

-- 3. Enhance set_task_waiting_state RPC to automatically log completed waiting duration into time_entries
CREATE OR REPLACE FUNCTION public.set_task_waiting_state(
    p_task_id UUID,
    p_is_waiting BOOLEAN,
    p_waiting_reason TEXT DEFAULT NULL,
    p_waiting_on_roster_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_task RECORD;
    v_caller RECORD;
    v_wait_dur INT;
BEGIN
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Task not found.'; END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_task.workspace_id);

    IF p_is_waiting THEN
        IF p_waiting_reason IS NULL OR btrim(p_waiting_reason) = '' THEN
            RAISE EXCEPTION 'Waiting reason is mandatory when pausing work.';
        END IF;

        -- Auto-pause any active timer for caller
        UPDATE public.time_entries
        SET ended_at = pg_catalog.now(),
            duration_seconds = EXTRACT(EPOCH FROM (pg_catalog.now() - started_at))::INT,
            updated_at = pg_catalog.now()
        WHERE workspace_id = v_task.workspace_id
          AND roster_person_id = v_caller.roster_person_id
          AND task_id = p_task_id
          AND ended_at IS NULL
          AND is_voided = FALSE;

        UPDATE public.tasks
        SET is_waiting = TRUE,
            waiting_reason = p_waiting_reason,
            waiting_since = pg_catalog.now(),
            waiting_on_roster_id = p_waiting_on_roster_id,
            updated_at = pg_catalog.now()
        WHERE id = p_task_id;
    ELSE
        -- If resuming from waiting, record the waiting duration into time_entries
        IF v_task.is_waiting AND v_task.waiting_since IS NOT NULL THEN
            v_wait_dur := EXTRACT(EPOCH FROM (pg_catalog.now() - v_task.waiting_since))::INT;
            IF v_wait_dur > 0 THEN
                INSERT INTO public.time_entries (
                    workspace_id,
                    task_id,
                    roster_person_id,
                    started_at,
                    ended_at,
                    duration_seconds,
                    category,
                    note,
                    source,
                    created_by_id
                ) VALUES (
                    v_task.workspace_id,
                    p_task_id,
                    COALESCE(v_task.primary_assignee_id, v_caller.roster_person_id),
                    v_task.waiting_since,
                    pg_catalog.now(),
                    v_wait_dur,
                    'waiting',
                    COALESCE(v_task.waiting_reason, 'ساعات انتظار وتعطيل'),
                    'manual',
                    v_caller.roster_person_id
                );
            END IF;
        END IF;

        UPDATE public.tasks
        SET is_waiting = FALSE,
            waiting_reason = NULL,
            waiting_since = NULL,
            waiting_on_roster_id = NULL,
            updated_at = pg_catalog.now()
        WHERE id = p_task_id;
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE,
        'task_id', p_task_id,
        'is_waiting', p_is_waiting
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION public.set_task_waiting_state(UUID, BOOLEAN, TEXT, UUID, TEXT) TO authenticated;
