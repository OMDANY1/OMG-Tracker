-- Migration 34: Business Owner Viewer Role, Self-Service Team Administration & Safety Hardening
-- OMG Creative Workspace

-- 1. Extend roster_role ENUM with business_owner_viewer
ALTER TYPE public.roster_role ADD VALUE IF NOT EXISTS 'business_owner_viewer';

BEGIN;

-- 2. Hardened RPC: admin_create_roster_person
-- Allows Workspace Owner to add new team members from the UI
CREATE OR REPLACE FUNCTION public.admin_create_roster_person(
    p_workspace_id UUID,
    p_display_name TEXT,
    p_job_title TEXT,
    p_specialties TEXT[] DEFAULT '{}',
    p_role public.roster_role DEFAULT 'designer'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
    v_caller RECORD;
    v_new_id UUID := extensions.gen_random_uuid();
    v_clean_name TEXT;
    v_clean_title TEXT;
    v_is_service_role BOOLEAN;
    v_actor_roster UUID;
BEGIN
    v_is_service_role := (current_setting('request.jwt.claim.role', true) = 'service_role');
    v_clean_name := btrim(p_display_name);
    v_clean_title := btrim(p_job_title);

    IF v_clean_name IS NULL OR v_clean_name = '' THEN
        RAISE EXCEPTION 'اسم العضو مطلوب ولا يمكن أن يكون فارغاً.';
    END IF;

    IF v_clean_title IS NULL OR v_clean_title = '' THEN
        RAISE EXCEPTION 'المسمى الوظيفي مطلوب.';
    END IF;

    IF NOT v_is_service_role THEN
        SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
        IF v_caller.role <> 'owner' THEN
            RAISE EXCEPTION 'غير مصرح: صلاحية إضافة أعضاء الفريق حصرية للمدير العام (Owner).';
        END IF;
        v_actor_roster := v_caller.roster_person_id;
    ELSE
        SELECT roster_person_id INTO v_actor_roster
        FROM public.workspace_memberships
        WHERE workspace_id = p_workspace_id AND role = 'owner' AND is_active = TRUE
        LIMIT 1;
    END IF;

    -- Check if person name already exists in workspace
    IF EXISTS (
        SELECT 1 FROM public.roster_people
        WHERE workspace_id = p_workspace_id AND display_name = v_clean_name
    ) THEN
        RAISE EXCEPTION 'اسم الشخص مسجل بالفعل في قائمة الفريق: %', v_clean_name;
    END IF;

    -- Insert into roster_people
    INSERT INTO public.roster_people (
        id,
        workspace_id,
        display_name,
        job_title,
        specialties,
        is_active,
        created_at,
        updated_at
    ) VALUES (
        v_new_id,
        p_workspace_id,
        v_clean_name,
        v_clean_title,
        COALESCE(p_specialties, '{}'),
        TRUE,
        pg_catalog.now(),
        pg_catalog.now()
    );

    -- Audit log
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
        'create_roster_person',
        'roster_people',
        v_new_id,
        jsonb_build_object(
            'display_name', v_clean_name,
            'job_title', v_clean_title,
            'specialties', p_specialties,
            'role', p_role
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'id', v_new_id,
        'display_name', v_clean_name,
        'job_title', v_clean_title,
        'specialties', p_specialties,
        'role', p_role,
        'is_active', TRUE
    );
END;
$$;

-- 3. Hardened RPC: admin_update_roster_person
-- Allows Workspace Owner to update member details, specialties and role
CREATE OR REPLACE FUNCTION public.admin_update_roster_person(
    p_workspace_id UUID,
    p_roster_person_id UUID,
    p_job_title TEXT,
    p_specialties TEXT[],
    p_role public.roster_role
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
BEGIN
    v_is_service_role := (current_setting('request.jwt.claim.role', true) = 'service_role');
    v_clean_title := btrim(p_job_title);

    IF v_clean_title IS NULL OR v_clean_title = '' THEN
        RAISE EXCEPTION 'المسمى الوظيفي مطلوب.';
    END IF;

    IF NOT v_is_service_role THEN
        SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
        IF v_caller.role <> 'owner' THEN
            RAISE EXCEPTION 'غير مصرح: صلاحية تعديل بيانات أعضاء الفريق حصرية للمدير العام (Owner).';
        END IF;
        v_actor_roster := v_caller.roster_person_id;
    ELSE
        SELECT roster_person_id INTO v_actor_roster
        FROM public.workspace_memberships
        WHERE workspace_id = p_workspace_id AND role = 'owner' AND is_active = TRUE
        LIMIT 1;
    END IF;

    SELECT * INTO v_person FROM public.roster_people
    WHERE workspace_id = p_workspace_id AND id = p_roster_person_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'سجل الشخص غير موجود في مساحة العمل.';
    END IF;

    -- If changing role of an existing membership, ensure we do not remove the last active owner
    SELECT * INTO v_membership FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id AND roster_person_id = p_roster_person_id AND is_active = TRUE;

    IF FOUND AND v_membership.role = 'owner' AND p_role <> 'owner' THEN
        -- Check if there is another active owner
        IF (SELECT COUNT(*) FROM public.workspace_memberships WHERE workspace_id = p_workspace_id AND role = 'owner' AND is_active = TRUE AND id <> v_membership.id) = 0 THEN
            RAISE EXCEPTION 'لا يمكن تغيير دور آخر مدير عام نشط في مساحة العمل.';
        END IF;
    END IF;

    -- Update roster_people
    UPDATE public.roster_people
    SET job_title = v_clean_title,
        specialties = COALESCE(p_specialties, '{}'),
        updated_at = pg_catalog.now()
    WHERE workspace_id = p_workspace_id AND id = p_roster_person_id;

    -- If membership exists, update membership role
    IF v_membership.id IS NOT NULL AND p_role IS NOT NULL THEN
        UPDATE public.workspace_memberships
        SET role = p_role,
            updated_at = pg_catalog.now()
        WHERE id = v_membership.id;
    END IF;

    -- Audit log
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
            'old_job_title', v_person.job_title,
            'new_job_title', v_clean_title,
            'old_specialties', v_person.specialties,
            'new_specialties', p_specialties,
            'new_role', p_role
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'id', p_roster_person_id,
        'job_title', v_clean_title,
        'specialties', p_specialties,
        'role', p_role
    );
END;
$$;

-- 4. Hardened RPC: get_member_deactivation_impact
-- Checks open tasks and client assignments before deactivating a member
CREATE OR REPLACE FUNCTION public.get_member_deactivation_impact(
    p_workspace_id UUID,
    p_roster_person_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
    v_open_tasks JSONB;
    v_assigned_clients JSONB;
BEGIN
    -- 1. Find open tasks assigned to or reviewed by the person
    SELECT jsonb_agg(jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'status', t.status,
        'is_assignee', (t.primary_assignee_id = p_roster_person_id),
        'is_reviewer', (t.reviewer_id = p_roster_person_id)
    )) INTO v_open_tasks
    FROM public.tasks t
    WHERE t.workspace_id = p_workspace_id
      AND (t.primary_assignee_id = p_roster_person_id OR t.reviewer_id = p_roster_person_id)
      AND t.status NOT IN ('delivered', 'cancelled');

    -- 2. Find clients where this person is assigned to any track
    SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'track', CASE
            WHEN c.owner_roster_id = p_roster_person_id OR cta.primary_designer_id = p_roster_person_id THEN 'التصميم'
            WHEN cta.primary_strategist_id = p_roster_person_id THEN 'الاستراتيجية'
            WHEN cta.primary_copywriter_id = p_roster_person_id THEN 'كتابة المحتوى'
            WHEN cta.primary_video_editor_id = p_roster_person_id THEN 'المونتاج'
            WHEN cta.design_reviewer_id = p_roster_person_id THEN 'مراجعة التصميم'
            WHEN cta.strategy_reviewer_id = p_roster_person_id THEN 'مراجعة الاستراتيجية'
            WHEN cta.copywriting_reviewer_id = p_roster_person_id THEN 'مراجعة المحتوى'
            WHEN cta.video_reviewer_id = p_roster_person_id THEN 'مراجعة الفيديو'
            ELSE 'مسؤول'
        END
    )) INTO v_assigned_clients
    FROM public.clients c
    LEFT JOIN public.client_team_assignments cta ON c.id = cta.client_id
    WHERE c.workspace_id = p_workspace_id
      AND (
          c.owner_roster_id = p_roster_person_id OR
          cta.primary_designer_id = p_roster_person_id OR
          cta.primary_strategist_id = p_roster_person_id OR
          cta.primary_copywriter_id = p_roster_person_id OR
          cta.primary_video_editor_id = p_roster_person_id OR
          cta.design_reviewer_id = p_roster_person_id OR
          cta.strategy_reviewer_id = p_roster_person_id OR
          cta.copywriting_reviewer_id = p_roster_person_id OR
          cta.video_reviewer_id = p_roster_person_id
      );

    RETURN jsonb_build_object(
        'open_tasks', COALESCE(v_open_tasks, '[]'::jsonb),
        'open_tasks_count', jsonb_array_length(COALESCE(v_open_tasks, '[]'::jsonb)),
        'assigned_clients', COALESCE(v_assigned_clients, '[]'::jsonb),
        'assigned_clients_count', jsonb_array_length(COALESCE(v_assigned_clients, '[]'::jsonb))
    );
END;
$$;

-- 5. Revoke execution from public/anon and grant to authenticated and service_role
REVOKE ALL ON FUNCTION public.admin_create_roster_person(UUID, TEXT, TEXT, TEXT[], public.roster_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_roster_person(UUID, TEXT, TEXT, TEXT[], public.roster_role) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_update_roster_person(UUID, UUID, TEXT, TEXT[], public.roster_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_roster_person(UUID, UUID, TEXT, TEXT[], public.roster_role) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_member_deactivation_impact(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_deactivation_impact(UUID, UUID) TO authenticated, service_role;

COMMIT;
