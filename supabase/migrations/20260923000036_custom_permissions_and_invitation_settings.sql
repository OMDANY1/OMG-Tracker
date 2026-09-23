-- Migration 36: Granular Customizable Permissions, Access Scopes, and Isolated Invitation Settings
-- Strictly Transactional: Everything wrapped in BEGIN; ... COMMIT;

BEGIN;

-- 1. Extend public.workspaces with explicit invitation settings
ALTER TABLE public.workspaces
    ADD COLUMN IF NOT EXISTS allow_invitation_emails BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS allow_invitation_acceptance BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Extend public.roster_people with access_scope and custom_permissions
ALTER TABLE public.roster_people
    ADD COLUMN IF NOT EXISTS access_scope TEXT NOT NULL DEFAULT 'assigned_tasks',
    ADD COLUMN IF NOT EXISTS custom_permissions JSONB NOT NULL DEFAULT '{}'::JSONB;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_roster_access_scope'
    ) THEN
        ALTER TABLE public.roster_people
            ADD CONSTRAINT chk_roster_access_scope
            CHECK (access_scope IN ('workspace', 'assigned_team', 'assigned_clients', 'assigned_tasks'));
    END IF;
END $$;

-- 3. Extend public.workspace_memberships with access_scope and custom_permissions
ALTER TABLE public.workspace_memberships
    ADD COLUMN IF NOT EXISTS access_scope TEXT NOT NULL DEFAULT 'assigned_tasks',
    ADD COLUMN IF NOT EXISTS custom_permissions JSONB NOT NULL DEFAULT '{}'::JSONB;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_membership_access_scope'
    ) THEN
        ALTER TABLE public.workspace_memberships
            ADD CONSTRAINT chk_membership_access_scope
            CHECK (access_scope IN ('workspace', 'assigned_team', 'assigned_clients', 'assigned_tasks'));
    END IF;
END $$;

-- 4. Extend public.workspace_invitations with encrypted_token for secure secret storage
ALTER TABLE public.workspace_invitations
    ADD COLUMN IF NOT EXISTS encrypted_token TEXT;

-- 5. Seed default access_scopes on roster_people according to established roles
UPDATE public.roster_people
SET access_scope = 'workspace'
WHERE role IN ('owner', 'manager', 'marketing_director', 'business_owner_viewer');

UPDATE public.roster_people
SET access_scope = 'assigned_team'
WHERE role IN ('strategy_lead', 'senior_reviewer');

UPDATE public.roster_people
SET access_scope = 'assigned_clients'
WHERE role = 'strategist';

UPDATE public.roster_people
SET access_scope = 'assigned_tasks'
WHERE role IN ('designer', 'content_writer', 'video_editor');

-- Sync existing workspace_memberships from roster_people
UPDATE public.workspace_memberships wm
SET access_scope = rp.access_scope,
    custom_permissions = rp.custom_permissions
FROM public.roster_people rp
WHERE wm.roster_person_id = rp.id;

-- 6. Ensure legacy owner account is marked inactive
UPDATE public.roster_people
SET is_active = FALSE
WHERE display_name = 'المدير العام (Owner)';

