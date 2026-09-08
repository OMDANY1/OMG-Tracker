-- =============================================================================
-- Migration 7: Owner Client Assignment and Review Bypass
-- 1. Create public.update_client_assignment RPC (Owner-only, allows NULL, reassigns open tasks, audit logged)
-- 2. Update private.resolve_task_reviewer to bypass review for Owner's tasks
-- 3. Update public.submit_review_round to reject review submissions for Owner's tasks
-- 4. Update public.transition_task_status to allow Owner review bypass from in_progress to approved
-- 5. Clean up any reviewer_id on open tasks assigned to the Owner
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. CLIENT ASSIGNMENT RPC (Owner Only)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_client_assignment(
    p_workspace_id UUID,
    p_client_id UUID,
    p_new_owner_roster_id UUID DEFAULT NULL,
    p_reassign_open_tasks BOOLEAN DEFAULT FALSE,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller RECORD;
    v_client RECORD;
    v_target_designer RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_t RECORD;
    v_reassigned_count INT := 0;
    v_resolved_reviewer UUID;
    v_is_owner_target BOOLEAN := FALSE;
    v_result JSONB;
BEGIN
    -- Idempotency key validation
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'Idempotency key cannot be blank.';
    END IF;

    -- Workspace lock and caller authentication
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);

    -- Strict Owner-only authorization
    IF v_caller.role <> 'owner' THEN
        RAISE EXCEPTION 'Access denied: Only Workspace Owner can reassign clients.' USING ERRCODE = '42501';
    END IF;

    -- Idempotency check
    IF p_idempotency_key IS NOT NULL THEN
        v_payload := jsonb_build_object(
            'p_workspace_id', p_workspace_id,
            'p_client_id', p_client_id,
            'p_new_owner_roster_id', p_new_owner_roster_id,
            'p_reassign_open_tasks', p_reassign_open_tasks
        );
        v_hash := encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(
            p_workspace_id,
            v_caller.roster_person_id,
            'update_client_assignment',
            p_idempotency_key,
            v_hash
        );
        IF v_cached IS NOT NULL THEN
            RETURN v_cached;
        END IF;
    END IF;

    -- Validate client existence in workspace
    SELECT * INTO v_client
    FROM public.clients
    WHERE workspace_id = p_workspace_id AND id = p_client_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Client not found in this workspace.';
    END IF;

    -- If target designer provided, validate active membership in workspace
    IF p_new_owner_roster_id IS NOT NULL THEN
        SELECT rp.id, rp.display_name, wm.role
        INTO v_target_designer
        FROM public.roster_people rp
        LEFT JOIN public.workspace_memberships wm
            ON wm.roster_person_id = rp.id
           AND wm.workspace_id = p_workspace_id
           AND wm.is_active = TRUE
        WHERE rp.workspace_id = p_workspace_id
          AND rp.id = p_new_owner_roster_id
          AND rp.is_active = TRUE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Target designer not found or inactive in this workspace.';
        END IF;

        -- Check if target is workspace owner
        IF EXISTS (
            SELECT 1 FROM public.workspace_memberships wm
            WHERE wm.workspace_id = p_workspace_id
              AND wm.roster_person_id = p_new_owner_roster_id
              AND wm.role = 'owner'
              AND wm.is_active = TRUE
        ) THEN
            v_is_owner_target := TRUE;
        END IF;
    END IF;

    -- Update client assignment (supports setting to NULL)
    UPDATE public.clients
    SET owner_roster_id = p_new_owner_roster_id,
        updated_at = pg_catalog.now()
    WHERE id = p_client_id;

    -- Reassign open tasks if requested
    IF p_reassign_open_tasks AND p_new_owner_roster_id IS NOT NULL THEN
        FOR v_t IN (
            SELECT id, primary_assignee_id, reviewer_id
            FROM public.tasks
            WHERE workspace_id = p_workspace_id
              AND client_id = p_client_id
              AND status NOT IN ('delivered', 'cancelled')
            FOR UPDATE
        ) LOOP
            -- Determine reviewer for the reassigned task
            IF v_is_owner_target THEN
                -- Tasks assigned to Owner have NO reviewer
                v_resolved_reviewer := NULL;
            ELSE
                -- Non-owner designer: resolve reviewer via routing engine
                v_resolved_reviewer := private.resolve_task_reviewer(
                    p_workspace_id,
                    v_t.id,
                    p_new_owner_roster_id,
                    ARRAY[p_new_owner_roster_id]
                );
            END IF;

            UPDATE public.tasks
            SET primary_assignee_id = p_new_owner_roster_id,
                reviewer_id = v_resolved_reviewer,
                updated_at = pg_catalog.now()
            WHERE id = v_t.id;

            INSERT INTO public.task_assignment_events (
                workspace_id,
                task_id,
                previous_assignee_id,
                new_assignee_id,
                actor_id,
                reason
            ) VALUES (
                p_workspace_id,
                v_t.id,
                v_t.primary_assignee_id,
                p_new_owner_roster_id,
                v_caller.roster_person_id,
                'Reassigned due to client owner reassignment'
            );

            v_reassigned_count := v_reassigned_count + 1;
        END LOOP;
    END IF;

    -- Insert structured audit event
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
        'update_client_assignment',
        'clients',
        p_client_id,
        jsonb_build_object(
            'client_id', p_client_id,
            'previous_owner_roster_id', v_client.owner_roster_id,
            'new_owner_roster_id', p_new_owner_roster_id,
            'reassign_open_tasks', p_reassign_open_tasks,
            'reassigned_tasks_count', v_reassigned_count,
            'actor_roster_id', v_caller.roster_person_id,
            'executed_at', pg_catalog.now()
        )
    );

    v_result := jsonb_build_object(
        'success', TRUE,
        'client_id', p_client_id,
        'previous_owner_roster_id', v_client.owner_roster_id,
        'new_owner_roster_id', p_new_owner_roster_id,
        'reassigned_tasks_count', v_reassigned_count
    );

    IF p_idempotency_key IS NOT NULL THEN
        PERFORM private.fn_record_idempotency(
            p_workspace_id,
            v_caller.roster_person_id,
            'update_client_assignment',
            p_idempotency_key,
            v_hash,
            v_result
        );
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.update_client_assignment(UUID, UUID, UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_client_assignment(UUID, UUID, UUID, BOOLEAN, TEXT) TO authenticated;


-- -----------------------------------------------------------------------------
-- 2. UPDATE REVIEWER RESOLUTION ENGINE (private.resolve_task_reviewer)
-- Dynamic Owner check via active workspace membership; Owner tasks have NO reviewer
-- -----------------------------------------------------------------------------
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
    v_owner_roster_id UUID;
BEGIN
    -- Dynamically resolve active Workspace Owner roster ID
    SELECT wm.roster_person_id INTO v_owner_roster_id
    FROM public.workspace_memberships wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.role = 'owner'
      AND wm.is_active = TRUE
    LIMIT 1;

    -- Review Bypass: If the task designer is the Workspace Owner, NO reviewer is assigned
    IF p_designer_id IS NOT NULL AND p_designer_id = v_owner_roster_id THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
    SELECT * INTO v_client FROM public.clients WHERE id = v_task.client_id;

    -- 1. Specific Designer & Client Difficulty Rule
    SELECT reviewer_roster_id, fallback_reviewer_id
    INTO v_candidate, v_fallback
    FROM public.review_routing_rules
    WHERE workspace_id = p_workspace_id
      AND designer_roster_id = p_designer_id
      AND client_difficulty = v_client.difficulty
    ORDER BY priority DESC
    LIMIT 1;

    IF v_candidate IS NOT NULL AND NOT (v_candidate = ANY(p_exclude_roster_ids)) AND EXISTS (
        SELECT 1 FROM public.roster_people rp
        WHERE rp.workspace_id = p_workspace_id AND rp.id = v_candidate AND rp.is_active = TRUE
    ) THEN
        RETURN v_candidate;
    END IF;

    IF v_fallback IS NOT NULL AND NOT (v_fallback = ANY(p_exclude_roster_ids)) AND EXISTS (
        SELECT 1 FROM public.roster_people rp
        WHERE rp.workspace_id = p_workspace_id AND rp.id = v_fallback AND rp.is_active = TRUE
    ) THEN
        RETURN v_fallback;
    END IF;

    -- 2. Specific Designer Rule (Any Difficulty)
    SELECT reviewer_roster_id, fallback_reviewer_id
    INTO v_candidate, v_fallback
    FROM public.review_routing_rules
    WHERE workspace_id = p_workspace_id
      AND designer_roster_id = p_designer_id
      AND client_difficulty IS NULL
    ORDER BY priority DESC
    LIMIT 1;

    IF v_candidate IS NOT NULL AND NOT (v_candidate = ANY(p_exclude_roster_ids)) AND EXISTS (
        SELECT 1 FROM public.roster_people rp
        WHERE rp.workspace_id = p_workspace_id AND rp.id = v_candidate AND rp.is_active = TRUE
    ) THEN
        RETURN v_candidate;
    END IF;

    IF v_fallback IS NOT NULL AND NOT (v_fallback = ANY(p_exclude_roster_ids)) AND EXISTS (
        SELECT 1 FROM public.roster_people rp
        WHERE rp.workspace_id = p_workspace_id AND rp.id = v_fallback AND rp.is_active = TRUE
    ) THEN
        RETURN v_fallback;
    END IF;

    -- 3. Workspace Default Rule
    SELECT reviewer_roster_id, fallback_reviewer_id
    INTO v_candidate, v_fallback
    FROM public.review_routing_rules
    WHERE workspace_id = p_workspace_id
      AND is_workspace_default = TRUE
    ORDER BY priority DESC
    LIMIT 1;

    IF v_candidate IS NOT NULL AND NOT (v_candidate = ANY(p_exclude_roster_ids)) AND EXISTS (
        SELECT 1 FROM public.roster_people rp
        WHERE rp.workspace_id = p_workspace_id AND rp.id = v_candidate AND rp.is_active = TRUE
    ) THEN
        RETURN v_candidate;
    END IF;

    IF v_fallback IS NOT NULL AND NOT (v_fallback = ANY(p_exclude_roster_ids)) AND EXISTS (
        SELECT 1 FROM public.roster_people rp
        WHERE rp.workspace_id = p_workspace_id AND rp.id = v_fallback AND rp.is_active = TRUE
    ) THEN
        RETURN v_fallback;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';


-- -----------------------------------------------------------------------------
-- 3. UPDATE SUBMIT_REVIEW_ROUND (Reject for Owner's tasks)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_review_round(
    p_task_id UUID,
    p_preview_url TEXT,
    p_note TEXT DEFAULT NULL,
    p_round_type public.review_round_type DEFAULT 'internal',
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL,
    p_reviewer_id UUID DEFAULT NULL
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
    v_owner_roster_id UUID;
    v_next_round_number INT;
    v_round_id UUID;
    v_new_task_status public.task_status;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'Idempotency key cannot be blank.';
    END IF;

    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.tasks WHERE id = p_task_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Task not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;

    -- Task involvement check
    IF NOT private.can_work_on_task(p_task_id) THEN
        RAISE EXCEPTION 'Access denied: You are not assigned to or collaborating on this task.';
    END IF;

    IF p_preview_url IS NULL OR btrim(p_preview_url) = '' THEN
        RAISE EXCEPTION 'Preview URL cannot be empty.';
    END IF;

    -- Fetch task
    SELECT * INTO v_task
    FROM public.tasks
    WHERE workspace_id = v_effective_workspace_id AND id = p_task_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found in this workspace.';
    END IF;

    -- Dynamically resolve active Workspace Owner roster ID
    SELECT wm.roster_person_id INTO v_owner_roster_id
    FROM public.workspace_memberships wm
    WHERE wm.workspace_id = v_effective_workspace_id
      AND wm.role = 'owner'
      AND wm.is_active = TRUE
    LIMIT 1;

    -- REVIEW BYPASS ENFORCEMENT: Tasks executed by the Workspace Owner bypass internal review
    IF v_task.primary_assignee_id IS NOT NULL AND v_task.primary_assignee_id = v_owner_roster_id THEN
        RAISE EXCEPTION 'Tasks executed by the Workspace Owner bypass internal review and do not require review rounds.' USING ERRCODE = '42501';
    END IF;

    -- Concurrency-Safe Idempotency Check
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object(
            'p_task_id', p_task_id,
            'p_preview_url', p_preview_url,
            'p_note', p_note,
            'p_round_type', p_round_type,
            'p_workspace_id', p_workspace_id,
            'p_reviewer_id', p_reviewer_id
        );
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'submit_review_round', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    -- Designers cannot initiate client review
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

    -- Close open timers on this task
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

    -- Resolve reviewer
    IF p_reviewer_id IS NOT NULL AND NOT (p_reviewer_id = ANY(v_exclude_ids)) AND EXISTS (
        SELECT 1 FROM public.roster_people rp WHERE rp.workspace_id = v_effective_workspace_id AND rp.id = p_reviewer_id AND rp.is_active = TRUE
    ) THEN
        v_reviewer_id := p_reviewer_id;
    ELSE
        v_reviewer_id := private.resolve_task_reviewer(
            v_effective_workspace_id,
            p_task_id,
            COALESCE(v_task.primary_assignee_id, v_caller.roster_person_id),
            v_exclude_ids
        );
    END IF;

    IF v_reviewer_id IS NULL THEN
        RAISE EXCEPTION 'No eligible reviewer found for this task. An independent reviewer is required.';
    END IF;

    -- Invariant: submitter cannot equal reviewer
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
        reviewer_id,
        preview_url,
        notes
    ) VALUES (
        v_effective_workspace_id,
        p_task_id,
        v_next_round_number,
        p_round_type,
        v_caller.roster_person_id,
        v_reviewer_id,
        p_preview_url,
        p_note
    ) RETURNING id INTO v_round_id;

    -- Update task status and assigned reviewer
    UPDATE public.tasks
    SET status = v_new_task_status,
        reviewer_id = v_reviewer_id,
        updated_at = pg_catalog.now()
    WHERE id = p_task_id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id,
        v_caller.roster_person_id,
        'submit_review_round',
        'tasks',
        p_task_id,
        jsonb_build_object(
            'round_id', v_round_id,
            'round_number', v_next_round_number,
            'round_type', p_round_type,
            'reviewer_id', v_reviewer_id,
            'preview_url', p_preview_url
        )
    );

    v_result := jsonb_build_object(
        'success', TRUE,
        'round_id', v_round_id,
        'round_number', v_next_round_number,
        'task_status', v_new_task_status,
        'reviewer_id', v_reviewer_id
    );

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'submit_review_round', p_idempotency_key, v_hash, v_result);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.submit_review_round(UUID, TEXT, TEXT, public.review_round_type, UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_review_round(UUID, TEXT, TEXT, public.review_round_type, UUID, TEXT, UUID) TO authenticated;


-- -----------------------------------------------------------------------------
-- 4. UPDATE TRANSITION_TASK_STATUS (Allow Owner Review Bypass: in_progress -> approved)
-- -----------------------------------------------------------------------------
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
    v_is_owner_assignee BOOLEAN := FALSE;
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

    -- 1. Complete resource authorization first
    SELECT * INTO v_task
    FROM public.tasks
    WHERE workspace_id = v_effective_workspace_id AND id = p_task_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found in this workspace.';
    END IF;

    -- NULL-sensitive guard
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

    -- Check if primary assignee is the active workspace Owner
    IF v_task.primary_assignee_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.workspace_memberships wm
        WHERE wm.workspace_id = v_effective_workspace_id
          AND wm.roster_person_id = v_task.primary_assignee_id
          AND wm.role = 'owner'
          AND wm.is_active = TRUE
    ) THEN
        v_is_owner_assignee := TRUE;
    END IF;

    -- 2. Concurrency-Safe Idempotency Check AFTER resource authorization
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object(
            'p_task_id', p_task_id,
            'p_new_status', p_new_status,
            'p_to_status', p_to_status,
            'p_reason', p_reason,
            'p_final_deliverable_url', p_final_deliverable_url,
            'p_deliverable_url', p_deliverable_url,
            'p_final_deliverable_attachment_id', p_final_deliverable_attachment_id,
            'p_workspace_id', p_workspace_id
        );
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'transition_task_status', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    v_current_status := v_task.status;

    -- 3. Idempotent no-op check
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
        ELSIF v_effective_status = 'approved' THEN
            -- REVIEW BYPASS: Only tasks assigned to the Owner can transition directly to approved
            IF v_is_owner_assignee THEN
                NULL; -- Review bypass granted
            ELSE
                RAISE EXCEPTION 'Invalid transition from in_progress to approved. Tasks assigned to designers must pass review rounds.';
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
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'Reopen reason is required when reopening an approved task.';
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
                RAISE EXCEPTION 'Only Owner or Manager can reopen delivered tasks back to in_progress.';
            END IF;
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'Reopen reason is required when reopening a delivered task.';
            END IF;
        ELSE
            RAISE EXCEPTION 'Delivered tasks are immutable and can only be reopened by Owner or Manager.';
        END IF;

    ELSIF v_current_status = 'cancelled' THEN
        RAISE EXCEPTION 'Cancelled tasks cannot be transitioned to any other status.';
    ELSE
        RAISE EXCEPTION 'Unrecognized current status %.', v_current_status;
    END IF;

    -- Apply status update
    UPDATE public.tasks
    SET status = v_effective_status,
        block_reason = CASE WHEN v_effective_status = 'blocked' THEN p_reason ELSE block_reason END,
        blocked_at = CASE WHEN v_effective_status = 'blocked' THEN pg_catalog.now() ELSE blocked_at END,
        cancel_reason = CASE WHEN v_effective_status = 'cancelled' THEN p_reason ELSE cancel_reason END,
        cancelled_at = CASE WHEN v_effective_status = 'cancelled' THEN pg_catalog.now() ELSE cancelled_at END,
        reopen_reason = CASE WHEN v_current_status IN ('approved', 'delivered') AND v_effective_status = 'in_progress' THEN p_reason ELSE reopen_reason END,
        reopened_at = CASE WHEN v_current_status IN ('approved', 'delivered') AND v_effective_status = 'in_progress' THEN pg_catalog.now() ELSE reopened_at END,
        delivered_at = CASE WHEN v_effective_status = 'delivered' THEN pg_catalog.now() ELSE delivered_at END,
        final_deliverable_url = CASE WHEN v_effective_status = 'delivered' AND v_effective_deliverable_url IS NOT NULL THEN v_effective_deliverable_url ELSE final_deliverable_url END,
        final_deliverable_attachment_id = CASE WHEN v_effective_status = 'delivered' AND p_final_deliverable_attachment_id IS NOT NULL THEN p_final_deliverable_attachment_id ELSE final_deliverable_attachment_id END,
        updated_at = pg_catalog.now()
    WHERE id = p_task_id;

    -- If moving to approved (Review Bypass), close active time entries
    IF v_effective_status = 'approved' AND v_is_owner_assignee THEN
        UPDATE public.time_entries
        SET ended_at = pg_catalog.now(),
            duration_seconds = EXTRACT(EPOCH FROM (pg_catalog.now() - started_at))::INT,
            updated_at = pg_catalog.now()
        WHERE task_id = p_task_id
          AND ended_at IS NULL
          AND is_voided = FALSE;
    END IF;

    -- Audit event
    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
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
            'review_bypass', v_is_owner_assignee,
            'final_deliverable_url', v_effective_deliverable_url
        )
    );

    v_result := jsonb_build_object(
        'success', TRUE,
        'task_id', p_task_id,
        'from_status', v_current_status,
        'status', v_effective_status,
        'review_bypass', v_is_owner_assignee
    );

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'transition_task_status', p_idempotency_key, v_hash, v_result);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.transition_task_status(UUID, public.task_status, public.task_status, TEXT, TEXT, TEXT, UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_task_status(UUID, public.task_status, public.task_status, TEXT, TEXT, TEXT, UUID, UUID, TEXT) TO authenticated;


-- -----------------------------------------------------------------------------
-- 5. CLEAN UP REVIEWER_ID ON OPEN TASKS ASSIGNED TO OWNER
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_owner_roster_id UUID;
BEGIN
    SELECT wm.roster_person_id INTO v_owner_roster_id
    FROM public.workspace_memberships wm
    WHERE wm.role = 'owner' AND wm.is_active = TRUE
    LIMIT 1;

    IF v_owner_roster_id IS NOT NULL THEN
        UPDATE public.tasks
        SET reviewer_id = NULL,
            updated_at = pg_catalog.now()
        WHERE primary_assignee_id = v_owner_roster_id
          AND status NOT IN ('delivered', 'cancelled')
          AND reviewer_id IS NOT NULL;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMIT;
