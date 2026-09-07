-- OMG Creative Workspace: Monthly Report Functions & Historical Snapshots (V3.5-R1 repaired baseline)
-- Migration: 20260906000005_monthly_report_functions.sql
-- Strictly Transactional: Everything wrapped in BEGIN; ... COMMIT;

BEGIN;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

-- -----------------------------------------------------------------------------
-- 1. GENERATE MONTHLY REPORT DRAFT (Historical Reconstruction as of Cutoff)
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

    -- Authoritative timezone and thresholds from workspace
    SELECT * INTO v_workspace FROM public.workspaces WHERE id = p_workspace_id;
    v_timezone := v_workspace.default_timezone;
    v_long_session_threshold := COALESCE(v_workspace.long_session_threshold_mins, 240);

    -- Parse month interval in workspace timezone
    v_start_date := TO_DATE(p_month_key || '-01', 'YYYY-MM-DD');
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_timezone) THEN
        RAISE EXCEPTION 'Invalid workspace timezone: %', v_timezone;
    END IF;
    v_interval_start := (v_start_date::TIMESTAMP) AT TIME ZONE v_timezone;
    v_interval_end := ((v_start_date + INTERVAL '1 month')::TIMESTAMP) AT TIME ZONE v_timezone;
    v_days_in_month := EXTRACT(DAY FROM (v_start_date + INTERVAL '1 month' - INTERVAL '1 day'))::INT;

    -- Calculate working days in this month according to workspace workweek_days
    SELECT COUNT(*) INTO v_working_days_in_month
    FROM generate_series(v_start_date, (v_start_date + INTERVAL '1 month' - INTERVAL '1 day')::DATE, '1 day'::interval) d
    WHERE EXTRACT(DOW FROM d)::INT = ANY(v_workspace.workweek_days);

    v_work_days_per_week := COALESCE(array_length(v_workspace.workweek_days, 1), 5);

    -- 1. Aggregate Logged Hours in month (split sessions logically at interval boundaries without double-counting)
    SELECT
        COALESCE(SUM(
            GREATEST(0, EXTRACT(EPOCH FROM (
                LEAST(ended_at, v_interval_end) - GREATEST(started_at, v_interval_start)
            ))) / 3600.0
        ), 0),
        COALESCE(SUM(
            CASE WHEN category IN ('internal_revision', 'client_revision') THEN
                GREATEST(0, EXTRACT(EPOCH FROM (
                    LEAST(ended_at, v_interval_end) - GREATEST(started_at, v_interval_start)
                ))) / 3600.0
            ELSE 0 END
        ), 0),
        COALESCE(SUM(
            CASE WHEN category = 'internal_revision' THEN
                GREATEST(0, EXTRACT(EPOCH FROM (
                    LEAST(ended_at, v_interval_end) - GREATEST(started_at, v_interval_start)
                ))) / 3600.0
            ELSE 0 END
        ), 0),
        COALESCE(SUM(
            CASE WHEN category = 'client_revision' THEN
                GREATEST(0, EXTRACT(EPOCH FROM (
                    LEAST(ended_at, v_interval_end) - GREATEST(started_at, v_interval_start)
                ))) / 3600.0
            ELSE 0 END
        ), 0),
        COUNT(id) FILTER (
            WHERE ended_at IS NOT NULL AND
                  EXTRACT(EPOCH FROM (ended_at - started_at)) / 60.0 > v_long_session_threshold
        ),
        COUNT(id)
    INTO
        v_total_hours,
        v_revision_hours,
        v_internal_rev_hours,
        v_client_rev_hours,
        v_long_sessions_count,
        v_time_entry_count
    FROM public.time_entries
    WHERE workspace_id = p_workspace_id
      AND is_voided = FALSE
      AND ended_at IS NOT NULL
      AND started_at < v_interval_end
      AND ended_at > v_interval_start;

    -- Round aggregate hours to 2 decimal places
    v_total_hours := ROUND(v_total_hours, 2);
    v_revision_hours := ROUND(v_revision_hours, 2);
    v_internal_rev_hours := ROUND(v_internal_rev_hours, 2);
    v_client_rev_hours := ROUND(v_client_rev_hours, 2);

    -- 2. Open Timers & Pending Corrections As Of Month Boundary
    SELECT COUNT(*) INTO v_active_open_timers_count
    FROM public.time_entries
    WHERE workspace_id = p_workspace_id
      AND is_voided = FALSE
      AND started_at < v_interval_end
      AND (ended_at IS NULL OR ended_at >= v_interval_end);

    SELECT COUNT(*) INTO v_pending_corrections_count
    FROM public.time_change_requests
    WHERE workspace_id = p_workspace_id
      AND created_at < v_interval_end
      AND (decided_at IS NULL OR decided_at >= v_interval_end);

    -- 3. Historical Reconstruction of Task Status as of Cutoff (v_interval_end)
    WITH task_status_at_cutoff AS (
        SELECT DISTINCT ON (tse.task_id)
            tse.task_id,
            tse.to_status AS status_at_cutoff
        FROM public.task_status_events tse
        JOIN public.tasks t ON tse.task_id = t.id
        WHERE t.workspace_id = p_workspace_id
          AND tse.created_at < v_interval_end
        ORDER BY tse.task_id, tse.created_at DESC, tse.id DESC
    ),
    task_due_at_cutoff AS (
        SELECT DISTINCT ON (tdde.task_id)
            tdde.task_id,
            tdde.new_due_date AS due_date_at_cutoff
        FROM public.task_due_date_events tdde
        JOIN public.tasks t ON tdde.task_id = t.id
        WHERE t.workspace_id = p_workspace_id
          AND tdde.created_at < v_interval_end
        ORDER BY tdde.task_id, tdde.created_at DESC, tdde.id DESC
    ),
    effective_tasks_as_of_cutoff AS (
        SELECT
            t.id,
            COALESCE(tsc.status_at_cutoff, t.status) AS status,
            tdc.due_date_at_cutoff AS due_date,
            t.estimated_hours
        FROM public.tasks t
        LEFT JOIN task_status_at_cutoff tsc ON t.id = tsc.task_id
        LEFT JOIN task_due_at_cutoff tdc ON t.id = tdc.task_id
        WHERE t.workspace_id = p_workspace_id
          AND t.created_at < v_interval_end
    )
    SELECT
        COUNT(*) FILTER (WHERE status = 'blocked'),
        COUNT(*) FILTER (WHERE status = 'backlog'),
        COUNT(*) FILTER (WHERE status NOT IN ('delivered', 'cancelled') AND due_date IS NOT NULL AND due_date < v_interval_end),
        COUNT(*) FILTER (WHERE status NOT IN ('delivered', 'cancelled') AND due_date IS NULL),
        COUNT(*) FILTER (WHERE status NOT IN ('delivered', 'cancelled') AND (estimated_hours IS NULL OR estimated_hours <= 0)),
        ARRAY_AGG(id)
    INTO
        v_blocked_tasks_count,
        v_backlog_tasks_count,
        v_overdue_tasks_count,
        v_missing_due_dates,
        v_missing_estimates,
        v_processed_task_ids
    FROM effective_tasks_as_of_cutoff;

    -- 4. Reconstruct Deliveries using lifetime ROW_NUMBER over delivered events
    WITH all_historical_deliveries AS (
        SELECT
            tse.task_id,
            tse.created_at AS delivered_at,
            (SELECT tdde.new_due_date FROM public.task_due_date_events tdde WHERE tdde.task_id = tse.task_id AND tdde.created_at <= tse.created_at ORDER BY tdde.created_at DESC, tdde.id DESC LIMIT 1) AS due_date,
            (SELECT tae.new_assignee_id FROM public.task_assignment_events tae WHERE tae.task_id = tse.task_id AND tae.created_at <= tse.created_at ORDER BY tae.created_at DESC, tae.id DESC LIMIT 1) AS assignee_at_delivery,
            ROW_NUMBER() OVER (PARTITION BY tse.task_id ORDER BY tse.created_at ASC, tse.id ASC) AS delivery_seq
        FROM public.task_status_events tse
        JOIN public.tasks t ON tse.task_id = t.id
        WHERE t.workspace_id = p_workspace_id
          AND tse.to_status = 'delivered'
          AND tse.created_at < v_interval_end
    ),
    month_deliveries AS (
        SELECT *
        FROM all_historical_deliveries
        WHERE delivered_at >= v_interval_start
          AND delivered_at < v_interval_end
    ),
    tasks_with_logged_time AS (
        SELECT DISTINCT task_id
        FROM public.time_entries
        WHERE workspace_id = p_workspace_id
          AND is_voided = FALSE
          AND started_at < v_interval_end
          AND ended_at > v_interval_start
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
    WITH eligible_roster AS (
        SELECT rp.id, rp.display_name, rp.job_title, COALESCE(wm.role, 'designer') AS role
        FROM public.roster_people rp
        LEFT JOIN public.workspace_memberships wm ON wm.roster_person_id = rp.id AND wm.workspace_id = p_workspace_id AND wm.is_active = TRUE
        WHERE rp.workspace_id = p_workspace_id
          AND rp.is_active = TRUE
          AND rp.created_at < v_interval_end
          AND (wm.role IS NULL OR wm.role <> 'owner')
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
          AND tse.created_at < v_interval_end
    ),
    designer_month_deliveries AS (
        SELECT * FROM designer_all_deliveries
        WHERE delivered_at >= v_interval_start AND delivered_at < v_interval_end
    ),
    designer_deliveries AS (
        SELECT
            dmd.assignee_at_delivery AS roster_person_id,
            COUNT(DISTINCT dmd.task_id) AS delivered_tasks
        FROM designer_month_deliveries dmd
        WHERE dmd.delivery_seq = 1
        GROUP BY dmd.assignee_at_delivery
    ),
    designer_campaigns AS (
        SELECT
            te.roster_person_id,
            COUNT(DISTINCT t.campaign_id) AS campaigns_count
        FROM public.time_entries te
        JOIN public.tasks t ON te.task_id = t.id
        WHERE te.workspace_id = p_workspace_id
          AND te.is_voided = FALSE
          AND te.ended_at IS NOT NULL
          AND te.started_at < v_interval_end
          AND te.ended_at > v_interval_start
          AND t.campaign_id IS NOT NULL
        GROUP BY te.roster_person_id
    ),
    designer_capacity_data AS (
        SELECT
            er.id AS roster_person_id,
            mc.weekly_hours,
            mc.reserved_management_hours,
            COALESCE(SUM(ld.hours), 0.00) AS month_leave_hours
        FROM eligible_roster er
        LEFT JOIN public.member_capacities mc ON mc.roster_person_id = er.id AND mc.workspace_id = p_workspace_id
        LEFT JOIN public.leave_days ld ON ld.roster_person_id = er.id
             AND ld.workspace_id = p_workspace_id
             AND ld.leave_date >= v_start_date
             AND ld.leave_date < (v_start_date + INTERVAL '1 month')::DATE
        GROUP BY er.id, mc.weekly_hours, mc.reserved_management_hours
    )
    SELECT jsonb_agg(
        jsonb_build_object(
            'rosterPersonId', er.id,
            'displayName', er.display_name,
            'jobTitle', er.job_title,
            'role', er.role,
            'firstDeliveredTasks', COALESCE(dd.delivered_tasks, 0),
            'loggedHours', COALESCE(dh.logged_hours, 0.00),
            'designHours', COALESCE(dh.design_hours, 0.00),
            'internalRevisionHours', COALESCE(dh.internal_revision_hours, 0.00),
            'clientRevisionHours', COALESCE(dh.client_revision_hours, 0.00),
            'totalRevisionHours', COALESCE(dh.total_revision_hours, 0.00),
            'revisionHours', COALESCE(dh.total_revision_hours, 0.00),
            'sessionCount', COALESCE(dh.session_count, 0),
            'campaignsWorkedOn', COALESCE(dc.campaigns_count, 0),
            'configuredWeeklyHours', dcap.weekly_hours,
            'reservedManagementHours', dcap.reserved_management_hours,
            'monthLeaveHours', dcap.month_leave_hours,
            'monthlyCapacityHours', CASE
                WHEN dcap.weekly_hours IS NOT NULL THEN
                    GREATEST(0, ROUND((((dcap.weekly_hours - COALESCE(dcap.reserved_management_hours, 0.00)) / NULLIF(v_work_days_per_week, 0)::NUMERIC) * v_working_days_in_month::NUMERIC) - dcap.month_leave_hours, 2))
                ELSE NULL
            END,
            'capacityUtilizationRate', CASE
                WHEN dcap.weekly_hours IS NOT NULL AND ((((dcap.weekly_hours - COALESCE(dcap.reserved_management_hours, 0.00)) / NULLIF(v_work_days_per_week, 0)::NUMERIC) * v_working_days_in_month::NUMERIC) - dcap.month_leave_hours) > 0 THEN
                    ROUND((COALESCE(dh.logged_hours, 0.00) / ((((dcap.weekly_hours - COALESCE(dcap.reserved_management_hours, 0.00)) / NULLIF(v_work_days_per_week, 0)::NUMERIC) * v_working_days_in_month::NUMERIC) - dcap.month_leave_hours)) * 100.0, 1)
                ELSE NULL
            END
        )
        ORDER BY er.display_name ASC, er.id ASC
    ) INTO v_designers_summary
    FROM eligible_roster er
    LEFT JOIN designer_hours dh ON dh.roster_person_id = er.id
    LEFT JOIN designer_deliveries dd ON dd.roster_person_id = er.id
    LEFT JOIN designer_campaigns dc ON dc.roster_person_id = er.id
    LEFT JOIN designer_capacity_data dcap ON dcap.roster_person_id = er.id;

    -- 6. Per Client Breakdown (Self-contained CTE, deterministic ORDER BY)
    WITH eligible_clients AS (
        SELECT * FROM public.clients
        WHERE workspace_id = p_workspace_id
          AND created_at < v_interval_end
    ),
    client_hours AS (
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
            ), 2) AS internal_rev_hours,
            ROUND(SUM(
                CASE WHEN te.category = 'client_revision' THEN
                    GREATEST(0, EXTRACT(EPOCH FROM (
                        LEAST(te.ended_at, v_interval_end) - GREATEST(te.started_at, v_interval_start)
                    ))) / 3600.0
                ELSE 0 END
            ), 2) AS client_rev_hours
        FROM public.time_entries te
        JOIN public.tasks t ON te.task_id = t.id
        WHERE te.workspace_id = p_workspace_id
          AND te.is_voided = FALSE
          AND te.ended_at IS NOT NULL
          AND te.started_at < v_interval_end
          AND te.ended_at > v_interval_start
        GROUP BY t.client_id
    ),
    client_month_deliveries AS (
        SELECT
            t.client_id,
            COUNT(DISTINCT tse.task_id) AS delivered_tasks
        FROM public.task_status_events tse
        JOIN public.tasks t ON tse.task_id = t.id
        WHERE t.workspace_id = p_workspace_id
          AND tse.to_status = 'delivered'
          AND tse.created_at >= v_interval_start
          AND tse.created_at < v_interval_end
        GROUP BY t.client_id
    )
    SELECT jsonb_agg(
        jsonb_build_object(
            'clientId', c.id,
            'clientName', c.name,
            'difficulty', c.difficulty,
            'extraWorkload', c.extra_workload,
            'state', c.state,
            'monthDeliveredTasks', COALESCE(cmd.delivered_tasks, 0),
            'monthTotalHours', COALESCE(ch.total_hours, 0.00),
            'monthInternalRevHours', COALESCE(ch.internal_rev_hours, 0.00),
            'monthClientRevHours', COALESCE(ch.client_rev_hours, 0.00)
        )
        ORDER BY c.name ASC, c.id ASC
    ) INTO v_clients_summary
    FROM eligible_clients c
    LEFT JOIN client_month_deliveries cmd ON cmd.client_id = c.id
    LEFT JOIN client_hours ch ON ch.client_id = c.id;

    -- 7. Per Campaign Breakdown (Uses c.title, NOT c.name; deterministic ORDER BY)
    WITH eligible_campaigns AS (
        SELECT * FROM public.campaigns
        WHERE workspace_id = p_workspace_id
          AND created_at < v_interval_end
    ),
    campaign_month_deliveries AS (
        SELECT
            t.campaign_id,
            COUNT(DISTINCT tse.task_id) AS delivered_tasks
        FROM public.task_status_events tse
        JOIN public.tasks t ON tse.task_id = t.id
        WHERE t.workspace_id = p_workspace_id
          AND tse.to_status = 'delivered'
          AND tse.created_at >= v_interval_start
          AND tse.created_at < v_interval_end
        GROUP BY t.campaign_id
    ),
    campaign_hours AS (
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
        GROUP BY t.campaign_id
    )
    SELECT jsonb_agg(
        jsonb_build_object(
            'campaignId', c.id,
            'campaignName', c.title,
            'clientName', cl.name,
            'status', c.status,
            'monthDeliveredTasks', COALESCE(cmd.delivered_tasks, 0),
            'monthTotalHours', COALESCE(ch.total_hours, 0.00)
        )
        ORDER BY c.title ASC, c.id ASC
    ) INTO v_campaigns_summary
    FROM eligible_campaigns c
    JOIN public.clients cl ON c.client_id = cl.id
    LEFT JOIN campaign_month_deliveries cmd ON cmd.campaign_id = c.id
    LEFT JOIN campaign_hours ch ON ch.campaign_id = c.id;

    -- 8. Completeness & Integrity Warnings (Evaluated As Of Cutoff)
    IF v_active_open_timers_count > 0 THEN
        v_warnings := v_warnings || jsonb_build_object('type', 'active_timers', 'message', 'يوجد ' || v_active_open_timers_count || ' عداد مفتوح قيد التشغيل في نهاية هذا الشهر.');
    END IF;

    IF v_pending_corrections_count > 0 THEN
        v_warnings := v_warnings || jsonb_build_object('type', 'pending_corrections', 'message', 'يوجد ' || v_pending_corrections_count || ' طلب تصحيح وقت معلق بانتظار الاعتماد.');
    END IF;

    IF v_blocked_tasks_count > 0 THEN
        v_warnings := v_warnings || jsonb_build_object('type', 'blocked_tasks', 'message', 'يوجد ' || v_blocked_tasks_count || ' مهمة معطلة في نهاية هذا الشهر.');
    END IF;

    IF v_overdue_tasks_count > 0 THEN
        v_warnings := v_warnings || jsonb_build_object('type', 'overdue_tasks', 'message', 'يوجد ' || v_overdue_tasks_count || ' مهمة متأخرة عن موعد استحقاقها.');
    END IF;

    IF v_missing_due_dates > 0 THEN
        v_warnings := v_warnings || jsonb_build_object('type', 'missing_due_dates', 'message', 'يوجد ' || v_missing_due_dates || ' مهمة غير منجزة بدون تاريخ استحقاق محدد.');
    END IF;

    IF v_missing_estimates > 0 THEN
        v_warnings := v_warnings || jsonb_build_object('type', 'missing_estimates', 'message', 'يوجد ' || v_missing_estimates || ' مهمة بدون تقدير ساعات عمل.');
    END IF;

    IF v_missing_time_tasks_count > 0 THEN
        v_warnings := v_warnings || jsonb_build_object('type', 'delivered_without_time', 'message', 'يوجد ' || v_missing_time_tasks_count || ' مهمة تم تسليمها في هذا الشهر بدون تسجيل أي وقت عمل.');
    END IF;

    IF v_long_sessions_count > 0 THEN
        v_warnings := v_warnings || jsonb_build_object('type', 'long_sessions', 'message', 'تم تسجيل ' || v_long_sessions_count || ' جلسة عمل تتجاوز حد الجلسات الطويلة (' || v_long_session_threshold || ' دقيقة).');
    END IF;

    -- Check for latest finalized snapshot for metadata revision tracking
    SELECT * INTO v_existing_snapshot
    FROM public.monthly_report_snapshots
    WHERE workspace_id = p_workspace_id
      AND month_key = p_month_key
    ORDER BY revision_number DESC
    LIMIT 1;

    -- Construct Source Manifest
    v_source_manifest := jsonb_build_object(
        'cutoffTimestamp', v_interval_end,
        'processedTaskCount', COALESCE(array_length(v_processed_task_ids, 1), 0),
        'processedTimeEntryCount', v_time_entry_count,
        'generatedAt', pg_catalog.now()
    );

    -- Assemble Final Canonical Payload
    v_result := jsonb_build_object(
        'workspaceId', p_workspace_id,
        'monthKey', p_month_key,
        'timezone', v_timezone,
        'intervalStart', v_interval_start,
        'intervalEnd', v_interval_end,
        'isFinalized', COALESCE(v_existing_snapshot.is_finalized, FALSE),
        'revisionNumber', COALESCE(v_existing_snapshot.revision_number, 0),
        'finalizedAt', v_existing_snapshot.finalized_at,
        'finalizedById', v_existing_snapshot.finalized_by_id,
        'sourceManifest', v_source_manifest,
        'executiveSummary', jsonb_build_object(
            'totalHours', v_total_hours,
            'revisionHours', v_revision_hours,
            'internalRevHours', v_internal_rev_hours,
            'clientRevHours', v_client_rev_hours,
            'uniqueFirstDeliveries', v_unique_first_deliveries,
            'redeliveries', v_redeliveries,
            'onTimeDeliveryRate', v_on_time_ratio,
            'avgReviewWaitMinutes', v_avg_review_wait_mins,
            'activeOpenTimersCount', v_active_open_timers_count,
            'pendingCorrectionsCount', v_pending_corrections_count,
            'blockedTasksCount', v_blocked_tasks_count,
            'overdueTasksCount', v_overdue_tasks_count,
            'backlogTasksCount', v_backlog_tasks_count,
            'missingDueDatesCount', v_missing_due_dates,
            'missingEstimatesCount', v_missing_estimates,
            'longSessionsCount', v_long_sessions_count
        ),
        'timingMetrics', jsonb_build_object(
            'daysInMonth', v_days_in_month,
            'workingDaysInMonth', v_working_days_in_month,
            'longSessionThresholdMins', v_long_session_threshold,
            'firstDeliveriesTotal', v_unique_first_deliveries,
            'redeliveriesTotal', v_redeliveries,
            'onTimeDeliveries', v_on_time_numerator,
            'onTimeEligibleDeliveries', v_on_time_denominator,
            'onTimeRatioPercentage', v_on_time_ratio
        ),
        'designerSummary', COALESCE(v_designers_summary, '[]'::JSONB),
        'clientSummary', COALESCE(v_clients_summary, '[]'::JSONB),
        'campaignSummary', COALESCE(v_campaigns_summary, '[]'::JSONB),
        'warnings', v_warnings,
        'managementCommentary', '{}'::JSONB
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- -----------------------------------------------------------------------------
-- 2. FINALIZE MONTHLY REPORT SNAPSHOT (Canonical Hash, Idempotent, Single Timestamp)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.finalize_monthly_report_snapshot(
    p_workspace_id UUID,
    p_month_key TEXT,
    p_management_commentary JSONB DEFAULT '{}'::JSONB,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller RECORD;
    v_draft JSONB;
    v_next_revision INT;
    v_content_hash TEXT;
    v_snapshot_id UUID;
    v_timezone TEXT;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_finalized_at TIMESTAMPTZ := pg_catalog.now();
    v_result JSONB;
BEGIN
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: only Owner or Manager can finalize monthly report snapshots.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;

    -- Validate month key format
    IF p_month_key IS NULL OR p_month_key !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'Invalid month key format. Expected YYYY-MM, received: %', p_month_key;
    END IF;

    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;

    -- Acquire exclusive transaction-level advisory lock for workspace and month
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('snapshot:' || p_workspace_id::TEXT || ':' || p_month_key, 0)
    );

    -- Concurrency-Safe Idempotency Check
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object(
            'workspace_id', p_workspace_id,
            'month_key', p_month_key,
            'commentary', COALESCE(p_management_commentary, '{}'::JSONB)
        );
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(p_workspace_id, v_caller.roster_person_id, 'finalize_monthly_report_snapshot', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    -- Lock workspace row for serialization
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;

    -- Compute next revision number sequentially after acquiring lock
    SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_next_revision
    FROM public.monthly_report_snapshots
    WHERE workspace_id = p_workspace_id
      AND month_key = p_month_key;

    -- Generate fresh draft metrics
    v_draft := public.generate_monthly_report_draft(p_workspace_id, p_month_key);
    v_timezone := v_draft->>'timezone';

    v_draft := v_draft || jsonb_build_object(
        'isFinalized', true, 'revisionNumber', v_next_revision,
        'finalizedAt', v_finalized_at, 'finalizedById', v_caller.roster_person_id,
        'managementCommentary', COALESCE(p_management_commentary, '{}'::jsonb));

    -- Hash the full payload including the timestamp and commentary.

    v_content_hash := encode(extensions.digest(v_draft::text,'sha256'),'hex');

    -- Insert immutable snapshot row using single server timestamp
    INSERT INTO public.monthly_report_snapshots (
        workspace_id,
        month_key,
        revision_number,
        is_finalized,
        finalized_at,
        finalized_by_id,
        timezone,
        snapshot_data,
        management_commentary,
        snapshot_hash
    ) VALUES (
        p_workspace_id,
        p_month_key,
        v_next_revision,
        TRUE,
        v_finalized_at,
        v_caller.roster_person_id,
        v_timezone,
        v_draft,
        COALESCE(p_management_commentary, '{}'::JSONB),
        v_content_hash
    ) RETURNING id INTO v_snapshot_id;

    -- Canonical audit event
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
        'finalize_monthly_report_snapshot',
        'monthly_report_snapshots',
        v_snapshot_id,
        jsonb_build_object(
            'month_key', p_month_key,
            'revision_number', v_next_revision,
            'snapshot_hash', v_content_hash
        )
    );

    -- Return identical server timestamp in response
    v_result := jsonb_build_object(
        'success', TRUE,
        'snapshot_id', v_snapshot_id,
        'month_key', p_month_key,
        'revision_number', v_next_revision,
        'snapshot_hash', v_content_hash,
        'finalized_at', v_finalized_at
    );

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(p_workspace_id, v_caller.roster_person_id, 'finalize_monthly_report_snapshot', p_idempotency_key, v_hash, v_result);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- -----------------------------------------------------------------------------
-- 3. EXPLICIT GRANTS FOR MONTHLY REPORTS
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.generate_monthly_report_draft(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.finalize_monthly_report_snapshot(UUID, TEXT, JSONB, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.generate_monthly_report_draft(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_monthly_report_snapshot(UUID, TEXT, JSONB, TEXT) TO authenticated, service_role;

COMMIT;
