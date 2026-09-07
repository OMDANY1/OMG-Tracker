-- OMG Creative Workspace: Constraints, Functions & Workflows (V3.5-R1 repaired baseline)
-- Migration: 20260906000002_constraints_and_functions.sql
BEGIN;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_time_entries_range
ON public.time_entries (workspace_id, roster_person_id, started_at, ended_at);

CREATE INDEX IF NOT EXISTS idx_time_entries_task
ON public.time_entries (task_id, started_at);

-- -----------------------------------------------------------------------------
-- 2. PRIVATE SCHEMA INTERNAL HELPERS (Revoked from PostgREST / Public)
-- -----------------------------------------------------------------------------

-- Helper to safely resolve caller identity and role server-side
CREATE OR REPLACE FUNCTION private.get_caller_context(p_workspace_id UUID)
RETURNS TABLE (
    user_id UUID,
    role public.roster_role,
    roster_person_id UUID,
    display_name TEXT
) AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required: User session not found.';
    END IF;

    RETURN QUERY
    SELECT
        wm.user_id,
        wm.role,
        wm.roster_person_id,
        rp.display_name
    FROM public.workspace_memberships wm
    JOIN public.roster_people rp ON wm.roster_person_id = rp.id
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = v_uid
      AND wm.is_active = TRUE
      AND rp.is_active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Access denied: Active workspace membership and active roster record required.';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- -----------------------------------------------------------------------------
-- RLS PREDICATE HELPERS (Private Schema, SECURITY DEFINER, STABLE)
-- Require BOTH active membership AND active roster person
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.is_workspace_member(p_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.workspace_memberships wm
        JOIN public.roster_people rp ON wm.roster_person_id = rp.id
        WHERE wm.workspace_id = p_workspace_id
          AND wm.user_id = auth.uid()
          AND wm.is_active = TRUE
          AND rp.is_active = TRUE
    );
$$;

