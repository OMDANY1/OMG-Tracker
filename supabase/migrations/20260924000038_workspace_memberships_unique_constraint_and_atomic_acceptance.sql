-- Migration 38: Unconditional Unique Constraints on workspace_memberships & Atomic Invitation Acceptance RPC
-- File: supabase/migrations/20260924000038_workspace_memberships_unique_constraint_and_atomic_acceptance.sql

-- 1. Ensure unconditional UNIQUE constraint on (workspace_id, user_id)
-- PostgreSQL ON CONFLICT (workspace_id, user_id) requires an unconditional unique constraint/index.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'uq_workspace_memberships_workspace_user'
    ) THEN
        ALTER TABLE public.workspace_memberships
        ADD CONSTRAINT uq_workspace_memberships_workspace_user 
        UNIQUE (workspace_id, user_id);
    END IF;
END $$;

-- 2. Ensure unconditional UNIQUE constraint on (workspace_id, roster_person_id)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'uq_workspace_memberships_workspace_roster'
    ) THEN
        ALTER TABLE public.workspace_memberships
        ADD CONSTRAINT uq_workspace_memberships_workspace_roster 
        UNIQUE (workspace_id, roster_person_id);
    END IF;
END $$;

-- 3. Atomic, Idempotent, and Recoverable Invitation Acceptance RPC
CREATE OR REPLACE FUNCTION public.accept_workspace_invitation_atomic(
    p_invitation_id UUID,
    p_user_id UUID,
    p_token_hash TEXT DEFAULT NULL,
    p_user_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inv RECORD;
    v_roster RECORD;
    v_existing_mem RECORD;
    v_membership_id UUID;
    v_target_scope TEXT;
    v_target_perms JSONB;
    v_target_role public.workspace_memberships.role%TYPE;
    v_ws RECORD;
BEGIN
    -- 1. Fetch workspace invitation with row lock to serialize concurrent attempts
    IF p_token_hash IS NOT NULL AND p_token_hash <> '' THEN
        SELECT * INTO v_inv
        FROM public.workspace_invitations
        WHERE id = p_invitation_id AND token_hash = p_token_hash
        FOR UPDATE;
    ELSE
        SELECT * INTO v_inv
        FROM public.workspace_invitations
        WHERE id = p_invitation_id
        FOR UPDATE;
    END IF;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVITATION_NOT_FOUND',
            'error', 'رابط الدعوة غير صالح أو غير موجود.'
        );
    END IF;

    -- 2. Verify workspace invitation acceptance setting
    SELECT id, allow_invitation_acceptance, invitations_paused INTO v_ws
    FROM public.workspaces
    WHERE id = v_inv.workspace_id;

    IF v_ws.allow_invitation_acceptance = FALSE OR v_ws.invitations_paused = TRUE THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVITATIONS_PAUSED',
            'error', 'قبول وتفعيل الدعوات متوقف حالياً من قِبل إدارة الايجنسي.'
        );
    END IF;

    -- 3. Idempotency Check:
    -- If invitation was already accepted by this user, ensure membership is active and return success
    IF v_inv.status = 'accepted' THEN
        IF v_inv.accepted_by_id = p_user_id THEN
            SELECT id INTO v_membership_id
            FROM public.workspace_memberships
            WHERE workspace_id = v_inv.workspace_id AND user_id = p_user_id;

            IF v_membership_id IS NOT NULL THEN
                UPDATE public.workspace_memberships
                SET is_active = TRUE, updated_at = now()
                WHERE id = v_membership_id;

                SELECT display_name INTO v_roster FROM public.roster_people WHERE id = v_inv.roster_person_id;

                RETURN jsonb_build_object(
                    'success', true,
                    'already_accepted', true,
                    'membership_id', v_membership_id,
                    'display_name', COALESCE(v_roster.display_name, 'عضو الفريق'),
                    'role', v_inv.role,
                    'message', 'تم تفعيل حسابك مسبقاً بنجاح! يمكنك الآن الدخول لمساحة العمل.'
                );
            END IF;
        ELSE
            RETURN jsonb_build_object(
                'success', false,
                'code', 'ALREADY_ACCEPTED_BY_ANOTHER',
                'error', 'تم قبول هذه الدعوة بالفعل من حساب مستخدم آخر.'
            );
        END IF;
    END IF;

    -- 4. Status and expiration validation
    IF v_inv.status = 'revoked' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVITATION_REVOKED',
            'error', 'تم إلغاء هذه الدعوة من قِبل إدارة الايجنسي.'
        );
    END IF;

    IF v_inv.status = 'draft' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVITATION_DRAFT',
            'error', 'هذه الدعوة ما زالت مسودة داخلية ولم يتم تفعيلها بعد.'
        );
    END IF;

    IF v_inv.expires_at < now() THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVITATION_EXPIRED',
            'error', 'انتهت صلاحية رابط الدعوة. يرجى طلب رابط جديد من الإدارة.'
        );
    END IF;

    -- 5. Lock and verify roster person
    SELECT * INTO v_roster
    FROM public.roster_people
    WHERE id = v_inv.roster_person_id AND workspace_id = v_inv.workspace_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'ROSTER_NOT_FOUND',
            'error', 'لم يتم العثور على سجل العضو في مساحة العمل.'
        );
    END IF;

    -- Check if this roster person is already bound to another active user
    SELECT * INTO v_existing_mem
    FROM public.workspace_memberships
    WHERE workspace_id = v_inv.workspace_id AND roster_person_id = v_roster.id AND is_active = TRUE;

    IF FOUND AND v_existing_mem.user_id <> p_user_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'ROSTER_BOUND_TO_ANOTHER_USER',
            'error', 'سجل هذا العضو مرتبط بالفعل بمستخدم نشط آخر في مساحة العمل.'
        );
    END IF;

    -- Determine effective role, scope, and permissions
    v_target_role := v_inv.role;
    v_target_scope := COALESCE(v_roster.access_scope, 'assigned_tasks');
    v_target_perms := COALESCE(v_roster.custom_permissions, '{}'::jsonb);

    -- 6. Upsert workspace membership atomically (Strict invariant: exactly 1 membership per user per workspace)
    INSERT INTO public.workspace_memberships (
        workspace_id,
        user_id,
        roster_person_id,
        role,
        access_scope,
        custom_permissions,
        is_active,
        created_at,
        updated_at
    ) VALUES (
        v_inv.workspace_id,
        p_user_id,
        v_roster.id,
        v_target_role,
        v_target_scope,
        v_target_perms,
        TRUE,
        now(),
        now()
    )
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET
        roster_person_id = EXCLUDED.roster_person_id,
        role = EXCLUDED.role,
        access_scope = EXCLUDED.access_scope,
        custom_permissions = EXCLUDED.custom_permissions,
        is_active = TRUE,
        updated_at = now()
    RETURNING id INTO v_membership_id;

    -- 7. Update roster person role & active status
    UPDATE public.roster_people
    SET role = v_target_role,
        is_active = TRUE,
        updated_at = now()
    WHERE id = v_roster.id;

    -- 8. Mark invitation accepted ONLY AFTER membership is successfully established
    UPDATE public.workspace_invitations
    SET status = 'accepted',
        accepted_at = now(),
        accepted_by_id = p_user_id,
        updated_at = now()
    WHERE id = v_inv.id;

    -- 9. Insert audit event
    INSERT INTO public.audit_events (
        workspace_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_inv.workspace_id,
        v_roster.id,
        'accept_invitation',
        'workspace_memberships',
        v_membership_id,
        jsonb_build_object(
            'invitation_id', v_inv.id,
            'email', v_inv.invited_email,
            'user_id', p_user_id,
            'roster_person_id', v_roster.id,
            'role', v_target_role,
            'display_name', v_roster.display_name
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'membership_id', v_membership_id,
        'display_name', v_roster.display_name,
        'role', v_target_role,
        'email', v_inv.invited_email,
        'message', 'تم تفعيل حسابك بنجاح! يمكنك الآن الدخول لمساحة العمل.'
    );
END;
$$;

-- Grant execution to authenticated and service_role
GRANT EXECUTE ON FUNCTION public.accept_workspace_invitation_atomic TO authenticated, service_role;
