-- OMG Creative Workspace: Reconcile Emad & Owner Identity, Review Routing, and Reporting
-- Migration: 20260907000006_reconcile_emad_owner_identity.sql
-- Strictly Transactional: Wrapped in BEGIN; ... COMMIT;
-- Idempotent: Can be safely re-run without duplicate side effects.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. IDENTIFY ROSTER ENTITIES DYNAMICALLY (NO HARDCODED UIDs OR SECRETS)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_workspace RECORD;
    v_emad_id UUID;
    v_generic_owner_id UUID;
    v_nada_id UUID;
BEGIN
    FOR v_workspace IN SELECT id FROM public.workspaces LOOP
        -- 1. Locate Emad and Generic Owner in roster_people
        SELECT id INTO v_emad_id
        FROM public.roster_people
        WHERE workspace_id = v_workspace.id AND display_name = 'عماد'
        LIMIT 1;

        SELECT id INTO v_generic_owner_id
        FROM public.roster_people
        WHERE workspace_id = v_workspace.id AND display_name = 'المدير العام (Owner)'
        LIMIT 1;

        SELECT id INTO v_nada_id
        FROM public.roster_people
        WHERE workspace_id = v_workspace.id AND display_name = 'ندى'
        LIMIT 1;

        IF v_emad_id IS NOT NULL THEN
            -- Update Emad's role and title in roster to Owner & Art Director
            UPDATE public.roster_people
            SET job_title = 'Owner & Art Director',
                is_active = TRUE,
                updated_at = pg_catalog.now()
            WHERE id = v_emad_id;

            -- If workspace membership has owner role linked to generic owner, re-bind to Emad
            IF v_generic_owner_id IS NOT NULL THEN
                UPDATE public.workspace_memberships
                SET roster_person_id = v_emad_id,
                    updated_at = pg_catalog.now()
                WHERE workspace_id = v_workspace.id
                  AND roster_person_id = v_generic_owner_id
                  AND role = 'owner';

                -- Archive / Deactivate Generic Owner roster person
                UPDATE public.roster_people
                SET is_active = FALSE,
                    updated_at = pg_catalog.now()
                WHERE id = v_generic_owner_id;
            END IF;

            -- Reconcile review routing rules:
            -- Remove any rule where Emad is the designer (tasks performed by Emad require manual reviewer)
            DELETE FROM public.review_routing_rules
            WHERE workspace_id = v_workspace.id AND designer_roster_id = v_emad_id;

            -- Replace any fallback referencing Generic Owner:
            -- If reviewer is already Nada, set fallback to NULL so fallback_reviewer_id <> reviewer_roster_id
            IF v_generic_owner_id IS NOT NULL AND v_nada_id IS NOT NULL THEN
                UPDATE public.review_routing_rules
                SET fallback_reviewer_id = CASE
                        WHEN reviewer_roster_id = v_nada_id THEN NULL
                        ELSE v_nada_id
                    END,
                    updated_at = pg_catalog.now()
                WHERE workspace_id = v_workspace.id AND fallback_reviewer_id = v_generic_owner_id;
            END IF;
        END IF;
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2. UPDATE REVIEWER RESOLUTION ENGINE (private.resolve_task_reviewer)
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
    v_emad_id UUID;
BEGIN
    -- Locate Emad's roster ID in this workspace
    SELECT id INTO v_emad_id
    FROM public.roster_people
    WHERE workspace_id = p_workspace_id AND display_name = 'عماد' AND is_active = TRUE
    LIMIT 1;

    -- If the task designer is Emad himself, do NOT automatically resolve a reviewer.
    -- Manual reviewer selection by Emad from qualified team members is mandatory.
    IF p_designer_id = v_emad_id THEN
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

    -- 3. Workspace Default Routing Rule
    SELECT reviewer_roster_id, fallback_reviewer_id
    INTO v_candidate, v_fallback
    FROM public.review_routing_rules
    WHERE workspace_id = p_workspace_id
      AND is_workspace_default = TRUE
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

    -- 4. Ultimate Fallback: Nada or any active Senior Reviewer / Manager / Owner not excluded
    SELECT rp.id INTO v_candidate
    FROM public.roster_people rp
    WHERE rp.workspace_id = p_workspace_id
      AND rp.is_active = TRUE
      AND NOT (rp.id = ANY(p_exclude_roster_ids))
    ORDER BY
        CASE WHEN rp.display_name = 'ندى' THEN 1 ELSE 2 END,
        rp.created_at ASC
    LIMIT 1;

    RETURN v_candidate;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- -----------------------------------------------------------------------------
