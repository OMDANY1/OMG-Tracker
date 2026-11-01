-- Migration 59: Add 2-argument private.has_granular_permission(p_workspace_id, p_permission_key)
-- Delegating to private.caller_has_permission(p_workspace_id, private.caller_roster_id(p_workspace_id), p_permission_key)

BEGIN;

CREATE OR REPLACE FUNCTION private.has_granular_permission(
  p_workspace_id UUID,
  p_permission_key TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.caller_has_permission(
    p_workspace_id,
    private.caller_roster_id(p_workspace_id),
    p_permission_key
  );
$$;

REVOKE ALL ON FUNCTION private.has_granular_permission(UUID, TEXT) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