CREATE OR REPLACE FUNCTION private.caller_roster_id(p_workspace_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT wm.roster_person_id
    FROM public.workspace_memberships wm
    JOIN public.roster_people rp ON wm.roster_person_id = rp.id
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = auth.uid()
      AND wm.is_active = TRUE
      AND rp.is_active = TRUE
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.caller_role(p_workspace_id UUID)
RETURNS public.roster_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT wm.role
    FROM public.workspace_memberships wm
    JOIN public.roster_people rp ON wm.roster_person_id = rp.id
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = auth.uid()
      AND wm.is_active = TRUE
      AND rp.is_active = TRUE
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.is_workspace_manager(p_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.workspace_memberships wm
        JOIN public.roster_people rp ON wm.roster_person_id = rp.id
        WHERE wm.workspace_id = p_workspace_id
          AND wm.user_id = auth.uid()
          AND wm.is_active = TRUE
          AND rp.is_active = TRUE
          AND wm.role IN ('owner', 'manager')
    );
$$;

CREATE OR REPLACE FUNCTION private.can_access_task(p_task_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_task RECORD;
    v_caller_roster UUID;
    v_caller_role public.roster_role;
BEGIN
    SELECT workspace_id, primary_assignee_id, reviewer_id
    INTO v_task
    FROM public.tasks
    WHERE id = p_task_id;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    SELECT wm.roster_person_id, wm.role
    INTO v_caller_roster, v_caller_role
    FROM public.workspace_memberships wm
    JOIN public.roster_people rp ON wm.roster_person_id = rp.id
    WHERE wm.workspace_id = v_task.workspace_id
      AND wm.user_id = auth.uid()
      AND wm.is_active = TRUE
      AND rp.is_active = TRUE;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    IF v_caller_role IN ('owner', 'manager') THEN
        RETURN TRUE;
    END IF;

    IF v_task.primary_assignee_id = v_caller_roster OR v_task.reviewer_id = v_caller_roster THEN
        RETURN TRUE;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM public.task_collaborators
        WHERE task_id = p_task_id AND roster_person_id = v_caller_roster
    );
END;
$$;

CREATE OR REPLACE FUNCTION private.can_work_on_task(p_task_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_task RECORD;
    v_caller_roster UUID;
    v_caller_role public.roster_role;
BEGIN
    SELECT workspace_id, primary_assignee_id
    INTO v_task
    FROM public.tasks
    WHERE id = p_task_id;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    SELECT wm.roster_person_id, wm.role
    INTO v_caller_roster, v_caller_role
    FROM public.workspace_memberships wm
    JOIN public.roster_people rp ON wm.roster_person_id = rp.id
    WHERE wm.workspace_id = v_task.workspace_id
      AND wm.user_id = auth.uid()
      AND wm.is_active = TRUE
      AND rp.is_active = TRUE;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    IF v_caller_role IN ('owner', 'manager') THEN
        RETURN TRUE;
    END IF;

    IF v_task.primary_assignee_id = v_caller_roster THEN
        RETURN TRUE;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM public.task_collaborators
        WHERE task_id = p_task_id AND roster_person_id = v_caller_roster
    );
END;
$$;

-- Advisory Lock & Atomic Idempotency Checker
CREATE OR REPLACE FUNCTION private.fn_acquire_idempotency_lock(
    p_workspace_id UUID,
    p_actor_id UUID,
    p_operation_name TEXT,
    p_idempotency_key TEXT,
    p_request_hash TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_lock_key BIGINT;
    v_existing RECORD;
BEGIN
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'Idempotency key is required for mutating operations.';
    END IF;

    -- Compute 64-bit advisory transaction lock key
    v_lock_key := pg_catalog.hashtextextended(
        p_workspace_id::TEXT || ':' ||
        p_actor_id::TEXT || ':' ||
        p_operation_name || ':' ||
        p_idempotency_key,
        0
    );

    PERFORM pg_catalog.pg_advisory_xact_lock(v_lock_key);

    SELECT * INTO v_existing
    FROM public.rpc_idempotency_records
    WHERE workspace_id = p_workspace_id
      AND actor_id = p_actor_id
      AND operation_name = p_operation_name
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_existing.request_hash <> p_request_hash THEN
            RAISE EXCEPTION 'Idempotency key conflict: Key % was already used with different parameters.', p_idempotency_key;
        END IF;
        RETURN v_existing.response_payload;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION private.fn_record_idempotency(
    p_workspace_id UUID,
    p_actor_id UUID,
    p_operation_name TEXT,
    p_idempotency_key TEXT,
    p_request_hash TEXT,
    p_response JSONB
)
RETURNS VOID AS $$
BEGIN
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RETURN;
    END IF;

    INSERT INTO public.rpc_idempotency_records (
        workspace_id,
        actor_id,
        operation_name,
        idempotency_key,
        request_hash,
        response_payload
    ) VALUES (
        p_workspace_id,
        p_actor_id,
        p_operation_name,
        p_idempotency_key,
        p_request_hash,
        p_response
    )
    ON CONFLICT (workspace_id, actor_id, operation_name, idempotency_key)
    DO UPDATE SET
        response_payload = EXCLUDED.response_payload;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Helper to resolve reviewer excluding assignee, submitter and collaborators
CREATE OR REPLACE FUNCTION private.resolve_task_reviewer(
    p_workspace_id UUID,
    p_task_id UUID,
    p_designer_id UUID,
    p_exclude_roster_ids UUID[]
)
RETURNS UUID AS $$
DECLARE
    v_task RECORD;
    v_client RECORD;
    v_candidate UUID;
    v_fallback UUID;
BEGIN
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
    SELECT * INTO v_client FROM public.clients WHERE id = v_task.client_id;

    -- 1. Try Specific Designer & Client Difficulty Rule
    SELECT reviewer_roster_id, fallback_reviewer_id
    INTO v_candidate, v_fallback
    FROM public.review_routing_rules
    WHERE workspace_id = p_workspace_id
      AND designer_roster_id = p_designer_id
      AND client_difficulty = v_client.difficulty
    ORDER BY priority DESC
    LIMIT 1;

    IF v_candidate IS NOT NULL AND NOT (v_candidate = ANY(p_exclude_roster_ids)) AND EXISTS (
        SELECT 1 FROM public.workspace_memberships wm
        JOIN public.roster_people rp ON wm.roster_person_id = rp.id
        WHERE wm.workspace_id = p_workspace_id AND wm.roster_person_id = v_candidate AND wm.is_active = TRUE AND rp.is_active = TRUE
    ) THEN
        RETURN v_candidate;
    END IF;

    IF v_fallback IS NOT NULL AND NOT (v_fallback = ANY(p_exclude_roster_ids)) AND EXISTS (
        SELECT 1 FROM public.workspace_memberships wm
        JOIN public.roster_people rp ON wm.roster_person_id = rp.id
        WHERE wm.workspace_id = p_workspace_id AND wm.roster_person_id = v_fallback AND wm.is_active = TRUE AND rp.is_active = TRUE
    ) THEN
        RETURN v_fallback;
    END IF;

    -- 2. Try Specific Designer Rule (Any Difficulty)
    SELECT reviewer_roster_id, fallback_reviewer_id
    INTO v_candidate, v_fallback
    FROM public.review_routing_rules
    WHERE workspace_id = p_workspace_id
      AND designer_roster_id = p_designer_id
      AND client_difficulty IS NULL
    ORDER BY priority DESC
    LIMIT 1;

    IF v_candidate IS NOT NULL AND NOT (v_candidate = ANY(p_exclude_roster_ids)) AND EXISTS (
        SELECT 1 FROM public.workspace_memberships wm
        JOIN public.roster_people rp ON wm.roster_person_id = rp.id
        WHERE wm.workspace_id = p_workspace_id AND wm.roster_person_id = v_candidate AND wm.is_active = TRUE AND rp.is_active = TRUE
    ) THEN
        RETURN v_candidate;
    END IF;

    IF v_fallback IS NOT NULL AND NOT (v_fallback = ANY(p_exclude_roster_ids)) AND EXISTS (
        SELECT 1 FROM public.workspace_memberships wm
        JOIN public.roster_people rp ON wm.roster_person_id = rp.id
        WHERE wm.workspace_id = p_workspace_id AND wm.roster_person_id = v_fallback AND wm.is_active = TRUE AND rp.is_active = TRUE
    ) THEN
        RETURN v_fallback;
    END IF;

    -- 3. Try Workspace Default Routing Rule
    SELECT reviewer_roster_id, fallback_reviewer_id
    INTO v_candidate, v_fallback
    FROM public.review_routing_rules
    WHERE workspace_id = p_workspace_id
      AND is_workspace_default = TRUE
    LIMIT 1;

    IF v_candidate IS NOT NULL AND NOT (v_candidate = ANY(p_exclude_roster_ids)) AND EXISTS (
        SELECT 1 FROM public.workspace_memberships wm
        JOIN public.roster_people rp ON wm.roster_person_id = rp.id
        WHERE wm.workspace_id = p_workspace_id AND wm.roster_person_id = v_candidate AND wm.is_active = TRUE AND rp.is_active = TRUE
    ) THEN
        RETURN v_candidate;
    END IF;

    IF v_fallback IS NOT NULL AND NOT (v_fallback = ANY(p_exclude_roster_ids)) AND EXISTS (
        SELECT 1 FROM public.workspace_memberships wm
        JOIN public.roster_people rp ON wm.roster_person_id = rp.id
        WHERE wm.workspace_id = p_workspace_id AND wm.roster_person_id = v_fallback AND wm.is_active = TRUE AND rp.is_active = TRUE
    ) THEN
        RETURN v_fallback;
    END IF;

    -- 4. Ultimate Fallback: Any active manager/senior_reviewer/owner not excluded
    SELECT wm.roster_person_id INTO v_candidate
    FROM public.workspace_memberships wm
    JOIN public.roster_people rp ON wm.roster_person_id = rp.id
    WHERE wm.workspace_id = p_workspace_id
      AND wm.is_active = TRUE
      AND rp.is_active = TRUE
      AND wm.role IN ('owner', 'manager', 'senior_reviewer')
      AND NOT (wm.roster_person_id = ANY(p_exclude_roster_ids))
    ORDER BY CASE wm.role WHEN 'senior_reviewer' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END
    LIMIT 1;

    RETURN v_candidate;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- -----------------------------------------------------------------------------
-- 3. INVITATION & MEMBERSHIP RPCS (Owner-Controlled, Hashed, Privilege-Hardened)
-- -----------------------------------------------------------------------------

-- Create Invitation: Strictly Owner-Controlled, Roster-Bound, Raw Token Returned Once
CREATE OR REPLACE FUNCTION public.create_workspace_invitation(
    p_workspace_id UUID,
    p_email TEXT,
    p_role public.roster_role,
    p_roster_person_id UUID,
    p_idempotency_key TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_caller RECORD;
    v_clean_email TEXT;
    v_target_roster RECORD;
    v_raw_token TEXT;
    v_token_hash TEXT;
    v_invitation_id UUID;
    v_expires_at TIMESTAMPTZ := pg_catalog.now() + INTERVAL '7 days';
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_safe_cached_result JSONB;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;

    -- 1. Strictly Owner-Controlled
    IF v_caller.role <> 'owner' THEN
        RAISE EXCEPTION 'Permission denied: Only workspace owner can invite members.';
    END IF;

    -- 2. Do not permit owner role through invitation RPC
    IF p_role = 'owner' THEN
        RAISE EXCEPTION 'Owner role cannot be invited. Ownership transfer requires an explicit transfer workflow.';
    END IF;

    -- 3. Email validation
    v_clean_email := pg_catalog.lower(btrim(p_email));
    IF v_clean_email IS NULL OR v_clean_email = '' OR v_clean_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
        RAISE EXCEPTION 'Valid email address is required.';
    END IF;

    -- Concurrency-Safe Idempotency Check
    v_payload := jsonb_build_object('p_workspace_id', p_workspace_id, 'p_email', p_email, 'p_role', p_role, 'p_roster_person_id', p_roster_person_id);
    v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
    v_cached := private.fn_acquire_idempotency_lock(p_workspace_id, v_caller.roster_person_id, 'create_workspace_invitation', p_idempotency_key, v_hash);
    -- On retry, return safe cached result that does NOT reveal raw token
    IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;


    -- 4. Roster Person Validation (Must exist, active, unlinked to active membership)
    IF p_roster_person_id IS NULL THEN
        RAISE EXCEPTION 'Roster person ID is required to bind the invitation.';
    END IF;

    SELECT * INTO v_target_roster
    FROM public.roster_people
    WHERE workspace_id = p_workspace_id AND id = p_roster_person_id;

    IF NOT FOUND OR v_target_roster.is_active = FALSE THEN
        RAISE EXCEPTION 'Target roster person not found or inactive in workspace.';
    END IF;

    -- Check if target roster person is already linked to an active membership
    IF EXISTS (
        SELECT 1 FROM public.workspace_memberships
        WHERE workspace_id = p_workspace_id
          AND roster_person_id = p_roster_person_id
          AND is_active = TRUE
    ) THEN
        RAISE EXCEPTION 'Target roster person is already linked to an active workspace membership.';
    END IF;

    -- Check if there is already a pending invitation for this roster person
    IF EXISTS (
        SELECT 1 FROM public.workspace_invitations
        WHERE workspace_id = p_workspace_id
          AND roster_person_id = p_roster_person_id
          AND status = 'pending'
    ) THEN
        RAISE EXCEPTION 'There is already a pending invitation for this roster person.';
    END IF;

    -- Check if user with this email is already an active member
    IF EXISTS (
        SELECT 1 FROM public.workspace_memberships wm
        JOIN auth.users u ON wm.user_id = u.id
        WHERE wm.workspace_id = p_workspace_id
          AND pg_catalog.lower(btrim(u.email)) = v_clean_email
          AND wm.is_active = TRUE
    ) THEN
        RAISE EXCEPTION 'User with email % is already an active member of this workspace.', v_clean_email;
    END IF;

    -- 5. Generate 32-byte cryptographically secure raw token and SHA-256 hash
    v_raw_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
    v_token_hash := pg_catalog.encode(extensions.digest(v_raw_token, 'sha256'), 'hex');

    -- 6. Store ONLY the hash in database
    INSERT INTO public.workspace_invitations (
        workspace_id,
        invited_email,
        role,
        roster_person_id,
        token_hash,
        status,
        invited_by_roster_id,
        expires_at
    ) VALUES (
        p_workspace_id,
        v_clean_email,
        p_role,
        p_roster_person_id,
        v_token_hash,
        'pending',
        v_caller.roster_person_id,
        v_expires_at
    ) RETURNING id INTO v_invitation_id;

    -- Audit event (NEVER contains raw token)
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
        'create_workspace_invitation',
        'workspace_invitations',
        v_invitation_id,
        jsonb_build_object(
            'invited_email', v_clean_email,
            'role', p_role,
            'roster_person_id', p_roster_person_id,
            'token_hash', v_token_hash,
            'expires_at', v_expires_at
        )
    );

    -- Safe cached result for idempotent retry (NEVER reveals raw token)
    v_safe_cached_result := jsonb_build_object(
        'success', TRUE,
        'invitation_id', v_invitation_id,
        'status', 'pending',
        'expires_at', v_expires_at,
        'email', v_clean_email,
        'token_hash', v_token_hash,
        'message', 'Invitation already created. For security, raw token is only returned on initial creation.'
    );
    PERFORM private.fn_record_idempotency(p_workspace_id, v_caller.roster_person_id, 'create_workspace_invitation', p_idempotency_key, v_hash, v_safe_cached_result);

    -- Return raw token ONLY on the first successful creation response
    v_result := jsonb_build_object(
        'success', TRUE,
        'invitation_id', v_invitation_id,
        'raw_token', v_raw_token,
        'token_hash', v_token_hash,
        'expires_at', v_expires_at,
        'email', v_clean_email
    );
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Accept Invitation: Links auth.uid() to the exact bound roster person (safely handling inactive memberships)
CREATE OR REPLACE FUNCTION public.accept_workspace_invitation(
    p_raw_token TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_user_email TEXT;
    v_token_hash TEXT;
    v_inv RECORD;
    v_roster RECORD;
    v_existing_membership RECORD;
    v_membership_id UUID;
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

    -- Email match verification
    IF v_user_email <> v_inv.invited_email THEN
        RAISE EXCEPTION 'Invitation email (%) does not match authenticated user email (%).', v_inv.invited_email, v_user_email;
    END IF;

    -- 2. Row-lock target roster person
    SELECT * INTO v_roster
    FROM public.roster_people
    WHERE workspace_id = v_inv.workspace_id AND id = v_inv.roster_person_id
    FOR UPDATE;

    IF NOT FOUND OR v_roster.is_active = FALSE THEN
        RAISE EXCEPTION 'Target roster person is missing or inactive in this workspace.';
    END IF;

    -- 3. Check if user already has an active membership in this workspace
    IF EXISTS (
        SELECT 1 FROM public.workspace_memberships
        WHERE workspace_id = v_inv.workspace_id
          AND user_id = v_uid
          AND is_active = TRUE
    ) THEN
        RAISE EXCEPTION 'User already has an active membership in this workspace.';
    END IF;

    -- 4. Row-lock existing membership for this roster person (if any)
    SELECT * INTO v_existing_membership
    FROM public.workspace_memberships
    WHERE workspace_id = v_inv.workspace_id AND roster_person_id = v_inv.roster_person_id
    ORDER BY is_active DESC, (user_id = v_uid) DESC, created_at DESC, id DESC
    LIMIT 1 FOR UPDATE;

    IF FOUND THEN
        -- CRITICAL: Never replace or rebind an already-active roster membership to another user!
        IF v_existing_membership.is_active = TRUE THEN
            RAISE EXCEPTION 'Target roster person already has an active workspace membership.';
        END IF;

        -- If previously assigned to the same user, reactivate; otherwise create new clean membership
        IF v_existing_membership.user_id IS NOT NULL AND v_existing_membership.user_id = v_uid THEN
            UPDATE public.workspace_memberships
            SET role = v_inv.role,
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
                is_active
            ) VALUES (
                v_inv.workspace_id,
                v_uid,
                v_inv.roster_person_id,
                v_inv.role,
                TRUE
            ) RETURNING id INTO v_membership_id;
        END IF;
    ELSE
        INSERT INTO public.workspace_memberships (
            workspace_id,
            user_id,
            roster_person_id,
            role,
            is_active
        ) VALUES (
            v_inv.workspace_id,
            v_uid,
            v_inv.roster_person_id,
            v_inv.role,
            TRUE
        ) RETURNING id INTO v_membership_id;
    END IF;

    -- Mark invitation accepted
    UPDATE public.workspace_invitations
    SET status = 'accepted',
        accepted_at = pg_catalog.now(),
        accepted_by_id = v_uid,
        updated_at = pg_catalog.now()
    WHERE id = v_inv.id;

    -- Audit event
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
        'accept_workspace_invitation',
        'workspace_invitations',
        v_inv.id,
        jsonb_build_object(
            'user_id', v_uid,
            'role', v_inv.role,
            'membership_id', v_membership_id,
            'roster_person_id', v_inv.roster_person_id
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'workspace_id', v_inv.workspace_id,
        'roster_person_id', v_inv.roster_person_id,
        'role', v_inv.role,
        'membership_id', v_membership_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Revoke Invitation
CREATE OR REPLACE FUNCTION public.revoke_workspace_invitation(
    p_workspace_id UUID,
    p_invitation_id UUID,
    p_idempotency_key TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_caller RECORD;
    v_inv RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF v_caller.role <> 'owner' THEN
        RAISE EXCEPTION 'Permission denied: Only workspace owner can revoke invitations.';
    END IF;

    v_payload := jsonb_build_object('p_workspace_id', p_workspace_id, 'p_invitation_id', p_invitation_id);
    v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
    v_cached := private.fn_acquire_idempotency_lock(p_workspace_id, v_caller.roster_person_id, 'revoke_workspace_invitation', p_idempotency_key, v_hash);
    IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

    SELECT * INTO v_inv
    FROM public.workspace_invitations
    WHERE workspace_id = p_workspace_id AND id = p_invitation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitation not found in this workspace.';
    END IF;

    IF v_inv.status <> 'pending' THEN
        RAISE EXCEPTION 'Only pending invitations can be revoked (current status: %).', v_inv.status;
    END IF;

    UPDATE public.workspace_invitations
    SET status = 'revoked', updated_at = pg_catalog.now()
    WHERE id = v_inv.id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        p_workspace_id, v_caller.roster_person_id, 'revoke_workspace_invitation', 'workspace_invitations', v_inv.id,
        jsonb_build_object('invited_email', v_inv.invited_email, 'revoked_at', pg_catalog.now())
    );

    v_result := jsonb_build_object('success', TRUE, 'invitation_id', v_inv.id, 'status', 'revoked');
    PERFORM private.fn_record_idempotency(p_workspace_id, v_caller.roster_person_id, 'revoke_workspace_invitation', p_idempotency_key, v_hash, v_result);
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Ownership Transfer: Explicit Owner-Only Workflow with row serialization
CREATE OR REPLACE FUNCTION public.transfer_workspace_ownership(
    p_workspace_id UUID,
    p_new_owner_roster_id UUID,
    p_idempotency_key TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_caller RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_target_membership RECORD;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF v_caller.role <> 'owner' THEN
        RAISE EXCEPTION 'Permission denied: Only current workspace owner can transfer ownership.';
    END IF;

    IF p_new_owner_roster_id = v_caller.roster_person_id THEN
        RAISE EXCEPTION 'Cannot transfer ownership to yourself.';
    END IF;

    v_payload := jsonb_build_object('p_workspace_id', p_workspace_id, 'p_new_owner_roster_id', p_new_owner_roster_id);
    v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
    v_cached := private.fn_acquire_idempotency_lock(p_workspace_id, v_caller.roster_person_id, 'transfer_workspace_ownership', p_idempotency_key, v_hash);
    IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

    -- Lock workspace row FOR UPDATE to serialize transfers
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;

    -- Target must be active member
    SELECT * INTO v_target_membership
    FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id
      AND roster_person_id = p_new_owner_roster_id
      AND is_active = TRUE
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target roster person is not an active member in this workspace.';
    END IF;

    -- Demote current owner to manager
    UPDATE public.workspace_memberships
    SET role = 'manager', updated_at = pg_catalog.now()
    WHERE workspace_id = p_workspace_id
      AND roster_person_id = v_caller.roster_person_id;

    -- Promote target to owner
    UPDATE public.workspace_memberships
    SET role = 'owner', updated_at = pg_catalog.now()
    WHERE id = v_target_membership.id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        p_workspace_id,
        v_caller.roster_person_id,
        'transfer_workspace_ownership',
        'workspace_memberships',
        v_target_membership.id,
        jsonb_build_object(
            'previous_owner_roster_id', v_caller.roster_person_id,
            'new_owner_roster_id', p_new_owner_roster_id
        )
    );

    v_result := jsonb_build_object(
        'success', TRUE,
        'workspace_id', p_workspace_id,
        'previous_owner_roster_id', v_caller.roster_person_id,
        'new_owner_roster_id', p_new_owner_roster_id
    );

    PERFORM private.fn_record_idempotency(p_workspace_id, v_caller.roster_person_id, 'transfer_workspace_ownership', p_idempotency_key, v_hash, v_result);
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Bootstrap Owner: Strictly Service-Role Controlled
CREATE OR REPLACE FUNCTION public.bootstrap_owner(
    p_workspace_id UUID,
    p_owner_user_id UUID,
    p_roster_person_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_existing_owner RECORD;
    v_existing_user_membership RECORD;
    v_roster RECORD;
    v_membership_id UUID;
BEGIN
    -- Validate user in auth.users
    IF NOT EXISTS (
        SELECT 1 FROM auth.users WHERE id = p_owner_user_id
    ) THEN
        RAISE EXCEPTION 'User not found in auth.users.';
    END IF;

    -- Lock workspace row FOR UPDATE to serialize bootstrap
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Workspace not found.';
    END IF;

    -- Validate target roster person belongs to workspace and is active
    SELECT * INTO v_roster
    FROM public.roster_people
    WHERE id = p_roster_person_id AND workspace_id = p_workspace_id AND is_active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target roster person not found or inactive in specified workspace.';
    END IF;

    -- Check if an active owner membership already exists
    SELECT * INTO v_existing_owner
    FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id AND role = 'owner' AND is_active = TRUE;

    IF FOUND THEN
        IF v_existing_owner.user_id = p_owner_user_id AND v_existing_owner.roster_person_id = p_roster_person_id THEN
            RETURN jsonb_build_object(
                'success', TRUE,
                'status', 'already_bootstrapped',
                'workspace_id', p_workspace_id,
                'membership_id', v_existing_owner.id,
                'roster_person_id', p_roster_person_id
            );
        ELSE
            RAISE EXCEPTION 'Workspace already has an active owner.';
        END IF;
    END IF;

    -- Check conflicting active user membership
    SELECT * INTO v_existing_user_membership
    FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id AND user_id = p_owner_user_id AND is_active = TRUE;

    IF FOUND THEN
        RAISE EXCEPTION 'User already has an active membership in this workspace.';
    END IF;

    -- Check if roster person is already bound to another active user
    IF EXISTS (
        SELECT 1 FROM public.workspace_memberships
        WHERE workspace_id = p_workspace_id AND roster_person_id = p_roster_person_id AND is_active = TRUE
    ) THEN
        RAISE EXCEPTION 'Roster person is already linked to an active membership.';
    END IF;

    -- Insert the single active owner membership
    INSERT INTO public.workspace_memberships (
        workspace_id,
        user_id,
        roster_person_id,
        role,
        is_active
    ) VALUES (
        p_workspace_id,
        p_owner_user_id,
        p_roster_person_id,
        'owner',
        TRUE
    ) RETURNING id INTO v_membership_id;

    -- Log audit event
    INSERT INTO public.audit_events (
        workspace_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        p_workspace_id,
        p_roster_person_id,
        'owner_bootstrap',
        'workspace_memberships',
        v_membership_id,
        jsonb_build_object(
            'workspace_id', p_workspace_id,
            'roster_person_id', p_roster_person_id,
            'role', 'owner'
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'status', 'bootstrapped',
        'workspace_id', p_workspace_id,
        'user_id', p_owner_user_id,
        'membership_id', v_membership_id,
        'roster_person_id', p_roster_person_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- -----------------------------------------------------------------------------
-- 4. TASK LIFECYCLE & MUTATION RPCS
-- -----------------------------------------------------------------------------

-- Create Task RPC
CREATE OR REPLACE FUNCTION public.create_task_rpc(
    p_workspace_id UUID,
    p_client_id UUID,
    p_campaign_id UUID DEFAULT NULL,
    p_title TEXT DEFAULT '',
    p_brief TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_deliverable_format TEXT DEFAULT NULL,
    p_deliverable_number TEXT DEFAULT '',
    p_priority public.task_priority DEFAULT 'Normal',
    p_primary_assignee_id UUID DEFAULT NULL,
    p_reviewer_id UUID DEFAULT NULL,
    p_due_date TIMESTAMPTZ DEFAULT NULL,
    p_estimated_hours NUMERIC DEFAULT NULL,
    p_working_file_url TEXT DEFAULT NULL,
    p_reference_urls TEXT[] DEFAULT '{}',
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_task_id UUID;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;

    IF p_title IS NULL OR btrim(p_title) = '' THEN
        RAISE EXCEPTION 'Task title cannot be empty.';
    END IF;

    -- Designers creating tasks may only self-assign or leave unassigned
    IF v_caller.role NOT IN ('owner', 'manager') THEN
        IF p_primary_assignee_id IS NOT NULL AND p_primary_assignee_id <> v_caller.roster_person_id THEN
            RAISE EXCEPTION 'Designers can only assign tasks to themselves.';
        END IF;
    END IF;

    -- Concurrency-Safe Idempotency Check
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_workspace_id', p_workspace_id, 'p_client_id', p_client_id, 'p_campaign_id', p_campaign_id, 'p_title', p_title, 'p_brief', p_brief, 'p_description', p_description, 'p_deliverable_format', p_deliverable_format, 'p_deliverable_number', p_deliverable_number, 'p_priority', p_priority, 'p_primary_assignee_id', p_primary_assignee_id, 'p_reviewer_id', p_reviewer_id, 'p_due_date', p_due_date, 'p_estimated_hours', p_estimated_hours, 'p_working_file_url', p_working_file_url, 'p_reference_urls', p_reference_urls);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(p_workspace_id, v_caller.roster_person_id, 'create_task_rpc', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    -- Validate client exists in workspace
    IF NOT EXISTS (SELECT 1 FROM public.clients WHERE workspace_id = p_workspace_id AND id = p_client_id) THEN
        RAISE EXCEPTION 'Client not found in workspace.';
    END IF;

    -- Insert task preserving brief and deliverable_number
    INSERT INTO public.tasks (
        workspace_id,
        client_id,
        campaign_id,
        title,
        brief,
        description,
        deliverable_format,
        deliverable_number,
        priority,
        status,
        primary_assignee_id,
        reviewer_id,
        due_date,
        estimated_hours,
        working_file_url,
        reference_urls,
        created_by_id
    ) VALUES (
        p_workspace_id,
        p_client_id,
        p_campaign_id,
        p_title,
        p_brief,
        p_description,
        p_deliverable_format,
        COALESCE(p_deliverable_number, ''),
        p_priority,
        'backlog',
        p_primary_assignee_id,
        p_reviewer_id,
        p_due_date,
        p_estimated_hours,
        p_working_file_url,
        COALESCE(p_reference_urls, '{}'::TEXT[]),
        v_caller.roster_person_id
    ) RETURNING id INTO v_task_id;

    -- Record initial status event
    INSERT INTO public.task_status_events (
        workspace_id, task_id, from_status, to_status, actor_id, reason
    ) VALUES (
        p_workspace_id, v_task_id, NULL, 'backlog', v_caller.roster_person_id, 'Task created'
    );

    -- Record initial assignment event
    IF p_primary_assignee_id IS NOT NULL THEN
        INSERT INTO public.task_assignment_events (
            workspace_id, task_id, previous_assignee_id, new_assignee_id, actor_id, reason
        ) VALUES (
            p_workspace_id, v_task_id, NULL, p_primary_assignee_id, v_caller.roster_person_id, 'Initial task assignment'
        );
    END IF;

    -- Record initial due date event
    IF p_due_date IS NOT NULL THEN
        INSERT INTO public.task_due_date_events (
            workspace_id, task_id, previous_due_date, new_due_date, actor_id, reason
        ) VALUES (
            p_workspace_id, v_task_id, NULL, p_due_date, v_caller.roster_person_id, 'Initial task due date'
        );
    END IF;

    -- Audit event
    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        p_workspace_id, v_caller.roster_person_id, 'create_task', 'tasks', v_task_id,
        jsonb_build_object('title', p_title, 'client_id', p_client_id, 'deliverable_number', COALESCE(p_deliverable_number, ''))
    );

    v_result := jsonb_build_object('success', TRUE, 'task_id', v_task_id);
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(p_workspace_id, v_caller.roster_person_id, 'create_task_rpc', p_idempotency_key, v_hash, v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- create_task wrapper preserving full task contract
CREATE OR REPLACE FUNCTION public.create_task(
    p_workspace_id UUID,
    p_client_id UUID,
    p_campaign_id UUID DEFAULT NULL,
    p_title TEXT DEFAULT '',
    p_deliverable_type TEXT DEFAULT NULL,
    p_deliverable_number TEXT DEFAULT NULL,
    p_priority public.task_priority DEFAULT 'Normal',
    p_primary_assignee_id UUID DEFAULT NULL,
    p_reviewer_id UUID DEFAULT NULL,
    p_due_at TIMESTAMPTZ DEFAULT NULL,
    p_estimated_minutes INT DEFAULT NULL,
    p_brief TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
BEGIN
    RETURN public.create_task_rpc(
        p_workspace_id => p_workspace_id,
        p_client_id => p_client_id,
        p_campaign_id => p_campaign_id,
        p_title => p_title,
        p_brief => p_brief,
        p_description => p_description,
        p_deliverable_format => p_deliverable_type,
        p_deliverable_number => COALESCE(p_deliverable_number, ''),
        p_priority => p_priority,
        p_primary_assignee_id => p_primary_assignee_id,
        p_reviewer_id => p_reviewer_id,
        p_due_date => p_due_at,
        p_estimated_hours => CASE WHEN p_estimated_minutes IS NOT NULL THEN ROUND(p_estimated_minutes::NUMERIC / 60.0, 2) ELSE NULL END,
        p_idempotency_key => p_idempotency_key
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Update Task Content Details (Roles allowed: Manager/Owner or Assigned Designer)
CREATE OR REPLACE FUNCTION public.update_task_details(
    p_workspace_id UUID,
    p_task_id UUID,
    p_title TEXT DEFAULT NULL,
    p_brief TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_deliverable_format TEXT DEFAULT NULL,
    p_deliverable_number TEXT DEFAULT NULL,
    p_priority public.task_priority DEFAULT NULL,
    p_working_file_url TEXT DEFAULT NULL,
    p_reference_urls TEXT[] DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller RECORD;
    v_task RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;

    SELECT * INTO v_task
    FROM public.tasks
    WHERE workspace_id = p_workspace_id AND id = p_task_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found in this workspace.';
    END IF;

    IF p_priority IS NOT NULL AND v_caller.role NOT IN ('owner', 'manager')
       AND p_priority IS DISTINCT FROM v_task.priority THEN
        RAISE EXCEPTION 'Only Owner or Manager can change task priority.';
    END IF;
    -- Authorization check
    IF v_caller.role NOT IN ('owner', 'manager') AND v_task.primary_assignee_id IS DISTINCT FROM v_caller.roster_person_id THEN
        RAISE EXCEPTION 'Permission denied: Only managers or the assigned designer can edit task details.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_workspace_id', p_workspace_id, 'p_task_id', p_task_id, 'p_title', p_title, 'p_brief', p_brief, 'p_description', p_description, 'p_deliverable_format', p_deliverable_format, 'p_deliverable_number', p_deliverable_number, 'p_priority', p_priority, 'p_working_file_url', p_working_file_url, 'p_reference_urls', p_reference_urls);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(p_workspace_id, v_caller.roster_person_id, 'update_task_details', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    UPDATE public.tasks
    SET title = COALESCE(NULLIF(btrim(p_title), ''), title),
        brief = COALESCE(p_brief, brief),
        description = COALESCE(p_description, description),
        deliverable_format = COALESCE(p_deliverable_format, deliverable_format),
        deliverable_number = COALESCE(p_deliverable_number, deliverable_number),
        priority = COALESCE(p_priority, priority),
        working_file_url = COALESCE(p_working_file_url, working_file_url),
        reference_urls = COALESCE(p_reference_urls, reference_urls),
        updated_at = pg_catalog.now()
    WHERE id = p_task_id;

    v_result := jsonb_build_object('success', TRUE, 'task_id', p_task_id);
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(p_workspace_id, v_caller.roster_person_id, 'update_task_details', p_idempotency_key, v_hash, v_result);
    END IF;
    INSERT INTO public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) VALUES(p_workspace_id,v_caller.roster_person_id,'update_task_details','tasks',p_task_id,jsonb_build_object('result',v_result));
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Transition Task Status (Authorization Checked BEFORE Early Returns)
CREATE OR REPLACE FUNCTION public.transition_task_status(
    p_task_id UUID,
    p_new_status public.task_status DEFAULT NULL,
    p_to_status public.task_status DEFAULT NULL,
    p_reason TEXT DEFAULT NULL,
    p_final_deliverable_url TEXT DEFAULT NULL,
    p_deliverable_url TEXT DEFAULT NULL,
    p_final_deliverable_attachment_id UUID DEFAULT NULL,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_effective_status public.task_status;
    v_effective_deliverable_url TEXT;
    v_caller RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_task RECORD;
    v_current_status public.task_status;
    v_is_involved BOOLEAN;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    v_effective_status := COALESCE(p_new_status, p_to_status);
    IF v_effective_status IS NULL THEN
        RAISE EXCEPTION 'Target status is required.';
    END IF;

    v_effective_deliverable_url := COALESCE(p_final_deliverable_url, p_deliverable_url);

    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id
        FROM public.tasks WHERE id = p_task_id;
        IF v_effective_workspace_id IS NULL THEN
            RAISE EXCEPTION 'Task not found.';
        END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;

    -- 1. COMPLETE RESOURCE AUTHORIZATION FIRST (Before any cached or early return)
    SELECT * INTO v_task
    FROM public.tasks
    WHERE workspace_id = v_effective_workspace_id AND id = p_task_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found in this workspace.';
    END IF;

    -- NULL-SENSITIVE GUARD: Ordinary designer MUST NOT transition or edit an unassigned task
    IF v_task.primary_assignee_id IS NULL AND v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Access denied: Unassigned tasks can only be transitioned or managed by a manager or owner.';
    END IF;

    -- Explicit NULL-safe involvement check
    v_is_involved := (
        v_caller.role IN ('owner', 'manager') OR
        (v_task.primary_assignee_id IS NOT NULL AND v_task.primary_assignee_id = v_caller.roster_person_id) OR
        EXISTS (
            SELECT 1 FROM public.task_collaborators tc
            JOIN public.roster_people rp ON tc.roster_person_id = rp.id
            WHERE tc.workspace_id = v_effective_workspace_id
              AND tc.task_id = p_task_id
              AND tc.roster_person_id = v_caller.roster_person_id
              AND rp.is_active = TRUE
        )
    );

    IF NOT COALESCE(v_is_involved, FALSE) THEN
        RAISE EXCEPTION 'Access denied: Caller is not assigned or collaborating on this task.';
    END IF;

    -- 2. Concurrency-Safe Idempotency Check AFTER resource authorization
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_task_id', p_task_id, 'p_new_status', p_new_status, 'p_to_status', p_to_status, 'p_reason', p_reason, 'p_final_deliverable_url', p_final_deliverable_url, 'p_deliverable_url', p_deliverable_url, 'p_final_deliverable_attachment_id', p_final_deliverable_attachment_id, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'transition_task_status', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    v_current_status := v_task.status;

    -- 3. If requested status equals current status, return idempotent no-op AFTER authorization
    IF v_effective_status = v_current_status THEN
        v_result := jsonb_build_object(
            'success', TRUE,
            'task_id', p_task_id,
            'status', v_current_status,
            'note', 'Status already equals requested status'
        );
        IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
            PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'transition_task_status', p_idempotency_key, v_hash, v_result);
        END IF;
        RETURN v_result;
    END IF;

    -- Prevent direct transition to review states outside dedicated RPCs
    IF v_effective_status IN ('internal_review', 'client_review') THEN
        RAISE EXCEPTION 'Transitions to % must be performed via submit_review_round or decide_review_round.', v_effective_status;
    END IF;

    -- Delivered requires approved status AND final deliverable
    IF v_effective_status = 'delivered' THEN
        IF v_current_status <> 'approved' THEN
            RAISE EXCEPTION 'Tasks must be approved before being delivered.';
        END IF;
        IF (v_effective_deliverable_url IS NULL OR btrim(v_effective_deliverable_url) = '')
           AND p_final_deliverable_attachment_id IS NULL
           AND v_task.final_deliverable_url IS NULL
           AND v_task.final_deliverable_attachment_id IS NULL THEN
            RAISE EXCEPTION 'A final deliverable URL or attachment is required to mark task as delivered.';
        END IF;
    END IF;

    -- VALIDATE TRANSITION MATRIX & MANDATORY REASONS
    IF v_current_status = 'backlog' THEN
        IF v_effective_status = 'ready' THEN
            NULL;
        ELSIF v_effective_status = 'in_progress' THEN
            RAISE EXCEPTION 'Invalid transition from backlog directly to in_progress. Task must move to ready first.';
        ELSIF v_effective_status = 'cancelled' THEN
            IF v_caller.role NOT IN ('owner', 'manager') THEN
                RAISE EXCEPTION 'Only Owner or Manager can cancel tasks.';
            END IF;
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'Cancel reason is required when cancelling a task.';
            END IF;
        ELSE
            RAISE EXCEPTION 'Invalid transition from backlog to %.', v_effective_status;
        END IF;

    ELSIF v_current_status = 'ready' THEN
        IF v_effective_status = 'in_progress' THEN
            NULL;
        ELSIF v_effective_status = 'backlog' THEN
            NULL;
        ELSIF v_effective_status = 'cancelled' THEN
            IF v_caller.role NOT IN ('owner', 'manager') THEN
                RAISE EXCEPTION 'Only Owner or Manager can cancel tasks.';
            END IF;
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'Cancel reason is required when cancelling a task.';
            END IF;
        ELSE
            RAISE EXCEPTION 'Invalid transition from ready to %.', v_effective_status;
        END IF;

    ELSIF v_current_status = 'in_progress' THEN
        IF v_effective_status = 'ready' THEN
            NULL;
        ELSIF v_effective_status = 'blocked' THEN
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'A valid reason is mandatory when blocking a task.';
            END IF;
        ELSIF v_effective_status = 'cancelled' THEN
            IF v_caller.role NOT IN ('owner', 'manager') THEN
                RAISE EXCEPTION 'Only Owner or Manager can cancel tasks.';
            END IF;
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'Cancel reason is required when cancelling a task.';
            END IF;
        ELSE
            RAISE EXCEPTION 'Invalid transition from in_progress to %.', v_effective_status;
        END IF;

    ELSIF v_current_status = 'blocked' THEN
        IF v_effective_status IN ('in_progress', 'ready') THEN
            NULL;
        ELSIF v_effective_status = 'cancelled' THEN
            IF v_caller.role NOT IN ('owner', 'manager') THEN
                RAISE EXCEPTION 'Only Owner or Manager can cancel tasks.';
            END IF;
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'Cancel reason is required when cancelling a task.';
            END IF;
        ELSE
            RAISE EXCEPTION 'Invalid transition from blocked to %. Can only unblock to in_progress or ready.', v_effective_status;
        END IF;

    ELSIF v_current_status = 'changes_requested' THEN
        IF v_effective_status = 'in_progress' THEN
            NULL;
        ELSIF v_effective_status = 'blocked' THEN
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'A valid reason is mandatory when blocking a task.';
            END IF;
        ELSIF v_effective_status = 'cancelled' THEN
            IF v_caller.role NOT IN ('owner', 'manager') THEN
                RAISE EXCEPTION 'Only Owner or Manager can cancel tasks.';
            END IF;
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'Cancel reason is required when cancelling a task.';
            END IF;
        ELSE
            RAISE EXCEPTION 'Invalid transition from changes_requested to %.', v_effective_status;
        END IF;

    ELSIF v_current_status = 'approved' THEN
        IF v_effective_status = 'delivered' THEN
            NULL;
        ELSIF v_effective_status = 'in_progress' THEN
            IF v_caller.role NOT IN ('owner', 'manager') THEN
                RAISE EXCEPTION 'Only Owner or Manager can reopen approved tasks back to in_progress.';
            END IF;
            -- REASON MANDATORY FOR APPROVED -> IN_PROGRESS
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'A mandatory reason is required when reopening an approved task back to in_progress.';
            END IF;
        ELSIF v_effective_status = 'cancelled' THEN
            IF v_caller.role NOT IN ('owner', 'manager') THEN
                RAISE EXCEPTION 'Only Owner or Manager can cancel tasks.';
            END IF;
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'Cancel reason is required when cancelling a task.';
            END IF;
        ELSE
            RAISE EXCEPTION 'Invalid transition from approved to %.', v_effective_status;
        END IF;

    ELSIF v_current_status = 'delivered' THEN
        IF v_effective_status = 'in_progress' THEN
            IF v_caller.role NOT IN ('owner', 'manager') THEN
                RAISE EXCEPTION 'Only Owner or Manager can reopen delivered tasks.';
            END IF;
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'Reopen reason is mandatory when reopening delivered tasks.';
            END IF;
        ELSIF v_effective_status = 'cancelled' THEN
            IF v_caller.role NOT IN ('owner', 'manager') THEN
                RAISE EXCEPTION 'Only Owner or Manager can cancel tasks.';
            END IF;
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'Cancel reason is required when cancelling a task.';
            END IF;
        ELSE
            RAISE EXCEPTION 'Invalid transition from delivered to %.', v_effective_status;
        END IF;

    ELSIF v_current_status = 'cancelled' THEN
        IF v_caller.role NOT IN ('owner', 'manager') THEN
            RAISE EXCEPTION 'Only Owner or Manager can reopen cancelled tasks.';
        END IF;
        IF p_reason IS NULL OR btrim(p_reason) = '' THEN
            RAISE EXCEPTION 'Reopen reason is mandatory when reopening cancelled tasks.';
        END IF;
        IF v_effective_status NOT IN ('backlog', 'ready') THEN
            RAISE EXCEPTION 'Cancelled tasks can only be reopened to backlog or ready.';
        END IF;

    ELSE
        RAISE EXCEPTION 'Invalid source status % for transition.', v_current_status;
    END IF;

    IF v_effective_status NOT IN ('in_progress', 'changes_requested') THEN
        UPDATE public.time_entries SET
            ended_at = GREATEST(clock_timestamp(), started_at + interval '1 microsecond'),
            duration_seconds = EXTRACT(EPOCH FROM (GREATEST(clock_timestamp(), started_at + interval '1 microsecond') - started_at))::int,
            updated_at = clock_timestamp()
        WHERE workspace_id = v_effective_workspace_id AND task_id = p_task_id
          AND ended_at IS NULL AND NOT is_voided;
    END IF;
    -- Apply update to tasks table
    UPDATE public.tasks
    SET
        status = v_effective_status,
        final_deliverable_url = COALESCE(v_effective_deliverable_url, final_deliverable_url),
        final_deliverable_attachment_id = COALESCE(p_final_deliverable_attachment_id, final_deliverable_attachment_id),
        delivered_at = CASE WHEN v_effective_status = 'delivered' THEN pg_catalog.now() ELSE delivered_at END,
        blocked_at = CASE WHEN v_effective_status = 'blocked' THEN pg_catalog.now() ELSE blocked_at END,
        block_reason = CASE WHEN v_effective_status = 'blocked' THEN p_reason ELSE block_reason END,
        cancelled_at = CASE WHEN v_effective_status = 'cancelled' THEN pg_catalog.now() ELSE cancelled_at END,
        cancel_reason = CASE WHEN v_effective_status = 'cancelled' THEN p_reason ELSE cancel_reason END,
        reopened_at = CASE WHEN (v_current_status IN ('delivered', 'approved', 'cancelled') AND v_effective_status IN ('in_progress','backlog','ready')) THEN pg_catalog.now() ELSE reopened_at END,
        reopen_reason = CASE WHEN (v_current_status IN ('delivered', 'approved', 'cancelled') AND v_effective_status IN ('in_progress','backlog','ready')) THEN p_reason ELSE reopen_reason END,
        updated_at = pg_catalog.now()
    WHERE id = p_task_id;

    -- Record status transition event
    INSERT INTO public.task_status_events (
        workspace_id,
        task_id,
        from_status,
        to_status,
        actor_id,
        reason
    ) VALUES (
        v_effective_workspace_id,
        p_task_id,
        v_current_status,
        v_effective_status,
        v_caller.roster_person_id,
        p_reason
    );

    -- Audit event
    INSERT INTO public.audit_events (
        workspace_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_effective_workspace_id,
        v_caller.roster_person_id,
        'transition_task_status',
        'tasks',
        p_task_id,
        jsonb_build_object(
            'from_status', v_current_status,
            'to_status', v_effective_status,
            'reason', p_reason,
            'final_url', v_effective_deliverable_url,
            'final_attachment', p_final_deliverable_attachment_id
        )
    );

    v_result := jsonb_build_object(
        'success', TRUE,
        'task_id', p_task_id,
        'from_status', v_current_status,
        'to_status', v_effective_status
    );

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'transition_task_status', p_idempotency_key, v_hash, v_result);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Management Reassign Task
CREATE OR REPLACE FUNCTION public.reassign_task(
    p_task_id UUID,
    p_new_assignee_id UUID,
    p_reason TEXT DEFAULT 'Reassigned by management',
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_caller RECORD;
    v_task RECORD;
    v_target_roster RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.tasks WHERE id = p_task_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Task not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;

    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can reassign tasks.';
    END IF;

    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'A non-empty reason is required for reassignment.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_task_id', p_task_id, 'p_new_assignee_id', p_new_assignee_id, 'p_reason', p_reason, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'reassign_task', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    SELECT * INTO v_task
    FROM public.tasks
    WHERE workspace_id = v_effective_workspace_id AND id = p_task_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found in this workspace.';
    END IF;

    IF p_new_assignee_id IS NOT NULL THEN
        SELECT * INTO v_target_roster
        FROM public.roster_people
        WHERE workspace_id = v_effective_workspace_id AND id = p_new_assignee_id AND is_active = TRUE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Target assignee not found or inactive in this workspace.';
        END IF;
    END IF;

    UPDATE public.tasks
    SET primary_assignee_id = p_new_assignee_id,
        updated_at = pg_catalog.now()
    WHERE id = p_task_id;

    INSERT INTO public.task_assignment_events (
        workspace_id,
        task_id,
        previous_assignee_id,
        new_assignee_id,
        actor_id,
        reason
    ) VALUES (
        v_effective_workspace_id,
        p_task_id,
        v_task.primary_assignee_id,
        p_new_assignee_id,
        v_caller.roster_person_id,
        p_reason
    );

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id, v_caller.roster_person_id, 'reassign_task', 'tasks', p_task_id,
        jsonb_build_object('previous_assignee', v_task.primary_assignee_id, 'new_assignee', p_new_assignee_id, 'reason', p_reason)
    );

    v_result := jsonb_build_object('success', TRUE, 'task_id', p_task_id, 'primary_assignee_id', p_new_assignee_id);
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'reassign_task', p_idempotency_key, v_hash, v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION public.change_task_assignee(
    p_task_id UUID,
    p_new_assignee_id UUID,
    p_reason TEXT DEFAULT 'Reassigned by management',
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
BEGIN
    RETURN public.reassign_task(p_task_id, p_new_assignee_id, p_reason, p_workspace_id, p_idempotency_key);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Management Change Task Reviewer
CREATE OR REPLACE FUNCTION public.change_task_reviewer(
    p_task_id UUID,
    p_new_reviewer_id UUID,
    p_reason TEXT DEFAULT NULL,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_caller RECORD;
    v_task RECORD;
    v_target_roster RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.tasks WHERE id = p_task_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Task not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;

    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can change task reviewer.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_task_id', p_task_id, 'p_new_reviewer_id', p_new_reviewer_id, 'p_reason', p_reason, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'change_task_reviewer', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    SELECT * INTO v_task
    FROM public.tasks
    WHERE workspace_id = v_effective_workspace_id AND id = p_task_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found in this workspace.';
    END IF;

    IF p_new_reviewer_id IS NOT NULL THEN
        SELECT * INTO v_target_roster
        FROM public.roster_people
        WHERE workspace_id = v_effective_workspace_id AND id = p_new_reviewer_id AND is_active = TRUE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Target reviewer not found or inactive in this workspace.';
        END IF;

        IF v_task.primary_assignee_id = p_new_reviewer_id THEN
            RAISE EXCEPTION 'Reviewer cannot be the primary assignee of the task.';
        END IF;
    END IF;

    UPDATE public.tasks
    SET reviewer_id = p_new_reviewer_id,
        updated_at = pg_catalog.now()
    WHERE id = p_task_id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id, v_caller.roster_person_id, 'change_task_reviewer', 'tasks', p_task_id,
        jsonb_build_object('previous_reviewer', v_task.reviewer_id, 'new_reviewer', p_new_reviewer_id, 'reason', p_reason)
    );

    v_result := jsonb_build_object('success', TRUE, 'task_id', p_task_id, 'reviewer_id', p_new_reviewer_id);
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'change_task_reviewer', p_idempotency_key, v_hash, v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Management Change Due Date
CREATE OR REPLACE FUNCTION public.update_task_due_date(
    p_task_id UUID,
    p_new_due_date TIMESTAMPTZ,
    p_reason TEXT DEFAULT 'Due date updated',
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_caller RECORD;
    v_task RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.tasks WHERE id = p_task_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Task not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;

    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can change task due dates.';
    END IF;

    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'A non-empty reason is required for due date changes.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_task_id', p_task_id, 'p_new_due_date', p_new_due_date, 'p_reason', p_reason, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'update_task_due_date', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    SELECT * INTO v_task
    FROM public.tasks
    WHERE workspace_id = v_effective_workspace_id AND id = p_task_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found in this workspace.';
    END IF;

    UPDATE public.tasks
    SET due_date = p_new_due_date,
        updated_at = pg_catalog.now()
    WHERE id = p_task_id;

    -- Insert into task_due_date_events ledger with canonical previous_due_date, new_due_date
    INSERT INTO public.task_due_date_events (
        workspace_id,
        task_id,
        previous_due_date,
        new_due_date,
        actor_id,
        reason
    ) VALUES (
        v_effective_workspace_id,
        p_task_id,
        v_task.due_date,
        p_new_due_date,
        v_caller.roster_person_id,
        p_reason
    );

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id, v_caller.roster_person_id, 'update_task_due_date', 'tasks', p_task_id,
        jsonb_build_object('previous_due_date', v_task.due_date, 'new_due_date', p_new_due_date, 'reason', p_reason)
    );

    v_result := jsonb_build_object('success', TRUE, 'task_id', p_task_id, 'due_date', p_new_due_date);
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'update_task_due_date', p_idempotency_key, v_hash, v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION public.change_task_due_date(
    p_task_id UUID,
    p_new_due_date TIMESTAMPTZ,
    p_reason TEXT DEFAULT 'Due date updated',
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
BEGIN
    RETURN public.update_task_due_date(p_task_id, p_new_due_date, p_reason, p_workspace_id, p_idempotency_key);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- -----------------------------------------------------------------------------
-- 5. REVIEW WORKFLOW RPCS (Zero Self-Approval, Routing & Decisions)
-- -----------------------------------------------------------------------------

-- Submit Review Round
CREATE OR REPLACE FUNCTION public.submit_review_round(
    p_task_id UUID,
    p_preview_url TEXT,
    p_note TEXT DEFAULT NULL,
    p_round_type public.review_round_type DEFAULT 'internal',
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_caller RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_task RECORD;
    v_exclude_ids UUID[];
    v_reviewer_id UUID;
    v_next_round_number INT;
    v_round_id UUID;
    v_new_task_status public.task_status;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.tasks WHERE id = p_task_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Task not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;

    -- 1. TASK INVOLVEMENT CHECK FIRST
    IF NOT private.can_work_on_task(p_task_id) THEN
        RAISE EXCEPTION 'Access denied: You are not assigned to or collaborating on this task.';
    END IF;

    IF p_preview_url IS NULL OR btrim(p_preview_url) = '' THEN
        RAISE EXCEPTION 'Preview URL cannot be empty.';
    END IF;

    -- Concurrency-Safe Idempotency Check
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_task_id', p_task_id, 'p_preview_url', p_preview_url, 'p_note', p_note, 'p_round_type', p_round_type, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'submit_review_round', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    SELECT * INTO v_task
    FROM public.tasks
    WHERE workspace_id = v_effective_workspace_id AND id = p_task_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found in this workspace.';
    END IF;

    -- Designers CANNOT submit directly to client review
    IF p_round_type = 'client' AND v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Designers cannot submit directly to client review. Client review must be initiated by Management.';
    END IF;

    -- Validate source status
    IF p_round_type = 'internal' THEN
        IF v_task.status NOT IN ('in_progress', 'changes_requested') THEN
            RAISE EXCEPTION 'Internal review can only be submitted from in_progress or changes_requested (current status: %).', v_task.status;
        END IF;
        v_new_task_status := 'internal_review';
    ELSE
        IF v_task.status NOT IN ('in_progress', 'changes_requested', 'approved') THEN
            RAISE EXCEPTION 'Client review can only be initiated from in_progress, changes_requested, or approved (current status: %).', v_task.status;
        END IF;
        v_new_task_status := 'client_review';
    END IF;

    -- Enforce single pending review round
    IF EXISTS (
        SELECT 1 FROM public.review_rounds
        WHERE task_id = p_task_id AND decision = 'pending'
    ) THEN
        RAISE EXCEPTION 'There is already an active pending review round for this task.';
    END IF;

    -- CLOSE EVERY OPEN TIMER ON THIS TASK (Across all assignees and collaborators) & compute duration_seconds
    UPDATE public.time_entries
    SET ended_at = pg_catalog.now(),
        duration_seconds = EXTRACT(EPOCH FROM (pg_catalog.now() - started_at))::INT,
        updated_at = pg_catalog.now()
    WHERE task_id = p_task_id
      AND ended_at IS NULL
      AND is_voided = FALSE;

    -- Build exclusion list: primary assignee, submitter, and all collaborators
    SELECT ARRAY_AGG(roster_person_id) INTO v_exclude_ids
    FROM (
        SELECT v_task.primary_assignee_id AS roster_person_id WHERE v_task.primary_assignee_id IS NOT NULL
        UNION
        SELECT v_caller.roster_person_id AS roster_person_id
        UNION
        SELECT roster_person_id FROM public.task_collaborators WHERE task_id = p_task_id
    ) t;

    -- Resolve reviewer via routing engine
    v_reviewer_id := private.resolve_task_reviewer(v_effective_workspace_id, p_task_id, COALESCE(v_task.primary_assignee_id, v_caller.roster_person_id), v_exclude_ids);

    IF v_reviewer_id IS NULL THEN
        RAISE EXCEPTION 'No eligible reviewer found for this task. An independent reviewer is required.';
    END IF;

    -- Check database invariant: submitter cannot equal reviewer
    IF v_reviewer_id = v_caller.roster_person_id THEN
        RAISE EXCEPTION 'Self-review invariant violation: Submitter cannot be the reviewer.';
    END IF;

    SELECT COALESCE(MAX(round_number), 0) + 1 INTO v_next_round_number
    FROM public.review_rounds
    WHERE task_id = p_task_id;

    -- Insert review round
    INSERT INTO public.review_rounds (
        workspace_id,
        task_id,
        round_number,
        round_type,
        submitter_id,
        preview_url,
        note,
        reviewer_id,
        decision
    ) VALUES (
        v_effective_workspace_id,
        p_task_id,
        v_next_round_number,
        p_round_type,
        v_caller.roster_person_id,
        p_preview_url,
        p_note,
        v_reviewer_id,
        'pending'
    ) RETURNING id INTO v_round_id;

    -- Update task status and reviewer
    UPDATE public.tasks
    SET status = v_new_task_status,
        reviewer_id = v_reviewer_id,
        updated_at = pg_catalog.now()
    WHERE id = p_task_id;

    -- Record status transition event
    INSERT INTO public.task_status_events (
        workspace_id,
        task_id,
        from_status,
        to_status,
        actor_id,
        review_round_id,
        reason
    ) VALUES (
        v_effective_workspace_id,
        p_task_id,
        v_task.status,
        v_new_task_status,
        v_caller.roster_person_id,
        v_round_id,
        'Review round submitted'
    );

    -- Notify reviewer
    INSERT INTO public.in_app_notifications (
        workspace_id, recipient_roster_id, actor_roster_id, task_id, title, message
    ) VALUES (
        v_effective_workspace_id, v_reviewer_id, v_caller.roster_person_id, p_task_id,
        'New review round submitted', 'Please review task: ' || v_task.title
    );

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id, v_caller.roster_person_id, 'submit_review_round', 'review_rounds', v_round_id,
        jsonb_build_object('task_id', p_task_id, 'round_number', v_next_round_number, 'reviewer_id', v_reviewer_id, 'preview_url', p_preview_url)
    );

    v_result := jsonb_build_object(
        'success', TRUE,
        'round_id', v_round_id,
        'round_number', v_next_round_number,
        'task_id', p_task_id,
        'reviewer_id', v_reviewer_id,
        'status', v_new_task_status
    );

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'submit_review_round', p_idempotency_key, v_hash, v_result);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Decide Review Round (Zero Self-Approval for ANYONE, Immutable Decided Rounds)
CREATE OR REPLACE FUNCTION public.decide_review_round(
    p_decision public.review_decision,
    p_round_id UUID DEFAULT NULL,
    p_review_round_id UUID DEFAULT NULL,
    p_feedback TEXT DEFAULT NULL,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_round_id UUID;
    v_effective_workspace_id UUID;
    v_caller RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_round RECORD;
    v_task RECORD;
    v_new_task_status public.task_status;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    v_effective_round_id := COALESCE(p_round_id, p_review_round_id);
    IF v_effective_round_id IS NULL THEN
        RAISE EXCEPTION 'Review round ID is required.';
    END IF;

    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.review_rounds WHERE id = v_effective_round_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Review round not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;

    IF p_decision IS NULL OR p_decision = 'pending' THEN
        RAISE EXCEPTION 'Invalid review decision: pending. Must be approved or changes_requested.';
    END IF;

    IF p_decision = 'changes_requested' AND (p_feedback IS NULL OR btrim(p_feedback) = '') THEN
        RAISE EXCEPTION 'Feedback is mandatory when requesting changes.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_decision', p_decision, 'p_round_id', p_round_id, 'p_review_round_id', p_review_round_id, 'p_feedback', p_feedback, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'decide_review_round', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    -- Lock round
    SELECT * INTO v_round
    FROM public.review_rounds
    WHERE workspace_id = v_effective_workspace_id AND id = v_effective_round_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Review round not found in this workspace.';
    END IF;

    IF v_round.decision <> 'pending' THEN
        RAISE EXCEPTION 'Review round has already been decided and is immutable.';
    END IF;

    SELECT * INTO v_task
    FROM public.tasks
    WHERE id = v_round.task_id
    FOR UPDATE;

    -- ZERO SELF-APPROVAL ENFORCEMENT
    IF v_caller.roster_person_id = v_round.submitter_id THEN
        RAISE EXCEPTION 'Self-approval denied: The submitter cannot decide their own review round.';
    END IF;

    IF v_caller.roster_person_id = v_task.primary_assignee_id THEN
        RAISE EXCEPTION 'Self-approval denied: The primary assignee cannot decide their own review round.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.task_collaborators
        WHERE task_id = v_task.id AND roster_person_id = v_caller.roster_person_id
    ) THEN
        RAISE EXCEPTION 'Self-approval denied: Collaborators cannot decide review rounds on tasks they worked on.';
    END IF;

    -- Role-based authority
    IF v_round.round_type = 'client' THEN
        IF v_caller.role NOT IN ('owner', 'manager') THEN
            RAISE EXCEPTION 'Only Owner or Manager can record decisions for client review rounds.';
        END IF;
    ELSE
        IF v_caller.roster_person_id <> v_round.reviewer_id AND v_caller.role NOT IN ('owner', 'manager') THEN
            RAISE EXCEPTION 'Permission denied: You are not the assigned reviewer for this round.';
        END IF;
    END IF;

    -- Determine new task status
    IF p_decision = 'approved' THEN
        v_new_task_status := 'approved';
    ELSE
        v_new_task_status := 'changes_requested';
    END IF;

    -- Update review round
    UPDATE public.review_rounds
    SET decision = p_decision,
        feedback = p_feedback,
        decided_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = v_round.id;

    -- If approved, autostop any open timers on task and record duration
    IF p_decision = 'approved' THEN
        UPDATE public.time_entries
        SET ended_at = pg_catalog.now(),
            duration_seconds = EXTRACT(EPOCH FROM (pg_catalog.now() - started_at))::INT,
            updated_at = pg_catalog.now()
        WHERE task_id = v_task.id
          AND ended_at IS NULL
          AND is_voided = FALSE;
    END IF;

    -- Update task status
    UPDATE public.tasks
    SET status = v_new_task_status,
        updated_at = pg_catalog.now()
    WHERE id = v_task.id;

    -- Record status event
    INSERT INTO public.task_status_events (
        workspace_id,
        task_id,
        from_status,
        to_status,
        actor_id,
        reason,
        review_round_id
    ) VALUES (
        v_effective_workspace_id,
        v_task.id,
        v_task.status,
        v_new_task_status,
        v_caller.roster_person_id,
        'Review round ' || v_round.round_number || ' decided: ' || p_decision::TEXT,
        v_round.id
    );

    -- Notify task primary assignee
    IF v_task.primary_assignee_id IS NOT NULL THEN
        INSERT INTO public.in_app_notifications (
            workspace_id, recipient_roster_id, actor_roster_id, title, message, task_id
        ) VALUES (
            v_effective_workspace_id,
            v_task.primary_assignee_id,
            v_caller.roster_person_id,
            CASE WHEN p_decision = 'approved' THEN 'تمت الموافقة على المهمة' ELSE 'مطلوب تعديلات على المهمة' END,
            'تم اتخاذ قرار ' || p_decision::TEXT || ' في الجولة ' || v_round.round_number || ' للمهمة: ' || v_task.title,
            v_task.id
        );
    END IF;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id, v_caller.roster_person_id, 'decide_review_round', 'review_rounds', v_round.id,
        jsonb_build_object('task_id', v_task.id, 'decision', p_decision, 'round_number', v_round.round_number)
    );

    v_result := jsonb_build_object(
        'success', TRUE,
        'review_round_id', v_round.id,
        'decision', p_decision,
        'task_id', v_task.id,
        'new_status', v_new_task_status
    );

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'decide_review_round', p_idempotency_key, v_hash, v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- -----------------------------------------------------------------------------
-- 6. TIME TRACKING RPCS (Active States Only, Guards, Clamping, Duration Sync)
-- -----------------------------------------------------------------------------

-- Start or Switch Timer
CREATE OR REPLACE FUNCTION public.start_or_switch_timer(
    p_task_id UUID,
    p_category public.time_category DEFAULT 'initial_design',
    p_note TEXT DEFAULT NULL,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_caller RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_task RECORD;
    v_entry_id UUID;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.tasks WHERE id = p_task_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Task not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;

    -- 1. TASK INVOLVEMENT CHECK FIRST
    IF NOT private.can_work_on_task(p_task_id) THEN
        RAISE EXCEPTION 'Access denied: You are not assigned to or collaborating on this task.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_task_id', p_task_id, 'p_category', p_category, 'p_note', p_note, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'start_or_switch_timer', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    SELECT * INTO v_task
    FROM public.tasks
    WHERE workspace_id = v_effective_workspace_id AND id = p_task_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found in this workspace.';
    END IF;

    -- Time tracking strictly allowed ONLY in explicitly active work states
    IF v_task.status NOT IN ('in_progress', 'changes_requested') THEN
        RAISE EXCEPTION 'Time tracking is only permitted for tasks in active work states (in_progress or changes_requested). Current status: %', v_task.status;
    END IF;

    -- Acquire transaction-level advisory lock on caller's roster person
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('timer:' || v_caller.roster_person_id::TEXT, 0));

    -- Auto-stop any open timer for caller and calculate duration_seconds
    UPDATE public.time_entries
    SET ended_at = pg_catalog.now(),
        duration_seconds = EXTRACT(EPOCH FROM (pg_catalog.now() - started_at))::INT,
        updated_at = pg_catalog.now()
    WHERE workspace_id = v_effective_workspace_id
      AND roster_person_id = v_caller.roster_person_id
      AND ended_at IS NULL
      AND is_voided = FALSE;

    -- Start new timer with canonical source column
    INSERT INTO public.time_entries (
        workspace_id,
        task_id,
        roster_person_id,
        started_at,
        category,
        note,
        source,
        created_by_id
    ) VALUES (
        v_effective_workspace_id,
        p_task_id,
        v_caller.roster_person_id,
        pg_catalog.now(),
        p_category,
        p_note,
        'timer',
        v_caller.roster_person_id
    ) RETURNING id INTO v_entry_id;

    v_result := jsonb_build_object(
        'success', TRUE,
        'time_entry_id', v_entry_id,
        'task_id', p_task_id,
        'started_at', pg_catalog.now()
    );

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'start_or_switch_timer', p_idempotency_key, v_hash, v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Start Timer On Behalf
CREATE OR REPLACE FUNCTION public.start_timer_on_behalf(
    p_task_id UUID,
    p_reason TEXT,
    p_target_roster_id UUID DEFAULT NULL,
    p_target_roster_person_id UUID DEFAULT NULL,
    p_category public.time_category DEFAULT 'initial_design',
    p_note TEXT DEFAULT NULL,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_target_id UUID;
    v_effective_workspace_id UUID;
    v_caller RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_task RECORD;
    v_is_involved BOOLEAN;
    v_entry_id UUID;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    v_effective_target_id := COALESCE(p_target_roster_person_id, p_target_roster_id);
    IF v_effective_target_id IS NULL THEN
        RAISE EXCEPTION 'Target roster person ID is required.';
    END IF;

    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.tasks WHERE id = p_task_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Task not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;

    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can start a timer on behalf of another member.';
    END IF;

    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'A non-empty reason is required when starting a timer on behalf.';
    END IF;

    -- 1. COMPLETE RESOURCE AUTHORIZATION FIRST
    SELECT * INTO v_task
    FROM public.tasks
    WHERE workspace_id = v_effective_workspace_id AND id = p_task_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found in this workspace.';
    END IF;

    -- Check target roster person exists and is active
    IF NOT EXISTS (
        SELECT 1 FROM public.roster_people
        WHERE workspace_id = v_effective_workspace_id
          AND id = v_effective_target_id
          AND is_active = TRUE
    ) THEN
        RAISE EXCEPTION 'Target roster person is not active in this workspace.';
    END IF;

    -- NULL-SENSITIVE: Target member must prove they are assignee or active collaborator
    v_is_involved := (
        (v_task.primary_assignee_id IS NOT NULL AND v_task.primary_assignee_id = v_effective_target_id) OR
        EXISTS (
            SELECT 1 FROM public.task_collaborators tc
            JOIN public.roster_people rp ON tc.roster_person_id = rp.id
            WHERE tc.workspace_id = v_effective_workspace_id
              AND tc.task_id = p_task_id
              AND tc.roster_person_id = v_effective_target_id
              AND rp.is_active = TRUE
        )
    );

    IF NOT COALESCE(v_is_involved, FALSE) THEN
        RAISE EXCEPTION 'Target member is not assigned or collaborating on this task.';
    END IF;

    IF v_task.status NOT IN ('in_progress', 'changes_requested') THEN
        RAISE EXCEPTION 'Time tracking is only permitted for tasks in active work states (in_progress or changes_requested). Current status: %', v_task.status;
    END IF;

    -- 2. Concurrency-Safe Idempotency Check AFTER authorization
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_task_id', p_task_id, 'p_reason', p_reason, 'p_target_roster_id', p_target_roster_id, 'p_target_roster_person_id', p_target_roster_person_id, 'p_category', p_category, 'p_note', p_note, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'start_timer_on_behalf', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('timer:' || v_effective_target_id::TEXT, 0));

    -- Auto-stop any open timer for target person and calculate duration_seconds
    UPDATE public.time_entries
    SET ended_at = pg_catalog.now(),
        duration_seconds = EXTRACT(EPOCH FROM (pg_catalog.now() - started_at))::INT,
        updated_at = pg_catalog.now()
    WHERE workspace_id = v_effective_workspace_id
      AND roster_person_id = v_effective_target_id
      AND ended_at IS NULL
      AND is_voided = FALSE;

    INSERT INTO public.time_entries (
        workspace_id,
        task_id,
        roster_person_id,
        started_at,
        category,
        note,
        source,
        created_by_id
    ) VALUES (
        v_effective_workspace_id,
        p_task_id,
        v_effective_target_id,
        pg_catalog.now(),
        p_category,
        p_note,
        'on_behalf',
        v_caller.roster_person_id
    ) RETURNING id INTO v_entry_id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id, v_caller.roster_person_id, 'start_timer_on_behalf', 'time_entries', v_entry_id,
        jsonb_build_object('task_id', p_task_id, 'target_roster_id', v_effective_target_id, 'reason', p_reason, 'category', p_category)
    );

    v_result := jsonb_build_object(
        'success', TRUE,
        'time_entry_id', v_entry_id,
        'task_id', p_task_id,
        'target_roster_id', v_effective_target_id,
        'source', 'on_behalf',
        'started_at', pg_catalog.now()
    );

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'start_timer_on_behalf', p_idempotency_key, v_hash, v_result);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Stop Timer (Authorization Checked BEFORE Early Returns, Computes duration_seconds)
CREATE OR REPLACE FUNCTION public.stop_timer(
    p_time_entry_id UUID,
    p_reason TEXT DEFAULT NULL,
    p_note TEXT DEFAULT NULL,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_effective_reason TEXT;
    v_caller RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_entry RECORD;
    v_now TIMESTAMPTZ := pg_catalog.now();
    v_dur INT;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.time_entries WHERE id = p_time_entry_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Time entry not found.'; END IF;
    END IF;

    v_effective_reason := COALESCE(p_reason, p_note);

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_time_entry_id', p_time_entry_id, 'p_reason', p_reason, 'p_note', p_note, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'stop_timer', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    SELECT * INTO v_entry
    FROM public.time_entries
    WHERE workspace_id = v_effective_workspace_id AND id = p_time_entry_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Time entry not found in this workspace.';
    END IF;

    -- 1. AUTHORIZATION CHECK FIRST
    IF v_entry.roster_person_id <> v_caller.roster_person_id THEN
        IF v_caller.role NOT IN ('owner', 'manager') THEN
            RAISE EXCEPTION 'Permission denied: Cannot stop another member timer.';
        END IF;
        IF v_effective_reason IS NULL OR btrim(v_effective_reason) = '' THEN
            RAISE EXCEPTION 'Reason is required when management stops another member timer.';
        END IF;
    END IF;

    -- 2. AFTER AUTHORIZATION: Check if already stopped
    IF v_entry.ended_at IS NOT NULL THEN
        v_result := jsonb_build_object('success', TRUE, 'time_entry_id', p_time_entry_id, 'ended_at', v_entry.ended_at, 'duration_seconds', v_entry.duration_seconds);
        IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
            PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'stop_timer', p_idempotency_key, v_hash, v_result);
        END IF;
        RETURN v_result;
    END IF;

    -- Reject zero/negative duration
    IF v_now <= v_entry.started_at THEN
        RAISE EXCEPTION 'Timer duration must be greater than zero.';
    END IF;

    v_dur := EXTRACT(EPOCH FROM (v_now - v_entry.started_at))::INT;

    UPDATE public.time_entries
    SET ended_at = v_now,
        duration_seconds = v_dur,
        note = COALESCE(p_note, note),
        updated_at = v_now
    WHERE id = p_time_entry_id;

    IF v_entry.roster_person_id <> v_caller.roster_person_id THEN
        INSERT INTO public.audit_events (
            workspace_id, actor_id, action, entity_type, entity_id, metadata
        ) VALUES (
            v_effective_workspace_id, v_caller.roster_person_id, 'management_timer_stopped', 'time_entries', p_time_entry_id,
            jsonb_build_object('timer_owner_id', v_entry.roster_person_id, 'reason', v_effective_reason)
        );
    END IF;

    v_result := jsonb_build_object('success', TRUE, 'time_entry_id', p_time_entry_id, 'ended_at', v_now, 'duration_seconds', v_dur);
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'stop_timer', p_idempotency_key, v_hash, v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Create Manual Time Entry (Enforces Task Involvement & Active Status)
CREATE OR REPLACE FUNCTION public.create_manual_time_entry(
    p_task_id UUID,
    p_started_at TIMESTAMPTZ,
    p_ended_at TIMESTAMPTZ,
    p_category public.time_category DEFAULT 'initial_design',
    p_note TEXT DEFAULT NULL,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_caller RECORD;
    v_task RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_entry_id UUID;
    v_dur INT;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.tasks WHERE id = p_task_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Task not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;

    -- 1. TASK INVOLVEMENT CHECK FIRST
    IF NOT private.can_work_on_task(p_task_id) THEN
        RAISE EXCEPTION 'Access denied: You are not assigned to or collaborating on this task.';
    END IF;

    IF p_started_at >= p_ended_at THEN
        RAISE EXCEPTION 'Start time must be strictly before end time.';
    END IF;

    IF p_ended_at > pg_catalog.now() THEN
        RAISE EXCEPTION 'Cannot record time entries in the future.';
    END IF;

    SELECT * INTO v_task
    FROM public.tasks
    WHERE workspace_id = v_effective_workspace_id AND id = p_task_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found in this workspace.';
    END IF;

    IF v_task.status IN ('delivered', 'cancelled') THEN
        RAISE EXCEPTION 'Cannot log time against delivered or cancelled tasks.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_task_id', p_task_id, 'p_started_at', p_started_at, 'p_ended_at', p_ended_at, 'p_category', p_category, 'p_note', p_note, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'create_manual_time_entry', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    v_dur := EXTRACT(EPOCH FROM (p_ended_at - p_started_at))::INT;

    INSERT INTO public.time_entries (
        workspace_id,
        task_id,
        roster_person_id,
        started_at,
        ended_at,
        duration_seconds,
        category,
        note,
        source,
        created_by_id
    ) VALUES (
        v_effective_workspace_id,
        p_task_id,
        v_caller.roster_person_id,
        p_started_at,
        p_ended_at,
        v_dur,
        p_category,
        p_note,
        'manual',
        v_caller.roster_person_id
    ) RETURNING id INTO v_entry_id;

    v_result := jsonb_build_object(
        'success', TRUE,
        'time_entry_id', v_entry_id,
        'task_id', p_task_id,
        'duration_seconds', v_dur
    );

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'create_manual_time_entry', p_idempotency_key, v_hash, v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION public.record_manual_time_entry(
    p_task_id UUID,
    p_started_at TIMESTAMPTZ,
    p_ended_at TIMESTAMPTZ,
    p_category public.time_category DEFAULT 'initial_design',
    p_note TEXT DEFAULT NULL,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
BEGIN
    RETURN public.create_manual_time_entry(p_task_id, p_started_at, p_ended_at, p_category, p_note, p_workspace_id, p_idempotency_key);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Void Time Entry: Owner/Manager Only with mandatory reason
CREATE OR REPLACE FUNCTION public.void_time_entry(
    p_time_entry_id UUID,
    p_reason TEXT DEFAULT NULL,
    p_void_reason TEXT DEFAULT NULL,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_effective_reason TEXT;
    v_caller RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_entry RECORD;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.time_entries WHERE id = p_time_entry_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Time entry not found.'; END IF;
    END IF;

    v_effective_reason := COALESCE(p_reason, p_void_reason);
    IF v_effective_reason IS NULL OR btrim(v_effective_reason) = '' THEN
        RAISE EXCEPTION 'A valid reason is required to void a time entry.';
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;

    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can void time entries.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_time_entry_id', p_time_entry_id, 'p_reason', p_reason, 'p_void_reason', p_void_reason, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'void_time_entry', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    SELECT * INTO v_entry
    FROM public.time_entries
    WHERE workspace_id = v_effective_workspace_id AND id = p_time_entry_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Time entry not found in this workspace.';
    END IF;

    IF v_entry.is_voided THEN
        v_result := jsonb_build_object('success', TRUE, 'time_entry_id', p_time_entry_id, 'note', 'Already voided');
        IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
            PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'void_time_entry', p_idempotency_key, v_hash, v_result);
        END IF;
        RETURN v_result;
    END IF;

    UPDATE public.time_entries
    SET is_voided = TRUE,
        void_reason = v_effective_reason,
        voided_by_id = v_caller.roster_person_id,
        voided_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = p_time_entry_id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id, v_caller.roster_person_id, 'void_time_entry', 'time_entries', p_time_entry_id,
        jsonb_build_object('reason', v_effective_reason, 'entry_roster_id', v_entry.roster_person_id)
    );

    v_result := jsonb_build_object('success', TRUE, 'time_entry_id', p_time_entry_id, 'is_voided', TRUE);
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'void_time_entry', p_idempotency_key, v_hash, v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Request Time Correction
CREATE OR REPLACE FUNCTION public.request_time_correction(
    p_time_entry_id UUID,
    p_proposed_started_at TIMESTAMPTZ,
    p_proposed_ended_at TIMESTAMPTZ,
    p_reason TEXT,
    p_proposed_category public.time_category DEFAULT NULL,
    p_proposed_note TEXT DEFAULT NULL,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_caller RECORD;
    v_entry RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_req_id UUID;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.time_entries WHERE id = p_time_entry_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Time entry not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;

    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'Correction reason is required.';
    END IF;

    IF p_proposed_started_at >= p_proposed_ended_at THEN
        RAISE EXCEPTION 'Proposed start must be strictly before proposed end.';
    END IF;

    IF p_proposed_ended_at > pg_catalog.now() THEN
        RAISE EXCEPTION 'Cannot propose time in the future.';
    END IF;

    SELECT * INTO v_entry
    FROM public.time_entries
    WHERE workspace_id = v_effective_workspace_id AND id = p_time_entry_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Time entry not found.';
    END IF;

    IF v_entry.roster_person_id <> v_caller.roster_person_id THEN
        RAISE EXCEPTION 'Permission denied: You can only request corrections for your own time entries.';
    END IF;

    IF v_entry.ended_at IS NULL THEN
        RAISE EXCEPTION 'Cannot request correction for an active running timer. Stop the timer first.';
    END IF;

    IF v_entry.is_voided THEN
        RAISE EXCEPTION 'Cannot request correction for a voided time entry.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_time_entry_id', p_time_entry_id, 'p_proposed_started_at', p_proposed_started_at, 'p_proposed_ended_at', p_proposed_ended_at, 'p_reason', p_reason, 'p_proposed_category', p_proposed_category, 'p_proposed_note', p_proposed_note, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'request_time_correction', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    INSERT INTO public.time_change_requests (
        workspace_id,
        time_entry_id,
        requested_by_id,
        original_started_at,
        original_ended_at,
        proposed_started_at,
        proposed_ended_at,
        proposed_category,
        proposed_note,
        reason,
        status
    ) VALUES (
        v_effective_workspace_id,
        p_time_entry_id,
        v_caller.roster_person_id,
        v_entry.started_at,
        v_entry.ended_at,
        p_proposed_started_at,
        p_proposed_ended_at,
        COALESCE(p_proposed_category, v_entry.category),
        COALESCE(p_proposed_note, v_entry.note),
        p_reason,
        'pending'
    ) RETURNING id INTO v_req_id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id, v_caller.roster_person_id, 'request_time_correction', 'time_change_requests', v_req_id,
        jsonb_build_object('time_entry_id', p_time_entry_id, 'reason', p_reason)
    );

    v_result := jsonb_build_object('success', TRUE, 'correction_request_id', v_req_id, 'status', 'pending');
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'request_time_correction', p_idempotency_key, v_hash, v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Decide Time Correction (Atomic Replacement with Lineage Preserved)
CREATE OR REPLACE FUNCTION public.decide_time_correction(
    p_request_id UUID,
    p_decision public.correction_status,
    p_review_notes TEXT DEFAULT NULL,
    p_rejection_reason TEXT DEFAULT NULL,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_caller RECORD;
    v_req RECORD;
    v_orig RECORD;
    v_new_entry_id UUID;
    v_dur INT;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.time_change_requests WHERE id = p_request_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Correction request not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;

    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can decide time corrections.';
    END IF;

    IF p_decision IS NULL OR p_decision = 'pending' THEN
        RAISE EXCEPTION 'Decision cannot be pending. Must be approved or rejected.';
    END IF;

    IF p_decision = 'rejected' AND (COALESCE(p_rejection_reason, p_review_notes) IS NULL OR btrim(COALESCE(p_rejection_reason, p_review_notes)) = '') THEN
        RAISE EXCEPTION 'Rejection reason is required when rejecting a correction request.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_request_id', p_request_id, 'p_decision', p_decision, 'p_review_notes', p_review_notes, 'p_rejection_reason', p_rejection_reason, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'decide_time_correction', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    SELECT * INTO v_req
    FROM public.time_change_requests
    WHERE workspace_id = v_effective_workspace_id AND id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Correction request not found in this workspace.';
    END IF;

    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'Correction request has already been decided.';
    END IF;

    IF v_caller.roster_person_id = v_req.requested_by_id THEN
        RAISE EXCEPTION 'Self-approval denied: Requester cannot decide their own correction request.';
    END IF;

    SELECT * INTO v_orig
    FROM public.time_entries
    WHERE id = v_req.time_entry_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Original time entry not found.';
    END IF;

    IF p_decision = 'approved' THEN
        IF v_orig.is_voided THEN
            RAISE EXCEPTION 'Cannot approve correction: Original time entry has already been voided.';
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.time_entries
            WHERE replaces_time_entry_id = v_orig.id
        ) THEN
            RAISE EXCEPTION 'Original time entry has already been replaced by another correction.';
        END IF;

        -- Atomically void original entry
        UPDATE public.time_entries
        SET is_voided = TRUE,
            void_reason = 'Replaced by approved time correction: ' || v_req.id::TEXT,
            voided_by_id = v_caller.roster_person_id,
            voided_at = pg_catalog.now(),
            updated_at = pg_catalog.now()
        WHERE id = v_orig.id;

        v_dur := EXTRACT(EPOCH FROM (v_req.proposed_ended_at - v_req.proposed_started_at))::INT;

        -- Insert replacement entry with lineage preserved
        INSERT INTO public.time_entries (
            workspace_id,
            task_id,
            roster_person_id,
            started_at,
            ended_at,
            duration_seconds,
            category,
            note,
            source,
            created_by_id,
            correction_request_id,
            replaces_time_entry_id
        ) VALUES (
            v_effective_workspace_id,
            v_orig.task_id,
            v_orig.roster_person_id,
            v_req.proposed_started_at,
            v_req.proposed_ended_at,
            v_dur,
            v_req.proposed_category,
            v_req.proposed_note,
            'manual',
            v_caller.roster_person_id,
            v_req.id,
            v_orig.id
        ) RETURNING id INTO v_new_entry_id;
    END IF;

    UPDATE public.time_change_requests
    SET status = p_decision,
        reviewed_by_id = v_caller.roster_person_id,
        decision_reason = COALESCE(p_rejection_reason, p_review_notes),
        decided_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = v_req.id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id, v_caller.roster_person_id, 'decide_time_correction', 'time_change_requests', v_req.id,
        jsonb_build_object('decision', p_decision, 'original_entry_id', v_orig.id, 'replacement_entry_id', v_new_entry_id)
    );

    v_result := jsonb_build_object(
        'success', TRUE,
        'request_id', v_req.id,
        'decision', p_decision,
        'replacement_entry_id', v_new_entry_id
    );

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'decide_time_correction', p_idempotency_key, v_hash, v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- -----------------------------------------------------------------------------
-- 7. CLIENTS, CAMPAIGNS, CAPACITIES & SETTINGS RPCS
-- -----------------------------------------------------------------------------

-- Create Client
CREATE OR REPLACE FUNCTION public.create_client(
    p_workspace_id UUID,
    p_name TEXT,
    p_owner_roster_id UUID DEFAULT NULL,
    p_difficulty public.client_difficulty DEFAULT 'Medium',
    p_extra_workload public.client_extra_workload DEFAULT 'None',
    p_state public.client_state DEFAULT 'Active',
    p_notes TEXT DEFAULT NULL,
    p_brand_guide_url TEXT DEFAULT NULL,
    p_brief_url TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_caller RECORD;
    v_client_id UUID;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can create clients.';
    END IF;
    IF p_idempotency_key IS NOT NULL THEN
        v_payload := jsonb_build_object('p_workspace_id', p_workspace_id, 'p_name', p_name, 'p_owner_roster_id', p_owner_roster_id, 'p_difficulty', p_difficulty, 'p_extra_workload', p_extra_workload, 'p_state', p_state, 'p_notes', p_notes, 'p_brand_guide_url', p_brand_guide_url, 'p_brief_url', p_brief_url);
        v_hash := encode(extensions.digest(v_payload::text,'sha256'),'hex');
        v_cached := private.fn_acquire_idempotency_lock(p_workspace_id,v_caller.roster_person_id,'create_client',p_idempotency_key,v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;


    IF p_name IS NULL OR btrim(p_name) = '' THEN
        RAISE EXCEPTION 'Client name cannot be empty.';
    END IF;

    INSERT INTO public.clients (
        workspace_id,
        name,
        owner_roster_id,
        difficulty,
        extra_workload,
        state,
        notes,
        brand_guide_url,
        brief_url
    ) VALUES (
        p_workspace_id,
        btrim(p_name),
        p_owner_roster_id,
        p_difficulty,
        p_extra_workload,
        p_state,
        p_notes,
        p_brand_guide_url,
        p_brief_url
    ) RETURNING id INTO v_client_id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        p_workspace_id, v_caller.roster_person_id, 'create_client', 'clients', v_client_id,
        jsonb_build_object('name', p_name, 'difficulty', p_difficulty)
    );

    v_result := jsonb_build_object('success', TRUE, 'client_id', v_client_id);
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM private.fn_record_idempotency(p_workspace_id,v_caller.roster_person_id,'create_client',p_idempotency_key,v_hash,v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Update Client with confirmed open task reassignment
CREATE OR REPLACE FUNCTION public.update_client(
    p_workspace_id UUID,
    p_client_id UUID,
    p_name TEXT DEFAULT NULL,
    p_owner_roster_id UUID DEFAULT NULL,
    p_difficulty public.client_difficulty DEFAULT NULL,
    p_extra_workload public.client_extra_workload DEFAULT NULL,
    p_state public.client_state DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_brand_guide_url TEXT DEFAULT NULL,
    p_brief_url TEXT DEFAULT NULL,
    p_reassign_open_tasks BOOLEAN DEFAULT FALSE,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_caller RECORD;
    v_client RECORD;
    v_reassigned_count INT := 0;
    v_t RECORD;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can update clients.';
    END IF;
    IF p_idempotency_key IS NOT NULL THEN
        v_payload := jsonb_build_object('p_workspace_id', p_workspace_id, 'p_client_id', p_client_id, 'p_name', p_name, 'p_owner_roster_id', p_owner_roster_id, 'p_difficulty', p_difficulty, 'p_extra_workload', p_extra_workload, 'p_state', p_state, 'p_notes', p_notes, 'p_brand_guide_url', p_brand_guide_url, 'p_brief_url', p_brief_url, 'p_reassign_open_tasks', p_reassign_open_tasks);
        v_hash := encode(extensions.digest(v_payload::text,'sha256'),'hex');
        v_cached := private.fn_acquire_idempotency_lock(p_workspace_id,v_caller.roster_person_id,'update_client',p_idempotency_key,v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;


    SELECT * INTO v_client
    FROM public.clients
    WHERE workspace_id = p_workspace_id AND id = p_client_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Client not found in this workspace.';
    END IF;

    UPDATE public.clients
    SET name = COALESCE(NULLIF(btrim(p_name), ''), name),
        owner_roster_id = COALESCE(p_owner_roster_id, owner_roster_id),
        difficulty = COALESCE(p_difficulty, difficulty),
        extra_workload = COALESCE(p_extra_workload, extra_workload),
        state = COALESCE(p_state, state),
        notes = COALESCE(p_notes, notes),
        brand_guide_url = COALESCE(p_brand_guide_url, brand_guide_url),
        brief_url = COALESCE(p_brief_url, brief_url),
        updated_at = pg_catalog.now()
    WHERE id = p_client_id;

    -- Confirmed open tasks reassignment workflow
    IF p_reassign_open_tasks AND p_owner_roster_id IS NOT NULL AND p_owner_roster_id <> COALESCE(v_client.owner_roster_id, '00000000-0000-0000-0000-000000000000'::UUID) THEN
        FOR v_t IN (
            SELECT id, primary_assignee_id FROM public.tasks
            WHERE workspace_id = p_workspace_id
              AND client_id = p_client_id
              AND status NOT IN ('delivered', 'cancelled')
        ) LOOP
            UPDATE public.tasks
            SET primary_assignee_id = p_owner_roster_id, updated_at = pg_catalog.now()
            WHERE id = v_t.id;

            INSERT INTO public.task_assignment_events (
                workspace_id, task_id, previous_assignee_id, new_assignee_id, actor_id, reason
            ) VALUES (
                p_workspace_id, v_t.id, v_t.primary_assignee_id, p_owner_roster_id, v_caller.roster_person_id, 'Reassigned due to client account owner change'
            );
            v_reassigned_count := v_reassigned_count + 1;
        END LOOP;
    END IF;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        p_workspace_id, v_caller.roster_person_id, 'update_client', 'clients', p_client_id,
        jsonb_build_object('client_id', p_client_id, 'reassigned_tasks_count', v_reassigned_count)
    );

    v_result := jsonb_build_object('success', TRUE, 'client_id', p_client_id, 'reassigned_tasks', v_reassigned_count);
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM private.fn_record_idempotency(p_workspace_id,v_caller.roster_person_id,'update_client',p_idempotency_key,v_hash,v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Archive Client
CREATE OR REPLACE FUNCTION public.archive_client(
    p_workspace_id UUID,
    p_client_id UUID,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_caller RECORD;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can archive clients.';
    END IF;
    IF p_idempotency_key IS NOT NULL THEN
        v_payload := jsonb_build_object('p_workspace_id', p_workspace_id, 'p_client_id', p_client_id);
        v_hash := encode(extensions.digest(v_payload::text,'sha256'),'hex');
        v_cached := private.fn_acquire_idempotency_lock(p_workspace_id,v_caller.roster_person_id,'archive_client',p_idempotency_key,v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;


    UPDATE public.clients
    SET state = 'Archived',
        archived_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE workspace_id = p_workspace_id AND id = p_client_id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        p_workspace_id, v_caller.roster_person_id, 'archive_client', 'clients', p_client_id,
        jsonb_build_object('archived_at', pg_catalog.now())
    );

    v_result := jsonb_build_object('success', TRUE, 'client_id', p_client_id, 'state', 'Archived');
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM private.fn_record_idempotency(p_workspace_id,v_caller.roster_person_id,'archive_client',p_idempotency_key,v_hash,v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Create Campaign
CREATE OR REPLACE FUNCTION public.create_campaign(
    p_workspace_id UUID,
    p_client_id UUID,
    p_title TEXT,
    p_objective TEXT DEFAULT NULL,
    p_brief TEXT DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_due_date DATE DEFAULT NULL,
    p_status public.campaign_status DEFAULT 'Draft',
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_caller RECORD;
    v_campaign_id UUID;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can create campaigns.';
    END IF;
    IF p_idempotency_key IS NOT NULL THEN
        v_payload := jsonb_build_object('p_workspace_id', p_workspace_id, 'p_client_id', p_client_id, 'p_title', p_title, 'p_objective', p_objective, 'p_brief', p_brief, 'p_start_date', p_start_date, 'p_due_date', p_due_date, 'p_status', p_status);
        v_hash := encode(extensions.digest(v_payload::text,'sha256'),'hex');
        v_cached := private.fn_acquire_idempotency_lock(p_workspace_id,v_caller.roster_person_id,'create_campaign',p_idempotency_key,v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;


    IF p_title IS NULL OR btrim(p_title) = '' THEN
        RAISE EXCEPTION 'Campaign title cannot be empty.';
    END IF;

    INSERT INTO public.campaigns (
        workspace_id,
        client_id,
        title,
        objective,
        brief,
        start_date,
        due_date,
        status,
        created_by_id
    ) VALUES (
        p_workspace_id,
        p_client_id,
        btrim(p_title),
        p_objective,
        p_brief,
        p_start_date,
        p_due_date,
        p_status,
        v_caller.roster_person_id
    ) RETURNING id INTO v_campaign_id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        p_workspace_id, v_caller.roster_person_id, 'create_campaign', 'campaigns', v_campaign_id,
        jsonb_build_object('title', p_title, 'client_id', p_client_id)
    );

    v_result := jsonb_build_object('success', TRUE, 'campaign_id', v_campaign_id);
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM private.fn_record_idempotency(p_workspace_id,v_caller.roster_person_id,'create_campaign',p_idempotency_key,v_hash,v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Generate Campaign Posts (Batch generation of Post 01...Post 12 with deliverable_number preserved)
CREATE OR REPLACE FUNCTION public.generate_campaign_posts(
    p_workspace_id UUID,
    p_campaign_id UUID,
    p_client_id UUID,
    p_post_count INT DEFAULT 12,
    p_deliverable_type TEXT DEFAULT 'Post',
    p_priority public.task_priority DEFAULT 'Normal',
    p_primary_assignee_id UUID DEFAULT NULL,
    p_reviewer_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller RECORD;
    v_campaign RECORD;
    v_count INT := COALESCE(p_post_count, 12);
    v_i INT;
    v_post_num TEXT;
    v_post_title TEXT;
    v_task_id UUID;
    v_created_ids UUID[] := '{}';
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can generate campaign posts.';
    END IF;

    SELECT * INTO v_campaign
    FROM public.campaigns
    WHERE workspace_id = p_workspace_id AND id = p_campaign_id AND client_id = p_client_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Campaign not found in this workspace and client.';
    END IF;

    -- Concurrency-Safe Idempotency Check with ALL behavior-affecting parameters
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_workspace_id', p_workspace_id, 'p_campaign_id', p_campaign_id, 'p_client_id', p_client_id, 'p_post_count', p_post_count, 'p_deliverable_type', p_deliverable_type, 'p_priority', p_priority, 'p_primary_assignee_id', p_primary_assignee_id, 'p_reviewer_id', p_reviewer_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(p_workspace_id, v_caller.roster_person_id, 'generate_campaign_posts', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    -- Prevent duplicate generation: Check if posts already exist for this campaign
    IF EXISTS (
        SELECT 1 FROM public.tasks
        WHERE workspace_id = p_workspace_id
          AND campaign_id = p_campaign_id
          AND deliverable_number = 'Post 01'
    ) THEN
        RAISE EXCEPTION 'Posts have already been generated for this campaign.';
    END IF;

    FOR v_i IN 1..v_count LOOP
        v_post_num := 'Post ' || LPAD(v_i::TEXT, 2, '0');
        v_post_title := v_campaign.title || ' - ' || v_post_num;

        INSERT INTO public.tasks (
            workspace_id,
            client_id,
            campaign_id,
            title,
            deliverable_format,
            deliverable_number,
            priority,
            status,
            primary_assignee_id,
            reviewer_id,
            created_by_id
        ) VALUES (
            p_workspace_id,
            p_client_id,
            p_campaign_id,
            v_post_title,
            p_deliverable_type,
            v_post_num,
            p_priority,
            'backlog',
            p_primary_assignee_id,
            p_reviewer_id,
            v_caller.roster_person_id
        ) RETURNING id INTO v_task_id;

        -- Record initial status event for retrospective reconstruction
        INSERT INTO public.task_status_events (
            workspace_id, task_id, from_status, to_status, actor_id, reason
        ) VALUES (
            p_workspace_id, v_task_id, NULL, 'backlog', v_caller.roster_person_id, 'Campaign post generated'
        );

        -- Record initial assignment event if assigned
        IF p_primary_assignee_id IS NOT NULL THEN
            INSERT INTO public.task_assignment_events (
                workspace_id, task_id, previous_assignee_id, new_assignee_id, actor_id, reason
            ) VALUES (
                p_workspace_id, v_task_id, NULL, p_primary_assignee_id, v_caller.roster_person_id, 'Campaign post initial assignment'
            );
        END IF;

        v_created_ids := array_append(v_created_ids, v_task_id);
    END LOOP;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        p_workspace_id, v_caller.roster_person_id, 'generate_campaign_posts', 'campaigns', p_campaign_id,
        jsonb_build_object('count', v_count, 'task_ids', v_created_ids)
    );

    v_result := jsonb_build_object(
        'success', TRUE,
        'campaign_id', p_campaign_id,
        'post_count', v_count,
        'created_task_ids', v_created_ids
    );

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(p_workspace_id, v_caller.roster_person_id, 'generate_campaign_posts', p_idempotency_key, v_hash, v_result);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Upsert Member Capacity
CREATE OR REPLACE FUNCTION public.upsert_member_capacity(
    p_workspace_id UUID,
    p_roster_person_id UUID,
    p_weekly_hours NUMERIC,
    p_reserved_management_hours NUMERIC DEFAULT 0,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_caller RECORD;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can manage member capacities.';
    END IF;
    IF p_idempotency_key IS NOT NULL THEN
        v_payload := jsonb_build_object('p_workspace_id', p_workspace_id, 'p_roster_person_id', p_roster_person_id, 'p_weekly_hours', p_weekly_hours, 'p_reserved_management_hours', p_reserved_management_hours);
        v_hash := encode(extensions.digest(v_payload::text,'sha256'),'hex');
        v_cached := private.fn_acquire_idempotency_lock(p_workspace_id,v_caller.roster_person_id,'upsert_member_capacity',p_idempotency_key,v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;


    IF p_weekly_hours IS NOT NULL AND p_weekly_hours < 0 THEN
        RAISE EXCEPTION 'Weekly hours must be nonnegative.';
    END IF;

    IF p_reserved_management_hours IS NOT NULL AND p_reserved_management_hours < 0 THEN
        RAISE EXCEPTION 'Reserved management hours must be nonnegative.';
    END IF;

    IF p_weekly_hours IS NOT NULL AND p_reserved_management_hours IS NOT NULL AND p_reserved_management_hours > p_weekly_hours THEN
        RAISE EXCEPTION 'Reserved management hours cannot exceed weekly hours.';
    END IF;

    INSERT INTO public.member_capacities (
        workspace_id,
        roster_person_id,
        weekly_hours,
        reserved_management_hours,
        updated_at
    ) VALUES (
        p_workspace_id,
        p_roster_person_id,
        p_weekly_hours,
        COALESCE(p_reserved_management_hours, 0.00),
        pg_catalog.now()
    )
    ON CONFLICT (workspace_id, roster_person_id)
    DO UPDATE SET
        weekly_hours = EXCLUDED.weekly_hours,
        reserved_management_hours = EXCLUDED.reserved_management_hours,
        updated_at = pg_catalog.now();

    v_result := jsonb_build_object('success', TRUE, 'roster_person_id', p_roster_person_id);
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM private.fn_record_idempotency(p_workspace_id,v_caller.roster_person_id,'upsert_member_capacity',p_idempotency_key,v_hash,v_result);
    END IF;
    INSERT INTO public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) VALUES(p_workspace_id,v_caller.roster_person_id,'upsert_member_capacity','workspace_operation',p_workspace_id,jsonb_build_object('result',v_result));
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Manage Leave Day (Add/Delete)
CREATE OR REPLACE FUNCTION public.manage_leave_day(
    p_workspace_id UUID,
    p_roster_person_id UUID,
    p_leave_date DATE,
    p_hours NUMERIC,
    p_leave_type public.leave_type DEFAULT 'annual',
    p_action TEXT DEFAULT 'add',
    p_leave_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_caller RECORD;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can manage leave days.';
    END IF;
    IF p_idempotency_key IS NOT NULL THEN
        v_payload := jsonb_build_object('p_workspace_id', p_workspace_id, 'p_roster_person_id', p_roster_person_id, 'p_leave_date', p_leave_date, 'p_hours', p_hours, 'p_leave_type', p_leave_type, 'p_action', p_action, 'p_leave_id', p_leave_id);
        v_hash := encode(extensions.digest(v_payload::text,'sha256'),'hex');
        v_cached := private.fn_acquire_idempotency_lock(p_workspace_id,v_caller.roster_person_id,'manage_leave_day',p_idempotency_key,v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;


    IF p_action = 'delete' THEN
        DELETE FROM public.leave_days
        WHERE workspace_id = p_workspace_id AND id = p_leave_id;
        v_result := jsonb_build_object('success', TRUE, 'action', 'deleted');
    ELSE
        INSERT INTO public.leave_days (
            workspace_id,
            roster_person_id,
            leave_date,
            hours,
            leave_type
        ) VALUES (
            p_workspace_id,
            p_roster_person_id,
            p_leave_date,
            p_hours,
            p_leave_type
        )
        ON CONFLICT (workspace_id, roster_person_id, leave_date)
        DO UPDATE SET
            hours = EXCLUDED.hours,
            leave_type = EXCLUDED.leave_type,
            updated_at = pg_catalog.now();
        v_result := jsonb_build_object('success', TRUE, 'action', 'saved');
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        PERFORM private.fn_record_idempotency(p_workspace_id,v_caller.roster_person_id,'manage_leave_day',p_idempotency_key,v_hash,v_result);
    END IF;
    INSERT INTO public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) VALUES(p_workspace_id,v_caller.roster_person_id,'manage_leave_day','workspace_operation',p_workspace_id,jsonb_build_object('result',v_result));
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Update Workspace Settings
CREATE OR REPLACE FUNCTION public.update_workspace_settings(
    p_workspace_id UUID,
    p_name TEXT,
    p_workweek_days INT[],
    p_day_start_time TIME DEFAULT NULL,
    p_day_end_time TIME DEFAULT NULL,
    p_long_session_threshold_mins INT DEFAULT 240,
    p_default_timezone TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_caller RECORD;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF v_caller.role <> 'owner' THEN
        RAISE EXCEPTION 'Permission denied: Only workspace owner can update workspace settings.';
    END IF;
    IF p_idempotency_key IS NOT NULL THEN
        v_payload := jsonb_build_object('p_workspace_id', p_workspace_id, 'p_name', p_name, 'p_workweek_days', p_workweek_days, 'p_day_start_time', p_day_start_time, 'p_day_end_time', p_day_end_time, 'p_long_session_threshold_mins', p_long_session_threshold_mins, 'p_default_timezone', p_default_timezone);
        v_hash := encode(extensions.digest(v_payload::text,'sha256'),'hex');
        v_cached := private.fn_acquire_idempotency_lock(p_workspace_id,v_caller.roster_person_id,'update_workspace_settings',p_idempotency_key,v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;


    IF NOT public.fn_validate_workweek_days(p_workweek_days) THEN
        RAISE EXCEPTION 'Invalid workweek days. Must contain unique integers 0..6 (where 0=Sunday).';
    END IF;

    IF p_long_session_threshold_mins IS NOT NULL AND p_long_session_threshold_mins <= 0 THEN
        RAISE EXCEPTION 'Long session threshold must be a positive integer.';
    END IF;

    IF p_default_timezone IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_default_timezone) THEN
            RAISE EXCEPTION 'Invalid timezone: %', p_default_timezone;
        END IF;
    END IF;

    UPDATE public.workspaces
    SET name = COALESCE(NULLIF(btrim(p_name), ''), name),
        workweek_days = p_workweek_days,
        day_start_time = COALESCE(p_day_start_time, day_start_time),
        day_end_time = COALESCE(p_day_end_time, day_end_time),
        long_session_threshold_mins = COALESCE(p_long_session_threshold_mins, long_session_threshold_mins),
        default_timezone = COALESCE(p_default_timezone, default_timezone),
        updated_at = pg_catalog.now()
    WHERE id = p_workspace_id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        p_workspace_id, v_caller.roster_person_id, 'update_workspace_settings', 'workspaces', p_workspace_id,
        jsonb_build_object('name', p_name, 'workweek_days', p_workweek_days)
    );

    v_result := jsonb_build_object('success', TRUE, 'workspace_id', p_workspace_id);
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM private.fn_record_idempotency(p_workspace_id,v_caller.roster_person_id,'update_workspace_settings',p_idempotency_key,v_hash,v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Create Roster Person
CREATE OR REPLACE FUNCTION public.create_roster_person(
    p_workspace_id UUID,
    p_display_name TEXT,
    p_job_title TEXT,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_caller RECORD;
    v_person_id UUID;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can create roster people.';
    END IF;
    IF p_idempotency_key IS NOT NULL THEN
        v_payload := jsonb_build_object('p_workspace_id', p_workspace_id, 'p_display_name', p_display_name, 'p_job_title', p_job_title);
        v_hash := encode(extensions.digest(v_payload::text,'sha256'),'hex');
        v_cached := private.fn_acquire_idempotency_lock(p_workspace_id,v_caller.roster_person_id,'create_roster_person',p_idempotency_key,v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;


    IF p_display_name IS NULL OR btrim(p_display_name) = '' THEN
        RAISE EXCEPTION 'Display name cannot be empty.';
    END IF;

    IF p_job_title IS NULL OR btrim(p_job_title) = '' THEN
        RAISE EXCEPTION 'Job title cannot be empty.';
    END IF;

    INSERT INTO public.roster_people (
        workspace_id,
        display_name,
        job_title,
        is_active
    ) VALUES (
        p_workspace_id,
        btrim(p_display_name),
        btrim(p_job_title),
        TRUE
    ) RETURNING id INTO v_person_id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        p_workspace_id, v_caller.roster_person_id, 'create_roster_person', 'roster_people', v_person_id,
        jsonb_build_object('display_name', p_display_name, 'job_title', p_job_title)
    );

    v_result := jsonb_build_object('success', TRUE, 'roster_person_id', v_person_id);
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM private.fn_record_idempotency(p_workspace_id,v_caller.roster_person_id,'create_roster_person',p_idempotency_key,v_hash,v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Update Roster Person (Owner protected from manager edits or deactivation)
CREATE OR REPLACE FUNCTION public.update_roster_person(
    p_workspace_id UUID,
    p_roster_person_id UUID,
    p_display_name TEXT,
    p_job_title TEXT,
    p_is_active BOOLEAN,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_caller RECORD;
    v_target_person RECORD;
    v_target_membership RECORD;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can update roster people.';
    END IF;
    IF p_idempotency_key IS NOT NULL THEN
        v_payload := jsonb_build_object('p_workspace_id', p_workspace_id, 'p_roster_person_id', p_roster_person_id, 'p_display_name', p_display_name, 'p_job_title', p_job_title, 'p_is_active', p_is_active);
        v_hash := encode(extensions.digest(v_payload::text,'sha256'),'hex');
        v_cached := private.fn_acquire_idempotency_lock(p_workspace_id,v_caller.roster_person_id,'update_roster_person',p_idempotency_key,v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;


    SELECT * INTO v_target_person
    FROM public.roster_people
    WHERE workspace_id = p_workspace_id AND id = p_roster_person_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Roster person not found in this workspace.';
    END IF;

    SELECT * INTO v_target_membership
    FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id AND roster_person_id = p_roster_person_id AND is_active = TRUE;

    IF FOUND AND v_target_membership.role = 'owner' THEN
        IF v_caller.role <> 'owner' THEN
            RAISE EXCEPTION 'Permission denied: Managers cannot edit or deactivate the workspace owner.';
        END IF;
        IF p_is_active = FALSE THEN
            RAISE EXCEPTION 'Cannot deactivate the active workspace owner. Transfer ownership first.';
        END IF;
    END IF;

    UPDATE public.roster_people
    SET display_name = COALESCE(NULLIF(btrim(p_display_name), ''), display_name),
        job_title = COALESCE(NULLIF(btrim(p_job_title), ''), job_title),
        is_active = COALESCE(p_is_active, is_active),
        updated_at = pg_catalog.now()
    WHERE id = p_roster_person_id;

    IF p_is_active = FALSE AND v_target_membership.id IS NOT NULL THEN
        UPDATE public.workspace_memberships
        SET is_active = FALSE, updated_at = pg_catalog.now()
        WHERE id = v_target_membership.id;
    END IF;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        p_workspace_id, v_caller.roster_person_id, 'update_roster_person', 'roster_people', p_roster_person_id,
        jsonb_build_object('display_name', p_display_name, 'is_active', p_is_active)
    );

    v_result := jsonb_build_object('success', TRUE, 'roster_person_id', p_roster_person_id, 'is_active', p_is_active);
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM private.fn_record_idempotency(p_workspace_id,v_caller.roster_person_id,'update_roster_person',p_idempotency_key,v_hash,v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Create Review Routing Rule
CREATE OR REPLACE FUNCTION public.create_review_routing_rule(
    p_workspace_id UUID,
    p_priority INT,
    p_designer_roster_id UUID,
    p_client_difficulty public.client_difficulty,
    p_reviewer_roster_id UUID,
    p_fallback_reviewer_id UUID,
    p_is_workspace_default BOOLEAN DEFAULT FALSE,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_caller RECORD;
    v_rule_id UUID;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can manage review routing rules.';
    END IF;
    IF p_idempotency_key IS NOT NULL THEN
        v_payload := jsonb_build_object('p_workspace_id', p_workspace_id, 'p_priority', p_priority, 'p_designer_roster_id', p_designer_roster_id, 'p_client_difficulty', p_client_difficulty, 'p_reviewer_roster_id', p_reviewer_roster_id, 'p_fallback_reviewer_id', p_fallback_reviewer_id, 'p_is_workspace_default', p_is_workspace_default);
        v_hash := encode(extensions.digest(v_payload::text,'sha256'),'hex');
        v_cached := private.fn_acquire_idempotency_lock(p_workspace_id,v_caller.roster_person_id,'create_review_routing_rule',p_idempotency_key,v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;


    INSERT INTO public.review_routing_rules (
        workspace_id,
        priority,
        designer_roster_id,
        client_difficulty,
        reviewer_roster_id,
        fallback_reviewer_id,
        is_workspace_default
    ) VALUES (
        p_workspace_id,
        COALESCE(p_priority, 0),
        p_designer_roster_id,
        p_client_difficulty,
        p_reviewer_roster_id,
        p_fallback_reviewer_id,
        COALESCE(p_is_workspace_default, FALSE)
    ) RETURNING id INTO v_rule_id;

    v_result := jsonb_build_object('success', TRUE, 'rule_id', v_rule_id);
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM private.fn_record_idempotency(p_workspace_id,v_caller.roster_person_id,'create_review_routing_rule',p_idempotency_key,v_hash,v_result);
    END IF;
    INSERT INTO public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) VALUES(p_workspace_id,v_caller.roster_person_id,'create_review_routing_rule','workspace_operation',p_workspace_id,jsonb_build_object('result',v_result));
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Delete Review Routing Rule
CREATE OR REPLACE FUNCTION public.delete_review_routing_rule(
    p_workspace_id UUID,
    p_rule_id UUID,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_caller RECORD;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can delete review routing rules.';
    END IF;
    IF p_idempotency_key IS NOT NULL THEN
        v_payload := jsonb_build_object('p_workspace_id', p_workspace_id, 'p_rule_id', p_rule_id);
        v_hash := encode(extensions.digest(v_payload::text,'sha256'),'hex');
        v_cached := private.fn_acquire_idempotency_lock(p_workspace_id,v_caller.roster_person_id,'delete_review_routing_rule',p_idempotency_key,v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;


    DELETE FROM public.review_routing_rules
    WHERE workspace_id = p_workspace_id AND id = p_rule_id;

    v_result := jsonb_build_object('success', TRUE, 'rule_id', p_rule_id);
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM private.fn_record_idempotency(p_workspace_id,v_caller.roster_person_id,'delete_review_routing_rule',p_idempotency_key,v_hash,v_result);
    END IF;
    INSERT INTO public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) VALUES(p_workspace_id,v_caller.roster_person_id,'delete_review_routing_rule','workspace_operation',p_workspace_id,jsonb_build_object('result',v_result));
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- -----------------------------------------------------------------------------
-- CAMPAIGN MANAGEMENT RPCS (Update & Archive)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_campaign(
    p_campaign_id UUID,
    p_title TEXT DEFAULT NULL,
    p_objective TEXT DEFAULT NULL,
    p_brief TEXT DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_due_date DATE DEFAULT NULL,
    p_status public.campaign_status DEFAULT NULL,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_caller RECORD;
    v_campaign RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.campaigns WHERE id = p_campaign_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Campaign not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;
    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can update campaigns.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_campaign_id', p_campaign_id, 'p_title', p_title, 'p_objective', p_objective, 'p_brief', p_brief, 'p_start_date', p_start_date, 'p_due_date', p_due_date, 'p_status', p_status, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'update_campaign', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    SELECT * INTO v_campaign
    FROM public.campaigns
    WHERE workspace_id = v_effective_workspace_id AND id = p_campaign_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Campaign not found in this workspace.';
    END IF;

    UPDATE public.campaigns
    SET
        title = COALESCE(NULLIF(btrim(p_title), ''), title),
        objective = COALESCE(p_objective, objective),
        brief = COALESCE(p_brief, brief),
        start_date = COALESCE(p_start_date, start_date),
        due_date = COALESCE(p_due_date, due_date),
        status = COALESCE(p_status, status),
        updated_at = pg_catalog.now()
    WHERE id = p_campaign_id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id, v_caller.roster_person_id, 'update_campaign', 'campaigns', p_campaign_id,
        jsonb_build_object('title', p_title, 'status', p_status)
    );

    v_result := jsonb_build_object('success', TRUE, 'campaign_id', p_campaign_id);
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'update_campaign', p_idempotency_key, v_hash, v_result);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION public.archive_campaign(
    p_campaign_id UUID,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_caller RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.campaigns WHERE id = p_campaign_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Campaign not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;
    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can archive campaigns.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_campaign_id', p_campaign_id, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'archive_campaign', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    UPDATE public.campaigns
    SET status = 'Archived', updated_at = pg_catalog.now()
    WHERE workspace_id = v_effective_workspace_id AND id = p_campaign_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Campaign not found in this workspace.';
    END IF;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id, v_caller.roster_person_id, 'archive_campaign', 'campaigns', p_campaign_id, '{}'::JSONB
    );

    v_result := jsonb_build_object('success', TRUE, 'campaign_id', p_campaign_id, 'status', 'Archived');
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'archive_campaign', p_idempotency_key, v_hash, v_result);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- -----------------------------------------------------------------------------
-- TASK COLLABORATORS RPCS (Add & Remove)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_task_collaborator(
    p_task_id UUID,
    p_roster_person_id UUID,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_caller RECORD;
    v_task RECORD;
    v_roster RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_collab_id UUID;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.tasks WHERE id = p_task_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Task not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;
    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can manage task collaborators.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_task_id', p_task_id, 'p_roster_person_id', p_roster_person_id, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'add_task_collaborator', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    SELECT * INTO v_task FROM public.tasks WHERE workspace_id = v_effective_workspace_id AND id = p_task_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Task not found in this workspace.'; END IF;

    SELECT * INTO v_roster FROM public.roster_people WHERE workspace_id = v_effective_workspace_id AND id = p_roster_person_id AND is_active = TRUE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Roster person not found or inactive in this workspace.'; END IF;

    INSERT INTO public.task_collaborators (workspace_id, task_id, roster_person_id)
    VALUES (v_effective_workspace_id, p_task_id, p_roster_person_id)
    ON CONFLICT (workspace_id, task_id, roster_person_id) DO NOTHING
    RETURNING id INTO v_collab_id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id, v_caller.roster_person_id, 'add_task_collaborator', 'tasks', p_task_id,
        jsonb_build_object('collaborator_roster_id', p_roster_person_id)
    );

    v_result := jsonb_build_object('success', TRUE, 'task_id', p_task_id, 'roster_person_id', p_roster_person_id);
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'add_task_collaborator', p_idempotency_key, v_hash, v_result);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION public.remove_task_collaborator(
    p_task_id UUID,
    p_roster_person_id UUID,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_caller RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.tasks WHERE id = p_task_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Task not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;
    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can manage task collaborators.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_task_id', p_task_id, 'p_roster_person_id', p_roster_person_id, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'remove_task_collaborator', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    DELETE FROM public.task_collaborators
    WHERE workspace_id = v_effective_workspace_id AND task_id = p_task_id AND roster_person_id = p_roster_person_id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id, v_caller.roster_person_id, 'remove_task_collaborator', 'tasks', p_task_id,
        jsonb_build_object('removed_collaborator_id', p_roster_person_id)
    );

    v_result := jsonb_build_object('success', TRUE, 'task_id', p_task_id, 'roster_person_id', p_roster_person_id);
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'remove_task_collaborator', p_idempotency_key, v_hash, v_result);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- -----------------------------------------------------------------------------
-- TASK CHECKLIST ITEMS RPCS (Create, Update, Delete)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_task_checklist_item(
    p_task_id UUID,
    p_title TEXT,
    p_sort_order INT DEFAULT 0,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_caller RECORD;
    v_item_id UUID;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.tasks WHERE id = p_task_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Task not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;
    IF NOT private.can_work_on_task(p_task_id) THEN
        RAISE EXCEPTION 'Access denied: You do not have access to this task.';
    END IF;

    IF p_title IS NULL OR btrim(p_title) = '' THEN
        RAISE EXCEPTION 'Checklist item title cannot be empty.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_task_id', p_task_id, 'p_title', p_title, 'p_sort_order', p_sort_order, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'create_task_checklist_item', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    INSERT INTO public.task_checklist_items (workspace_id, task_id, title, sort_order)
    VALUES (v_effective_workspace_id, p_task_id, btrim(p_title), COALESCE(p_sort_order, 0))
    RETURNING id INTO v_item_id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id, v_caller.roster_person_id, 'create_task_checklist_item', 'task_checklist_items', v_item_id,
        jsonb_build_object('task_id', p_task_id, 'title', p_title)
    );

    v_result := jsonb_build_object('success', TRUE, 'item_id', v_item_id, 'task_id', p_task_id);
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'create_task_checklist_item', p_idempotency_key, v_hash, v_result);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION public.update_task_checklist_item(
    p_item_id UUID,
    p_is_completed BOOLEAN DEFAULT NULL,
    p_title TEXT DEFAULT NULL,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_item RECORD;
    v_caller RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    SELECT * INTO v_item FROM public.task_checklist_items WHERE id = p_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Checklist item not found.'; END IF;

    IF p_workspace_id IS NOT NULL AND p_workspace_id <> v_item.workspace_id THEN RAISE EXCEPTION 'Workspace mismatch.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(v_item.workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_item.workspace_id FOR UPDATE;
    IF NOT private.can_work_on_task(v_item.task_id) THEN
        RAISE EXCEPTION 'Access denied: You do not have access to this task.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_item_id', p_item_id, 'p_is_completed', p_is_completed, 'p_title', p_title, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_item.workspace_id, v_caller.roster_person_id, 'update_task_checklist_item', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    UPDATE public.task_checklist_items
    SET
        is_completed = COALESCE(p_is_completed, is_completed),
        title = COALESCE(NULLIF(btrim(p_title), ''), title),
        updated_at = pg_catalog.now()
    WHERE id = p_item_id;

    v_result := jsonb_build_object('success', TRUE, 'item_id', p_item_id);
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_item.workspace_id, v_caller.roster_person_id, 'update_task_checklist_item', p_idempotency_key, v_hash, v_result);
    END IF;

    INSERT INTO public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata) VALUES(v_item.workspace_id,v_caller.roster_person_id,'update_task_checklist_item','task_checklist_items',p_item_id,jsonb_build_object('result',v_result));
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION public.delete_task_checklist_item(
    p_item_id UUID,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_workspace_id UUID;
    v_caller RECORD;
    v_resource RECORD;
    v_cached JSONB;
    v_hash TEXT;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'Idempotency key cannot be blank.';
    END IF;
    SELECT workspace_id INTO v_workspace_id FROM public.task_checklist_items WHERE id=p_item_id;
    IF v_workspace_id IS NULL AND p_idempotency_key IS NOT NULL THEN
        SELECT ir.workspace_id INTO v_workspace_id
        FROM public.rpc_idempotency_records ir
        JOIN public.workspace_memberships wm ON wm.workspace_id=ir.workspace_id AND wm.roster_person_id=ir.actor_id
        JOIN public.roster_people rp ON rp.id=wm.roster_person_id
        WHERE wm.user_id=auth.uid() AND wm.is_active AND rp.is_active
          AND ir.operation_name='delete_task_checklist_item' AND ir.idempotency_key=p_idempotency_key
          AND ir.response_payload->>'item_id'=p_item_id::text
          AND (p_workspace_id IS NULL OR ir.workspace_id=p_workspace_id)
        LIMIT 1;
    END IF;
    IF v_workspace_id IS NULL THEN RAISE EXCEPTION 'Resource not found or no access.'; END IF;
    IF p_workspace_id IS NOT NULL AND p_workspace_id <> v_workspace_id THEN RAISE EXCEPTION 'Workspace mismatch.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(v_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id=v_workspace_id FOR UPDATE;
    IF p_idempotency_key IS NOT NULL THEN
        v_hash := encode(extensions.digest(jsonb_build_object('p_item_id',p_item_id,'p_workspace_id',p_workspace_id)::text,'sha256'),'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_workspace_id,v_caller.roster_person_id,'delete_task_checklist_item',p_idempotency_key,v_hash);
        IF v_cached IS NOT NULL THEN
            IF private.can_access_task((v_cached->>'task_id')::uuid) IS NOT TRUE THEN RAISE EXCEPTION 'Access denied.'; END IF;
            RETURN v_cached;
        END IF;
    END IF;
    SELECT * INTO v_resource FROM public.task_checklist_items WHERE workspace_id=v_workspace_id AND id=p_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Resource not found.'; END IF;
    IF private.can_work_on_task(v_resource.task_id) IS NOT TRUE THEN RAISE EXCEPTION 'Access denied.'; END IF;
    DELETE FROM public.task_checklist_items WHERE id=p_item_id;
    INSERT INTO public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
    VALUES(v_workspace_id,v_caller.roster_person_id,'delete_task_checklist_item','task_checklist_items',p_item_id,jsonb_build_object('task_id',v_resource.task_id));
    v_result := jsonb_build_object('success',true,'item_id',p_item_id,'task_id',v_resource.task_id);
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM private.fn_record_idempotency(v_workspace_id,v_caller.roster_person_id,'delete_task_checklist_item',p_idempotency_key,v_hash,v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';


-- -----------------------------------------------------------------------------
-- ATTACHMENT METADATA RPCS (Create & Delete with Path Validation)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_task_attachment(
    p_task_id UUID,
    p_file_name TEXT,
    p_storage_path TEXT,
    p_file_size_bytes BIGINT,
    p_mime_type TEXT,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_caller RECORD;
    v_task RECORD;
    v_path_parts TEXT[];
    v_parsed_ws UUID;
    v_parsed_task UUID;
    v_attachment_id UUID;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.tasks WHERE id = p_task_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Task not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;
    IF NOT private.can_work_on_task(p_task_id) THEN
        RAISE EXCEPTION 'Access denied: You do not have access to this task.';
    END IF;

    -- Canonical storage_path validation: workspace_uuid/task_uuid/filename
    IF p_storage_path IS NULL OR p_storage_path !~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[^/]+$' THEN
        RAISE EXCEPTION 'Invalid storage path format. Must be workspace_uuid/task_uuid/file_name.';
    END IF;

    v_path_parts := string_to_array(p_storage_path, '/');
    v_parsed_ws := public.safe_cast_uuid(v_path_parts[1]);
    v_parsed_task := public.safe_cast_uuid(v_path_parts[2]);

    IF v_parsed_ws IS NULL OR v_parsed_ws <> v_effective_workspace_id THEN
        RAISE EXCEPTION 'Storage path workspace does not match task workspace.';
    END IF;

    IF v_parsed_task IS NULL OR v_parsed_task <> p_task_id THEN
        RAISE EXCEPTION 'Storage path task does not match target task.';
    END IF;

    IF p_file_size_bytes IS NULL OR p_file_size_bytes <= 0 OR p_file_size_bytes > 104857600 THEN
        RAISE EXCEPTION 'File size must be between 1 byte and 100MB.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_task_id', p_task_id, 'p_file_name', p_file_name, 'p_storage_path', p_storage_path, 'p_file_size_bytes', p_file_size_bytes, 'p_mime_type', p_mime_type, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'create_task_attachment', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    INSERT INTO public.attachments (
        workspace_id,
        task_id,
        uploader_roster_id,
        file_name,
        storage_path,
        file_size_bytes,
        mime_type
    ) VALUES (
        v_effective_workspace_id,
        p_task_id,
        v_caller.roster_person_id,
        btrim(p_file_name),
        p_storage_path,
        p_file_size_bytes,
        COALESCE(p_mime_type, 'application/octet-stream')
    ) RETURNING id INTO v_attachment_id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id, v_caller.roster_person_id, 'create_task_attachment', 'attachments', v_attachment_id,
        jsonb_build_object('task_id', p_task_id, 'file_name', p_file_name, 'storage_path', p_storage_path)
    );

    v_result := jsonb_build_object('success', TRUE, 'attachment_id', v_attachment_id, 'task_id', p_task_id);
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'create_task_attachment', p_idempotency_key, v_hash, v_result);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION public.delete_task_attachment(
    p_attachment_id UUID,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_workspace_id UUID;
    v_caller RECORD;
    v_resource RECORD;
    v_cached JSONB;
    v_hash TEXT;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'Idempotency key cannot be blank.';
    END IF;
    SELECT workspace_id INTO v_workspace_id FROM public.attachments WHERE id=p_attachment_id;
    IF v_workspace_id IS NULL AND p_idempotency_key IS NOT NULL THEN
        SELECT ir.workspace_id INTO v_workspace_id
        FROM public.rpc_idempotency_records ir
        JOIN public.workspace_memberships wm ON wm.workspace_id=ir.workspace_id AND wm.roster_person_id=ir.actor_id
        JOIN public.roster_people rp ON rp.id=wm.roster_person_id
        WHERE wm.user_id=auth.uid() AND wm.is_active AND rp.is_active
          AND ir.operation_name='delete_task_attachment' AND ir.idempotency_key=p_idempotency_key
          AND ir.response_payload->>'attachment_id'=p_attachment_id::text
          AND (p_workspace_id IS NULL OR ir.workspace_id=p_workspace_id)
        LIMIT 1;
    END IF;
    IF v_workspace_id IS NULL THEN RAISE EXCEPTION 'Resource not found or no access.'; END IF;
    IF p_workspace_id IS NOT NULL AND p_workspace_id <> v_workspace_id THEN RAISE EXCEPTION 'Workspace mismatch.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(v_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id=v_workspace_id FOR UPDATE;
    IF p_idempotency_key IS NOT NULL THEN
        v_hash := encode(extensions.digest(jsonb_build_object('p_attachment_id',p_attachment_id,'p_workspace_id',p_workspace_id)::text,'sha256'),'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_workspace_id,v_caller.roster_person_id,'delete_task_attachment',p_idempotency_key,v_hash);
        IF v_cached IS NOT NULL THEN
            IF private.can_access_task((v_cached->>'task_id')::uuid) IS NOT TRUE THEN RAISE EXCEPTION 'Access denied.'; END IF;
            RETURN v_cached;
        END IF;
    END IF;
    SELECT * INTO v_resource FROM public.attachments WHERE workspace_id=v_workspace_id AND id=p_attachment_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Resource not found.'; END IF;
    IF private.can_work_on_task(v_resource.task_id) IS NOT TRUE THEN RAISE EXCEPTION 'Access denied.'; END IF;
    IF v_caller.role NOT IN ('owner','manager') AND v_resource.uploader_roster_id <> v_caller.roster_person_id THEN
        RAISE EXCEPTION 'Only uploader or management may delete an attachment.';
    END IF;
    IF EXISTS(SELECT 1 FROM public.tasks WHERE final_deliverable_attachment_id=p_attachment_id) THEN
        RAISE EXCEPTION 'Cannot delete the selected final deliverable. Replace it through the delivery workflow first.';
    END IF;
    DELETE FROM public.attachments WHERE id=p_attachment_id;
    INSERT INTO public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,metadata)
    VALUES(v_workspace_id,v_caller.roster_person_id,'delete_task_attachment','attachments',p_attachment_id,jsonb_build_object('task_id',v_resource.task_id));
    v_result := jsonb_build_object('success',true,'attachment_id',p_attachment_id,'task_id',v_resource.task_id);
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM private.fn_record_idempotency(v_workspace_id,v_caller.roster_person_id,'delete_task_attachment',p_idempotency_key,v_hash,v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';


-- -----------------------------------------------------------------------------
-- TASK PRIORITY RPCS (Audited)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_task_priority(
    p_task_id UUID,
    p_priority public.task_priority,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_caller RECORD;
    v_old_priority public.task_priority;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.tasks WHERE id = p_task_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Task not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;
    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can change task priority.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_task_id', p_task_id, 'p_priority', p_priority, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'update_task_priority', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    SELECT priority INTO v_old_priority FROM public.tasks WHERE workspace_id = v_effective_workspace_id AND id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Task not found in this workspace.'; END IF;

    UPDATE public.tasks
    SET priority = p_priority, updated_at = pg_catalog.now()
    WHERE id = p_task_id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id, v_caller.roster_person_id, 'update_task_priority', 'tasks', p_task_id,
        jsonb_build_object('previous_priority', v_old_priority, 'new_priority', p_priority)
    );

    v_result := jsonb_build_object('success', TRUE, 'task_id', p_task_id, 'priority', p_priority);
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'update_task_priority', p_idempotency_key, v_hash, v_result);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';



REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_workspace_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.caller_roster_id(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.caller_role(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_workspace_manager(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_task(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_work_on_task(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_cast_uuid(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_workspace_invitation(UUID, TEXT, public.roster_role, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invitation(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_workspace_invitation(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_workspace_ownership(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_owner(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_task_rpc(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, public.task_priority, UUID, UUID, TIMESTAMPTZ, NUMERIC, TEXT, TEXT[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_task(UUID, UUID, UUID, TEXT, TEXT, TEXT, public.task_priority, UUID, UUID, TIMESTAMPTZ, INT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_task_details(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, public.task_priority, TEXT, TEXT[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_task_status(UUID, public.task_status, public.task_status, TEXT, TEXT, TEXT, UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_task(UUID, UUID, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.change_task_assignee(UUID, UUID, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.change_task_reviewer(UUID, UUID, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_task_due_date(UUID, TIMESTAMPTZ, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.change_task_due_date(UUID, TIMESTAMPTZ, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_review_round(UUID, TEXT, TEXT, public.review_round_type, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_review_round(public.review_decision, UUID, UUID, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_or_switch_timer(UUID, public.time_category, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_timer_on_behalf(UUID, TEXT, UUID, UUID, public.time_category, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stop_timer(UUID, TEXT, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_time_entry(UUID, TIMESTAMPTZ, TIMESTAMPTZ, public.time_category, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_manual_time_entry(UUID, TIMESTAMPTZ, TIMESTAMPTZ, public.time_category, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_time_entry(UUID, TEXT, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_time_correction(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, public.time_category, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_time_correction(UUID, public.correction_status, TEXT, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_client(UUID, TEXT, UUID, public.client_difficulty, public.client_extra_workload, public.client_state, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_client(UUID, UUID, TEXT, UUID, public.client_difficulty, public.client_extra_workload, public.client_state, TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_client(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_campaign(UUID, UUID, TEXT, TEXT, TEXT, DATE, DATE, public.campaign_status, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_campaign_posts(UUID, UUID, UUID, INT, TEXT, public.task_priority, UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_member_capacity(UUID, UUID, NUMERIC, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manage_leave_day(UUID, UUID, DATE, NUMERIC, public.leave_type, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_workspace_settings(UUID, TEXT, INT[], TIME, TIME, INT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_roster_person(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_roster_person(UUID, UUID, TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_review_routing_rule(UUID, INT, UUID, public.client_difficulty, UUID, UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_review_routing_rule(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_campaign(UUID, TEXT, TEXT, TEXT, DATE, DATE, public.campaign_status, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_campaign(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_task_collaborator(UUID, UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_task_collaborator(UUID, UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_task_checklist_item(UUID, TEXT, INT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_task_checklist_item(UUID, BOOLEAN, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_task_checklist_item(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_task_attachment(UUID, TEXT, TEXT, BIGINT, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_task_attachment(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_task_priority(UUID, public.task_priority, UUID, TEXT) TO authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public, private TO service_role;
COMMIT;
