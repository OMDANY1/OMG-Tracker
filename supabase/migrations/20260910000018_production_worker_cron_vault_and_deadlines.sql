-- Migration 18: Production Supabase Cron, Vault Worker Secret, and Configurable Workspace Deadline Settings
-- File: supabase/migrations/20260910000018_production_worker_cron_vault_and_deadlines.sql

-- 1. Ensure extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- 2. Configurable Workspace Deadline Settings Table
CREATE TABLE IF NOT EXISTS public.workspace_deadline_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    static_lead_days INTEGER NOT NULL DEFAULT 2 CHECK (static_lead_days BETWEEN 1 AND 14),
    carousel_lead_days INTEGER NOT NULL DEFAULT 3 CHECK (carousel_lead_days BETWEEN 1 AND 14),
    video_lead_days INTEGER NOT NULL DEFAULT 3 CHECK (video_lead_days BETWEEN 1 AND 14),
    review_lead_days INTEGER NOT NULL DEFAULT 1 CHECK (review_lead_days BETWEEN 1 AND 7),
    hard_client_extra_days INTEGER NOT NULL DEFAULT 1 CHECK (hard_client_extra_days BETWEEN 0 AND 7),
    working_days INTEGER[] NOT NULL DEFAULT ARRAY[0, 1, 2, 3, 4], -- 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday
    default_publish_time TEXT NOT NULL DEFAULT '18:00' CHECK (default_publish_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_by_id UUID REFERENCES public.roster_people(id),
    CONSTRAINT uq_workspace_deadline_settings_ws UNIQUE (workspace_id)
);

-- Enable RLS
ALTER TABLE public.workspace_deadline_settings ENABLE ROW LEVEL SECURITY;

-- Owner manage policy
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'workspace_deadline_settings' AND policyname = 'workspace_deadline_settings_owner_manage'
    ) THEN
        CREATE POLICY "workspace_deadline_settings_owner_manage"
            ON public.workspace_deadline_settings
            FOR ALL
            TO authenticated
            USING (
                EXISTS (
                    SELECT 1 FROM public.workspace_memberships wm
                    WHERE wm.workspace_id = workspace_deadline_settings.workspace_id
                      AND wm.user_id = auth.uid()
                      AND wm.is_active = TRUE
                      AND wm.role = 'owner'
                )
            );
    END IF;
END $$;

-- Member read policy
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'workspace_deadline_settings' AND policyname = 'workspace_deadline_settings_member_read'
    ) THEN
        CREATE POLICY "workspace_deadline_settings_member_read"
            ON public.workspace_deadline_settings
            FOR SELECT
            TO authenticated
            USING (
                EXISTS (
                    SELECT 1 FROM public.workspace_memberships wm
                    WHERE wm.workspace_id = workspace_deadline_settings.workspace_id
                      AND wm.user_id = auth.uid()
                      AND wm.is_active = TRUE
                )
            );
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.workspace_deadline_settings TO authenticated;
GRANT ALL ON public.workspace_deadline_settings TO service_role;

-- Seed default settings for all existing workspaces
INSERT INTO public.workspace_deadline_settings (workspace_id)
SELECT id FROM public.workspaces
ON CONFLICT (workspace_id) DO NOTHING;

-- 3. Vault Helper Functions for Worker Secret
CREATE OR REPLACE FUNCTION public.set_ai_worker_secret(p_secret TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
    v_existing_id UUID;
BEGIN
    IF p_secret IS NULL OR length(trim(p_secret)) < 16 THEN
        RAISE EXCEPTION 'Secret must be at least 16 characters.';
    END IF;

    -- Check if secret exists in vault.decrypted_secrets
    SELECT id INTO v_existing_id
    FROM vault.decrypted_secrets
    WHERE name = 'ai_worker_secret'
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        PERFORM vault.update_secret(v_existing_id, p_secret, 'ai_worker_secret', 'Worker secret for background calendar AI jobs');
    ELSE
        PERFORM vault.create_secret(p_secret, 'ai_worker_secret', 'Worker secret for background calendar AI jobs');
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_ai_worker_secret(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_ai_worker_secret(TEXT) TO service_role;

-- 4. Supabase Cron Worker Invocation Function (uses pg_net & vault)
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

    -- Fire asynchronous HTTP POST request via pg_net
    PERFORM net.http_post(
        url := v_url,
        body := jsonb_build_object(
            'source', 'supabase_cron',
            'invoked_at', pg_catalog.now()
        ),
        params := '{}'::jsonb,
        headers := v_headers,
        timeout_milliseconds := 30000
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invoke_ai_worker_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_ai_worker_cron() TO service_role;

-- 5. Schedule Supabase Cron (pg_cron)
DO $$
BEGIN
    -- Unschedule existing job if already present
    IF EXISTS (
        SELECT 1 FROM cron.job WHERE jobname = 'ai-calendar-worker-every-minute'
    ) THEN
        PERFORM cron.unschedule('ai-calendar-worker-every-minute');
    END IF;

    -- Schedule worker to run every minute via pg_cron
    PERFORM cron.schedule(
        'ai-calendar-worker-every-minute',
        '* * * * *',
        'SELECT public.invoke_ai_worker_cron();'
    );
END $$;

-- 6. Clean up temporary inspect functions
DROP FUNCTION IF EXISTS public.check_vault_and_extensions();
DROP FUNCTION IF EXISTS public.check_net_post();
