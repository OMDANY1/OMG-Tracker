-- Migration 25: Designer Full-Cycle Production Hardening
-- Allows backlog -> in_progress canonical transition
-- Emits in-app notifications on review submission and review decision
-- Preserves Zero Self-Approval, Owner Review Bypass, and Immutable Rounds

BEGIN;

-- 1. UPDATE TRANSITION_TASK_STATUS
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
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN 
        RAISE EXCEPTION 'Idempotency key cannot be blank.'; 
    END IF;

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

    -- 1. Authorization
    SELECT * INTO v_task
    FROM public.tasks
    WHERE workspace_id = v_effective_workspace_id AND id = p_task_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found in this workspace.';
    END IF;

    IF v_task.primary_assignee_id IS NULL AND v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Access denied: Unassigned tasks can only be transitioned or managed by a manager or owner.';
    END IF;

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

    -- 2. Idempotency Check
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

    -- 3. Idempotent no-op
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

    -- VALIDATE TRANSITION MATRIX
    IF v_current_status = 'backlog' THEN
        IF v_effective_status IN ('ready', 'in_progress') THEN
            NULL; -- Allow starting work directly from backlog/انتظار
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
        IF v_effective_status IN ('in_progress', 'backlog') THEN
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
        ELSIF v_effective_status = 'cancelled' THEN
            IF v_caller.role NOT IN ('owner', 'manager') THEN
                RAISE EXCEPTION 'Only Owner or Manager can cancel tasks.';
            END IF;
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'Cancel reason is required when cancelling a task.';
            END IF;
        ELSE
            RAISE EXCEPTION 'Invalid transition from changes_requested to %. Designer should resume work or submit new review.', v_effective_status;
        END IF;

    ELSIF v_current_status = 'approved' THEN
        IF v_effective_status = 'delivered' THEN
            NULL;
        ELSIF v_effective_status = 'in_progress' THEN
            IF v_caller.role NOT IN ('owner', 'manager') THEN
                RAISE EXCEPTION 'Only Owner or Manager can reopen an approved task to in_progress.';
            END IF;
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'Reopen reason is required when moving approved task back to in_progress.';
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
        IF v_effective_status = 'approved' THEN
            IF v_caller.role NOT IN ('owner', 'manager') THEN
                RAISE EXCEPTION 'Only Owner or Manager can unmark delivered tasks.';
            END IF;
        ELSE
            RAISE EXCEPTION 'Delivered tasks cannot be transitioned to %.', v_effective_status;
        END IF;

    ELSE
        RAISE EXCEPTION 'Unsupported current task status: %.', v_current_status;
    END IF;

    -- Apply update
    UPDATE public.tasks
    SET status = v_effective_status,
        final_deliverable_url = CASE 
            WHEN v_effective_status = 'delivered' AND v_effective_deliverable_url IS NOT NULL 
            THEN v_effective_deliverable_url 
            ELSE final_deliverable_url 
        END,
        final_deliverable_attachment_id = CASE 
            WHEN v_effective_status = 'delivered' AND p_final_deliverable_attachment_id IS NOT NULL 
            THEN p_final_deliverable_attachment_id 
            ELSE final_deliverable_attachment_id 
        END,
        delivered_at = CASE 
            WHEN v_effective_status = 'delivered' AND delivered_at IS NULL 
            THEN pg_catalog.now() 
            ELSE delivered_at 
        END,
        blocked_at = CASE 
            WHEN v_effective_status = 'blocked' AND blocked_at IS NULL 
            THEN pg_catalog.now() 
            ELSE blocked_at 
        END,
        block_reason = CASE 
            WHEN v_effective_status = 'blocked' 
            THEN p_reason 
            ELSE block_reason 
        END,
        cancelled_at = CASE 
            WHEN v_effective_status = 'cancelled' AND cancelled_at IS NULL 
            THEN pg_catalog.now() 
            ELSE cancelled_at 
        END,
        cancel_reason = CASE 
            WHEN v_effective_status = 'cancelled' 
            THEN p_reason 
            ELSE cancel_reason 
        END,
        reopened_at = CASE 
            WHEN v_current_status = 'approved' AND v_effective_status = 'in_progress' 
            THEN pg_catalog.now() 
            ELSE reopened_at 
        END,
        reopen_reason = CASE 
            WHEN v_current_status = 'approved' AND v_effective_status = 'in_progress' 
            THEN p_reason 
            ELSE reopen_reason 
        END,
        updated_at = pg_catalog.now()
    WHERE id = p_task_id;

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
            'is_owner_assignee', v_is_owner_assignee,
            'final_deliverable_url', v_effective_deliverable_url
        )
    );

    v_result := jsonb_build_object(
        'success', TRUE,
        'task_id', p_task_id,
        'previous_status', v_current_status,
        'status', v_effective_status
    );

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'transition_task_status', p_idempotency_key, v_hash, v_result);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.transition_task_status(UUID, public.task_status, public.task_status, TEXT, TEXT, TEXT, UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_task_status(UUID, public.task_status, public.task_status, TEXT, TEXT, TEXT, UUID, UUID, TEXT) TO authenticated, service_role;

-- 2. UPDATE SUBMIT_REVIEW_ROUND (Notification Integration)
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

    IF NOT private.can_work_on_task(p_task_id) THEN
        RAISE EXCEPTION 'Access denied: You are not assigned to or collaborating on this task.';
    END IF;

    IF p_preview_url IS NULL OR btrim(p_preview_url) = '' THEN
        RAISE EXCEPTION 'Preview URL cannot be empty.';
    END IF;

    SELECT * INTO v_task
    FROM public.tasks
    WHERE workspace_id = v_effective_workspace_id AND id = p_task_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found in this workspace.';
    END IF;

    SELECT wm.roster_person_id INTO v_owner_roster_id
    FROM public.workspace_memberships wm
    WHERE wm.workspace_id = v_effective_workspace_id
      AND wm.role = 'owner'
      AND wm.is_active = TRUE
    LIMIT 1;

    -- REVIEW BYPASS: Owner primary assignee does not undergo review rounds
    IF v_task.primary_assignee_id IS NOT NULL AND v_task.primary_assignee_id = v_owner_roster_id THEN
        RAISE EXCEPTION 'Tasks executed by the Workspace Owner bypass internal review and do not require review rounds.' USING ERRCODE = '42501';
    END IF;

    -- Idempotency Check
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

    IF p_round_type = 'client' AND v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Designers cannot submit directly to client review. Client review must be initiated by Management.';
    END IF;

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

    IF v_reviewer_id = v_caller.roster_person_id THEN
        RAISE EXCEPTION 'Self-review invariant violation: Submitter cannot be the reviewer.';
    END IF;

    SELECT COALESCE(MAX(round_number), 0) + 1 INTO v_next_round_number
    FROM public.review_rounds
    WHERE task_id = p_task_id;

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

    UPDATE public.tasks
    SET status = v_new_task_status,
        reviewer_id = v_reviewer_id,
        updated_at = pg_catalog.now()
    WHERE id = p_task_id;

    -- IN-APP NOTIFICATION TO REVIEWER
    IF v_reviewer_id <> v_caller.roster_person_id THEN
        INSERT INTO public.in_app_notifications (
            workspace_id,
            recipient_roster_id,
            actor_roster_id,
            title,
            message,
            task_id,
            action_url,
            notification_type,
            metadata
        ) VALUES (
            v_effective_workspace_id,
            v_reviewer_id,
            v_caller.roster_person_id,
            'طلب مراجعة جديد',
            'أرسل ' || v_caller.display_name || ' مهمة "' || v_task.title || '" للمراجعة.',
            p_task_id,
            '/tasks?taskId=' || p_task_id,
            'review_requested',
            jsonb_build_object('round_id', v_round_id, 'round_number', v_next_round_number)
        );
    END IF;

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
GRANT EXECUTE ON FUNCTION public.submit_review_round(UUID, TEXT, TEXT, public.review_round_type, UUID, TEXT, UUID) TO authenticated, service_role;

-- 3. UPDATE DECIDE_REVIEW_ROUND (Notification Integration)
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
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN 
        RAISE EXCEPTION 'Idempotency key cannot be blank.'; 
    END IF;

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

    IF v_round.round_type = 'client' THEN
        IF v_caller.role NOT IN ('owner', 'manager') THEN
            RAISE EXCEPTION 'Only Owner or Manager can record decisions for client review rounds.';
        END IF;
    ELSE
        IF v_caller.roster_person_id <> v_round.reviewer_id AND v_caller.role NOT IN ('owner', 'manager') THEN
            RAISE EXCEPTION 'Permission denied: You are not the assigned reviewer for this round.';
        END IF;
    END IF;

    IF p_decision = 'approved' THEN
        v_new_task_status := 'approved';
    ELSE
        v_new_task_status := 'changes_requested';
    END IF;

    UPDATE public.review_rounds
    SET decision = p_decision,
        feedback = p_feedback,
        decided_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = v_round.id;

    UPDATE public.tasks
    SET status = v_new_task_status,
        updated_at = pg_catalog.now()
    WHERE id = v_task.id;

    -- IN-APP NOTIFICATION TO PRIMARY ASSIGNEE
    IF v_task.primary_assignee_id IS NOT NULL AND v_task.primary_assignee_id <> v_caller.roster_person_id THEN
        INSERT INTO public.in_app_notifications (
            workspace_id,
            recipient_roster_id,
            actor_roster_id,
            title,
            message,
            task_id,
            action_url,
            notification_type,
            metadata
        ) VALUES (
            v_effective_workspace_id,
            v_task.primary_assignee_id,
            v_caller.roster_person_id,
            CASE WHEN p_decision = 'approved' THEN 'تم اعتماد المهمة' ELSE 'مطلوب تعديلات على المهمة' END,
            CASE WHEN p_decision = 'approved' 
                 THEN 'تم اعتماد تصميم المهمة "' || v_task.title || '".' 
                 ELSE 'طلب ' || v_caller.display_name || ' تعديلات على المهمة "' || v_task.title || '": ' || COALESCE(p_feedback, '')
            END,
            v_task.id,
            '/tasks?taskId=' || v_task.id,
            CASE WHEN p_decision = 'approved' THEN 'task_approved' ELSE 'changes_requested' END,
            jsonb_build_object('round_id', v_round.id, 'decision', p_decision, 'feedback', p_feedback)
        );
    END IF;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id,
        v_caller.roster_person_id,
        'decide_review_round',
        'tasks',
        v_task.id,
        jsonb_build_object(
            'round_id', v_round.id,
            'decision', p_decision,
            'feedback', p_feedback,
            'new_status', v_new_task_status
        )
    );

    v_result := jsonb_build_object(
        'success', TRUE,
        'round_id', v_round.id,
        'decision', p_decision,
        'task_status', v_new_task_status
    );

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'decide_review_round', p_idempotency_key, v_hash, v_result);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.decide_review_round(public.review_decision, UUID, UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_review_round(public.review_decision, UUID, UUID, TEXT, UUID, TEXT) TO authenticated, service_role;

COMMIT;
