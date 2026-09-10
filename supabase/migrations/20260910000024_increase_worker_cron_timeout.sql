-- Migration 24: Increase Worker Cron pg_net Timeout to 300s to match Vercel maxDuration
-- File: supabase/migrations/20260910000024_increase_worker_cron_timeout.sql

CREATE OR REPLACE FUNCTION public.invoke_ai_worker_cron()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
    v_secret TEXT;
    v_url TEXT := 'https://omg-creative-workspace.vercel.app/api/ai/worker';
    v_headers JSONB;
BEGIN
    -- Check if there are active queued or waiting jobs before sending HTTP request
    IF NOT EXISTS (
        SELECT 1 FROM public.ai_processing_jobs
        WHERE status IN ('queued', 'waiting_for_retry')
           OR (status = 'processing' AND lease_expires_at < pg_catalog.now())
        LIMIT 1
    ) THEN
        -- No eligible jobs to process; avoid unnecessary HTTP roundtrips
        RETURN;
    END IF;

    -- Retrieve secret securely from Vault
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'ai_worker_secret'
    LIMIT 1;

    IF v_secret IS NULL OR v_secret = '' THEN
        RAISE WARNING 'invoke_ai_worker_cron: ai_worker_secret not found in vault';
        RETURN;
    END IF;

    v_headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', v_secret
    );

    -- Fire asynchronous HTTP POST request via pg_net with 300s timeout (matching maxDuration = 300)
    PERFORM net.http_post(
        url := v_url,
        body := jsonb_build_object(
            'source', 'supabase_cron',
            'invoked_at', pg_catalog.now()
        ),
        params := '{}'::jsonb,
        headers := v_headers,
        timeout_milliseconds := 300000
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invoke_ai_worker_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_ai_worker_cron() TO service_role;

-- Reset any stalled job that timed out under the previous 30s limit
UPDATE public.ai_processing_jobs
SET status = 'queued',
    lease_owner = NULL,
    lease_expires_at = NULL,
    updated_at = pg_catalog.now()
WHERE id = 'c0746e02-0a29-4461-9c65-31b83c95932c'
  AND status = 'processing';
