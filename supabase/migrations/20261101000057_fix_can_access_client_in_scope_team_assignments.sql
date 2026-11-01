-- Migration 57: Fix private.can_access_client_in_scope to join public.client_team_assignments
-- Ensures SQL-level scope checks (RLS policies and import_content_calendar_tasks RPC)
-- accurately inspect primary_strategist_id, strategy_reviewer_id, primary_designer_id, etc. from client_team_assignments.

BEGIN;

CREATE OR REPLACE FUNCTION private.can_access_client_in_scope(
  p_workspace_id UUID,
  p_client_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_mem RECORD;
  v_client RECORD;
  v_scope TEXT;
  v_role TEXT;
  v_roster_id UUID;
BEGIN
  IF v_uid IS NULL OR p_workspace_id IS NULL OR p_client_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT
    wm.role::TEXT AS role,
    wm.roster_person_id,
    COALESCE(wm.access_scope, rp.access_scope) AS access_scope
  INTO v_mem
  FROM public.workspace_memberships wm
  JOIN public.roster_people rp ON rp.id = wm.roster_person_id
  WHERE wm.workspace_id = p_workspace_id
    AND wm.user_id = v_uid
    AND wm.is_active = TRUE
    AND rp.is_active = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  v_role := v_mem.role;
  v_roster_id := v_mem.roster_person_id;
  v_scope := COALESCE(v_mem.access_scope, 'assigned_clients');

  -- Full workspace roles or explicit all_clients scope
  IF v_role IN ('owner', 'company_owner', 'manager') OR v_scope IN ('all_clients', 'workspace') THEN
    RETURN EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = p_client_id AND c.workspace_id = p_workspace_id
    );
  END IF;

  SELECT
    c.id,
    c.owner_roster_id,
    c.strategy_lead_id,
    cta.primary_designer_id,
    cta.backup_designer_id,
    cta.design_reviewer_id,
    cta.primary_strategist_id,
    cta.strategy_reviewer_id,
    cta.primary_copywriter_id,
    cta.copy_reviewer_id,
    cta.primary_video_editor_id,
    cta.video_reviewer_id
  INTO v_client
  FROM public.clients c
  LEFT JOIN public.client_team_assignments cta
    ON cta.client_id = c.id AND cta.workspace_id = c.workspace_id
  WHERE c.id = p_client_id AND c.workspace_id = p_workspace_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Direct assignment check
  IF v_roster_id IN (
    v_client.owner_roster_id,
    v_client.strategy_lead_id,
    v_client.primary_designer_id,
    v_client.backup_designer_id,
    v_client.design_reviewer_id,
    v_client.primary_strategist_id,
    v_client.strategy_reviewer_id,
    v_client.primary_copywriter_id,
    v_client.copy_reviewer_id,
    v_client.primary_video_editor_id,
    v_client.video_reviewer_id
  ) THEN
    RETURN TRUE;
  END IF;

  -- Task-level assignment check
  IF EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.workspace_id = p_workspace_id
      AND t.client_id = p_client_id
      AND (t.primary_assignee_id = v_roster_id OR t.reviewer_id = v_roster_id)
  ) THEN
    RETURN TRUE;
  END IF;

  -- Team-level scope check (strategy_lead / senior_reviewer / assigned_team)
  IF v_scope = 'assigned_team' OR v_role IN ('strategy_lead', 'senior_reviewer') THEN
    IF v_role = 'strategy_lead' THEN
      -- Strategy team scope: any client assigned to any active strategy member in the workspace
      RETURN EXISTS (
        SELECT 1 FROM public.roster_people rp
        WHERE rp.workspace_id = p_workspace_id
          AND rp.is_active = TRUE
          AND (rp.role::TEXT IN ('strategy_lead', 'strategist') OR 'strategy' = ANY(rp.specialties))
          AND (
            rp.id IN (
              v_client.primary_strategist_id,
              v_client.strategy_reviewer_id,
              v_client.strategy_lead_id,
              v_client.owner_roster_id
            )
            OR EXISTS (
              SELECT 1 FROM public.tasks t
              WHERE t.workspace_id = p_workspace_id
                AND t.client_id = p_client_id
                AND (t.primary_assignee_id = rp.id OR t.reviewer_id = rp.id)
            )
          )
      );
    ELSIF v_role = 'senior_reviewer' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.roster_people rp
        WHERE rp.workspace_id = p_workspace_id
          AND rp.is_active = TRUE
          AND (rp.role::TEXT IN ('designer', 'senior_reviewer') OR 'design' = ANY(rp.specialties))
          AND rp.id IN (
            v_client.owner_roster_id,
            v_client.primary_designer_id,
            v_client.backup_designer_id,
            v_client.design_reviewer_id
          )
      );
    END IF;
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION private.can_access_client_in_scope(UUID, UUID) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
