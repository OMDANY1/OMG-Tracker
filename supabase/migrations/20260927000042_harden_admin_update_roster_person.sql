-- ==============================================================================
-- Migration: 20260927000042_harden_admin_update_roster_person.sql
-- Description: Harden admin_update_roster_person RPC to:
--  1. Allow company_owner (alongside owner) to execute updates.
--  2. Support p_display_name to update member display name.
--  3. Automatically enforce full workspace scope and permissions for company_owner.
--  4. Synchronize role, access_scope, and custom_permissions to workspace_memberships.
-- ==============================================================================

-- Drop old 7-parameter version to avoid PostgREST ambiguous function overload error
DROP FUNCTION IF EXISTS public.admin_update_roster_person(UUID, UUID, TEXT, TEXT[], public.roster_role, TEXT, JSONB);

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
SET search_path = public, private
AS $$
DECLARE
    v_caller RECORD;
    v_person RECORD;
    v_membership RECORD;
    v_is_service_role BOOLEAN;
    v_actor_roster UUID;
    v_clean_title TEXT;
    v_clean_name TEXT;
    v_target_role public.roster_role;
    v_target_scope TEXT;
    v_target_permissions JSONB;
    v_full_permissions JSONB;
BEGIN
    v_is_service_role := (current_setting('request.jwt.claim.role', true) = 'service_role');
    v_clean_title := btrim(p_job_title);
    v_clean_name := btrim(COALESCE(p_display_name, ''));

    IF v_clean_title IS NULL OR v_clean_title = '' THEN
        RAISE EXCEPTION 'المسمى الوظيفي مطلوب.';
    END IF;

    -- Verification of caller: Owner or Company Owner or service_role
    IF NOT v_is_service_role THEN
        SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
        IF v_caller.role NOT IN ('owner', 'company_owner') THEN
            RAISE EXCEPTION 'غير مصرح: صلاحية تعديل بيانات أعضاء الفريق حصرية لمالك الشركة والمدير العام.';
        END IF;
        v_actor_roster := v_caller.roster_person_id;
    ELSE
        SELECT roster_person_id INTO v_actor_roster
        FROM public.workspace_memberships
        WHERE workspace_id = p_workspace_id AND role IN ('owner', 'company_owner') AND is_active = TRUE
        LIMIT 1;
    END IF;

    -- Check target person exists
    SELECT * INTO v_person FROM public.roster_people
    WHERE workspace_id = p_workspace_id AND id = p_roster_person_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'سجل الشخص غير موجود في مساحة العمل.';
    END IF;

    v_target_role := COALESCE(p_role, v_person.role);
    v_target_scope := COALESCE(p_access_scope, v_person.access_scope, 'assigned_tasks');
    v_target_permissions := COALESCE(p_custom_permissions, v_person.custom_permissions, '{}'::JSONB);

    -- Protect last active system administrator
    SELECT * INTO v_membership FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id AND roster_person_id = p_roster_person_id AND is_active = TRUE
    LIMIT 1;

    IF (v_person.role IN ('owner', 'company_owner') OR (FOUND AND v_membership.role IN ('owner', 'company_owner'))) 
       AND v_target_role NOT IN ('owner', 'company_owner') THEN
        IF (SELECT COUNT(*) FROM public.roster_people 
            WHERE workspace_id = p_workspace_id AND role IN ('owner', 'company_owner') AND is_active = TRUE AND id <> p_roster_person_id) = 0 THEN
            RAISE EXCEPTION 'لا يمكن خفض رتبة أو تغيير دور آخر مسؤول نشط في مساحة العمل حفاظاً على استقرار النظام.';
        END IF;
    END IF;

    -- Define full permission set for owners
    v_full_permissions := jsonb_build_object(
        'manage_workspace', true,
        'manage_clients', true,
        'delete_clients', true,
        'assign_team', true,
        'create_tasks', true,
        'approve_reviews', true,
        'approve_strategy', true,
        'track_timer', true,
        'view_time_logs', true,
        'export_reports', true,
        'invite_members', true,
        'manage_members', true,
        'create_campaigns', true,
        'comment_and_attachments', true
    );

    -- Owner and Company Owner MUST retain full workspace scope and permissions
    IF v_target_role IN ('owner', 'company_owner') THEN
        v_target_scope := 'workspace';
        v_target_permissions := v_full_permissions;
    END IF;

    IF v_target_scope NOT IN ('workspace', 'assigned_team', 'assigned_clients', 'assigned_tasks') THEN
        RAISE EXCEPTION 'نطاق الوصول المحدد غير صالح.';
    END IF;

    -- 1. Update roster_people
    UPDATE public.roster_people
    SET display_name = CASE WHEN v_clean_name <> '' THEN v_clean_name ELSE display_name END,
        job_title = v_clean_title,
        specialties = COALESCE(p_specialties, '{}'),
        role = v_target_role,
        access_scope = v_target_scope,
        custom_permissions = v_target_permissions,
        updated_at = pg_catalog.now()
    WHERE workspace_id = p_workspace_id AND id = p_roster_person_id;

    -- 2. Synchronize to workspace_memberships if exists
    UPDATE public.workspace_memberships
    SET role = v_target_role,
        access_scope = v_target_scope,
        custom_permissions = v_target_permissions,
        updated_at = pg_catalog.now()
    WHERE workspace_id = p_workspace_id AND roster_person_id = p_roster_person_id;

    -- 3. Audit event
    INSERT INTO public.audit_events (
        workspace_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        p_workspace_id,
        v_actor_roster,
        'update_roster_person',
        'roster_people',
        p_roster_person_id,
        jsonb_build_object(
            'old_display_name', v_person.display_name,
            'new_display_name', CASE WHEN v_clean_name <> '' THEN v_clean_name ELSE v_person.display_name END,
            'old_job_title', v_person.job_title,
            'new_job_title', v_clean_title,
            'old_role', v_person.role,
            'new_role', v_target_role,
            'old_access_scope', v_person.access_scope,
            'new_access_scope', v_target_scope,
            'custom_permissions', v_target_permissions
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'id', p_roster_person_id,
        'role', v_target_role,
        'display_name', CASE WHEN v_clean_name <> '' THEN v_clean_name ELSE v_person.display_name END,
        'job_title', v_clean_title,
        'access_scope', v_target_scope,
        'custom_permissions', v_target_permissions
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_roster_person(UUID, UUID, TEXT, TEXT[], public.roster_role, TEXT, JSONB, TEXT) TO authenticated, service_role;