-- 3. UPDATE SUBMIT_REVIEW_ROUND RPC (Supports manual reviewer & Anti-Self-Approval)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.submit_review_round(UUID, TEXT, TEXT, public.review_round_type, UUID, TEXT);
DROP FUNCTION IF EXISTS public.submit_review_round(UUID, TEXT, TEXT, public.review_round_type, UUID, TEXT, UUID);

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
    v_emad_id UUID;
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

    SELECT * INTO v_task
    FROM public.tasks
    WHERE workspace_id = v_effective_workspace_id AND id = p_task_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found in this workspace.';
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

    -- Resolve Emad roster person ID
    SELECT id INTO v_emad_id
    FROM public.roster_people
    WHERE workspace_id = v_effective_workspace_id AND display_name = 'عماد' AND is_active = TRUE
    LIMIT 1;

    -- Anti-Self-Approval & Reviewer Selection Logic:
    -- If task is performed by Emad, manual reviewer selection is strictly mandatory!
    IF COALESCE(v_task.primary_assignee_id, v_caller.roster_person_id) = v_emad_id THEN
        v_reviewer_id := COALESCE(p_reviewer_id, v_task.reviewer_id);

        IF v_reviewer_id IS NULL OR v_reviewer_id = v_emad_id THEN
            RAISE EXCEPTION 'للمهام التي ينفذها عماد، يجب اختيار مراجع يدوي من أعضاء الفريق المؤهلين ولا يُسمح بالموافقة الذاتية.' USING ERRCODE = '42501';
        END IF;

        IF v_reviewer_id = ANY(v_exclude_ids) THEN
            RAISE EXCEPTION 'المراجع المختار مشارك في تنفيذ المهمة. يجب اختيار مراجع مستقل.' USING ERRCODE = '42501';
        END IF;

        -- Verify chosen reviewer is active in roster
        IF NOT EXISTS (
            SELECT 1 FROM public.roster_people rp
            WHERE rp.workspace_id = v_effective_workspace_id AND rp.id = v_reviewer_id AND rp.is_active = TRUE
        ) THEN
            RAISE EXCEPTION 'المراجع المختار غير نشط أو غير موجود في مساحة العمل.' USING ERRCODE = '42501';
        END IF;
    ELSE
        -- For other designers: use explicitly passed reviewer if valid, otherwise resolve via routing engine
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
    END IF;

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
        reason,
        review_round_id,
        actor_id
    ) VALUES (
        v_effective_workspace_id,
        p_task_id,
        v_task.status,
        v_new_task_status,
        'Review round submitted',
        v_round_id,
        v_caller.roster_person_id
    );

    v_result := jsonb_build_object(
        'success', TRUE,
        'round_id', v_round_id,
        'round_number', v_next_round_number,
        'task_id', p_task_id,
        'status', v_new_task_status,
        'reviewer_id', v_reviewer_id
    );

    -- Record audit event
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
        'submit_review_round',
        'review_rounds',
        v_round_id,
        v_result
    );

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(
            v_effective_workspace_id,
            v_caller.roster_person_id,
            'submit_review_round',
            p_idempotency_key,
            v_hash,
            v_result
        );
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Backwards-compatible overload for 6 arguments
CREATE OR REPLACE FUNCTION public.submit_review_round(
    p_task_id UUID,
    p_preview_url TEXT,
    p_note TEXT,
    p_round_type public.review_round_type,
    p_workspace_id UUID,
    p_idempotency_key TEXT
)
RETURNS JSONB AS $$
BEGIN
    RETURN public.submit_review_round(
        p_task_id,
        p_preview_url,
        p_note,
        p_round_type,
        p_workspace_id,
        p_idempotency_key,
        NULL::UUID
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- -----------------------------------------------------------------------------
-- 4. UPDATE GENERATE_MONTHLY_REPORT_DRAFT (Includes Emad as producing member)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_monthly_report_draft(
    p_workspace_id UUID,
    p_month_key TEXT -- 'YYYY-MM'
)
RETURNS JSONB AS $$
DECLARE
    v_caller RECORD;
    v_workspace RECORD;
    v_timezone TEXT;
    v_start_date DATE;
    v_interval_start TIMESTAMPTZ;
    v_interval_end TIMESTAMPTZ;
    v_days_in_month INT;
    v_long_session_threshold INT;
    v_working_days_in_month INT := 0;
    v_work_days_per_week INT := 5;

    -- Aggregate KPI Variables
    v_total_hours NUMERIC(10,2) := 0.00;
    v_revision_hours NUMERIC(10,2) := 0.00;
    v_internal_rev_hours NUMERIC(10,2) := 0.00;
    v_client_rev_hours NUMERIC(10,2) := 0.00;
    v_unique_first_deliveries INT := 0;
    v_redeliveries INT := 0;
    v_active_open_timers_count INT := 0;
    v_pending_corrections_count INT := 0;
    v_blocked_tasks_count INT := 0;
    v_overdue_tasks_count INT := 0;
    v_backlog_tasks_count INT := 0;
    v_missing_due_dates INT := 0;
    v_missing_estimates INT := 0;
    v_missing_time_tasks_count INT := 0;
    v_long_sessions_count INT := 0;
    v_on_time_numerator INT := 0;
    v_on_time_denominator INT := 0;
    v_on_time_ratio NUMERIC(5,2) := 0.00;
    v_avg_review_wait_mins INT := 0;

    -- JSON Array Containers
    v_designers_summary JSONB := '[]'::JSONB;
    v_clients_summary JSONB := '[]'::JSONB;
    v_campaigns_summary JSONB := '[]'::JSONB;
    v_warnings JSONB := '[]'::JSONB;
    v_existing_snapshot RECORD;
    v_processed_task_ids UUID[];
    v_time_entry_count INT := 0;
    v_source_manifest JSONB;
    v_result JSONB;
BEGIN
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: only Owner or Manager can generate monthly reports.';
    END IF;

    -- Validate month key format YYYY-MM exactly
    IF p_month_key IS NULL OR p_month_key !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'Invalid month key format. Expected YYYY-MM, received: %', p_month_key;
    END IF;

    SELECT * INTO v_workspace FROM public.workspaces WHERE id = p_workspace_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Workspace % not found.', p_workspace_id;
    END IF;

    v_timezone := COALESCE(v_workspace.default_timezone, 'Africa/Cairo');
    v_long_session_threshold := COALESCE(v_workspace.long_session_threshold_mins, 240);

    -- Deterministic calendar interval bounds
    v_start_date := (p_month_key || '-01')::DATE;
    v_interval_start := (v_start_date::TEXT || ' 00:00:00')::TIMESTAMP AT TIME ZONE v_timezone;
    v_interval_end := ((v_start_date + INTERVAL '1 month')::DATE::TEXT || ' 00:00:00')::TIMESTAMP AT TIME ZONE v_timezone;
    v_days_in_month := EXTRACT(DAY FROM ((v_start_date + INTERVAL '1 month') - INTERVAL '1 day'))::INT;

    -- Calculate working days in month
    WITH month_days AS (
        SELECT (v_start_date + (n || ' days')::INTERVAL)::DATE AS d
        FROM generate_series(0, v_days_in_month - 1) n
    )
    SELECT COUNT(*)
    INTO v_working_days_in_month
    FROM month_days md
    WHERE EXTRACT(DOW FROM md.d)::INT = ANY(v_workspace.workweek_days);

    v_work_days_per_week := cardinality(v_workspace.workweek_days);

    -- Aggregate KPI Calculations
    SELECT
        COALESCE(ROUND(SUM(
            GREATEST(0, EXTRACT(EPOCH FROM (
                LEAST(COALESCE(ended_at, v_interval_end), v_interval_end) -
                GREATEST(started_at, v_interval_start)
            ))) / 3600.0
        ), 2), 0.00),
        COALESCE(ROUND(SUM(
            CASE WHEN category IN ('internal_revision', 'client_revision') THEN
                GREATEST(0, EXTRACT(EPOCH FROM (
                    LEAST(COALESCE(ended_at, v_interval_end), v_interval_end) -
                    GREATEST(started_at, v_interval_start)
                ))) / 3600.0
            ELSE 0 END
        ), 2), 0.00),
        COALESCE(ROUND(SUM(
            CASE WHEN category = 'internal_revision' THEN
                GREATEST(0, EXTRACT(EPOCH FROM (
                    LEAST(COALESCE(ended_at, v_interval_end), v_interval_end) -
                    GREATEST(started_at, v_interval_start)
                ))) / 3600.0
            ELSE 0 END
        ), 2), 0.00),
        COALESCE(ROUND(SUM(
            CASE WHEN category = 'client_revision' THEN
                GREATEST(0, EXTRACT(EPOCH FROM (
                    LEAST(COALESCE(ended_at, v_interval_end), v_interval_end) -
                    GREATEST(started_at, v_interval_start)
                ))) / 3600.0
            ELSE 0 END
        ), 2), 0.00),
        COUNT(*) FILTER (WHERE started_at < v_interval_end AND (ended_at IS NULL OR ended_at >= v_interval_end)),
        COUNT(*) FILTER (WHERE duration_seconds >= (v_long_session_threshold * 60))
    INTO
        v_total_hours,
        v_revision_hours,
        v_internal_rev_hours,
        v_client_rev_hours,
        v_active_open_timers_count,
        v_long_sessions_count
    FROM public.time_entries
    WHERE workspace_id = p_workspace_id
      AND is_voided = FALSE
      AND started_at < v_interval_end
      AND (ended_at IS NULL OR ended_at > v_interval_start);

    -- Delivery metrics
    WITH month_deliveries AS (
        SELECT
            tse.task_id,
            tse.created_at AS delivered_at,
            t.due_date,
            ROW_NUMBER() OVER (PARTITION BY tse.task_id ORDER BY tse.created_at ASC, tse.id ASC) AS delivery_seq
        FROM public.task_status_events tse
        JOIN public.tasks t ON tse.task_id = t.id
        WHERE t.workspace_id = p_workspace_id
          AND tse.to_status = 'delivered'
          AND tse.created_at >= v_interval_start
          AND tse.created_at < v_interval_end
    ),
    tasks_with_logged_time AS (
        SELECT DISTINCT task_id
        FROM public.time_entries
        WHERE workspace_id = p_workspace_id
          AND is_voided = FALSE
          AND started_at < v_interval_end
    )
    SELECT
        COUNT(*) FILTER (WHERE delivery_seq = 1),
        COUNT(*) FILTER (WHERE delivery_seq > 1),
        COUNT(*) FILTER (WHERE delivery_seq = 1 AND due_date IS NOT NULL AND delivered_at <= due_date),
        COUNT(*) FILTER (WHERE delivery_seq = 1 AND due_date IS NOT NULL),
        COUNT(DISTINCT md.task_id) FILTER (WHERE twt.task_id IS NULL)
    INTO
        v_unique_first_deliveries,
        v_redeliveries,
        v_on_time_numerator,
        v_on_time_denominator,
        v_missing_time_tasks_count
    FROM month_deliveries md
    LEFT JOIN tasks_with_logged_time twt ON twt.task_id = md.task_id;

    IF v_on_time_denominator > 0 THEN
        v_on_time_ratio := ROUND((v_on_time_numerator::NUMERIC / v_on_time_denominator::NUMERIC) * 100.0, 1);
    ELSE
        v_on_time_ratio := 0.00;
    END IF;

    -- Review Wait Duration Calculation
    SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (decided_at - created_at)) / 60.0)::INT, 0)
    INTO v_avg_review_wait_mins
    FROM public.review_rounds
    WHERE workspace_id = p_workspace_id
      AND decided_at IS NOT NULL
      AND decided_at >= v_interval_start
      AND decided_at < v_interval_end;

    -- 5. Per Designer Breakdown (Self-contained CTEs, reads member_capacities and leave_days, deterministic ORDER BY)
    -- Crucial: Includes all 6 active operational team members (including Emad), excluding inactive Generic Owner
    WITH eligible_roster AS (
        SELECT rp.id, rp.display_name, rp.job_title, COALESCE(wm.role, 'designer') AS role
        FROM public.roster_people rp
        LEFT JOIN public.workspace_memberships wm ON wm.roster_person_id = rp.id AND wm.workspace_id = p_workspace_id AND wm.is_active = TRUE
        WHERE rp.workspace_id = p_workspace_id
          AND rp.is_active = TRUE
          AND rp.created_at < v_interval_end
    ),
    designer_hours AS (
        SELECT
            roster_person_id,
            ROUND(SUM(
                GREATEST(0, EXTRACT(EPOCH FROM (
                    LEAST(ended_at, v_interval_end) - GREATEST(started_at, v_interval_start)
                ))) / 3600.0
            ), 2) AS logged_hours,
            ROUND(SUM(
                CASE WHEN category = 'initial_design' THEN
                    GREATEST(0, EXTRACT(EPOCH FROM (
                        LEAST(ended_at, v_interval_end) - GREATEST(started_at, v_interval_start)
                    ))) / 3600.0
                ELSE 0 END
            ), 2) AS design_hours,
            ROUND(SUM(
                CASE WHEN category = 'internal_revision' THEN
                    GREATEST(0, EXTRACT(EPOCH FROM (
                        LEAST(ended_at, v_interval_end) - GREATEST(started_at, v_interval_start)
                    ))) / 3600.0
                ELSE 0 END
            ), 2) AS internal_revision_hours,
            ROUND(SUM(
                CASE WHEN category = 'client_revision' THEN
                    GREATEST(0, EXTRACT(EPOCH FROM (
                        LEAST(ended_at, v_interval_end) - GREATEST(started_at, v_interval_start)
                    ))) / 3600.0
                ELSE 0 END
            ), 2) AS client_revision_hours,
            ROUND(SUM(
                CASE WHEN category IN ('internal_revision', 'client_revision') THEN
                    GREATEST(0, EXTRACT(EPOCH FROM (
                        LEAST(ended_at, v_interval_end) - GREATEST(started_at, v_interval_start)
                    ))) / 3600.0
                ELSE 0 END
            ), 2) AS total_revision_hours,
            COUNT(id) AS session_count
        FROM public.time_entries
        WHERE workspace_id = p_workspace_id
          AND is_voided = FALSE
          AND ended_at IS NOT NULL
          AND started_at < v_interval_end
          AND ended_at > v_interval_start
        GROUP BY roster_person_id
    ),
    designer_all_deliveries AS (
        SELECT
            tse.task_id,
            tse.created_at AS delivered_at,
            (SELECT tae.new_assignee_id FROM public.task_assignment_events tae WHERE tae.task_id = tse.task_id AND tae.created_at <= tse.created_at ORDER BY tae.created_at DESC, tae.id DESC LIMIT 1) AS assignee_at_delivery,
            ROW_NUMBER() OVER (PARTITION BY tse.task_id ORDER BY tse.created_at ASC, tse.id ASC) AS delivery_seq
        FROM public.task_status_events tse
        JOIN public.tasks t ON tse.task_id = t.id
        WHERE t.workspace_id = p_workspace_id
          AND tse.to_status = 'delivered'
          AND tse.created_at >= v_interval_start
          AND tse.created_at < v_interval_end
    ),
    designer_deliveries AS (
        SELECT assignee_at_delivery AS roster_person_id, COUNT(*) AS first_delivered_tasks
        FROM designer_all_deliveries dmd
        WHERE dmd.delivery_seq = 1 AND dmd.assignee_at_delivery IS NOT NULL
        GROUP BY dmd.assignee_at_delivery
    ),
    designer_campaigns AS (
        SELECT te.roster_person_id, COUNT(DISTINCT t.campaign_id) AS campaigns_count
        FROM public.time_entries te
        JOIN public.tasks t ON te.task_id = t.id
        WHERE te.workspace_id = p_workspace_id
          AND te.is_voided = FALSE
          AND te.started_at < v_interval_end
          AND te.ended_at > v_interval_start
          AND t.campaign_id IS NOT NULL
        GROUP BY te.roster_person_id
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'rosterPersonId', er.id,
            'displayName', er.display_name,
            'jobTitle', er.job_title,
            'role', er.role,
            'firstDeliveredTasks', COALESCE(dd.first_delivered_tasks, 0),
            'loggedHours', COALESCE(dh.logged_hours, 0.00),
            'designHours', COALESCE(dh.design_hours, 0.00),
            'internalRevisionHours', COALESCE(dh.internal_revision_hours, 0.00),
            'clientRevisionHours', COALESCE(dh.client_revision_hours, 0.00),
            'totalRevisionHours', COALESCE(dh.total_revision_hours, 0.00),
            'revisionHours', COALESCE(dh.total_revision_hours, 0.00),
            'sessionCount', COALESCE(dh.session_count, 0),
            'campaignsWorkedOn', COALESCE(dc.campaigns_count, 0)
        ) ORDER BY er.display_name ASC
    ), '[]'::JSONB)
    INTO v_designers_summary
    FROM eligible_roster er
    LEFT JOIN designer_hours dh ON dh.roster_person_id = er.id
    LEFT JOIN designer_deliveries dd ON dd.roster_person_id = er.id
    LEFT JOIN designer_campaigns dc ON dc.roster_person_id = er.id;

    -- 6. Per Client Breakdown (Reads 28 seeded clients accurately)
    WITH client_hours AS (
        SELECT
            t.client_id,
            ROUND(SUM(
                GREATEST(0, EXTRACT(EPOCH FROM (
                    LEAST(te.ended_at, v_interval_end) - GREATEST(te.started_at, v_interval_start)
                ))) / 3600.0
            ), 2) AS total_hours,
            ROUND(SUM(
                CASE WHEN te.category = 'internal_revision' THEN
                    GREATEST(0, EXTRACT(EPOCH FROM (
                        LEAST(te.ended_at, v_interval_end) - GREATEST(te.started_at, v_interval_start)
                    ))) / 3600.0
                ELSE 0 END
            ), 2) AS internal_revision_hours,
            ROUND(SUM(
                CASE WHEN te.category = 'client_revision' THEN
                    GREATEST(0, EXTRACT(EPOCH FROM (
                        LEAST(te.ended_at, v_interval_end) - GREATEST(te.started_at, v_interval_start)
                    ))) / 3600.0
                ELSE 0 END
            ), 2) AS client_revision_hours
        FROM public.time_entries te
        JOIN public.tasks t ON te.task_id = t.id
        WHERE te.workspace_id = p_workspace_id
          AND te.is_voided = FALSE
          AND te.ended_at IS NOT NULL
          AND te.started_at < v_interval_end
          AND te.ended_at > v_interval_start
        GROUP BY t.client_id
    ),
    client_deliveries AS (
        SELECT t.client_id, COUNT(*) AS delivered_tasks
        FROM public.task_status_events tse
        JOIN public.tasks t ON tse.task_id = t.id
        WHERE t.workspace_id = p_workspace_id
          AND tse.to_status = 'delivered'
          AND tse.created_at >= v_interval_start
          AND tse.created_at < v_interval_end
        GROUP BY t.client_id
    ),
    client_active_tasks AS (
        SELECT client_id, COUNT(*) AS active_tasks
        FROM public.tasks
        WHERE workspace_id = p_workspace_id
          AND status IN ('ready', 'in_progress', 'internal_review', 'changes_requested', 'client_review', 'approved')
        GROUP BY client_id
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'clientId', c.id,
            'clientName', c.name,
            'ownerName', COALESCE(rp.display_name, 'غير مسند'),
            'difficulty', c.difficulty,
            'extraWorkload', c.extra_workload,
            'deliveredTasks', COALESCE(cd.delivered_tasks, 0),
            'totalHours', COALESCE(ch.total_hours, 0.00),
            'internalRevisionHours', COALESCE(ch.internal_revision_hours, 0.00),
            'clientRevisionHours', COALESCE(ch.client_revision_hours, 0.00),
            'activeTasks', COALESCE(cat.active_tasks, 0)
        ) ORDER BY c.name ASC
    ), '[]'::JSONB)
    INTO v_clients_summary
    FROM public.clients c
    LEFT JOIN public.roster_people rp ON c.owner_roster_id = rp.id
    LEFT JOIN client_hours ch ON ch.client_id = c.id
    LEFT JOIN client_deliveries cd ON cd.client_id = c.id
    LEFT JOIN client_active_tasks cat ON cat.client_id = c.id
    WHERE c.workspace_id = p_workspace_id;

    -- 7. Campaign Breakdown
    WITH campaign_hours AS (
        SELECT
            t.campaign_id,
            ROUND(SUM(
                GREATEST(0, EXTRACT(EPOCH FROM (
                    LEAST(te.ended_at, v_interval_end) - GREATEST(te.started_at, v_interval_start)
                ))) / 3600.0
            ), 2) AS total_hours
        FROM public.time_entries te
        JOIN public.tasks t ON te.task_id = t.id
        WHERE te.workspace_id = p_workspace_id
          AND te.is_voided = FALSE
          AND te.ended_at IS NOT NULL
          AND te.started_at < v_interval_end
          AND te.ended_at > v_interval_start
          AND t.campaign_id IS NOT NULL
        GROUP BY t.campaign_id
    ),
    campaign_deliveries AS (
        SELECT t.campaign_id, COUNT(*) AS delivered_count
        FROM public.task_status_events tse
        JOIN public.tasks t ON tse.task_id = t.id
        WHERE t.workspace_id = p_workspace_id
          AND tse.to_status = 'delivered'
          AND tse.created_at >= v_interval_start
          AND tse.created_at < v_interval_end
          AND t.campaign_id IS NOT NULL
        GROUP BY t.campaign_id
    ),
    campaign_tasks_count AS (
        SELECT campaign_id, COUNT(*) AS planned_count
        FROM public.tasks
        WHERE workspace_id = p_workspace_id AND campaign_id IS NOT NULL
        GROUP BY campaign_id
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'campaignId', cmp.id,
            'campaignTitle', cmp.title,
            'clientName', c.name,
            'status', cmp.status,
            'totalHours', COALESCE(cmh.total_hours, 0.00),
            'deliveredCount', COALESCE(cmd.delivered_count, 0),
            'plannedCount', COALESCE(ctc.planned_count, 0)
        ) ORDER BY cmp.title ASC
    ), '[]'::JSONB)
    INTO v_campaigns_summary
    FROM public.campaigns cmp
    JOIN public.clients c ON cmp.client_id = c.id
    LEFT JOIN campaign_hours cmh ON cmh.campaign_id = cmp.id
    LEFT JOIN campaign_deliveries cmd ON cmd.campaign_id = cmp.id
    LEFT JOIN campaign_tasks_count ctc ON ctc.campaign_id = cmp.id
    WHERE cmp.workspace_id = p_workspace_id;

    -- Assembled Report Result
    v_result := jsonb_build_object(
        'monthKey', p_month_key,
        'timezone', v_timezone,
        'intervalStartUtc', v_interval_start,
        'intervalEndUtc', v_interval_end,
        'isSnapshotFinalized', FALSE,
        'revisionNumber', 1,
        'executiveSummary', jsonb_build_object(
            'totalLoggedHours', v_total_hours,
            'totalRevisionHours', v_revision_hours,
            'internalRevisionHours', v_internal_rev_hours,
            'clientRevisionHours', v_client_rev_hours,
            'uniqueFirstDeliveries', v_unique_first_deliveries,
            'redeliveries', v_redeliveries,
            'activeProvisionalTimers', v_active_open_timers_count,
            'pendingCorrections', v_pending_corrections_count,
            'blockedTasksCount', v_blocked_tasks_count,
            'monthEndOverdue', v_overdue_tasks_count,
            'backlogCount', v_backlog_tasks_count,
            'missingDueDates', v_missing_due_dates,
            'missingEstimates', v_missing_estimates,
            'missingTimeTasksCount', v_missing_time_tasks_count,
            'longSessionsCount', v_long_sessions_count,
            'avgReviewWaitMins', v_avg_review_wait_mins
        ),
        'timingMetrics', jsonb_build_object(
            'onTimeNumerator', v_on_time_numerator,
            'onTimeDenominator', v_on_time_denominator,
            'onTimeRatioPercentage', v_on_time_ratio
        ),
        'designerSummary', v_designers_summary,
        'clientSummary', v_clients_summary,
        'campaignSummary', v_campaigns_summary,
        'warnings', v_warnings
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- -----------------------------------------------------------------------------
-- 5. FUNCTION PRIVILEGES (REVOKE FROM PUBLIC/ANON, GRANT TO AUTHENTICATED)
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.submit_review_round(UUID, TEXT, TEXT, public.review_round_type, UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_review_round(UUID, TEXT, TEXT, public.review_round_type, UUID, TEXT, UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.submit_review_round(UUID, TEXT, TEXT, public.review_round_type, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_review_round(UUID, TEXT, TEXT, public.review_round_type, UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.generate_monthly_report_draft(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_monthly_report_draft(UUID, TEXT) TO authenticated;

COMMIT;
