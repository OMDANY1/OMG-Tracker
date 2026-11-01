-- Migration 58: Restore canonical import_content_calendar_tasks body from Migration 48
-- with granular permission (create_campaigns) and client scope (private.can_access_client_in_scope) enforcement.

BEGIN;

CREATE OR REPLACE FUNCTION public.import_content_calendar_tasks(
    p_workspace_id uuid,
    p_campaign_id uuid,
    p_idempotency_key text,
    p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_caller RECORD;
    v_campaign RECORD;
    v_client RECORD;
    v_team RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_item JSONB;
    v_item_id UUID;
    v_target_assignee_id UUID;
    v_assignee_role public.roster_role;
    v_reviewer_id UUID;
    v_new_task_id UUID;
    v_owner_roster_id UUID;
    v_post_number TEXT;
    v_title TEXT;
    v_brief TEXT;
    v_caption TEXT;
    v_platform TEXT;
    v_format TEXT;
    v_work_stage TEXT;
    v_is_video_post BOOLEAN;
    v_due_date TIMESTAMPTZ;
    v_tasks_created INT := 0;
    v_notifications_created INT := 0;
    v_assignee_map JSONB := '{}'::JSONB;
    v_result JSONB;
    v_existing_task_id UUID;
    v_slides JSONB;
    v_slide_item JSONB;
    v_slides_text TEXT;
    v_hook TEXT;
    v_cta TEXT;
    v_reel_script TEXT;
    v_on_design_text TEXT;
    v_description_parts TEXT[];
    v_full_description TEXT;
    v_explicit_reviewer_id UUID;
    v_total_operational INT := 0;
    v_imported_operational INT := 0;
BEGIN
    IF p_workspace_id IS NULL OR p_campaign_id IS NULL THEN
        RAISE EXCEPTION 'workspace_id and campaign_id are required.';
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    IF v_caller.role::TEXT NOT IN ('owner', 'company_owner', 'manager')
       AND NOT private.has_granular_permission(p_workspace_id, 'create_campaigns') THEN
        RAISE EXCEPTION 'Permission denied: You do not have permission to import content calendar tasks.';
    END IF;

    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;

    SELECT wm.roster_person_id INTO v_owner_roster_id
    FROM public.workspace_memberships wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.role = 'owner'
      AND wm.is_active = TRUE
    LIMIT 1;

    SELECT * INTO v_campaign
    FROM public.campaigns
    WHERE workspace_id = p_workspace_id AND id = p_campaign_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Campaign not found in workspace.';
    END IF;

    IF NOT private.can_access_client_in_scope(p_workspace_id, v_campaign.client_id) THEN
        RAISE EXCEPTION 'Permission denied: This client is outside your authorized team/client scope.';
    END IF;

    SELECT * INTO v_client
    FROM public.clients
    WHERE workspace_id = p_workspace_id AND id = v_campaign.client_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Client not found in workspace.';
    END IF;

    SELECT * INTO v_team
    FROM public.client_team_assignments
    WHERE workspace_id = p_workspace_id AND client_id = v_campaign.client_id;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object(
            'p_workspace_id', p_workspace_id,
            'p_campaign_id', p_campaign_id,
            'p_items', p_items
        );
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(
            p_workspace_id,
            v_caller.roster_person_id,
            'import_content_calendar_tasks',
            p_idempotency_key,
            v_hash
        );
        IF v_cached IS NOT NULL THEN
            RETURN v_cached;
        END IF;
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'No items provided for import.';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        IF (v_item->>'is_included')::BOOLEAN IS FALSE OR (v_item->>'is_excluded_from_tasks')::BOOLEAN IS TRUE THEN
            CONTINUE;
        END IF;

        v_item_id := public.safe_cast_uuid(v_item->>'id');
        v_post_number := btrim(COALESCE(v_item->>'post_number', ''));
        v_title := btrim(COALESCE(v_item->>'title', ''));
        v_brief := NULLIF(btrim(COALESCE(v_item->>'brief', '')), '');
        v_caption := NULLIF(btrim(COALESCE(v_item->>'caption', '')), '');
        v_platform := COALESCE(NULLIF(btrim(v_item->>'platform'), ''), 'Instagram');
        v_format := COALESCE(NULLIF(btrim(v_item->>'content_format'), ''), 'Static');
        v_hook := NULLIF(btrim(COALESCE(v_item->>'hook', '')), '');
        v_cta := NULLIF(btrim(COALESCE(v_item->>'cta', '')), '');
        v_reel_script := NULLIF(btrim(COALESCE(v_item->>'reel_script', '')), '');
        v_on_design_text := NULLIF(btrim(COALESCE(v_item->>'on_design_text', '')), '');
        v_slides := COALESCE(v_item->'slides', '[]'::jsonb);

        IF v_item->>'design_due_date' IS NOT NULL AND btrim(v_item->>'design_due_date') <> '' THEN
            BEGIN
                v_due_date := (v_item->>'design_due_date')::TIMESTAMPTZ;
            EXCEPTION WHEN OTHERS THEN
                v_due_date := NULL;
            END;
        ELSE
            v_due_date := NULL;
        END IF;

        v_existing_task_id := NULL;

        IF v_item_id IS NOT NULL THEN
            SELECT task_id INTO v_existing_task_id
            FROM public.content_calendar_items
            WHERE workspace_id = p_workspace_id AND id = v_item_id
            FOR UPDATE;

            IF v_existing_task_id IS NOT NULL THEN
                CONTINUE;
            END IF;
        END IF;

        IF v_item_id IS NULL AND v_post_number <> '' THEN
            SELECT id, task_id INTO v_item_id, v_existing_task_id
            FROM public.content_calendar_items
            WHERE workspace_id = p_workspace_id
              AND campaign_id = p_campaign_id
              AND btrim(COALESCE(post_number, '')) = v_post_number
            LIMIT 1
            FOR UPDATE;

            IF v_existing_task_id IS NOT NULL THEN
                CONTINUE;
            END IF;
        END IF;

        IF v_post_number <> '' THEN
            SELECT id INTO v_existing_task_id
            FROM public.tasks
            WHERE workspace_id = p_workspace_id
              AND campaign_id = p_campaign_id
              AND btrim(COALESCE(deliverable_number, '')) = v_post_number
              AND status <> 'cancelled'
            LIMIT 1;

            IF v_existing_task_id IS NOT NULL THEN
                IF v_item_id IS NOT NULL THEN
                    UPDATE public.content_calendar_items
                    SET task_id = v_existing_task_id, updated_at = pg_catalog.now()
                    WHERE id = v_item_id AND workspace_id = p_workspace_id AND task_id IS NULL;
                END IF;
                CONTINUE;
            END IF;
        END IF;

        v_is_video_post := (
            lower(v_format) ~ '(reel|video|motion|فيديو|ريل)' OR
            v_reel_script IS NOT NULL
        );

        v_target_assignee_id := public.safe_cast_uuid(v_item->>'approved_assignee_id');
        IF v_target_assignee_id IS NULL THEN
            v_target_assignee_id := public.safe_cast_uuid(v_item->>'suggested_assignee_id');
        END IF;
        IF v_target_assignee_id IS NULL THEN
            IF v_is_video_post AND v_team.primary_video_editor_id IS NOT NULL THEN
                v_target_assignee_id := v_team.primary_video_editor_id;
            ELSE
                v_target_assignee_id := COALESCE(v_team.primary_designer_id, v_client.owner_roster_id);
            END IF;
        END IF;

        IF v_target_assignee_id IS NULL THEN
            RAISE EXCEPTION 'يجب اختيار عضو مسؤول صالح للبوست رقم % قبل إنشاء التاسك.', COALESCE(v_post_number, 'غير محدد');
        END IF;

        IF NOT private.is_eligible_executor(p_workspace_id, v_target_assignee_id) THEN
            RAISE EXCEPTION 'العضو المختار للبوست رقم % غير مؤهل للتنفيذ (مشاهد أو مدير تسويق أو معطل أو غير موجود في مساحة العمل).', COALESCE(v_post_number, 'غير محدد');
        END IF;

        SELECT rp.role INTO v_assignee_role
        FROM public.roster_people rp
        WHERE rp.workspace_id = p_workspace_id
          AND rp.id = v_target_assignee_id;

        IF v_assignee_role = 'video_editor' OR v_is_video_post THEN
            v_work_stage := 'video_editing';
        ELSIF v_assignee_role = 'content_writer' THEN
            v_work_stage := 'copywriting';
        ELSIF v_assignee_role IN ('strategist', 'strategy_lead') THEN
            v_work_stage := 'strategy';
        ELSE
            v_work_stage := 'design';
        END IF;

        -- Determine Reviewer
        v_explicit_reviewer_id := public.safe_cast_uuid(v_item->>'reviewer_id');
        IF v_explicit_reviewer_id IS NOT NULL AND v_explicit_reviewer_id <> v_target_assignee_id THEN
            IF private.is_eligible_reviewer(p_workspace_id, v_explicit_reviewer_id) THEN
                v_reviewer_id := v_explicit_reviewer_id;
            ELSE
                v_reviewer_id := NULL;
            END IF;
        ELSE
            v_reviewer_id := NULL;
        END IF;

        IF v_reviewer_id IS NULL THEN
            -- Narrow Review Bypass: Strictly only for Emad (role = 'owner')
            IF EXISTS (
                SELECT 1 FROM public.workspace_memberships wm
                WHERE wm.workspace_id = p_workspace_id
                  AND wm.roster_person_id = v_target_assignee_id
                  AND wm.role = 'owner'
                  AND wm.is_active = TRUE
            ) THEN
                v_reviewer_id := NULL;
            ELSE
                IF v_work_stage = 'video_editing' AND v_team.video_reviewer_id IS NOT NULL AND v_team.video_reviewer_id <> v_target_assignee_id AND private.is_eligible_reviewer(p_workspace_id, v_team.video_reviewer_id) THEN
                    v_reviewer_id := v_team.video_reviewer_id;
                ELSIF v_work_stage = 'design' AND v_team.design_reviewer_id IS NOT NULL AND v_team.design_reviewer_id <> v_target_assignee_id AND private.is_eligible_reviewer(p_workspace_id, v_team.design_reviewer_id) THEN
                    v_reviewer_id := v_team.design_reviewer_id;
                END IF;

                IF v_reviewer_id IS NULL THEN
                    SELECT reviewer_roster_id INTO v_reviewer_id
                    FROM public.review_routing_rules
                    WHERE workspace_id = p_workspace_id
                      AND designer_roster_id = v_target_assignee_id
                      AND client_difficulty = v_client.difficulty
                      AND private.is_eligible_reviewer(p_workspace_id, reviewer_roster_id)
                    ORDER BY priority DESC
                    LIMIT 1;
                END IF;

                IF v_reviewer_id IS NULL THEN
                    SELECT reviewer_roster_id INTO v_reviewer_id
                    FROM public.review_routing_rules
                    WHERE workspace_id = p_workspace_id
                      AND designer_roster_id = v_target_assignee_id
                      AND client_difficulty IS NULL
                      AND private.is_eligible_reviewer(p_workspace_id, reviewer_roster_id)
                    ORDER BY priority DESC
                    LIMIT 1;
                END IF;

                IF v_reviewer_id IS NULL THEN
                    SELECT reviewer_roster_id INTO v_reviewer_id
                    FROM public.review_routing_rules
                    WHERE workspace_id = p_workspace_id
                      AND is_workspace_default = TRUE
                      AND private.is_eligible_reviewer(p_workspace_id, reviewer_roster_id)
                    ORDER BY priority DESC
                    LIMIT 1;
                END IF;

                IF v_reviewer_id IS NULL THEN
                    v_reviewer_id := v_owner_roster_id;
                END IF;

                IF v_reviewer_id = v_target_assignee_id THEN
                    v_reviewer_id := NULL;
                END IF;
            END IF;
        END IF;

        IF v_title = '' THEN
            v_title := COALESCE(NULLIF(v_post_number, ''), 'Post');
        ELSEIF v_post_number <> '' AND v_title !~ ('^' || v_post_number) THEN
            v_title := v_post_number || ' - ' || v_title;
        END IF;

        v_description_parts := ARRAY[]::TEXT[];

        IF v_on_design_text IS NOT NULL THEN
            v_description_parts := array_append(v_description_parts, '【النص على التصميم】: ' || v_on_design_text);
        END IF;

        IF v_hook IS NOT NULL THEN
            v_description_parts := array_append(v_description_parts, '【الخطاف / Hook】: ' || v_hook);
        END IF;

        IF v_reel_script IS NOT NULL THEN
            v_description_parts := array_append(v_description_parts, '【الاسكريبت】:' || E'\n' || v_reel_script);
        END IF;

        IF v_cta IS NOT NULL THEN
            v_description_parts := array_append(v_description_parts, '【الدعوة للتفاعل / CTA】: ' || v_cta);
        END IF;

        IF jsonb_array_length(v_slides) > 0 THEN
            v_slides_text := '【تفاصيل السلايدز】:';
            FOR v_slide_item IN SELECT * FROM jsonb_array_elements(v_slides)
            LOOP
                v_slides_text := v_slides_text || E'\n- سلايد ' || COALESCE(v_slide_item->>'slide_number', '?') || ': ' || COALESCE(v_slide_item->>'text', '');
                IF v_slide_item->>'visual_notes' IS NOT NULL AND btrim(v_slide_item->>'visual_notes') <> '' THEN
                    v_slides_text := v_slides_text || ' (' || (v_slide_item->>'visual_notes') || ')';
                END IF;
            END LOOP;
            v_description_parts := array_append(v_description_parts, v_slides_text);
        END IF;

        IF v_caption IS NOT NULL THEN
            v_description_parts := array_append(v_description_parts, '【الكابشن】:' || E'\n' || v_caption);
        END IF;

        IF array_length(v_description_parts, 1) > 0 THEN
            v_full_description := array_to_string(v_description_parts, E'\n\n');
        ELSE
            v_full_description := COALESCE(v_brief, v_title);
        END IF;

        IF v_item_id IS NULL THEN
            INSERT INTO public.content_calendar_items (
                workspace_id,
                campaign_id,
                client_id,
                post_order,
                post_number,
                title,
                brief,
                caption,
                platform,
                content_format,
                design_due_date,
                suggested_assignee_id,
                approved_assignee_id,
                is_included,
                on_design_text,
                hook,
                cta,
                reel_script,
                slides
            ) VALUES (
                p_workspace_id,
                p_campaign_id,
                v_campaign.client_id,
                v_tasks_created + 1,
                v_post_number,
                v_title,
                v_brief,
                v_caption,
                v_platform,
                v_format,
                v_due_date::DATE,
                v_target_assignee_id,
                v_target_assignee_id,
                TRUE,
                v_on_design_text,
                v_hook,
                v_cta,
                v_reel_script,
                v_slides
            ) RETURNING id INTO v_item_id;
        END IF;

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
            work_stage,
            primary_assignee_id,
            reviewer_id,
            due_date,
            design_due_date,
            content_calendar_item_id,
            created_by_id
        ) VALUES (
            p_workspace_id,
            v_campaign.client_id,
            p_campaign_id,
            v_title,
            COALESCE(v_brief, v_on_design_text),
            v_full_description,
            v_format,
            v_post_number,
            'Normal',
            'backlog',
            v_work_stage,
            v_target_assignee_id,
            v_reviewer_id,
            v_due_date,
            v_due_date,
            v_item_id,
            v_caller.roster_person_id
        ) RETURNING id INTO v_new_task_id;

        v_tasks_created := v_tasks_created + 1;

        UPDATE public.content_calendar_items
        SET task_id = v_new_task_id,
            approved_assignee_id = v_target_assignee_id,
            title = v_title,
            brief = v_brief,
            caption = v_caption,
            platform = v_platform,
            content_format = v_format,
            design_due_date = v_due_date::DATE,
            is_included = TRUE,
            updated_at = pg_catalog.now()
        WHERE id = v_item_id AND workspace_id = p_workspace_id;

        INSERT INTO public.task_status_events (
            workspace_id,
            task_id,
            from_status,
            to_status,
            actor_id,
            reason
        ) VALUES (
            p_workspace_id,
            v_new_task_id,
            NULL,
            'backlog',
            v_caller.roster_person_id,
            'Imported from Content Calendar'
        );

        INSERT INTO public.task_assignment_events (
            workspace_id,
            task_id,
            previous_assignee_id,
            new_assignee_id,
            actor_id,
            reason
        ) VALUES (
            p_workspace_id,
            v_new_task_id,
            NULL,
            v_target_assignee_id,
            v_caller.roster_person_id,
            'Initial assignment from content calendar import'
        );

        IF v_target_assignee_id <> v_caller.roster_person_id THEN
            INSERT INTO public.in_app_notifications (
                workspace_id,
                recipient_roster_id,
                actor_roster_id,
                task_id,
                title,
                message,
                action_url,
                notification_type,
                metadata,
                is_read
            ) VALUES (
                p_workspace_id,
                v_target_assignee_id,
                v_caller.roster_person_id,
                v_new_task_id,
                'تمت إضافة تاسك جديدة لك',
                'تمت إضافة تاسك جديدة لك: ' || COALESCE(NULLIF(v_post_number, ''), 'Post') || ' — ' || v_client.name,
                '/tasks?taskId=' || v_new_task_id::TEXT,
                'task_assigned',
                '{}'::jsonb,
                FALSE
            );
            v_notifications_created := v_notifications_created + 1;
        END IF;

        v_assignee_map := jsonb_set(
            v_assignee_map,
            ARRAY[v_target_assignee_id::TEXT],
            to_jsonb(COALESCE((v_assignee_map->>v_target_assignee_id::TEXT)::INT, 0) + 1)
        );
    END LOOP;

    SELECT
        COUNT(*) FILTER (WHERE NOT is_excluded_from_tasks),
        COUNT(*) FILTER (WHERE NOT is_excluded_from_tasks AND task_id IS NOT NULL)
    INTO v_total_operational, v_imported_operational
    FROM public.content_calendar_items
    WHERE campaign_id = p_campaign_id AND workspace_id = p_workspace_id;

    UPDATE public.campaigns
    SET status = 'Active',
        calendar_status = CASE
            WHEN v_imported_operational >= v_total_operational AND v_total_operational > 0 THEN 'imported'
            ELSE 'ready'
        END,
        approved_at = pg_catalog.now(),
        approved_by_roster_id = v_caller.roster_person_id,
        updated_at = pg_catalog.now()
    WHERE id = p_campaign_id AND workspace_id = p_workspace_id;

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
        'import_content_calendar_tasks',
        'campaigns',
        p_campaign_id,
        jsonb_build_object(
            'client_id', v_campaign.client_id,
            'tasks_created', v_tasks_created,
            'notifications_created', v_notifications_created,
            'assignees', v_assignee_map
        )
    );

    v_result := jsonb_build_object(
        'success', TRUE,
        'campaign_id', p_campaign_id,
        'tasks_created', v_tasks_created,
        'notifications_created', v_notifications_created,
        'assignees', v_assignee_map,
        'total_operational', v_total_operational,
        'imported_operational', v_imported_operational,
        'is_fully_imported', (v_imported_operational >= v_total_operational AND v_total_operational > 0)
    );

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(
            p_workspace_id,
            v_caller.roster_person_id,
            'import_content_calendar_tasks',
            p_idempotency_key,
            v_hash,
            v_result
        );
    END IF;

    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_content_calendar_tasks(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_content_calendar_tasks(UUID, UUID, TEXT, JSONB) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
