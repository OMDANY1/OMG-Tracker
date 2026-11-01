-- Migration 56: Fix p_role::TEXT cast in public.admin_update_roster_person
-- Prevents invalid enum literal cast when checking viewer/read-only roles.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_update_roster_person(
  p_workspace_id UUID,
  p_roster_person_id UUID,
  p_job_title TEXT,
  p_specialties TEXT[],
  p_role public.roster_role,
  p_access_scope TEXT DEFAULT NULL,
  p_custom_permissions JSONB DEFAULT NULL,
  p_display_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller RECORD;
  v_target RECORD;
  v_active_owners_count INT;
  v_clean_title TEXT;
  v_clean_name TEXT;
  v_clean_scope TEXT;
  v_clean_perms JSONB;
BEGIN
  IF p_workspace_id IS NULL OR p_roster_person_id IS NULL THEN
    RAISE EXCEPTION 'Workspace ID and Roster Person ID are required.';
  END IF;

  SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
  IF v_caller.role::TEXT NOT IN ('owner', 'company_owner') THEN
    RAISE EXCEPTION 'Only the workspace Owner or Company Owner can update roster member details and roles.';
  END IF;

  v_clean_title := btrim(COALESCE(p_job_title, ''));
  IF v_clean_title = '' THEN
    RAISE EXCEPTION 'Job title cannot be empty.';
  END IF;

  SELECT * INTO v_target
  FROM public.roster_people
  WHERE id = p_roster_person_id AND workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Roster member not found in this workspace.';
  END IF;

  v_clean_name := NULLIF(btrim(COALESCE(p_display_name, '')), '');
  IF v_clean_name IS NULL THEN
    v_clean_name := v_target.display_name;
  END IF;

  -- Prevent self-downgrade or removing the last active owner
  IF v_target.role::TEXT = 'owner' AND p_role::TEXT <> 'owner' THEN
    SELECT COUNT(*)::INT INTO v_active_owners_count
    FROM public.roster_people
    WHERE workspace_id = p_workspace_id
      AND role::TEXT = 'owner'
      AND is_active = TRUE
      AND id <> p_roster_person_id;

    IF v_active_owners_count < 1 THEN
      RAISE EXCEPTION 'Cannot downgrade the only active Owner of the workspace.';
    END IF;
  END IF;

  -- Validate and normalize access_scope
  v_clean_scope := COALESCE(p_access_scope, v_target.access_scope, 'assigned_clients');
  IF v_clean_scope NOT IN ('all_clients', 'assigned_team', 'assigned_clients', 'read_only_all') THEN
    v_clean_scope := 'assigned_clients';
  END IF;

  IF p_role::TEXT IN ('owner', 'company_owner', 'manager') THEN
    v_clean_scope := 'all_clients';
  ELSIF p_role::TEXT IN ('marketing_director', 'business_owner_viewer', 'viewer') THEN
    v_clean_scope := 'read_only_all';
  ELSIF p_role::TEXT = 'strategy_lead' AND v_clean_scope = 'assigned_clients' THEN
    v_clean_scope := 'assigned_team';
  END IF;

  v_clean_perms := COALESCE(p_custom_permissions, v_target.custom_permissions, '{}'::jsonb);

  -- Enforce locked role guards on custom_permissions in DB
  IF p_role::TEXT IN ('owner', 'company_owner') THEN
    v_clean_perms := jsonb_build_object(
      'track_timer', true,
      'create_tasks', true,
      'assign_team', true,
      'approve_reviews', true,
      'approve_strategy', true,
      'manage_clients', true,
      'delete_clients', true,
      'create_campaigns', true,
      'export_reports', true,
      'view_time_logs', true,
      'invite_members', true,
      'manage_members', true,
      'manage_workspace', true
    );
  ELSE
    -- Non-owners cannot hold system-admin privileges
    v_clean_perms := v_clean_perms || jsonb_build_object(
      'manage_workspace', false,
      'manage_members', false,
      'invite_members', false,
      'delete_clients', false
    );
    IF p_role::TEXT IN ('marketing_director', 'business_owner_viewer', 'viewer') THEN
      v_clean_perms := v_clean_perms || jsonb_build_object(
        'track_timer', false,
        'create_tasks', false,
        'assign_team', false,
        'approve_reviews', false,
        'approve_strategy', false,
        'manage_clients', false,
        'create_campaigns', false
      );
    END IF;
  END IF;

  -- 1. Update roster_people
  UPDATE public.roster_people
  SET display_name = v_clean_name,
      job_title = v_clean_title,
      specialties = COALESCE(p_specialties, ARRAY[]::TEXT[]),
      role = p_role,
      access_scope = v_clean_scope,
      custom_permissions = v_clean_perms,
      updated_at = pg_catalog.now()
  WHERE id = p_roster_person_id AND workspace_id = p_workspace_id;

  -- 2. Synchronize workspace_memberships immediately (role + access_scope + custom_permissions)
  UPDATE public.workspace_memberships
  SET role = p_role,
      access_scope = v_clean_scope,
      custom_permissions = v_clean_perms,
      updated_at = pg_catalog.now()
  WHERE roster_person_id = p_roster_person_id AND workspace_id = p_workspace_id;

  -- 3. Record audit event in public.audit_events
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
    'roster_person.updated_permissions',
    'roster_person',
    p_roster_person_id,
    jsonb_build_object(
      'display_name', v_clean_name,
      'old_role', v_target.role,
      'new_role', p_role,
      'old_access_scope', v_target.access_scope,
      'new_access_scope', v_clean_scope,
      'old_custom_permissions', COALESCE(v_target.custom_permissions, '{}'::jsonb),
      'new_custom_permissions', v_clean_perms
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'roster_person_id', p_roster_person_id,
    'display_name', v_clean_name,
    'job_title', v_clean_title,
    'role', p_role,
    'access_scope', v_clean_scope,
    'custom_permissions', v_clean_perms,
    'specialties', COALESCE(p_specialties, ARRAY[]::TEXT[])
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_roster_person(UUID, UUID, TEXT, TEXT[], public.roster_role, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_roster_person(UUID, UUID, TEXT, TEXT[], public.roster_role, TEXT, JSONB, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
