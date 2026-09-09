-- OMG Creative Workspace: Hybrid AI Content Calendar Pipeline
-- Migration: 20260908000009_ai_content_calendar_pipeline.sql
-- Strictly Transactional: Wrapped in BEGIN; ... COMMIT;

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. CAMPAIGNS TABLE EXTENSIONS FOR AI PIPELINE
-- -----------------------------------------------------------------------------
ALTER TABLE public.campaigns
    ADD COLUMN IF NOT EXISTS ai_provider TEXT DEFAULT 'google',
    ADD COLUMN IF NOT EXISTS ai_model TEXT DEFAULT 'gemini-3.8-flash',
    ADD COLUMN IF NOT EXISTS ai_prompt_version TEXT DEFAULT 'v2.0',
    ADD COLUMN IF NOT EXISTS ai_schema_version TEXT DEFAULT '2026-09-08',
    ADD COLUMN IF NOT EXISTS ai_overall_confidence NUMERIC(4,2),
    ADD COLUMN IF NOT EXISTS ai_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS declared_post_count INT,
    ADD COLUMN IF NOT EXISTS detected_post_count INT,
    ADD COLUMN IF NOT EXISTS processing_attempts INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS file_sha256 TEXT,
    ADD COLUMN IF NOT EXISTS prompt_tokens INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS completion_tokens INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_tokens INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS inventory_summary JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_campaigns_ai_confidence') THEN
        ALTER TABLE public.campaigns
            ADD CONSTRAINT chk_campaigns_ai_confidence
            CHECK (ai_overall_confidence IS NULL OR (ai_overall_confidence >= 0.0 AND ai_overall_confidence <= 1.0));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_campaigns_declared_post_count') THEN
        ALTER TABLE public.campaigns
            ADD CONSTRAINT chk_campaigns_declared_post_count
            CHECK (declared_post_count IS NULL OR (declared_post_count >= 0 AND declared_post_count <= 100));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_campaigns_detected_post_count') THEN
        ALTER TABLE public.campaigns
            ADD CONSTRAINT chk_campaigns_detected_post_count
            CHECK (detected_post_count IS NULL OR (detected_post_count >= 0 AND detected_post_count <= 100));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_campaigns_processing_attempts') THEN
        ALTER TABLE public.campaigns
            ADD CONSTRAINT chk_campaigns_processing_attempts
            CHECK (processing_attempts >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_campaigns_tokens') THEN
        ALTER TABLE public.campaigns
            ADD CONSTRAINT chk_campaigns_tokens
            CHECK (prompt_tokens >= 0 AND completion_tokens >= 0 AND total_tokens >= 0);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_campaigns_sha256 ON public.campaigns (workspace_id, file_sha256);

-- -----------------------------------------------------------------------------
-- 2. CONTENT CALENDAR ITEMS TABLE EXTENSIONS
-- -----------------------------------------------------------------------------
ALTER TABLE public.content_calendar_items
    ADD COLUMN IF NOT EXISTS on_design_text TEXT,
    ADD COLUMN IF NOT EXISTS hook TEXT,
    ADD COLUMN IF NOT EXISTS cta TEXT,
    ADD COLUMN IF NOT EXISTS reel_script TEXT,
    ADD COLUMN IF NOT EXISTS slides JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS source_regions JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS source_pages INT[] NOT NULL DEFAULT '{}'::int[],
    ADD COLUMN IF NOT EXISTS warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS content_fingerprint TEXT,
    ADD COLUMN IF NOT EXISTS possible_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS duplicate_of_item_id UUID,
    ADD COLUMN IF NOT EXISTS is_excluded_from_tasks BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS exclusion_reason TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cci_confidence') THEN
        ALTER TABLE public.content_calendar_items
            ADD CONSTRAINT chk_cci_confidence
            CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cci_duplicate_of') THEN
        ALTER TABLE public.content_calendar_items
            ADD CONSTRAINT fk_cci_duplicate_of
            FOREIGN KEY (workspace_id, duplicate_of_item_id)
            REFERENCES public.content_calendar_items(workspace_id, id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cci_fingerprint ON public.content_calendar_items (workspace_id, content_fingerprint);
CREATE INDEX IF NOT EXISTS idx_cci_duplicate ON public.content_calendar_items (workspace_id, duplicate_of_item_id);

-- -----------------------------------------------------------------------------
-- 3. AI EXTRACTION CACHE TABLE (Server-side / Owner-only)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_extraction_cache (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    file_sha256 TEXT NOT NULL,
    parser_version TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'google',
    model TEXT NOT NULL DEFAULT 'gemini-3.8-flash',
    extracted_payload JSONB NOT NULL,
    token_usage JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_ai_cache_entry UNIQUE (workspace_id, file_sha256, parser_version, schema_version)
);

CREATE INDEX IF NOT EXISTS idx_ai_cache_lookup ON public.ai_extraction_cache (workspace_id, file_sha256);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ai_extraction_cache_updated_at') THEN
        CREATE TRIGGER trg_ai_extraction_cache_updated_at
        BEFORE UPDATE ON public.ai_extraction_cache
        FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
    END IF;
END $$;

ALTER TABLE public.ai_extraction_cache ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_extraction_cache' AND policyname = 'p_select_ai_cache_owner') THEN
        CREATE POLICY p_select_ai_cache_owner ON public.ai_extraction_cache
        FOR SELECT TO authenticated
        USING (private.is_workspace_owner(workspace_id));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_extraction_cache' AND policyname = 'p_insert_ai_cache_owner') THEN
        CREATE POLICY p_insert_ai_cache_owner ON public.ai_extraction_cache
        FOR INSERT TO authenticated
        WITH CHECK (private.is_workspace_owner(workspace_id));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_extraction_cache' AND policyname = 'p_update_ai_cache_owner') THEN
        CREATE POLICY p_update_ai_cache_owner ON public.ai_extraction_cache
        FOR UPDATE TO authenticated
        USING (private.is_workspace_owner(workspace_id))
        WITH CHECK (private.is_workspace_owner(workspace_id));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_extraction_cache' AND policyname = 'p_delete_ai_cache_owner') THEN
        CREATE POLICY p_delete_ai_cache_owner ON public.ai_extraction_cache
        FOR DELETE TO authenticated
        USING (private.is_workspace_owner(workspace_id));
    END IF;
END $$;

REVOKE ALL ON public.ai_extraction_cache FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_extraction_cache TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. ATOMIC RPC: save_ai_calendar_extraction
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_ai_calendar_extraction(
    p_workspace_id UUID,
    p_campaign_id UUID,
    p_file_sha256 TEXT,
    p_ai_metadata JSONB,
    p_inventory JSONB,
    p_items JSONB
)
RETURNS JSONB AS $$
DECLARE
    v_caller RECORD;
    v_actor_roster_id UUID;
    v_campaign RECORD;
    v_item JSONB;
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
BEGIN
    IF p_workspace_id IS NULL OR p_campaign_id IS NULL THEN
        RAISE EXCEPTION 'workspace_id and campaign_id are required.';
    END IF;

    -- Check if called via service role or authentic owner
    v_is_service_role := (current_setting('request.jwt.claim.role', true) = 'service_role');

    IF NOT v_is_service_role THEN
        SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
        IF v_caller.role <> 'owner' THEN
            RAISE EXCEPTION 'Permission denied: Only workspace owner or service role can save AI calendar extraction.';
        END IF;
        v_actor_roster_id := v_caller.roster_person_id;
    ELSE
        SELECT roster_person_id INTO v_actor_roster_id
        FROM public.workspace_memberships
        WHERE workspace_id = p_workspace_id AND role = 'owner' AND is_active = TRUE
        LIMIT 1;
    END IF;

    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;

    SELECT * INTO v_campaign
    FROM public.campaigns
    WHERE workspace_id = p_workspace_id AND id = p_campaign_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Campaign not found in workspace.';
    END IF;

    -- Extract metadata safely
    v_provider := COALESCE(p_ai_metadata->>'provider', 'google');
    v_model := COALESCE(p_ai_metadata->>'model', 'gemini-3.8-flash');
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

    -- Insert new extracted items
    IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' AND jsonb_array_length(p_items) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
        LOOP
            v_item_count := v_item_count + 1;

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
                COALESCE(public.safe_cast_uuid(v_item->>'id'), extensions.gen_random_uuid()),
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
                public.safe_cast_uuid(v_item->>'suggested_assignee_id'),
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.save_ai_calendar_extraction(UUID, UUID, TEXT, JSONB, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_ai_calendar_extraction(UUID, UUID, TEXT, JSONB, JSONB, JSONB) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. UPDATED ATOMIC TASK IMPORT RPC (import_content_calendar_tasks)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_content_calendar_tasks(
    p_workspace_id UUID,
    p_campaign_id UUID,
    p_idempotency_key TEXT,
    p_items JSONB
)
RETURNS JSONB AS $$
DECLARE
    v_caller RECORD;
    v_campaign RECORD;
    v_client RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_item JSONB;
    v_item_id UUID;
    v_target_assignee_id UUID;
    v_reviewer_id UUID;
    v_new_task_id UUID;
    v_owner_roster_id UUID;
    v_post_number TEXT;
    v_title TEXT;
    v_brief TEXT;
    v_caption TEXT;
    v_platform TEXT;
    v_format TEXT;
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
BEGIN
    IF p_workspace_id IS NULL OR p_campaign_id IS NULL THEN
        RAISE EXCEPTION 'workspace_id and campaign_id are required.';
    END IF;

    -- 1. Caller identity and Owner authorization
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    IF v_caller.role <> 'owner' THEN
        RAISE EXCEPTION 'Permission denied: Only workspace owner can import content calendar tasks.';
    END IF;

    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;

    -- Resolve Owner roster ID
    SELECT wm.roster_person_id INTO v_owner_roster_id
    FROM public.workspace_memberships wm
    WHERE wm.workspace_id = p_workspace_id AND wm.role = 'owner' AND wm.is_active = TRUE
    LIMIT 1;

    -- 2. Verify campaign and lock
    SELECT * INTO v_campaign
    FROM public.campaigns
    WHERE workspace_id = p_workspace_id AND id = p_campaign_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Campaign not found in workspace.';
    END IF;

    -- 3. Verify client
    SELECT * INTO v_client
    FROM public.clients
    WHERE workspace_id = p_workspace_id AND id = v_campaign.client_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Client not found in workspace.';
    END IF;

    -- 4. Concurrency-Safe Idempotency Check
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

    -- 5. Process Items
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'No items provided for import.';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        -- Check if included AND not excluded from tasks
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

        -- Check if item already has a task (idempotency per item)
        IF v_item_id IS NOT NULL THEN
            SELECT task_id INTO v_existing_task_id
            FROM public.content_calendar_items
            WHERE workspace_id = p_workspace_id AND id = v_item_id;

            IF v_existing_task_id IS NOT NULL THEN
                CONTINUE;
            END IF;
        END IF;

        -- Determine Assignee: approved_assignee_id -> suggested_assignee_id -> client.owner_roster_id
        v_target_assignee_id := public.safe_cast_uuid(v_item->>'approved_assignee_id');
        IF v_target_assignee_id IS NULL THEN
            v_target_assignee_id := public.safe_cast_uuid(v_item->>'suggested_assignee_id');
        END IF;
        IF v_target_assignee_id IS NULL THEN
            v_target_assignee_id := v_client.owner_roster_id;
        END IF;

        IF v_target_assignee_id IS NULL THEN
            RAISE EXCEPTION 'Cannot import post %: Client has no assigned designer and no assignee was selected.', v_post_number;
        END IF;

        -- Ensure assignee exists and is active in workspace
        IF NOT EXISTS (
            SELECT 1 FROM public.roster_people
            WHERE workspace_id = p_workspace_id AND id = v_target_assignee_id AND is_active = TRUE
        ) THEN
            RAISE EXCEPTION 'Target assignee (%) not found or inactive in workspace.', v_target_assignee_id;
        END IF;

        -- Determine Reviewer
        -- Review Bypass: Emad (Owner) tasks have NO reviewer
        IF v_target_assignee_id = v_owner_roster_id THEN
            v_reviewer_id := NULL;
        ELSE
            SELECT reviewer_roster_id INTO v_reviewer_id
            FROM public.review_routing_rules
            WHERE workspace_id = p_workspace_id
              AND designer_roster_id = v_target_assignee_id
              AND client_difficulty = v_client.difficulty
            ORDER BY priority DESC
            LIMIT 1;

            IF v_reviewer_id IS NULL THEN
                SELECT reviewer_roster_id INTO v_reviewer_id
                FROM public.review_routing_rules
                WHERE workspace_id = p_workspace_id
                  AND designer_roster_id = v_target_assignee_id
                  AND client_difficulty IS NULL
                ORDER BY priority DESC
                LIMIT 1;
            END IF;

            IF v_reviewer_id IS NULL THEN
                SELECT reviewer_roster_id INTO v_reviewer_id
                FROM public.review_routing_rules
                WHERE workspace_id = p_workspace_id
                  AND is_workspace_default = TRUE
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

        -- Construct task title
        IF v_title = '' THEN
            v_title := COALESCE(v_post_number, 'Post');
        ELSEIF v_post_number <> '' AND v_title !~ ('^' || v_post_number) THEN
            v_title := v_post_number || ' - ' || v_title;
        END IF;

        -- Construct rich task description from slides, hook, script, cta, caption
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
            v_full_description := v_caption;
        END IF;

        -- Create Single Task with initial status 'backlog'
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
            v_target_assignee_id,
            v_reviewer_id,
            v_due_date,
            v_caller.roster_person_id
        ) RETURNING id INTO v_new_task_id;

        v_tasks_created := v_tasks_created + 1;

        -- Update content_calendar_items
        IF v_item_id IS NOT NULL THEN
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
        ELSE
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
                task_id,
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
                v_tasks_created,
                v_post_number,
                v_title,
                v_brief,
                v_caption,
                v_platform,
                v_format,
                v_due_date::DATE,
                v_target_assignee_id,
                v_target_assignee_id,
                v_new_task_id,
                TRUE,
                v_on_design_text,
                v_hook,
                v_cta,
                v_reel_script,
                v_slides
            );
        END IF;

        -- Ledger: Status event
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
            'Imported from AI Content Calendar'
        );

        -- Ledger: Assignment event
        INSERT INTO public.task_assignment_events (
            workspace_id,
            task_id,
            from_assignee_id,
            to_assignee_id,
            actor_id
        ) VALUES (
            p_workspace_id,
            v_new_task_id,
            NULL,
            v_target_assignee_id,
            v_caller.roster_person_id
        );

        -- In-App Notification (strictly notify assignee ONLY IF NOT self-assigned by Owner)
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
                is_read
            ) VALUES (
                p_workspace_id,
                v_target_assignee_id,
                v_caller.roster_person_id,
                v_new_task_id,
                'تمت إضافة تاسك جديدة لك',
                'تمت إضافة تاسك جديدة لك: ' || COALESCE(v_post_number, 'Post') || ' — ' || v_client.name,
                '/tasks?taskId=' || v_new_task_id::TEXT,
                'task_assigned',
                FALSE
            );
            v_notifications_created := v_notifications_created + 1;
        END IF;

        -- Tally assignees
        v_assignee_map := jsonb_set(
            v_assignee_map,
            ARRAY[v_target_assignee_id::TEXT],
            to_jsonb(COALESCE((v_assignee_map->>v_target_assignee_id::TEXT)::INT, 0) + 1)
        );
    END LOOP;

    -- Update campaign status
    UPDATE public.campaigns
    SET status = 'Active',
        calendar_status = 'imported',
        approved_at = pg_catalog.now(),
        approved_by_roster_id = v_caller.roster_person_id,
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
        'assignees', v_assignee_map
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.import_content_calendar_tasks(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_content_calendar_tasks(UUID, UUID, TEXT, JSONB) TO authenticated;

COMMIT;
