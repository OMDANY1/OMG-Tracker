-- Migration 13: Production Hardening, Durable Worker Queue, Calendar Revision Protection, and Task Traceability
-- Implements single-active-revision constraint, smart deadlines task columns, worker job claim RPC, and safe apply engine.

BEGIN;

-- 1. Ensure only 1 active calendar revision exists per client per month
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_calendar_revision
ON public.campaigns (workspace_id, client_id, month_key)
WHERE is_current_revision = TRUE;

-- 2. Extend tasks with smart deadlines, source traceability, and content fingerprint
ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS source_pdf_pages INTEGER[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS content_fingerprint TEXT,
    ADD COLUMN IF NOT EXISTS design_due_date DATE,
    ADD COLUMN IF NOT EXISTS review_due_date DATE,
    ADD COLUMN IF NOT EXISTS publish_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tasks_fingerprint ON public.tasks(workspace_id, content_fingerprint);
CREATE INDEX IF NOT EXISTS idx_tasks_design_due ON public.tasks(workspace_id, design_due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_review_due ON public.tasks(workspace_id, review_due_date);

-- 3. Extend campaigns with archiving support
ALTER TABLE public.campaigns
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS archived_by_id UUID REFERENCES public.roster_people(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS archive_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_campaigns_archived ON public.campaigns(workspace_id, archived_at);

-- 4. Atomic Background Worker Job Claim RPC
CREATE OR REPLACE FUNCTION public.claim_next_ai_job(
    p_worker_id TEXT,
    p_lease_seconds INTEGER DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_job RECORD;
    v_lease_expiry TIMESTAMPTZ;
BEGIN
    v_lease_expiry := pg_catalog.now() + (p_lease_seconds || ' seconds')::INTERVAL;

    -- Atomically select and lock the next eligible job (FIFO)
    SELECT * INTO v_job
    FROM public.ai_processing_jobs
    WHERE (
        status = 'queued'
        OR (status = 'waiting_for_retry' AND (next_retry_at IS NULL OR next_retry_at <= pg_catalog.now()))
        OR (status = 'processing' AND lease_expires_at < pg_catalog.now())
    )
    ORDER BY queued_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('claimed', FALSE);
    END IF;

    -- Claim and transition job to processing
    UPDATE public.ai_processing_jobs
    SET status = 'processing',
        lease_owner = p_worker_id,
        lease_expires_at = v_lease_expiry,
        attempt_count = attempt_count + 1,
        started_at = COALESCE(started_at, pg_catalog.now()),
        updated_at = pg_catalog.now()
    WHERE id = v_job.id;

    RETURN jsonb_build_object(
        'claimed', TRUE,
        'job_id', v_job.id,
        'workspace_id', v_job.workspace_id,
        'campaign_id', v_job.campaign_id,
        'client_id', v_job.client_id,
        'file_sha256', v_job.file_sha256,
        'model', v_job.model,
        'attempt_count', v_job.attempt_count + 1,
        'max_attempts', v_job.max_attempts,
        'is_recovered', (v_job.status = 'processing' AND v_job.lease_expires_at < pg_catalog.now())
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.claim_next_ai_job(TEXT, INTEGER) TO authenticated, service_role;

-- 5. Safe Calendar Revisions Apply Engine
CREATE OR REPLACE FUNCTION public.apply_calendar_revision_tasks(
    p_workspace_id UUID,
    p_campaign_id UUID,
    p_apply_mode TEXT DEFAULT 'sync_pending', -- 'new_only', 'sync_pending', 'full_apply'
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_caller RECORD;
    v_campaign RECORD;
    v_item RECORD;
    v_existing_task RECORD;
    v_new_task_id UUID;
    v_created_count INTEGER := 0;
    v_updated_count INTEGER := 0;
    v_skipped_count INTEGER := 0;
    v_assigned_target UUID;
    v_design_due DATE;
    v_review_due DATE;
BEGIN
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    IF v_caller.role <> 'owner' THEN
        RAISE EXCEPTION 'Permission denied: Only the workspace owner can apply calendar revisions.';
    END IF;

    SELECT * INTO v_campaign
    FROM public.campaigns
    WHERE id = p_campaign_id AND workspace_id = p_workspace_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Campaign % not found in workspace.', p_campaign_id;
    END IF;

    -- Process each content calendar item
    FOR v_item IN
        SELECT *
        FROM public.content_calendar_items
        WHERE campaign_id = p_campaign_id
          AND workspace_id = p_workspace_id
          AND is_included = TRUE
          AND is_excluded_from_tasks = FALSE
        ORDER BY post_order ASC
    LOOP
        -- Check if task already exists for this calendar item
        SELECT * INTO v_existing_task
        FROM public.tasks
        WHERE workspace_id = p_workspace_id
          AND (content_calendar_item_id = v_item.id OR (campaign_id = p_campaign_id AND deliverable_number = v_item.post_order))
        LIMIT 1;

        IF FOUND THEN
            -- ACTIVE TASK PROTECTION:
            -- If task is in_progress, review, approved, or delivered, strictly protect it from overwriting
            IF v_existing_task.status IN ('in_progress', 'review', 'approved', 'delivered') THEN
                v_skipped_count := v_skipped_count + 1;
                CONTINUE;
            END IF;

            -- If mode is 'new_only', skip existing tasks
            IF p_apply_mode = 'new_only' THEN
                v_skipped_count := v_skipped_count + 1;
                CONTINUE;
            END IF;

            -- Otherwise sync task if still in 'backlog' or 'ready'
            UPDATE public.tasks
            SET title = COALESCE(v_item.title, title),
                brief = COALESCE(v_item.brief, brief),
                deliverable_format = COALESCE(v_item.content_format, deliverable_format),
                content_fingerprint = v_item.content_fingerprint,
                design_due_date = COALESCE(v_item.design_due_date, design_due_date),
                publish_at = CASE WHEN v_item.publish_date IS NOT NULL THEN (v_item.publish_date::TEXT || ' 12:00:00+02')::TIMESTAMPTZ ELSE publish_at END,
                source_pdf_pages = COALESCE(v_item.source_pages, ARRAY[v_item.source_page]),
                content_calendar_item_id = v_item.id,
                updated_at = pg_catalog.now()
            WHERE id = v_existing_task.id;

            v_updated_count := v_updated_count + 1;
        ELSE
            -- Create new task in 'backlog' (انتظار)
            v_new_task_id := extensions.gen_random_uuid();
            v_assigned_target := COALESCE(v_item.approved_assignee_id, v_item.suggested_assignee_id);
            v_design_due := COALESCE(v_item.design_due_date, CURRENT_DATE + INTERVAL '3 days');
            v_review_due := v_design_due + INTERVAL '1 day';

            INSERT INTO public.tasks (
                id,
                workspace_id,
                client_id,
                campaign_id,
                content_calendar_item_id,
                title,
                brief,
                deliverable_format,
                deliverable_number,
                priority,
                status,
                primary_assignee_id,
                reviewer_id,
                due_date,
                design_due_date,
                review_due_date,
                publish_at,
                source_pdf_pages,
                content_fingerprint,
                created_by_id
            ) VALUES (
                v_new_task_id,
                p_workspace_id,
                v_campaign.client_id,
                p_campaign_id,
                v_item.id,
                COALESCE(v_item.title, 'Post ' || v_item.post_order),
                v_item.brief,
                COALESCE(v_item.content_format, 'Static'),
                v_item.post_order,
                'Medium',
                'backlog',
                v_assigned_target,
                v_caller.roster_person_id,
                v_review_due,
                v_design_due,
                v_review_due,
                CASE WHEN v_item.publish_date IS NOT NULL THEN (v_item.publish_date::TEXT || ' 12:00:00+02')::TIMESTAMPTZ ELSE NULL END,
                COALESCE(v_item.source_pages, ARRAY[v_item.source_page]),
                v_item.content_fingerprint,
                v_caller.roster_person_id
            );

            -- Link created task back to calendar item
            UPDATE public.content_calendar_items
            SET task_id = v_new_task_id,
                updated_at = pg_catalog.now()
            WHERE id = v_item.id;

            -- Create in-app notification if assigned to another designer
            IF v_assigned_target IS NOT NULL AND v_assigned_target <> v_caller.roster_person_id THEN
                INSERT INTO public.in_app_notifications (
                    workspace_id,
                    recipient_roster_id,
                    actor_roster_id,
                    task_id,
                    notification_type,
                    title,
                    body,
                    is_read
                ) VALUES (
                    p_workspace_id,
                    v_assigned_target,
                    v_caller.roster_person_id,
                    v_new_task_id,
                    'task_assigned',
                    'تم إسناد مهمة جديدة إليك',
                    'تم إسناد مهمة جديدة لك من تقويم المحتوى: ' || COALESCE(v_item.title, 'Post ' || v_item.post_order),
                    FALSE
                );
            END IF;

            v_created_count := v_created_count + 1;
        END IF;
    END LOOP;

    -- Update campaign status to 'approved'
    UPDATE public.campaigns
    SET calendar_status = 'approved',
        status = 'Active',
        updated_at = pg_catalog.now()
    WHERE id = p_campaign_id;

    -- Log to audit_events
    INSERT INTO public.audit_events (
        workspace_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        p_workspace_id,
        v_caller.roster_person_id,
        'apply_calendar_revision',
        'campaigns',
        p_campaign_id,
        jsonb_build_object(
            'apply_mode', p_apply_mode,
            'tasks_created', v_created_count,
            'tasks_updated', v_updated_count,
            'tasks_skipped_protected', v_skipped_count,
            'idempotency_key', p_idempotency_key
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'campaign_id', p_campaign_id,
        'tasks_created', v_created_count,
        'tasks_updated', v_updated_count,
        'tasks_skipped_protected', v_skipped_count
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_calendar_revision_tasks(UUID, UUID, TEXT, TEXT) TO authenticated, service_role;

COMMIT;
