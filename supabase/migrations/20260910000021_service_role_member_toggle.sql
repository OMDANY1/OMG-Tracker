-- Migration 21: Service role support for toggle_workspace_member_active
-- File: supabase/migrations/20260910000021_service_role_member_toggle.sql

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
    v_is_service_role BOOLEAN;
    v_actor_roster UUID;
BEGIN
    v_is_service_role := (current_setting('request.jwt.claim.role', true) = 'service_role');

    IF NOT v_is_service_role THEN
        SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
        IF v_caller.role <> 'owner' THEN
            RAISE EXCEPTION 'Permission denied: Only Owner can toggle member activation status.';
        END IF;
        v_actor_roster := v_caller.roster_person_id;
    ELSE
        SELECT roster_person_id INTO v_actor_roster
        FROM public.workspace_memberships
        WHERE workspace_id = p_workspace_id AND role = 'owner' AND is_active = TRUE
        LIMIT 1;
    END IF;

    -- Target membership check
    SELECT * INTO v_target_membership
    FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id AND roster_person_id = p_roster_person_id;

    -- Protect Owner from deactivation (Invariant)
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
        v_actor_roster,
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