-- 7. Update RPC: admin_create_roster_person
CREATE OR REPLACE FUNCTION public.admin_create_roster_person(
    p_workspace_id UUID,
    p_display_name TEXT,
    p_job_title TEXT,
    p_specialties TEXT[] DEFAULT '{}',
    p_role public.roster_role DEFAULT 'designer'::public.roster_role,
    p_access_scope TEXT DEFAULT 'assigned_tasks',
    p_custom_permissions JSONB DEFAULT '{}'::JSONB
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
    v_target_scope TEXT;
BEGIN
    v_is_service_role := (current_setting('request.jwt.claim.role', true) = 'service_role');
    v_clean_name := btrim(p_display_name);
    v_clean_title := btrim(p_job_title);
    v_target_role := COALESCE(p_role, 'designer'::public.roster_role);
    v_target_scope := COALESCE(p_access_scope, 'assigned_tasks');

    IF v_clean_name IS NULL OR v_clean_name = '' THEN
        RAISE EXCEPTION 'اسم العضو مطلوب ولا يمكن أن يكون فارغاً.';
    END IF;
    IF v_clean_title IS NULL OR v_clean_title = '' THEN
        RAISE EXCEPTION 'المسمى الوظيفي مطلوب.';
    END IF;

    IF v_target_scope NOT IN ('workspace', 'assigned_team', 'assigned_clients', 'assigned_tasks') THEN
        RAISE EXCEPTION 'نطاق الوصول المحدد غير صالح.';
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

    -- Check duplicate name in workspace
    IF EXISTS (
        SELECT 1 FROM public.roster_people
        WHERE workspace_id = p_workspace_id AND display_name = v_clean_name
    ) THEN
        RAISE EXCEPTION 'اسم الشخص مسجل بالفعل في قائمة الفريق: %', v_clean_name;
    END IF;

    v_new_id := extensions.gen_random_uuid();

    INSERT INTO public.roster_people (
        id,
        workspace_id,
        display_name,
        job_title,
        specialties,
        role,
        access_scope,
        custom_permissions,
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
        v_target_scope,
        COALESCE(p_custom_permissions, '{}'::JSONB),
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
            'role', v_target_role,
            'access_scope', v_target_scope,
            'custom_permissions', p_custom_permissions
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'id', v_new_id,
        'display_name', v_clean_name,
        'job_title', v_clean_title,
        'specialties', p_specialties,
        'role', v_target_role,
        'access_scope', v_target_scope,
        'custom_permissions', p_custom_permissions,
        'is_active', TRUE
    );
END;
$$;

-- 8. Update RPC: admin_update_roster_person
CREATE OR REPLACE FUNCTION public.admin_update_roster_person(
    p_workspace_id UUID,
    p_roster_person_id UUID,
    p_job_title TEXT,
    p_specialties TEXT[],
    p_role public.roster_role,
    p_access_scope TEXT DEFAULT NULL,
    p_custom_permissions JSONB DEFAULT NULL
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
    v_target_scope TEXT;
    v_target_permissions JSONB;
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
    v_target_scope := COALESCE(p_access_scope, v_person.access_scope, 'assigned_tasks');
    v_target_permissions := COALESCE(p_custom_permissions, v_person.custom_permissions, '{}'::JSONB);

    IF v_target_scope NOT IN ('workspace', 'assigned_team', 'assigned_clients', 'assigned_tasks') THEN
        RAISE EXCEPTION 'نطاق الوصول المحدد غير صالح.';
    END IF;

    -- Protect last active system administrator (owner)
    SELECT * INTO v_membership FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id AND roster_person_id = p_roster_person_id AND is_active = TRUE;

    IF (v_person.role = 'owner' OR (FOUND AND v_membership.role = 'owner')) AND v_target_role <> 'owner' THEN
        IF (SELECT COUNT(*) FROM public.roster_people WHERE workspace_id = p_workspace_id AND role = 'owner' AND is_active = TRUE AND id <> p_roster_person_id) = 0 THEN
            RAISE EXCEPTION 'لا يمكن تغيير دور آخر مدير عام نشط في مساحة العمل حفاظاً على استقرار النظام.';
        END IF;
    END IF;

    -- Owner must retain full workspace scope
    IF v_target_role = 'owner' THEN
        v_target_scope := 'workspace';
    END IF;

    -- Update roster_people
    UPDATE public.roster_people
    SET job_title = v_clean_title,
        specialties = COALESCE(p_specialties, '{}'),
        role = v_target_role,
        access_scope = v_target_scope,
        custom_permissions = v_target_permissions,
        updated_at = pg_catalog.now()
    WHERE workspace_id = p_workspace_id AND id = p_roster_person_id;

    -- If membership exists, update membership role, scope and permissions as well
    IF v_membership.id IS NOT NULL THEN
        UPDATE public.workspace_memberships
        SET role = v_target_role,
            access_scope = v_target_scope,
            custom_permissions = v_target_permissions,
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
            'new_role', v_target_role,
            'old_access_scope', v_person.access_scope,
            'new_access_scope', v_target_scope,
            'old_custom_permissions', v_person.custom_permissions,
            'new_custom_permissions', v_target_permissions
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'id', p_roster_person_id,
        'job_title', v_clean_title,
        'specialties', p_specialties,
        'role', v_target_role,
        'access_scope', v_target_scope,
        'custom_permissions', v_target_permissions
    );
END;
$$;

-- 9. RPC: set_workspace_invitation_settings
CREATE OR REPLACE FUNCTION public.set_workspace_invitation_settings(
    p_workspace_id UUID,
    p_allow_emails BOOLEAN,
    p_allow_acceptance BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
    v_caller RECORD;
    v_actor_roster UUID;
    v_is_service_role BOOLEAN;
    v_old_emails BOOLEAN;
    v_old_accept BOOLEAN;
BEGIN
    v_is_service_role := (current_setting('request.jwt.claim.role', true) = 'service_role');

    IF NOT v_is_service_role THEN
        SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
        IF v_caller.role <> 'owner' THEN
            RAISE EXCEPTION 'غير مصرح: تعديل إعدادات الدعوات مقتصر على المدير العام (Owner).';
        END IF;
        v_actor_roster := v_caller.roster_person_id;
    ELSE
        SELECT roster_person_id INTO v_actor_roster
        FROM public.workspace_memberships
        WHERE workspace_id = p_workspace_id AND role = 'owner' AND is_active = TRUE
        LIMIT 1;
    END IF;

    SELECT allow_invitation_emails, allow_invitation_acceptance
    INTO v_old_emails, v_old_accept
    FROM public.workspaces
    WHERE id = p_workspace_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'مساحة العمل غير موجودة.';
    END IF;

    UPDATE public.workspaces
    SET allow_invitation_emails = p_allow_emails,
        allow_invitation_acceptance = p_allow_acceptance,
        invitations_paused = (NOT p_allow_acceptance),
        updated_at = pg_catalog.now()
    WHERE id = p_workspace_id;

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
        'set_invitation_settings',
        'workspaces',
        p_workspace_id,
        jsonb_build_object(
            'old_allow_emails', v_old_emails,
            'new_allow_emails', p_allow_emails,
            'old_allow_acceptance', v_old_accept,
            'new_allow_acceptance', p_allow_acceptance,
            'invitations_paused', (NOT p_allow_acceptance)
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'allow_invitation_emails', p_allow_emails,
        'allow_invitation_acceptance', p_allow_acceptance,
        'invitations_paused', (NOT p_allow_acceptance)
    );
END;
$$;

-- 10. Update RPC: accept_workspace_invitation to sync scope and permissions
CREATE OR REPLACE FUNCTION public.accept_workspace_invitation(
    p_raw_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, auth
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_user_email TEXT;
    v_token_hash TEXT;
    v_inv RECORD;
    v_roster RECORD;
    v_membership_id UUID;
    v_existing_membership RECORD;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required to accept an invitation.';
    END IF;

    SELECT pg_catalog.lower(btrim(email)) INTO v_user_email
    FROM auth.users
    WHERE id = v_uid;

    IF v_user_email IS NULL OR v_user_email = '' THEN
        RAISE EXCEPTION 'Authenticated user must have a valid registered email to accept invitations.';
    END IF;

    -- Compute SHA-256 hash server-side
    v_token_hash := pg_catalog.encode(extensions.digest(p_raw_token, 'sha256'), 'hex');

    PERFORM 1 FROM public.workspaces WHERE id = (SELECT workspace_id FROM public.workspace_invitations WHERE token_hash = v_token_hash) FOR UPDATE;

    -- 1. Row-lock invitation
    SELECT * INTO v_inv
    FROM public.workspace_invitations
    WHERE token_hash = v_token_hash
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid invitation token.';
    END IF;

    -- Check allow_invitation_acceptance on workspace
    IF EXISTS (
        SELECT 1 FROM public.workspaces
        WHERE id = v_inv.workspace_id AND (invitations_paused = TRUE OR allow_invitation_acceptance = FALSE)
    ) THEN
        RAISE EXCEPTION 'قبول الدعوات متوقف حالياً في مساحة العمل بناءً على إعدادات الإدارة.';
    END IF;

    -- Check status
    IF v_inv.status <> 'pending' THEN
        RAISE EXCEPTION 'Invitation is no longer pending (current status: %).', v_inv.status;
    END IF;

    -- Expiration handling
    IF v_inv.expires_at <= pg_catalog.now() THEN
        UPDATE public.workspace_invitations
        SET status = 'expired', updated_at = pg_catalog.now()
        WHERE id = v_inv.id;

        RETURN jsonb_build_object(
            'success', FALSE,
            'status', 'expired',
            'error', 'Invitation has expired.'
        );
    END IF;

    -- 2. Strict Email Match Verification
    IF v_user_email <> v_inv.invited_email THEN
        RAISE EXCEPTION 'Email mismatch: Authenticated user email does not match invitation recipient email.';
    END IF;

    -- 3. Row-lock target roster person
    SELECT * INTO v_roster
    FROM public.roster_people
    WHERE id = v_inv.roster_person_id
    FOR UPDATE;

    IF NOT FOUND OR v_roster.is_active = FALSE THEN
        RAISE EXCEPTION 'Bound roster person is not found or inactive.';
    END IF;

    -- 4. Check if target roster person is already bound to another ACTIVE user
    IF EXISTS (
        SELECT 1 FROM public.workspace_memberships
        WHERE workspace_id = v_inv.workspace_id
          AND roster_person_id = v_inv.roster_person_id
          AND user_id <> v_uid
          AND is_active = TRUE
    ) THEN
        RAISE EXCEPTION 'Target roster person is already actively bound to another user.';
    END IF;

    -- 5. Safe upsert: Re-activate inactive membership or create new
    SELECT * INTO v_existing_membership
    FROM public.workspace_memberships
    WHERE workspace_id = v_inv.workspace_id
      AND user_id = v_uid
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_membership.is_active = TRUE THEN
            RAISE EXCEPTION 'User is already an active member of this workspace.';
        END IF;

        UPDATE public.workspace_memberships
        SET roster_person_id = v_inv.roster_person_id,
            role = v_inv.role,
            access_scope = v_roster.access_scope,
            custom_permissions = v_roster.custom_permissions,
            is_active = TRUE,
            updated_at = pg_catalog.now()
        WHERE id = v_existing_membership.id
        RETURNING id INTO v_membership_id;
    ELSE
        INSERT INTO public.workspace_memberships (
            workspace_id,
            user_id,
            roster_person_id,
            role,
            access_scope,
            custom_permissions,
            is_active
        ) VALUES (
            v_inv.workspace_id,
            v_uid,
            v_inv.roster_person_id,
            v_inv.role,
            v_roster.access_scope,
            v_roster.custom_permissions,
            TRUE
        ) RETURNING id INTO v_membership_id;
    END IF;

    -- 6. Mark invitation accepted
    UPDATE public.workspace_invitations
    SET status = 'accepted',
        accepted_at = pg_catalog.now(),
        accepted_by_id = v_uid,
        updated_at = pg_catalog.now()
    WHERE id = v_inv.id;

    -- 7. Audit Event
    INSERT INTO public.audit_events (
        workspace_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_inv.workspace_id,
        v_inv.roster_person_id,
        'accept_invitation',
        'workspace_invitations',
        v_inv.id,
        jsonb_build_object(
            'accepted_by_uid', v_uid,
            'membership_id', v_membership_id,
            'roster_person_id', v_inv.roster_person_id,
            'role', v_inv.role,
            'access_scope', v_roster.access_scope
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'membership_id', v_membership_id,
        'workspace_id', v_inv.workspace_id,
        'role', v_inv.role,
        'access_scope', v_roster.access_scope
    );
END;
$$;

-- 11. Permissions and Grants
GRANT EXECUTE ON FUNCTION public.admin_create_roster_person(UUID, TEXT, TEXT, TEXT[], public.roster_role, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_roster_person(UUID, UUID, TEXT, TEXT[], public.roster_role, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_workspace_invitation_settings(UUID, BOOLEAN, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invitation(TEXT) TO authenticated, service_role;

COMMIT;
