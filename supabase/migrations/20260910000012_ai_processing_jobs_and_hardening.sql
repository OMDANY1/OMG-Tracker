-- Migration 12: AI Processing Jobs, Calendar Versioning Hardening, and Task Traceability
-- Enforces durable jobs queue, lease recovery, concurrency guard, task source link, and comment threads.

BEGIN;

-- 1. Create durable AI processing jobs table
CREATE TABLE IF NOT EXISTS public.ai_processing_jobs (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL DEFAULT 'content_calendar_extraction',
    file_sha256 TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'google_gemini',
    model TEXT NOT NULL DEFAULT 'gemini-3.6-flash',
    status TEXT NOT NULL DEFAULT 'queued' CHECK (
        status IN ('queued', 'processing', 'completed', 'waiting_for_retry', 'rate_limited', 'failed', 'cancelled')
    ),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    next_retry_at TIMESTAMPTZ,
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,
    last_error_code TEXT,
    safe_error_message TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
    processing_duration_ms INTEGER NOT NULL DEFAULT 0,
    created_by_id UUID REFERENCES public.roster_people(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- Indices for rapid queue polling and concurrency enforcement
CREATE INDEX IF NOT EXISTS idx_ai_jobs_workspace_status ON public.ai_processing_jobs (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_campaign ON public.ai_processing_jobs (campaign_id);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_polling ON public.ai_processing_jobs (status, next_retry_at) WHERE status IN ('queued', 'waiting_for_retry');
CREATE INDEX IF NOT EXISTS idx_ai_jobs_lease ON public.ai_processing_jobs (lease_expires_at) WHERE status = 'processing';

-- Prevent concurrent active duplicate jobs for same campaign + file
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_ai_processing_job 
ON public.ai_processing_jobs (workspace_id, campaign_id, file_sha256) 
WHERE status IN ('queued', 'processing');

-- Attach updated_at trigger
DROP TRIGGER IF EXISTS trg_ai_processing_jobs_updated_at ON public.ai_processing_jobs;
CREATE TRIGGER trg_ai_processing_jobs_updated_at
BEFORE UPDATE ON public.ai_processing_jobs
FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- 2. Extend campaigns for versioning & replacement reason
ALTER TABLE public.campaigns
    ADD COLUMN IF NOT EXISTS replacement_reason TEXT,
    ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS superseded_by_revision INTEGER;

-- 3. Extend tasks with direct content_calendar_item_id link for source traceability
ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS content_calendar_item_id UUID REFERENCES public.content_calendar_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_calendar_item_id ON public.tasks(content_calendar_item_id);

-- 4. Extend comments for reviews, resolved status, and mentions
ALTER TABLE public.comments
    ADD COLUMN IF NOT EXISTS comment_type TEXT NOT NULL DEFAULT 'general' CHECK (comment_type IN ('general', 'internal_review', 'client_note')),
    ADD COLUMN IF NOT EXISTS is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS resolved_by_roster_id UUID REFERENCES public.roster_people(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS mentions UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_comments_task_resolved ON public.comments(task_id, is_resolved);

-- 5. Extend member_capacities for fine-grained capacity scoring
ALTER TABLE public.member_capacities
    ADD COLUMN IF NOT EXISTS max_active_tasks INTEGER DEFAULT 10,
    ADD COLUMN IF NOT EXISTS max_weighted_load NUMERIC(5,2) DEFAULT 15.0;

-- 6. Atomic RPC to acquire or reuse AI processing job
CREATE OR REPLACE FUNCTION public.acquire_ai_processing_job(
    p_workspace_id UUID,
    p_campaign_id UUID,
    p_client_id UUID,
    p_file_sha256 TEXT,
    p_worker_id TEXT,
    p_model TEXT DEFAULT 'gemini-3.6-flash',
    p_lease_seconds INTEGER DEFAULT 300,
    p_force_refresh BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_caller RECORD;
    v_existing_job RECORD;
    v_new_job_id UUID;
    v_active_count INTEGER;
    v_lease_expiry TIMESTAMPTZ;
BEGIN
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    IF v_caller.role <> 'owner' THEN
        RAISE EXCEPTION 'Permission denied: Only workspace owner can schedule AI jobs.';
    END IF;

    v_lease_expiry := pg_catalog.now() + (p_lease_seconds || ' seconds')::INTERVAL;

    -- Check for existing active job (queued or processing)
    SELECT * INTO v_existing_job
    FROM public.ai_processing_jobs
    WHERE workspace_id = p_workspace_id
      AND campaign_id = p_campaign_id
      AND file_sha256 = p_file_sha256
      AND status IN ('queued', 'processing')
    FOR UPDATE;

    IF FOUND THEN
        -- If currently processing but lease expired, recover and steal lease
        IF v_existing_job.status = 'processing' AND v_existing_job.lease_expires_at < pg_catalog.now() THEN
            UPDATE public.ai_processing_jobs
            SET lease_owner = p_worker_id,
                lease_expires_at = v_lease_expiry,
                attempt_count = attempt_count + 1,
                started_at = pg_catalog.now(),
                updated_at = pg_catalog.now()
            WHERE id = v_existing_job.id;

            RETURN jsonb_build_object(
                'job_id', v_existing_job.id,
                'status', 'processing',
                'is_resumed', TRUE,
                'attempt_count', v_existing_job.attempt_count + 1,
                'action', 'recovered_expired_lease'
            );
        END IF;

        -- Still validly processing by another active worker
        RETURN jsonb_build_object(
            'job_id', v_existing_job.id,
            'status', v_existing_job.status,
            'is_resumed', FALSE,
            'attempt_count', v_existing_job.attempt_count,
            'action', 'already_active'
        );
    END IF;

    -- Concurrency guard: Allow max 2 parallel processing jobs per workspace
    SELECT count(*) INTO v_active_count
    FROM public.ai_processing_jobs
    WHERE workspace_id = p_workspace_id
      AND status = 'processing'
      AND lease_expires_at >= pg_catalog.now();

    IF v_active_count >= 2 THEN
        -- Queue the job
        INSERT INTO public.ai_processing_jobs (
            workspace_id,
            campaign_id,
            client_id,
            file_sha256,
            model,
            status,
            attempt_count,
            created_by_id
        ) VALUES (
            p_workspace_id,
            p_campaign_id,
            p_client_id,
            p_file_sha256,
            p_model,
            'queued',
            0,
            v_caller.roster_person_id
        ) RETURNING id INTO v_new_job_id;

        RETURN jsonb_build_object(
            'job_id', v_new_job_id,
            'status', 'queued',
            'is_resumed', FALSE,
            'action', 'concurrency_limit_queued'
        );
    END IF;

    -- Create new processing job immediately
    INSERT INTO public.ai_processing_jobs (
        workspace_id,
        campaign_id,
        client_id,
        file_sha256,
        model,
        status,
        attempt_count,
        started_at,
        lease_owner,
        lease_expires_at,
        created_by_id
    ) VALUES (
        p_workspace_id,
        p_campaign_id,
        p_client_id,
        p_file_sha256,
        p_model,
        'processing',
        1,
        pg_catalog.now(),
        p_worker_id,
        v_lease_expiry,
        v_caller.roster_person_id
    ) RETURNING id INTO v_new_job_id;

    RETURN jsonb_build_object(
        'job_id', v_new_job_id,
        'status', 'processing',
        'is_resumed', FALSE,
        'attempt_count', 1,
        'action', 'started_new'
    );
END;
$function$;

-- 7. Atomic RPC to complete or fail AI processing job
CREATE OR REPLACE FUNCTION public.release_ai_processing_job(
    p_job_id UUID,
    p_status TEXT,
    p_model TEXT DEFAULT NULL,
    p_input_tokens INTEGER DEFAULT 0,
    p_output_tokens INTEGER DEFAULT 0,
    p_total_tokens INTEGER DEFAULT 0,
    p_cache_hit BOOLEAN DEFAULT FALSE,
    p_duration_ms INTEGER DEFAULT 0,
    p_error_code TEXT DEFAULT NULL,
    p_safe_error_msg TEXT DEFAULT NULL,
    p_retry_delay_seconds INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_job RECORD;
    v_next_retry TIMESTAMPTZ := NULL;
BEGIN
    SELECT * INTO v_job
    FROM public.ai_processing_jobs
    WHERE id = p_job_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job % not found.', p_job_id;
    END IF;

    IF p_retry_delay_seconds IS NOT NULL AND p_retry_delay_seconds > 0 THEN
        v_next_retry := pg_catalog.now() + (p_retry_delay_seconds || ' seconds')::INTERVAL;
    END IF;

    UPDATE public.ai_processing_jobs
    SET status = p_status,
        model = COALESCE(p_model, model),
        input_tokens = p_input_tokens,
        output_tokens = p_output_tokens,
        total_tokens = p_total_tokens,
        cache_hit = p_cache_hit,
        processing_duration_ms = p_duration_ms,
        last_error_code = p_error_code,
        safe_error_message = p_safe_error_msg,
        completed_at = CASE WHEN p_status IN ('completed', 'failed', 'cancelled') THEN pg_catalog.now() ELSE completed_at END,
        next_retry_at = v_next_retry,
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = pg_catalog.now()
    WHERE id = p_job_id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'job_id', p_job_id,
        'status', p_status
    );
END;
$function$;

-- 8. Enable RLS and grant permissions
ALTER TABLE public.ai_processing_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspace members can view AI jobs"
ON public.ai_processing_jobs FOR SELECT
USING (
    private.is_workspace_member(workspace_id)
);

CREATE POLICY "Only workspace owner can mutate AI jobs"
ON public.ai_processing_jobs FOR ALL
USING (
    private.is_workspace_owner(workspace_id)
);

GRANT ALL ON TABLE public.ai_processing_jobs TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.acquire_ai_processing_job(UUID, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_ai_processing_job(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER, BOOLEAN, INTEGER, TEXT, TEXT, INTEGER) TO authenticated, service_role;

COMMIT;
