-- Migration 35: Authoritative Roster Roles and Permissions Matrix
-- Strictly Transactional: Everything wrapped in BEGIN; ... COMMIT;

BEGIN;

-- 1. Add authoritative role column to public.roster_people
ALTER TABLE public.roster_people
    ADD COLUMN IF NOT EXISTS role public.roster_role NOT NULL DEFAULT 'designer';

-- 2. Update existing roster members with their approved authoritative roles
-- Emad / Agency Owner -> owner
UPDATE public.roster_people
SET role = 'owner'
WHERE display_name IN ('عماد', 'المدير العام (Owner)');

-- Nada -> senior_reviewer
UPDATE public.roster_people
SET role = 'senior_reviewer'
WHERE display_name = 'ندى';

-- Atta -> marketing_director (Reports and export only)
UPDATE public.roster_people
SET role = 'marketing_director'
WHERE display_name = 'عطا';

-- Arwa -> strategy_lead (Strategy leadership and review)
UPDATE public.roster_people
SET role = 'strategy_lead'
WHERE display_name IN ('أروى', 'اروى');

-- Strategists
UPDATE public.roster_people
SET role = 'strategist'
WHERE display_name IN ('تسنيم', 'هند', 'هاجر حسن');

-- Content Writers
UPDATE public.roster_people
SET role = 'content_writer'
WHERE display_name IN ('ميرهان', 'ميار', 'ريهام');

-- Designers
UPDATE public.roster_people
SET role = 'designer'
WHERE display_name IN ('سارة', 'آلاء', 'شهد', 'آية');

-- 3. Update RPC: admin_create_roster_person to store role directly in roster_people
CREATE OR REPLACE FUNCTION public.admin_create_roster_person(
    p_workspace_id UUID,
    p_display_name TEXT,
    p_job_title TEXT,
    p_specialties TEXT[] DEFAULT '{}',
    p_role public.roster_role DEFAULT 'designer'::public.roster_role
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
    v_caller RECORD;
    v_new_id UUID;
    v_clean_name TEXT;
    v_clean_title TEXT;
    v_actor_roster UUID;
    v_is_service_role BOOLEAN;
    v_target_role public.roster_role;
BEGIN
    v_is_service_role := (current_setting('request.jwt.claim.role', true) = 'service_role');
    v_clean_name := btrim(p_display_name);
    v_clean_title := btrim(p_job_title);
    v_target_role := COALESCE(p_role, 'designer'::public.roster_role);

    IF v_clean_name IS NULL OR v_clean_name = '' THEN
        RAISE EXCEPTION 'اسم العضو مطلوب ولا يمكن أن يكون فارغاً.';
    END IF;
    IF v_clean_title IS NULL OR v_clean_title = '' THEN
        RAISE EXCEPTION 'المسمى الوظيفي مطلوب.';
    END IF;

    -- Verify caller is Owner (or service role)
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

    v_new_id := extensions.gen_random_uuid();

    -- Insert into roster_people with authoritative role
    INSERT INTO public.roster_people (
        id,
        workspace_id,
        display_name,
        job_title,
        specialties,
        role,
        is_active,
        created_at,
        updated_at
    ) VALUES (
        v_new_id,
        p_workspace_id,
        v_clean_name,
        v_clean_title,
        COALESCE(p_specialties, '{}'),
        v_target_role,
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
            'role', v_target_role
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'id', v_new_id,
        'display_name', v_clean_name,
        'job_title', v_clean_title,
        'specialties', p_specialties,
        'role', v_target_role,
        'is_active', TRUE
    );
END;
$$;

-- 4. Update RPC: admin_update_roster_person to update role in roster_people AND workspace_memberships
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
    v_target_role public.roster_role;
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

    v_target_role := COALESCE(p_role, v_person.role);

    -- Protect last active system administrator (owner)
    SELECT * INTO v_membership FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id AND roster_person_id = p_roster_person_id AND is_active = TRUE;

    IF (v_person.role = 'owner' OR (FOUND AND v_membership.role = 'owner')) AND v_target_role <> 'owner' THEN
        -- Check if there is another active owner in the workspace
        IF (SELECT COUNT(*) FROM public.roster_people WHERE workspace_id = p_workspace_id AND role = 'owner' AND is_active = TRUE AND id <> p_roster_person_id) = 0 THEN
            RAISE EXCEPTION 'لا يمكن تغيير دور آخر مدير عام نشط في مساحة العمل حفاظاً على استقرار النظام.';
        END IF;
    END IF;

    -- Update roster_people
    UPDATE public.roster_people
    SET job_title = v_clean_title,
        specialties = COALESCE(p_specialties, '{}'),
        role = v_target_role,
        updated_at = pg_catalog.now()
    WHERE workspace_id = p_workspace_id AND id = p_roster_person_id;

    -- If membership exists, update membership role as well
    IF v_membership.id IS NOT NULL THEN
        UPDATE public.workspace_memberships
        SET role = v_target_role,
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
            'old_role', v_person.role,
            'new_role', v_target_role
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'id', p_roster_person_id,
        'job_title', v_clean_title,
        'specialties', p_specialties,
        'role', v_target_role
    );
END;
$$;

COMMIT;
