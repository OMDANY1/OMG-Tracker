BEGIN;

-- =============================================================================
-- Migration 61: Fix save_ai_calendar_extraction to always generate collision-free
-- item UUIDs when saving cached or re-uploaded calendar revisions (Rev 2+)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.save_ai_calendar_extraction(
    p_workspace_id UUID,
    p_campaign_id UUID,
    p_file_sha256 TEXT,
    p_ai_metadata JSONB,
    p_inventory JSONB,
    p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_caller RECORD;
    v_actor_roster_id UUID;
    v_campaign RECORD;
    v_item JSONB;
    v_item_id UUID;
    v_item_count INT := 0;
    v_detected_posts INT := 0;
    v_declared_posts INT;
    v_overall_confidence NUMERIC(4,2);
    v_prompt_tokens INT := 0;
    v_completion_tokens INT := 0;
    v_total_tokens INT := 0;
    v_provider TEXT;
    v_model TEXT;
    v_prompt_ver TEXT;
    v_schema_ver TEXT;
    v_warnings JSONB;
    v_is_service_role BOOLEAN;
    v_suggested_assignee UUID;
    v_approved_assignee UUID;
BEGIN
    IF p_workspace_id IS NULL OR p_campaign_id IS NULL THEN
        RAISE EXCEPTION 'workspace_id and campaign_id are required.';
    END IF;

    v_is_service_role := (auth.role() = 'service_role')
                         OR (COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role');

    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;

    SELECT * INTO v_campaign
    FROM public.campaigns
    WHERE workspace_id = p_workspace_id AND id = p_campaign_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Campaign not found in workspace.';
    END IF;

    IF NOT v_is_service_role THEN
        SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
        IF NOT (
            v_caller.role IN ('owner', 'company_owner', 'manager')
            OR (
                private.caller_has_permission(p_workspace_id, v_caller.roster_person_id, 'create_campaigns')
                AND private.can_access_client_in_scope(p_workspace_id, v_caller.roster_person_id, v_campaign.client_id)
            )
        ) THEN
            RAISE EXCEPTION 'Permission denied: Caller is not authorized to save AI calendar extraction for this client.';
        END IF;
        v_actor_roster_id := v_caller.roster_person_id;
    ELSE
        v_actor_roster_id := v_campaign.uploaded_by_roster_id;
        IF v_actor_roster_id IS NULL THEN
            SELECT roster_person_id INTO v_actor_roster_id
            FROM public.workspace_memberships
            WHERE workspace_id = p_workspace_id AND role IN ('owner', 'company_owner') AND is_active = TRUE
            LIMIT 1;
        END IF;
    END IF;

    -- Extract metadata safely
    v_provider := COALESCE(p_ai_metadata->>'provider', 'google');
    v_model := COALESCE(p_ai_metadata->>'model', 'gemini-2.5-flash');
    v_prompt_ver := COALESCE(p_ai_metadata->>'prompt_version', 'v2.0');
    v_schema_ver := COALESCE(p_ai_metadata->>'schema_version', '2026-09-08');
    v_overall_confidence := (p_ai_metadata->>'confidence')::NUMERIC;
    v_declared_posts := (p_ai_metadata->>'declared_post_count')::INT;
    v_detected_posts := (p_ai_metadata->>'detected_post_count')::INT;
    v_prompt_tokens := COALESCE((p_ai_metadata->'token_usage'->>'prompt_tokens')::INT, 0);
    v_completion_tokens := COALESCE((p_ai_metadata->'token_usage'->>'completion_tokens')::INT, 0);
    v_total_tokens := COALESCE((p_ai_metadata->'token_usage'->>'total_tokens')::INT, 0);
    v_warnings := COALESCE(p_ai_metadata->'warnings', '[]'::jsonb);

    -- Clean up existing unimported items for this campaign before saving new extraction
    DELETE FROM public.content_calendar_items
    WHERE workspace_id = p_workspace_id
      AND campaign_id = p_campaign_id
      AND task_id IS NULL;

    -- Insert new extracted items with guaranteed collision-free UUIDs
    IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' AND jsonb_array_length(p_items) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
        LOOP
            v_item_count := v_item_count + 1;

            -- Ensure v_item_id never collides with an existing item (e.g. from cached Rev 1)
            v_item_id := public.safe_cast_uuid(v_item->>'id');
            IF v_item_id IS NULL OR EXISTS (SELECT 1 FROM public.content_calendar_items WHERE id = v_item_id) THEN
                v_item_id := extensions.gen_random_uuid();
            END IF;

            v_suggested_assignee := public.safe_cast_uuid(v_item->>'suggested_assignee_id');
            v_approved_assignee := COALESCE(public.safe_cast_uuid(v_item->>'approved_assignee_id'), v_suggested_assignee);

            INSERT INTO public.content_calendar_items (
                id,
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
                publish_date,
                design_due_date,
                notes,
                reference_urls,
                raw_text,
                source_page,
                confidence,
                needs_manual_review,
                suggested_assignee_id,
                approved_assignee_id,
                is_included,
                on_design_text,
                hook,
                cta,
                reel_script,
                slides,
                source_regions,
                source_pages,
                warnings,
                content_fingerprint,
                possible_duplicate,
                is_excluded_from_tasks,
                exclusion_reason
            ) VALUES (
                v_item_id,
                p_workspace_id,
                p_campaign_id,
                v_campaign.client_id,
                COALESCE((v_item->>'post_order')::INT, v_item_count),
                COALESCE(NULLIF(btrim(v_item->>'post_number'), ''), 'Post ' || v_item_count),
                COALESCE(NULLIF(btrim(v_item->>'title'), ''), 'Post ' || v_item_count),
                NULLIF(btrim(v_item->>'brief'), ''),
                NULLIF(btrim(v_item->>'caption'), ''),
                COALESCE(NULLIF(btrim(v_item->>'platform'), ''), 'Instagram'),
                COALESCE(NULLIF(btrim(v_item->>'content_format'), ''), 'Static'),
                CASE WHEN (v_item->>'publish_date') ~ '^\d{4}-\d{2}-\d{2}$' THEN (v_item->>'publish_date')::DATE ELSE NULL END,
                CASE WHEN (v_item->>'design_due_date') ~ '^\d{4}-\d{2}-\d{2}$' THEN (v_item->>'design_due_date')::DATE ELSE NULL END,
                NULLIF(btrim(v_item->>'notes'), ''),
                ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_item->'reference_urls', '[]'::jsonb))),
                NULLIF(btrim(v_item->>'raw_text'), ''),
                (v_item->>'source_page')::INT,
                COALESCE((v_item->>'confidence')::NUMERIC, 1.0),
                COALESCE((v_item->>'needs_manual_review')::BOOLEAN, FALSE),
                v_suggested_assignee,
                v_approved_assignee,
                COALESCE((v_item->>'is_included')::BOOLEAN, TRUE),
                NULLIF(btrim(v_item->>'on_design_text'), ''),
                NULLIF(btrim(v_item->>'hook'), ''),
                NULLIF(btrim(v_item->>'cta'), ''),
                NULLIF(btrim(v_item->>'reel_script'), ''),
                COALESCE(v_item->'slides', '[]'::jsonb),
                COALESCE(v_item->'source_regions', '[]'::jsonb),
                COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_item->'source_pages')::INT), '{}'::int[]),
                COALESCE(v_item->'warnings', '[]'::jsonb),
                NULLIF(btrim(v_item->>'content_fingerprint'), ''),
                COALESCE((v_item->>'possible_duplicate')::BOOLEAN, FALSE),
                COALESCE((v_item->>'is_excluded_from_tasks')::BOOLEAN, FALSE),
                NULLIF(btrim(v_item->>'exclusion_reason'), '')
            );
        END LOOP;
    END IF;

    -- If detected_posts wasn't explicitly passed, count non-excluded items
    IF v_detected_posts IS NULL OR v_detected_posts = 0 THEN
        SELECT count(*) INTO v_detected_posts
        FROM public.content_calendar_items
        WHERE workspace_id = p_workspace_id
          AND campaign_id = p_campaign_id
          AND is_excluded_from_tasks = FALSE;
    END IF;

    -- Update campaign metadata
    UPDATE public.campaigns
    SET file_sha256 = COALESCE(p_file_sha256, file_sha256),
        ai_provider = v_provider,
        ai_model = v_model,
        ai_prompt_version = v_prompt_ver,
        ai_schema_version = v_schema_ver,
        ai_overall_confidence = v_overall_confidence,
        ai_warnings = v_warnings,
        declared_post_count = v_declared_posts,
        detected_post_count = v_detected_posts,
        prompt_tokens = v_prompt_tokens,
        completion_tokens = v_completion_tokens,
        total_tokens = v_total_tokens,
        inventory_summary = COALESCE(p_inventory, '{}'::jsonb),
        calendar_status = 'needs_review',
        processed_at = pg_catalog.now(),
        processing_error = NULL,
        processing_attempts = processing_attempts + 1,
        updated_at = pg_catalog.now()
    WHERE id = p_campaign_id AND workspace_id = p_workspace_id;

    -- Audit Event
    INSERT INTO public.audit_events (
        workspace_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        p_workspace_id,
        v_actor_roster_id,
        'save_ai_calendar_extraction',
        'campaigns',
        p_campaign_id,
        jsonb_build_object(
            'client_id', v_campaign.client_id,
            'items_saved', v_item_count,
            'detected_post_count', v_detected_posts,
            'declared_post_count', v_declared_posts,
            'confidence', v_overall_confidence,
            'model', v_model
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'campaign_id', p_campaign_id,
        'items_count', v_item_count,
        'detected_post_count', v_detected_posts,
        'declared_post_count', v_declared_posts,
        'confidence', v_overall_confidence
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_ai_calendar_extraction(UUID, UUID, TEXT, JSONB, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_ai_calendar_extraction(UUID, UUID, TEXT, JSONB, JSONB, JSONB) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
