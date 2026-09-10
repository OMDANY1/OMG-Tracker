-- Migration 19: Worker Cron Monitoring Helper RPC
-- File: supabase/migrations/20260910000019_worker_cron_monitoring.sql

CREATE OR REPLACE FUNCTION public.get_worker_cron_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, vault
AS $$
DECLARE
    v_job jsonb;
    v_recent_runs jsonb;
    v_has_vault_secret boolean;
BEGIN
    -- 1. Check job schedule in cron.job
    SELECT jsonb_build_object(
        'jobid', jobid,
        'jobname', jobname,
        'schedule', schedule,
        'active', active
    ) INTO v_job
    FROM cron.job
    WHERE jobname = 'ai-calendar-worker-every-minute'
    LIMIT 1;

    -- 2. Check recent runs in cron.job_run_details
    SELECT jsonb_agg(
        jsonb_build_object(
            'runid', runid,
            'status', status,
            'return_message', return_message,
            'start_time', start_time,
            'end_time', end_time
        )
    ) INTO v_recent_runs
    FROM (
        SELECT runid, status, return_message, start_time, end_time
        FROM cron.job_run_details
        WHERE command LIKE '%invoke_ai_worker_cron%'
        ORDER BY start_time DESC
        LIMIT 10
    ) sub;

    -- 3. Check if vault secret is configured (without revealing the secret itself!)
    SELECT EXISTS (
        SELECT 1 FROM vault.decrypted_secrets
        WHERE name = 'ai_worker_secret' AND length(decrypted_secret) >= 16
    ) INTO v_has_vault_secret;

    RETURN jsonb_build_object(
        'configured', v_job IS NOT NULL,
        'job', v_job,
        'has_vault_secret', v_has_vault_secret,
        'recent_runs', COALESCE(v_recent_runs, '[]'::jsonb)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_worker_cron_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_worker_cron_status() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_worker_cron_status() TO authenticated;
