-- =============================================================================
-- Migration 49: Fix review_rounds.note column reference in submit_review_round
-- and add active owner/reviewer fallback in private.resolve_task_reviewer
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION private.resolve_task_reviewer(
    p_workspace_id UUID,
    p_task_id UUID,
    p_designer_id UUID,
    p_exclude_roster_ids UUID[] DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
    v_client_id UUID;
    v_client_diff public.client_difficulty;
    v_work_stage TEXT;
    v_deliverable_format TEXT;
    v_owner_roster_id UUID;
    v_team_reviewer UUID;
    v_candidate UUID;
    v_fallback UUID;
BEGIN
    SELECT wm.roster_person_id INTO v_owner_roster_id
    FROM public.workspace_memberships wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.role = 'owner'
      AND wm.is_active = TRUE
    LIMIT 1;

    -- Narrow Review Bypass: Strictly only for Emad (role = 'owner') on his own assigned task
    IF p_designer_id IS NOT NULL AND p_designer_id = v_owner_roster_id THEN
        RETURN NULL;
    END IF;

    SELECT t.client_id, c.difficulty, t.work_stage, t.deliverable_format
    INTO v_client_id, v_client_diff, v_work_stage, v_deliverable_format
    FROM public.tasks t
    JOIN public.clients c ON c.id = t.client_id
    WHERE t.workspace_id = p_workspace_id AND t.id = p_task_id;

    -- 0. Check client_team_assignments track-specific reviewer first
    IF v_client_id IS NOT NULL THEN
        IF v_work_stage = 'video_editing' OR lower(COALESCE(v_deliverable_format, '')) ~ '(reel|video|motion|فيديو|ريل)' THEN
            SELECT cta.video_reviewer_id INTO v_team_reviewer
            FROM public.client_team_assignments cta
            WHERE cta.workspace_id = p_workspace_id AND cta.client_id = v_client_id;
        ELSIF v_work_stage = 'copywriting' THEN
            SELECT cta.copywriting_reviewer_id INTO v_team_reviewer
            FROM public.client_team_assignments cta
            WHERE cta.workspace_id = p_workspace_id AND cta.client_id = v_client_id;
        ELSIF v_work_stage = 'strategy' THEN
            SELECT cta.strategy_reviewer_id INTO v_team_reviewer
            FROM public.client_team_assignments cta
            WHERE cta.workspace_id = p_workspace_id AND cta.client_id = v_client_id;
        ELSE
            SELECT cta.design_reviewer_id INTO v_team_reviewer
            FROM public.client_team_assignments cta
            WHERE cta.workspace_id = p_workspace_id AND cta.client_id = v_client_id;
        END IF;

        IF v_team_reviewer IS NOT NULL
           AND NOT (v_team_reviewer = ANY(p_exclude_roster_ids))
           AND private.is_eligible_reviewer(p_workspace_id, v_team_reviewer) THEN
            RETURN v_team_reviewer;
        END IF;
    END IF;

    -- 1. Designer + Client Difficulty Rule
    IF v_client_diff IS NOT NULL THEN
        SELECT reviewer_roster_id, fallback_reviewer_id
        INTO v_candidate, v_fallback
        FROM public.review_routing_rules
        WHERE workspace_id = p_workspace_id
          AND designer_roster_id = p_designer_id
          AND client_difficulty = v_client_diff
        ORDER BY priority DESC
        LIMIT 1;

        IF v_candidate IS NOT NULL AND NOT (v_candidate = ANY(p_exclude_roster_ids))
           AND private.is_eligible_reviewer(p_workspace_id, v_candidate) THEN
            RETURN v_candidate;
        END IF;

        IF v_fallback IS NOT NULL AND NOT (v_fallback = ANY(p_exclude_roster_ids))
           AND private.is_eligible_reviewer(p_workspace_id, v_fallback) THEN
            RETURN v_fallback;
        END IF;
    END IF;

    -- 2. Designer Default Rule
    SELECT reviewer_roster_id, fallback_reviewer_id
    INTO v_candidate, v_fallback
    FROM public.review_routing_rules
    WHERE workspace_id = p_workspace_id
      AND designer_roster_id = p_designer_id
      AND client_difficulty IS NULL
    ORDER BY priority DESC
    LIMIT 1;

    IF v_candidate IS NOT NULL AND NOT (v_candidate = ANY(p_exclude_roster_ids))
       AND private.is_eligible_reviewer(p_workspace_id, v_candidate) THEN
        RETURN v_candidate;
    END IF;

    IF v_fallback IS NOT NULL AND NOT (v_fallback = ANY(p_exclude_roster_ids))
       AND private.is_eligible_reviewer(p_workspace_id, v_fallback) THEN
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

    IF v_candidate IS NOT NULL AND NOT (v_candidate = ANY(p_exclude_roster_ids))
       AND private.is_eligible_reviewer(p_workspace_id, v_candidate) THEN
        RETURN v_candidate;
    END IF;

    IF v_fallback IS NOT NULL AND NOT (v_fallback = ANY(p_exclude_roster_ids))
       AND private.is_eligible_reviewer(p_workspace_id, v_fallback) THEN
        RETURN v_fallback;
    END IF;

    -- 4. Ultimate fallback: active eligible reviewer (preferring owner / company_owner) not in exclude list
    SELECT rp.id INTO v_candidate
    FROM public.roster_people rp
    LEFT JOIN public.workspace_memberships wm
      ON wm.workspace_id = rp.workspace_id AND wm.roster_person_id = rp.id AND wm.is_active = TRUE
    WHERE rp.workspace_id = p_workspace_id
      AND rp.is_active = TRUE
      AND NOT (rp.id = ANY(p_exclude_roster_ids))
      AND private.is_eligible_reviewer(p_workspace_id, rp.id)
    ORDER BY CASE
        WHEN COALESCE(wm.role, rp.role) = 'owner' THEN 0
        WHEN COALESCE(wm.role, rp.role) = 'company_owner' THEN 1
        ELSE 2
    END
    LIMIT 1;

    RETURN v_candidate;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

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

    -- Narrow Review Bypass: Strictly only for Emad (role = 'owner')
    SELECT wm.roster_person_id INTO v_owner_roster_id
    FROM public.workspace_memberships wm
    WHERE wm.workspace_id = v_effective_workspace_id
      AND wm.role = 'owner'
      AND wm.is_active = TRUE
    LIMIT 1;

    IF v_task.primary_assignee_id IS NOT NULL AND v_task.primary_assignee_id = v_owner_roster_id THEN
        RAISE EXCEPTION 'Tasks executed by the Workspace Owner bypass internal review and do not require review rounds.' USING ERRCODE = '42501';
    END IF;

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

    IF p_round_type = 'client' AND v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
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

    UPDATE public.time_entries
    SET ended_at = pg_catalog.now(),
        duration_seconds = EXTRACT(EPOCH FROM (pg_catalog.now() - started_at))::INT,
        updated_at = pg_catalog.now()
    WHERE task_id = p_task_id
      AND ended_at IS NULL
      AND is_voided = FALSE;

    SELECT ARRAY_AGG(roster_person_id) INTO v_exclude_ids
    FROM (
        SELECT v_task.primary_assignee_id AS roster_person_id WHERE v_task.primary_assignee_id IS NOT NULL
        UNION
        SELECT v_caller.roster_person_id AS roster_person_id
        UNION
        SELECT roster_person_id FROM public.task_collaborators WHERE task_id = p_task_id
    ) t;

    IF p_reviewer_id IS NOT NULL THEN
        IF NOT private.is_eligible_reviewer(v_effective_workspace_id, p_reviewer_id) THEN
            RAISE EXCEPTION 'المراجع المختار غير مؤهل للمراجعة.';
        END IF;
        IF p_reviewer_id = ANY(v_exclude_ids) THEN
            RAISE EXCEPTION 'Self-review invariant violation: Submitter or assignee cannot be the reviewer.';
        END IF;
        v_reviewer_id := p_reviewer_id;
    ELSEIF v_task.reviewer_id IS NOT NULL
           AND NOT (v_task.reviewer_id = ANY(v_exclude_ids))
           AND private.is_eligible_reviewer(v_effective_workspace_id, v_task.reviewer_id) THEN
        v_reviewer_id := v_task.reviewer_id;
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
        note
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

COMMIT;
