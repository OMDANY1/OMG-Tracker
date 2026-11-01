BEGIN;

-- =============================================================================
-- Migration 52: Fix AI Job Acquisition, Lease Expiry Max-Attempts Guard & Gemini 2.5 Flash Defaults
-- =============================================================================

-- 1. Update default model values on AI tables
ALTER TABLE public.campaigns
  ALTER COLUMN ai_model SET DEFAULT 'gemini-2.5-flash';

ALTER TABLE public.ai_extraction_cache
  ALTER COLUMN model SET DEFAULT 'gemini-2.5-flash';

ALTER TABLE public.ai_processing_jobs
  ALTER COLUMN model SET DEFAULT 'gemini-2.5-flash';

-- 2. Sanitize legacy/invalid model identifiers in existing campaigns & jobs
UPDATE public.campaigns
SET ai_model = 'gemini-2.5-flash'
WHERE ai_model IN ('gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-flash-latest', 'gemini-1.5-flash');

UPDATE public.ai_processing_jobs
SET model = 'gemini-2.5-flash'
WHERE model IN ('gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-flash-latest', 'gemini-1.5-flash');

-- Reset stuck processing jobs that looped past max_attempts due to previous model hang so they can be cleanly processed
UPDATE public.ai_processing_jobs
SET status = 'queued',
    attempt_count = 0,
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_error_code = NULL,
    safe_error_message = NULL,
    updated_at = pg_catalog.now()
WHERE status = 'processing'
  AND attempt_count >= max_attempts;

