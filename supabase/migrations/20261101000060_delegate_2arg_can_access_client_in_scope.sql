-- Migration 60: Delegate 2-argument private.can_access_client_in_scope(p_workspace_id, p_client_id)
-- directly to the canonical 3-argument private.can_access_client_in_scope(p_workspace_id, private.caller_roster_id(p_workspace_id), p_client_id).

BEGIN;

CREATE OR REPLACE FUNCTION private.can_access_client_in_scope(
  p_workspace_id UUID,
  p_client_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.can_access_client_in_scope(
    p_workspace_id,
    private.caller_roster_id(p_workspace_id),
    p_client_id
  );
$$;

REVOKE ALL ON FUNCTION private.can_access_client_in_scope(UUID, UUID) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
