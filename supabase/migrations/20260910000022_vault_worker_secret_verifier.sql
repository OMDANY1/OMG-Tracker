-- Migration 22: Vault Worker Secret Verifier
-- File: supabase/migrations/20260910000022_vault_worker_secret_verifier.sql

CREATE OR REPLACE FUNCTION public.verify_ai_worker_secret(p_secret TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
    v_actual_secret TEXT;
BEGIN
    IF p_secret IS NULL OR pg_catalog.length(p_secret) < 16 THEN
        RETURN FALSE;
    END IF;

    SELECT decrypted_secret INTO v_actual_secret
    FROM vault.decrypted_secrets
    WHERE name = 'ai_worker_secret'
    LIMIT 1;

    IF v_actual_secret IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN (p_secret = v_actual_secret);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_ai_worker_secret(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_ai_worker_secret(TEXT) TO service_role;
