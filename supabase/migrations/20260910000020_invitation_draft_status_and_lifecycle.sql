-- Migration 20: Invitation Draft Status and Lifecycle Hardening
-- File: supabase/migrations/20260910000020_invitation_draft_status_and_lifecycle.sql

-- 1. Add 'draft' to invitation_status enum if not present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumtypid = 'public.invitation_status'::regtype
          AND enumlabel = 'draft'
    ) THEN
        ALTER TYPE public.invitation_status ADD VALUE 'draft';
    END IF;
END $$;

-- 2. Add last_sent_at and notes columns to workspace_invitations
ALTER TABLE public.workspace_invitations
ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- 3. Toggle member active status helper RPC (with Owner lockout protection)
CREATE OR REPLACE FUNCTION public.toggle_workspace_member_active(
    p_workspace_id UUID,
    p_roster_person_id UUID,
    p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
    v_caller RECORD;
    v_target_membership RECORD;
BEGIN
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    IF v_caller.role <> 'owner' THEN
        RAISE EXCEPTION 'Permission denied: Only Owner can toggle member activation status.';
    END IF;

    -- Target membership check
    SELECT * INTO v_target_membership
    FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id AND roster_person_id = p_roster_person_id;

    -- Protect Owner from self-deactivation
    IF v_target_membership.role = 'owner' AND p_is_active = FALSE THEN
        RAISE EXCEPTION 'Owner account cannot be deactivated. Transfer workspace ownership first.';
    END IF;

    -- Update roster_people
    UPDATE public.roster_people
    SET is_active = p_is_active,
        updated_at = pg_catalog.now()
    WHERE workspace_id = p_workspace_id AND id = p_roster_person_id;

    -- Update workspace_memberships if exists
    IF v_target_membership.id IS NOT NULL THEN
        UPDATE public.workspace_memberships
        SET is_active = p_is_active,
            updated_at = pg_catalog.now()
        WHERE id = v_target_membership.id;
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
        v_caller.roster_person_id,
        CASE WHEN p_is_active THEN 'activate_member' ELSE 'deactivate_member' END,
        'workspace_memberships',
        COALESCE(v_target_membership.id, p_roster_person_id),
        jsonb_build_object(
            'roster_person_id', p_roster_person_id,
            'is_active', p_is_active
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'roster_person_id', p_roster_person_id,
        'is_active', p_is_active
    );
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_workspace_member_active(UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_workspace_member_active(UUID, UUID, BOOLEAN) TO authenticated, service_role;