-- 3. Fix public.acquire_ai_processing_job to:
--    (a) Support service_role caller (admin client) as well as authenticated owner
--    (b) Properly claim existing 'queued' / 'waiting_for_retry' / expired 'processing' jobs
CREATE OR REPLACE FUNCTION public.acquire_ai_processing_job(
    p_workspace_id UUID,
    p_campaign_id UUID,
    p_client_id UUID,
    p_file_sha256 TEXT,
    p_worker_id TEXT,
    p_model TEXT DEFAULT 'gemini-2.5-flash',
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
    v_actor_roster_id UUID;
    v_is_service_role BOOLEAN;
    v_existing_job RECORD;
    v_new_job_id UUID;
    v_active_count INTEGER;
    v_lease_expiry TIMESTAMPTZ;
    v_clean_model TEXT;
BEGIN
    v_is_service_role := (current_setting('request.jwt.claim.role', true) = 'service_role');

    IF NOT v_is_service_role THEN
        SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
        IF v_caller.role NOT IN ('owner', 'company_owner') THEN
            RAISE EXCEPTION 'Permission denied: Only workspace owner can schedule AI jobs.';
        END IF;
        v_actor_roster_id := v_caller.roster_person_id;
    ELSE
        SELECT roster_person_id INTO v_actor_roster_id
        FROM public.workspace_memberships
        WHERE workspace_id = p_workspace_id AND role IN ('owner', 'company_owner') AND is_active = TRUE
        LIMIT 1;
    END IF;

    v_clean_model := COALESCE(NULLIF(btrim(p_model), ''), 'gemini-2.5-flash');
    IF v_clean_model LIKE '%3.8%' OR v_clean_model LIKE '%3.6%' OR v_clean_model LIKE '%1.5%' OR v_clean_model LIKE '%latest%' THEN
        v_clean_model := 'gemini-2.5-flash';
    END IF;

    v_lease_expiry := pg_catalog.now() + (p_lease_seconds || ' seconds')::INTERVAL;

    -- Check for existing active or retryable job for this campaign
    SELECT * INTO v_existing_job
    FROM public.ai_processing_jobs
    WHERE workspace_id = p_workspace_id
      AND campaign_id = p_campaign_id
      AND status IN ('queued', 'processing', 'waiting_for_retry')
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        -- If queued, waiting_for_retry, force_refresh, or processing with expired lease -> claim it now
        IF v_existing_job.status IN ('queued', 'waiting_for_retry')
           OR p_force_refresh = TRUE
           OR (v_existing_job.status = 'processing' AND v_existing_job.lease_expires_at < pg_catalog.now()) THEN

            UPDATE public.ai_processing_jobs
            SET status = 'processing',
                model = v_clean_model,
                file_sha256 = COALESCE(NULLIF(btrim(p_file_sha256), ''), file_sha256),
                lease_owner = p_worker_id,
                lease_expires_at = v_lease_expiry,
                attempt_count = CASE
                    WHEN v_existing_job.status = 'queued' AND v_existing_job.attempt_count = 0 THEN 1
                    ELSE v_existing_job.attempt_count + 1
                END,
                started_at = pg_catalog.now(),
                updated_at = pg_catalog.now()
            WHERE id = v_existing_job.id;

            RETURN jsonb_build_object(
                'job_id', v_existing_job.id,
                'status', 'processing',
                'is_resumed', (v_existing_job.status <> 'queued'),
                'attempt_count', CASE
                    WHEN v_existing_job.status = 'queued' AND v_existing_job.attempt_count = 0 THEN 1
                    ELSE v_existing_job.attempt_count + 1
                END,
                'action', 'claimed_existing'
            );
        END IF;

        -- Still validly processing by another active worker with unexpired lease
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
            v_clean_model,
            'queued',
            0,
            v_actor_roster_id
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
        v_clean_model,
        'processing',
        1,
        pg_catalog.now(),
        p_worker_id,
        v_lease_expiry,
        v_actor_roster_id
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

REVOKE ALL ON FUNCTION public.acquire_ai_processing_job(UUID, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acquire_ai_processing_job(UUID, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, BOOLEAN) TO authenticated, service_role;

-- 4. Fix public.claim_next_ai_job to prevent infinite retry loops when leases expire
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

    -- First, fail any expired processing jobs that have already exhausted max_attempts
    WITH exhausted AS (
        UPDATE public.ai_processing_jobs
        SET status = 'failed',
            lease_owner = NULL,
            lease_expires_at = NULL,
            last_error_code = COALESCE(last_error_code, 'TIMEOUT_MAX_ATTEMPTS'),
            safe_error_message = COALESCE(
                safe_error_message,
                'تجاوزت معالجة الملف الحد الأقصى للمحاولات بسبب انتهاء مهلة الاستجابة. يرجى الضغط على إعادة المعالجة.'
            ),
            completed_at = pg_catalog.now(),
            updated_at = pg_catalog.now()
        WHERE status = 'processing'
          AND lease_expires_at < pg_catalog.now()
          AND attempt_count >= max_attempts
        RETURNING campaign_id, workspace_id, safe_error_message
    )
    UPDATE public.campaigns c
    SET calendar_status = 'failed',
        processing_error = e.safe_error_message,
        updated_at = pg_catalog.now()
    FROM exhausted e
    WHERE c.id = e.campaign_id
      AND c.workspace_id = e.workspace_id
      AND c.calendar_status = 'processing';

    -- Claim the oldest eligible job that has not exceeded max_attempts
    SELECT * INTO v_job
    FROM public.ai_processing_jobs
    WHERE attempt_count < max_attempts
      AND (
          status = 'queued'
          OR (status = 'waiting_for_retry' AND (next_retry_at IS NULL OR next_retry_at <= pg_catalog.now()))
          OR (status = 'processing' AND lease_expires_at < pg_catalog.now())
      )
    ORDER BY
        CASE WHEN status = 'queued' THEN 0 ELSE 1 END ASC,
        queued_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('claimed', FALSE);
    END IF;

    UPDATE public.ai_processing_jobs
    SET status = 'processing',
        model = CASE
            WHEN model LIKE '%3.8%' OR model LIKE '%3.6%' OR model LIKE '%1.5%' OR model LIKE '%latest%' THEN 'gemini-2.5-flash'
            ELSE model
        END,
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
        'attempt_count', v_job.attempt_count + 1,
        'max_attempts', v_job.max_attempts
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_next_ai_job(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_next_ai_job(TEXT, INTEGER) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
