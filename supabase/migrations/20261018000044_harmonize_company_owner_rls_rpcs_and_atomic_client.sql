-- Migration 44: Harmonize company_owner Across RLS & RPCs, Enforce Marketing Director Read-Only,
-- Atomic Client Creation, Multi-Track Assignment Sync, and Realtime Publication Expansion.

BEGIN;

-- =============================================================================
-- 1. PRIVATE SCHEMA CALLER CONTEXT & RLS PREDICATE HELPERS
-- =============================================================================

CREATE OR REPLACE FUNCTION private.get_caller_context(p_workspace_id UUID)
RETURNS TABLE (
    user_id UUID,
    role public.roster_role,
    roster_person_id UUID,
    display_name TEXT
) AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_jwt_role TEXT := COALESCE(
        current_setting('request.jwt.claim.role', true),
        (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
        ''
    );
BEGIN
    IF v_uid IS NOT NULL THEN
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
          AND rp.is_active = TRUE
        LIMIT 1;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Access denied: Active workspace membership and active roster record required.';
        END IF;
        RETURN;
    END IF;

    -- Service-role server-side execution fallback
    IF v_jwt_role = 'service_role' OR current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
        RETURN QUERY
        SELECT
            wm.user_id,
            wm.role,
            wm.roster_person_id,
            rp.display_name
        FROM public.workspace_memberships wm
        JOIN public.roster_people rp ON wm.roster_person_id = rp.id
        WHERE wm.workspace_id = p_workspace_id
          AND wm.role IN ('owner', 'company_owner')
          AND wm.is_active = TRUE
          AND rp.is_active = TRUE
        ORDER BY CASE WHEN wm.role = 'owner' THEN 0 ELSE 1 END, wm.created_at ASC
        LIMIT 1;

        IF FOUND THEN
            RETURN;
        END IF;
    END IF;

    RAISE EXCEPTION 'Authentication required: User session not found.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

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

CREATE OR REPLACE FUNCTION private.is_workspace_owner(p_workspace_id UUID)
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
          AND wm.role IN ('owner', 'company_owner')
    );
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
          AND wm.role IN ('owner', 'company_owner', 'manager')
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

    IF v_caller_role IN ('owner', 'company_owner', 'manager', 'marketing_director', 'business_owner_viewer', 'strategy_lead', 'senior_reviewer') THEN
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

    -- Read-only / non-execution roles cannot work on tasks or start timers
    IF v_caller_role IN ('marketing_director', 'business_owner_viewer') THEN
        RETURN FALSE;
    END IF;

    IF v_caller_role IN ('owner', 'company_owner', 'manager') THEN
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

-- =============================================================================
-- 2. RLS POLICIES FOR TIME ENTRIES & MONTHLY REPORT SNAPSHOTS (READ OVERSIGHT)
-- =============================================================================

DROP POLICY IF EXISTS p_select_time_entries ON public.time_entries;
CREATE POLICY p_select_time_entries ON public.time_entries
FOR SELECT TO authenticated
USING (
    roster_person_id = private.caller_roster_id(workspace_id) OR
    private.is_workspace_manager(workspace_id) OR
    private.caller_role(workspace_id) IN ('marketing_director', 'business_owner_viewer')
);

DROP POLICY IF EXISTS p_select_monthly_report_snapshots ON public.monthly_report_snapshots;
CREATE POLICY p_select_monthly_report_snapshots ON public.monthly_report_snapshots
FOR SELECT TO authenticated
USING (
    private.is_workspace_manager(workspace_id) OR
    private.caller_role(workspace_id) IN ('marketing_director', 'business_owner_viewer')
);

-- =============================================================================
-- 3. SWEEP ALL PUBLIC FUNCTIONS TO INCLUDE company_owner ALONGSIDE owner
-- =============================================================================

DO $$
DECLARE
    r RECORD;
    v_def TEXT;
    v_new_def TEXT;
BEGIN
    FOR r IN
        SELECT p.oid, n.nspname, p.proname
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prokind = 'f'
          AND p.proname NOT IN (
              'bootstrap_owner',
              'toggle_workspace_member_active',
              'admin_hard_delete_roster_member',
              'admin_update_roster_person'
          )
    LOOP
        v_def := pg_catalog.pg_get_functiondef(r.oid);
        v_new_def := v_def;

        v_new_def := replace(v_new_def, 'v_caller.role <> ''owner''', 'v_caller.role NOT IN (''owner'', ''company_owner'')');
        v_new_def := replace(v_new_def, 'v_caller.role != ''owner''', 'v_caller.role NOT IN (''owner'', ''company_owner'')');
        v_new_def := replace(v_new_def, 'v_caller.role = ''owner''', 'v_caller.role IN (''owner'', ''company_owner'')');
        v_new_def := replace(v_new_def, 'v_caller.role NOT IN (''owner'', ''manager'')', 'v_caller.role NOT IN (''owner'', ''company_owner'', ''manager'')');
        v_new_def := replace(v_new_def, 'v_caller.role IN (''owner'', ''manager'')', 'v_caller.role IN (''owner'', ''company_owner'', ''manager'')');
        v_new_def := replace(v_new_def, 'v_caller.role NOT IN (''owner'', ''strategy_lead'')', 'v_caller.role NOT IN (''owner'', ''company_owner'', ''strategy_lead'')');
        v_new_def := replace(v_new_def, 'v_caller.role IN (''owner'', ''strategy_lead'')', 'v_caller.role IN (''owner'', ''company_owner'', ''strategy_lead'')');
        v_new_def := replace(v_new_def, 'wm.role = ''owner''', 'wm.role IN (''owner'', ''company_owner'')');
        v_new_def := replace(v_new_def, 'p_role = ''owner''', 'p_role IN (''owner'', ''company_owner'')');

        IF v_new_def IS DISTINCT FROM v_def THEN
            EXECUTE v_new_def;
        END IF;
    END LOOP;
END;
$$;

-- =============================================================================
-- 4. HARDENED CLIENT & MULTI-TRACK TEAM ASSIGNMENT RPCS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.upsert_client_team_assignment(
    p_workspace_id UUID,
    p_client_id UUID,
    p_primary_strategist_id UUID DEFAULT NULL,
    p_primary_copywriter_id UUID DEFAULT NULL,
    p_primary_designer_id UUID DEFAULT NULL,
    p_primary_video_editor_id UUID DEFAULT NULL,
    p_strategy_reviewer_id UUID DEFAULT NULL,
    p_copywriting_reviewer_id UUID DEFAULT NULL,
    p_design_reviewer_id UUID DEFAULT NULL,
    p_video_reviewer_id UUID DEFAULT NULL,
    p_marketing_director_id UUID DEFAULT NULL,
    p_strategy_lead_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL,
    p_requires_video BOOLEAN DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller RECORD;
    v_res RECORD;
    v_effective_requires_video BOOLEAN;
    v_member_id UUID;
    v_reviewer_id UUID;
BEGIN
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);

    IF v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
        RAISE EXCEPTION 'Access denied: Only Workspace Owner or Manager can configure client team assignments.';
    END IF;

    -- Validate all non-null assigned roster members are active and not deleted
    FOREACH v_member_id IN ARRAY ARRAY[
        p_primary_strategist_id,
        p_primary_copywriter_id,
        p_primary_designer_id,
        p_primary_video_editor_id,
        p_strategy_reviewer_id,
        p_copywriting_reviewer_id,
        p_design_reviewer_id,
        p_video_reviewer_id,
        p_marketing_director_id,
        p_strategy_lead_id
    ]
    LOOP
        IF v_member_id IS NOT NULL THEN
            IF NOT EXISTS (
                SELECT 1 FROM public.roster_people rp
                WHERE rp.workspace_id = p_workspace_id
                  AND rp.id = v_member_id
                  AND rp.is_active = TRUE
                  AND TRUE
            ) THEN
                RAISE EXCEPTION 'لا يمكن إسناد عميل إلى عضو معطل أو محذوف.';
            END IF;
        END IF;
    END LOOP;

    -- Enforce that Marketing Director cannot be assigned as a reviewer
    FOREACH v_reviewer_id IN ARRAY ARRAY[
        p_strategy_reviewer_id,
        p_copywriting_reviewer_id,
        p_design_reviewer_id,
        p_video_reviewer_id
    ]
    LOOP
        IF v_reviewer_id IS NOT NULL THEN
            IF EXISTS (
                SELECT 1 FROM public.roster_people rp
                LEFT JOIN public.workspace_memberships wm
                  ON wm.workspace_id = rp.workspace_id AND wm.roster_person_id = rp.id AND wm.is_active = TRUE
                WHERE rp.workspace_id = p_workspace_id
                  AND rp.id = v_reviewer_id
                  AND (rp.role = 'marketing_director' OR wm.role = 'marketing_director')
            ) THEN
                RAISE EXCEPTION 'Permission denied: Marketing Director cannot be assigned as a reviewer.';
            END IF;
        END IF;
    END LOOP;

    v_effective_requires_video := COALESCE(
        p_requires_video,
        (p_primary_video_editor_id IS NOT NULL OR p_video_reviewer_id IS NOT NULL),
        false
    );

    INSERT INTO public.client_team_assignments (
        workspace_id,
        client_id,
        primary_strategist_id,
        primary_copywriter_id,
        primary_designer_id,
        primary_video_editor_id,
        strategy_reviewer_id,
        copywriting_reviewer_id,
        design_reviewer_id,
        video_reviewer_id,
        marketing_director_id,
        strategy_lead_id,
        requires_video,
        updated_at
    ) VALUES (
        p_workspace_id,
        p_client_id,
        p_primary_strategist_id,
        p_primary_copywriter_id,
        p_primary_designer_id,
        p_primary_video_editor_id,
        p_strategy_reviewer_id,
        p_copywriting_reviewer_id,
        p_design_reviewer_id,
        p_video_reviewer_id,
        p_marketing_director_id,
        p_strategy_lead_id,
        v_effective_requires_video,
        pg_catalog.now()
    )
    ON CONFLICT (workspace_id, client_id)
    DO UPDATE SET
        primary_strategist_id = EXCLUDED.primary_strategist_id,
        primary_copywriter_id = EXCLUDED.primary_copywriter_id,
        primary_designer_id = EXCLUDED.primary_designer_id,
        primary_video_editor_id = EXCLUDED.primary_video_editor_id,
        strategy_reviewer_id = EXCLUDED.strategy_reviewer_id,
        copywriting_reviewer_id = EXCLUDED.copywriting_reviewer_id,
        design_reviewer_id = EXCLUDED.design_reviewer_id,
        video_reviewer_id = EXCLUDED.video_reviewer_id,
        marketing_director_id = EXCLUDED.marketing_director_id,
        strategy_lead_id = EXCLUDED.strategy_lead_id,
        requires_video = EXCLUDED.requires_video,
        updated_at = pg_catalog.now()
    RETURNING * INTO v_res;

    -- Always synchronize clients.owner_roster_id with primary_designer_id and bump updated_at for Realtime
    UPDATE public.clients
    SET owner_roster_id = p_primary_designer_id,
        updated_at = pg_catalog.now()
    WHERE id = p_client_id AND workspace_id = p_workspace_id;

    RETURN to_jsonb(v_res);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION public.upsert_client_team_assignment(UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, TEXT, BOOLEAN) TO authenticated, service_role;

-- Update create_client to provide clean duplicate-name messaging and active assignee validation
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
    v_clean_name TEXT;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'Idempotency key cannot be blank.';
    END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can create clients.';
    END IF;

    v_clean_name := btrim(COALESCE(p_name, ''));
    IF v_clean_name = '' THEN
        RAISE EXCEPTION 'Client name cannot be empty.';
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        v_payload := jsonb_build_object(
            'p_workspace_id', p_workspace_id,
            'p_name', v_clean_name,
            'p_owner_roster_id', p_owner_roster_id,
            'p_difficulty', p_difficulty,
            'p_extra_workload', p_extra_workload,
            'p_state', p_state,
            'p_notes', p_notes,
            'p_brand_guide_url', p_brand_guide_url,
            'p_brief_url', p_brief_url
        );
        v_hash := pg_catalog.encode(extensions.digest(v_payload::text, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(p_workspace_id, v_caller.roster_person_id, 'create_client', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    IF p_owner_roster_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.roster_people rp
            WHERE rp.workspace_id = p_workspace_id
              AND rp.id = p_owner_roster_id
              AND rp.is_active = TRUE
              AND TRUE
        ) THEN
            RAISE EXCEPTION 'لا يمكن إسناد عميل إلى عضو معطل أو محذوف.';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.clients c
        WHERE c.workspace_id = p_workspace_id
          AND btrim(c.name) = v_clean_name
    ) THEN
        RAISE EXCEPTION 'اسم العميل مسجل بالفعل في مساحة العمل.';
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
        v_clean_name,
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
        jsonb_build_object('name', v_clean_name, 'difficulty', p_difficulty)
    );

    v_result := jsonb_build_object('success', TRUE, 'client_id', v_client_id);
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM private.fn_record_idempotency(p_workspace_id, v_caller.roster_person_id, 'create_client', p_idempotency_key, v_hash, v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION public.create_client(UUID, TEXT, UUID, public.client_difficulty, public.client_extra_workload, public.client_state, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- Atomic Client + Team Assignment + Brief Creation RPC
CREATE OR REPLACE FUNCTION public.create_client_atomic(
    p_workspace_id UUID,
    p_name TEXT,
    p_owner_roster_id UUID DEFAULT NULL,
    p_difficulty public.client_difficulty DEFAULT 'Medium',
    p_extra_workload public.client_extra_workload DEFAULT 'None',
    p_state public.client_state DEFAULT 'Active',
    p_notes TEXT DEFAULT NULL,
    p_brand_guide_url TEXT DEFAULT NULL,
    p_brief_url TEXT DEFAULT NULL,
    p_team_assignments JSONB DEFAULT NULL,
    p_brief JSONB DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_client_res JSONB;
    v_client_id UUID;
    v_primary_designer_id UUID;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'Idempotency key cannot be blank.';
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;

    IF v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can create clients.';
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        v_payload := jsonb_build_object(
            'p_workspace_id', p_workspace_id,
            'p_name', btrim(COALESCE(p_name, '')),
            'p_owner_roster_id', p_owner_roster_id,
            'p_difficulty', p_difficulty,
            'p_extra_workload', p_extra_workload,
            'p_state', p_state
        );
        v_hash := pg_catalog.encode(extensions.digest(v_payload::text, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(p_workspace_id, v_caller.roster_person_id, 'create_client_atomic', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    v_primary_designer_id := COALESCE(
        public.safe_cast_uuid(p_team_assignments ->> 'primaryDesignerId'),
        p_owner_roster_id
    );

    -- 1. Create client row (without inner idempotency collision since outer lock is held)
    v_client_res := public.create_client(
        p_workspace_id => p_workspace_id,
        p_name => p_name,
        p_owner_roster_id => v_primary_designer_id,
        p_difficulty => p_difficulty,
        p_extra_workload => p_extra_workload,
        p_state => p_state,
        p_notes => p_notes,
        p_brand_guide_url => p_brand_guide_url,
        p_brief_url => p_brief_url,
        p_idempotency_key => NULL
    );

    v_client_id := (v_client_res ->> 'client_id')::UUID;

    -- 2. Upsert multi-track team assignments in the same transaction
    IF p_team_assignments IS NOT NULL OR v_primary_designer_id IS NOT NULL THEN
        PERFORM public.upsert_client_team_assignment(
            p_workspace_id => p_workspace_id,
            p_client_id => v_client_id,
            p_primary_strategist_id => public.safe_cast_uuid(p_team_assignments ->> 'primaryStrategistId'),
            p_primary_copywriter_id => public.safe_cast_uuid(p_team_assignments ->> 'primaryCopywriterId'),
            p_primary_designer_id => v_primary_designer_id,
            p_primary_video_editor_id => public.safe_cast_uuid(p_team_assignments ->> 'primaryVideoEditorId'),
            p_strategy_reviewer_id => public.safe_cast_uuid(p_team_assignments ->> 'strategyReviewerId'),
            p_copywriting_reviewer_id => public.safe_cast_uuid(p_team_assignments ->> 'copywritingReviewerId'),
            p_design_reviewer_id => public.safe_cast_uuid(p_team_assignments ->> 'designReviewerId'),
            p_video_reviewer_id => public.safe_cast_uuid(p_team_assignments ->> 'videoReviewerId'),
            p_marketing_director_id => public.safe_cast_uuid(p_team_assignments ->> 'marketingDirectorId'),
            p_strategy_lead_id => public.safe_cast_uuid(p_team_assignments ->> 'strategyLeadId'),
            p_idempotency_key => NULL,
            p_requires_video => CASE
                WHEN p_team_assignments ? 'requiresVideo' AND jsonb_typeof(p_team_assignments -> 'requiresVideo') = 'boolean'
                THEN (p_team_assignments ->> 'requiresVideo')::BOOLEAN
                ELSE NULL
            END
        );
    END IF;

    -- 3. Upsert initial client brief in the same transaction if provided
    IF p_brief IS NOT NULL AND jsonb_typeof(p_brief) = 'object' THEN
        PERFORM public.upsert_client_brief(
            p_workspace_id => p_workspace_id,
            p_client_id => v_client_id,
            p_objectives => NULLIF(btrim(COALESCE(p_brief ->> 'objectives', '')), ''),
            p_target_audience => NULLIF(btrim(COALESCE(p_brief ->> 'targetAudience', '')), ''),
            p_products_services => NULLIF(btrim(COALESCE(p_brief ->> 'productsServices', '')), ''),
            p_tone_of_voice => NULLIF(btrim(COALESCE(p_brief ->> 'toneOfVoice', '')), ''),
            p_content_pillars => CASE
                WHEN p_brief ? 'contentPillars' AND jsonb_typeof(p_brief -> 'contentPillars') = 'array'
                THEN ARRAY(SELECT jsonb_array_elements_text(p_brief -> 'contentPillars'))
                ELSE '{}'::TEXT[]
            END,
            p_dos_and_donts => NULLIF(btrim(COALESCE(p_brief ->> 'dosAndDonts', '')), ''),
            p_brand_guidelines_url => NULLIF(btrim(COALESCE(p_brief ->> 'brandGuidelinesUrl', '')), ''),
            p_assets_drive_url => NULLIF(btrim(COALESCE(p_brief ->> 'assetsDriveUrl', '')), ''),
            p_strategy_summary => NULLIF(btrim(COALESCE(p_brief ->> 'strategySummary', '')), ''),
            p_idempotency_key => NULL
        );
    END IF;

    v_result := jsonb_build_object('success', TRUE, 'client_id', v_client_id);
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM private.fn_record_idempotency(p_workspace_id, v_caller.roster_person_id, 'create_client_atomic', p_idempotency_key, v_hash, v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.create_client_atomic(UUID, TEXT, UUID, public.client_difficulty, public.client_extra_workload, public.client_state, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_client_atomic(UUID, TEXT, UUID, public.client_difficulty, public.client_extra_workload, public.client_state, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT) TO authenticated, service_role;

-- Update update_client to sync client_team_assignments.primary_designer_id without overwriting other tracks
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
    IF v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can update clients.';
    END IF;
    IF p_idempotency_key IS NOT NULL THEN
        v_payload := jsonb_build_object('p_workspace_id', p_workspace_id, 'p_client_id', p_client_id, 'p_name', p_name, 'p_owner_roster_id', p_owner_roster_id, 'p_difficulty', p_difficulty, 'p_extra_workload', p_extra_workload, 'p_state', p_state, 'p_notes', p_notes, 'p_brand_guide_url', p_brand_guide_url, 'p_brief_url', p_brief_url, 'p_reassign_open_tasks', p_reassign_open_tasks);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::text,'sha256'),'hex');
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

    IF p_owner_roster_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.roster_people rp
            WHERE rp.workspace_id = p_workspace_id
              AND rp.id = p_owner_roster_id
              AND rp.is_active = TRUE
              AND TRUE
        ) THEN
            RAISE EXCEPTION 'لا يمكن إسناد عميل إلى عضو معطل أو محذوف.';
        END IF;
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

    -- Sync primary_designer_id in client_team_assignments without touching video/strategy/copywriting tracks
    IF p_owner_roster_id IS NOT NULL THEN
        INSERT INTO public.client_team_assignments (
            workspace_id, client_id, primary_designer_id, updated_at
        ) VALUES (
            p_workspace_id, p_client_id, p_owner_roster_id, pg_catalog.now()
        )
        ON CONFLICT (workspace_id, client_id)
        DO UPDATE SET
            primary_designer_id = EXCLUDED.primary_designer_id,
            updated_at = pg_catalog.now();
    END IF;

    -- Confirmed open design tasks reassignment workflow (only when explicitly requested)
    IF p_reassign_open_tasks AND p_owner_roster_id IS NOT NULL AND p_owner_roster_id <> COALESCE(v_client.owner_roster_id, '00000000-0000-0000-0000-000000000000'::UUID) THEN
        FOR v_t IN (
            SELECT id, primary_assignee_id FROM public.tasks
            WHERE workspace_id = p_workspace_id
              AND client_id = p_client_id
              AND COALESCE(work_stage, 'design') = 'design'
              AND status NOT IN ('delivered', 'cancelled')
        ) LOOP
            UPDATE public.tasks
            SET primary_assignee_id = p_owner_roster_id, updated_at = pg_catalog.now()
            WHERE id = v_t.id;

            INSERT INTO public.task_assignment_events (
                workspace_id, task_id, previous_assignee_id, new_assignee_id, actor_id, reason
            ) VALUES (
                p_workspace_id, v_t.id, v_t.primary_assignee_id, p_owner_roster_id, v_caller.roster_person_id, 'Reassigned due to client designer change'
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

-- =============================================================================
-- 5. HARDENED CLIENT BRIEF, REVIEW & DELIVERABLE RPCS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.upsert_client_brief(
    p_workspace_id UUID,
    p_client_id UUID,
    p_objectives TEXT DEFAULT NULL,
    p_target_audience TEXT DEFAULT NULL,
    p_products_services TEXT DEFAULT NULL,
    p_tone_of_voice TEXT DEFAULT NULL,
    p_content_pillars TEXT[] DEFAULT '{}',
    p_dos_and_donts TEXT DEFAULT NULL,
    p_brand_guidelines_url TEXT DEFAULT NULL,
    p_assets_drive_url TEXT DEFAULT NULL,
    p_strategy_summary TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller RECORD;
    v_res RECORD;
BEGIN
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);

    IF v_caller.role IN ('marketing_director', 'business_owner_viewer') THEN
        RAISE EXCEPTION 'Permission denied: Your role is read-only and cannot modify client briefs.';
    END IF;

    INSERT INTO public.client_briefs (
        workspace_id,
        client_id,
        objectives,
        target_audience,
        products_services,
        tone_of_voice,
        content_pillars,
        dos_and_donts,
        brand_guidelines_url,
        assets_drive_url,
        strategy_summary,
        updated_at
    ) VALUES (
        p_workspace_id,
        p_client_id,
        p_objectives,
        p_target_audience,
        p_products_services,
        p_tone_of_voice,
        p_content_pillars,
        p_dos_and_donts,
        p_brand_guidelines_url,
        p_assets_drive_url,
        p_strategy_summary,
        pg_catalog.now()
    )
    ON CONFLICT (workspace_id, client_id)
    DO UPDATE SET
        objectives = COALESCE(EXCLUDED.objectives, public.client_briefs.objectives),
        target_audience = COALESCE(EXCLUDED.target_audience, public.client_briefs.target_audience),
        products_services = COALESCE(EXCLUDED.products_services, public.client_briefs.products_services),
        tone_of_voice = COALESCE(EXCLUDED.tone_of_voice, public.client_briefs.tone_of_voice),
        content_pillars = CASE WHEN EXCLUDED.content_pillars <> '{}' THEN EXCLUDED.content_pillars ELSE public.client_briefs.content_pillars END,
        dos_and_donts = COALESCE(EXCLUDED.dos_and_donts, public.client_briefs.dos_and_donts),
        brand_guidelines_url = COALESCE(EXCLUDED.brand_guidelines_url, public.client_briefs.brand_guidelines_url),
        assets_drive_url = COALESCE(EXCLUDED.assets_drive_url, public.client_briefs.assets_drive_url),
        strategy_summary = COALESCE(EXCLUDED.strategy_summary, public.client_briefs.strategy_summary),
        updated_at = pg_catalog.now()
    RETURNING * INTO v_res;

    RETURN jsonb_build_object(
        'success', TRUE,
        'client_id', p_client_id,
        'brief', row_to_json(v_res)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION public.approve_client_brief_strategy(
    p_workspace_id UUID,
    p_client_id UUID,
    p_approved_content TEXT,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller RECORD;
    v_brief RECORD;
    v_new_version INT;
BEGIN
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);

    -- Only Owner or Company Owner can grant final workspace strategy approval
    IF v_caller.role NOT IN ('owner', 'company_owner') THEN
        RAISE EXCEPTION 'Access denied: Only Workspace Owner can grant final workspace strategy approval.';
    END IF;

    SELECT * INTO v_brief FROM public.client_briefs
    WHERE workspace_id = p_workspace_id AND client_id = p_client_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Client brief not found.';
    END IF;

    IF v_brief.status <> 'reviewed' AND v_brief.status <> 'approved' THEN
        RAISE EXCEPTION 'Prerequisite not met: Strategy must pass operational review by Strategy Lead before final workspace approval.';
    END IF;

    v_new_version := COALESCE(v_brief.strategy_version, 0) + 1;

    UPDATE public.client_briefs
    SET status = 'approved',
        approved_strategy_content = p_approved_content,
        strategy_version = v_new_version,
        approved_by_roster_id = v_caller.roster_person_id,
        approved_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE workspace_id = p_workspace_id AND client_id = p_client_id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'client_id', p_client_id,
        'status', 'approved',
        'strategy_version', v_new_version,
        'approved_by', v_caller.roster_person_id,
        'approved_at', pg_catalog.now()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION public.review_client_brief_operational(
    p_workspace_id UUID,
    p_client_id UUID,
    p_decision TEXT DEFAULT 'approved',
    p_feedback TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller RECORD;
    v_brief RECORD;
    v_team RECORD;
BEGIN
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);

    IF v_caller.role IN ('marketing_director', 'business_owner_viewer') THEN
        RAISE EXCEPTION 'Access denied: Marketing Director and Viewers cannot perform operational reviews.';
    END IF;

    SELECT * INTO v_brief FROM public.client_briefs
    WHERE workspace_id = p_workspace_id AND client_id = p_client_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Client brief not found.';
    END IF;

    SELECT * INTO v_team FROM public.client_team_assignments
    WHERE workspace_id = p_workspace_id AND client_id = p_client_id;

    IF v_caller.role NOT IN ('owner', 'company_owner', 'strategy_lead')
       AND v_caller.roster_person_id <> COALESCE(v_team.strategy_lead_id, '00000000-0000-0000-0000-000000000000'::UUID)
       AND v_caller.roster_person_id <> COALESCE(v_team.strategy_reviewer_id, '00000000-0000-0000-0000-000000000000'::UUID) THEN
        RAISE EXCEPTION 'Access denied: Only Strategy Lead (Arwa) or designated Strategy Reviewer can perform operational review.';
    END IF;

    IF p_decision = 'approved' THEN
        UPDATE public.client_briefs
        SET status = 'reviewed',
            operational_review_by = v_caller.roster_person_id,
            operational_review_at = pg_catalog.now(),
            operational_feedback = p_feedback,
            updated_at = pg_catalog.now()
        WHERE workspace_id = p_workspace_id AND client_id = p_client_id;
    ELSE
        UPDATE public.client_briefs
        SET status = 'in_review',
            operational_feedback = p_feedback,
            updated_at = pg_catalog.now()
        WHERE workspace_id = p_workspace_id AND client_id = p_client_id;
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE,
        'client_id', p_client_id,
        'status', CASE WHEN p_decision = 'approved' THEN 'reviewed' ELSE 'in_review' END,
        'reviewed_by', v_caller.roster_person_id,
        'reviewed_at', pg_catalog.now()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Unified decide_review_round: Marketing Director block + company_owner support + notifications + audit events
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

    IF v_caller.role IN ('marketing_director', 'business_owner_viewer') THEN
        RAISE EXCEPTION 'Permission denied: Marketing Director cannot decide review rounds or request changes.';
    END IF;

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
        IF v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
            RAISE EXCEPTION 'Only Owner or Manager can record decisions for client review rounds.';
        END IF;
    ELSE
        IF v_caller.roster_person_id <> v_round.reviewer_id AND v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
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

    IF p_decision = 'approved' THEN
        UPDATE public.time_entries
        SET ended_at = pg_catalog.now(),
            duration_seconds = EXTRACT(EPOCH FROM (pg_catalog.now() - started_at))::INT,
            updated_at = pg_catalog.now()
        WHERE task_id = v_task.id
          AND ended_at IS NULL
          AND is_voided = FALSE;
    END IF;

    UPDATE public.tasks
    SET status = v_new_task_status,
        updated_at = pg_catalog.now()
    WHERE id = v_task.id;

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
                 THEN 'تم اعتماد المهمة "' || v_task.title || '".'
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
        'review_round_id', v_round.id,
        'task_id', v_task.id,
        'decision', p_decision,
        'status', v_new_task_status,
        'task_status', v_new_task_status,
        'new_status', v_new_task_status
    );

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'decide_review_round', p_idempotency_key, v_hash, v_result);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Hardened submit_task_deliverable: safe review_round creation & reviewer resolution
CREATE OR REPLACE FUNCTION public.submit_task_deliverable(
    p_task_id UUID,
    p_deliverable_type TEXT,
    p_title TEXT DEFAULT NULL,
    p_body_content TEXT DEFAULT NULL,
    p_payload JSONB DEFAULT '{}'::jsonb,
    p_deliverable_url TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_task RECORD;
    v_caller RECORD;
    v_next_ver INT;
    v_deliv_id UUID;
    v_next_round_num INT;
    v_reviewer_id UUID;
    v_exclude_ids UUID[];
    v_round_id UUID;
BEGIN
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Task not found.'; END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_task.workspace_id);

    IF v_caller.role IN ('marketing_director', 'business_owner_viewer') THEN
        RAISE EXCEPTION 'Access denied: Your role cannot submit deliverables.';
    END IF;

    IF NOT private.can_work_on_task(p_task_id) AND v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
        RAISE EXCEPTION 'Access denied: You are not assigned to this task.';
    END IF;

    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_ver
    FROM public.task_deliverables
    WHERE task_id = p_task_id;

    INSERT INTO public.task_deliverables (
        workspace_id,
        task_id,
        version_number,
        deliverable_type,
        title,
        body_content,
        payload,
        deliverable_url,
        notes,
        submitted_by_id
    ) VALUES (
        v_task.workspace_id,
        p_task_id,
        v_next_ver,
        p_deliverable_type,
        p_title,
        p_body_content,
        p_payload,
        p_deliverable_url,
        p_notes,
        v_caller.roster_person_id
    ) RETURNING id INTO v_deliv_id;

    -- Auto-stop any active timer for caller on this task
    UPDATE public.time_entries
    SET ended_at = pg_catalog.now(),
        duration_seconds = EXTRACT(EPOCH FROM (pg_catalog.now() - started_at))::INT,
        updated_at = pg_catalog.now()
    WHERE workspace_id = v_task.workspace_id
      AND roster_person_id = v_caller.roster_person_id
      AND task_id = p_task_id
      AND ended_at IS NULL
      AND is_voided = FALSE;

    -- Transition task status to internal_review
    UPDATE public.tasks
    SET status = 'internal_review',
        updated_at = pg_catalog.now()
    WHERE id = p_task_id;

    -- Create pending review round if none is currently pending
    SELECT id INTO v_round_id
    FROM public.review_rounds
    WHERE task_id = p_task_id AND decision = 'pending'
    LIMIT 1;

    IF v_round_id IS NULL THEN
        SELECT ARRAY_AGG(roster_person_id) INTO v_exclude_ids
        FROM (
            SELECT v_task.primary_assignee_id AS roster_person_id WHERE v_task.primary_assignee_id IS NOT NULL
            UNION
            SELECT v_caller.roster_person_id AS roster_person_id
            UNION
            SELECT roster_person_id FROM public.task_collaborators WHERE task_id = p_task_id
        ) t;

        IF v_task.reviewer_id IS NOT NULL AND v_task.reviewer_id <> v_caller.roster_person_id THEN
            v_reviewer_id := v_task.reviewer_id;
        ELSE
            v_reviewer_id := private.resolve_task_reviewer(
                v_task.workspace_id,
                p_task_id,
                COALESCE(v_task.primary_assignee_id, v_caller.roster_person_id),
                v_exclude_ids
            );
        END IF;

        IF v_reviewer_id IS NULL OR v_reviewer_id = v_caller.roster_person_id THEN
            SELECT rp.id INTO v_reviewer_id
            FROM public.roster_people rp
            LEFT JOIN public.workspace_memberships wm
              ON wm.workspace_id = rp.workspace_id AND wm.roster_person_id = rp.id AND wm.is_active = TRUE
            WHERE rp.workspace_id = v_task.workspace_id
              AND rp.is_active = TRUE
              AND TRUE
              AND rp.id <> v_caller.roster_person_id
              AND COALESCE(wm.role, rp.role) IN ('owner', 'company_owner', 'manager', 'senior_reviewer', 'strategy_lead')
            ORDER BY CASE WHEN COALESCE(wm.role, rp.role) IN ('owner', 'company_owner') THEN 0 ELSE 1 END
            LIMIT 1;
        END IF;

        IF v_reviewer_id IS NOT NULL AND v_reviewer_id <> v_caller.roster_person_id THEN
            SELECT COALESCE(MAX(round_number), 0) + 1 INTO v_next_round_num
            FROM public.review_rounds
            WHERE task_id = p_task_id;

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
                v_task.workspace_id,
                p_task_id,
                v_next_round_num,
                'internal',
                v_caller.roster_person_id,
                COALESCE(p_deliverable_url, 'https://workspace.internal/deliverable/' || v_deliv_id::TEXT),
                p_notes,
                v_reviewer_id,
                'pending'
            ) RETURNING id INTO v_round_id;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE,
        'deliverable_id', v_deliv_id,
        'round_id', v_round_id,
        'version_number', v_next_ver,
        'status', 'internal_review'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Hardened set_task_waiting_state
CREATE OR REPLACE FUNCTION public.set_task_waiting_state(
    p_task_id UUID,
    p_is_waiting BOOLEAN,
    p_waiting_reason TEXT DEFAULT NULL,
    p_waiting_on_roster_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_task RECORD;
    v_caller RECORD;
BEGIN
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Task not found.'; END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_task.workspace_id);

    IF v_caller.role IN ('marketing_director', 'business_owner_viewer') THEN
        RAISE EXCEPTION 'Access denied: Your role is read-only and cannot modify task waiting state.';
    END IF;

    IF NOT private.can_work_on_task(p_task_id) AND v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
        RAISE EXCEPTION 'Access denied: You are not assigned to this task.';
    END IF;

    IF p_is_waiting THEN
        IF p_waiting_reason IS NULL OR btrim(p_waiting_reason) = '' THEN
            RAISE EXCEPTION 'Waiting reason is mandatory when pausing work.';
        END IF;

        UPDATE public.time_entries
        SET ended_at = pg_catalog.now(),
            duration_seconds = EXTRACT(EPOCH FROM (pg_catalog.now() - started_at))::INT,
            updated_at = pg_catalog.now()
        WHERE workspace_id = v_task.workspace_id
          AND roster_person_id = v_caller.roster_person_id
          AND task_id = p_task_id
          AND ended_at IS NULL
          AND is_voided = FALSE;

        UPDATE public.tasks
        SET is_waiting = TRUE,
            waiting_reason = p_waiting_reason,
            waiting_since = pg_catalog.now(),
            waiting_on_roster_id = p_waiting_on_roster_id,
            updated_at = pg_catalog.now()
        WHERE id = p_task_id;
    ELSE
        UPDATE public.tasks
        SET is_waiting = FALSE,
            waiting_reason = NULL,
            waiting_since = NULL,
            waiting_on_roster_id = NULL,
            updated_at = pg_catalog.now()
        WHERE id = p_task_id;
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE,
        'task_id', p_task_id,
        'is_waiting', p_is_waiting
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Hardened approve_copywriting_and_unlock_downstream
CREATE OR REPLACE FUNCTION public.approve_copywriting_and_unlock_downstream(
    p_copy_task_id UUID,
    p_approved_copy TEXT,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_copy_task RECORD;
    v_caller RECORD;
    v_cci_id UUID;
    v_downstream_unlocked INT := 0;
BEGIN
    SELECT * INTO v_copy_task FROM public.tasks WHERE id = p_copy_task_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Copywriting task not found.'; END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_copy_task.workspace_id);

    IF v_caller.role IN ('marketing_director', 'business_owner_viewer') THEN
        RAISE EXCEPTION 'Permission denied: Marketing Director and Viewers cannot approve copywriting deliverables.';
    END IF;

    -- Must be designated reviewer or management/review lead
    IF v_caller.roster_person_id IS DISTINCT FROM v_copy_task.reviewer_id
       AND v_caller.role NOT IN ('owner', 'company_owner', 'manager', 'senior_reviewer', 'strategy_lead') THEN
        RAISE EXCEPTION 'Permission denied: Only the designated reviewer or management can approve copywriting.';
    END IF;

    -- Anti-self-approval (except Owner / Company Owner bypass)
    IF v_copy_task.primary_assignee_id = v_caller.roster_person_id
       AND v_caller.role NOT IN ('owner', 'company_owner') THEN
        RAISE EXCEPTION 'Anti-Self-Approval violation: You cannot approve your own copywriting work.';
    END IF;

    UPDATE public.tasks
    SET status = 'approved',
        final_deliverable_url = COALESCE(final_deliverable_url, 'approved-copy-text'),
        updated_at = pg_catalog.now()
    WHERE id = p_copy_task_id;

    UPDATE public.review_rounds
    SET decision = 'approved',
        decided_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE task_id = p_copy_task_id AND decision = 'pending';

    v_cci_id := v_copy_task.content_calendar_item_id;
    IF v_cci_id IS NOT NULL THEN
        UPDATE public.content_calendar_items
        SET on_design_text = COALESCE(p_approved_copy, on_design_text),
            updated_at = pg_catalog.now()
        WHERE id = v_cci_id;
    END IF;

    UPDATE public.tasks
    SET status = 'ready',
        is_waiting = FALSE,
        waiting_reason = NULL,
        updated_at = pg_catalog.now()
    WHERE workspace_id = v_copy_task.workspace_id
      AND (dependency_task_id = p_copy_task_id OR (v_cci_id IS NOT NULL AND content_calendar_item_id = v_cci_id AND work_stage IN ('design', 'video_editing')))
      AND status IN ('backlog', 'blocked');

    GET DIAGNOSTICS v_downstream_unlocked = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', TRUE,
        'copy_task_id', p_copy_task_id,
        'downstream_unlocked_count', v_downstream_unlocked
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- =============================================================================
-- 6. HARDENED RLS POLICIES ON AGENCY EXPANSION & DEADLINE TABLES
-- =============================================================================

-- client_team_assignments: all active members can read; only management can mutate
DROP POLICY IF EXISTS p_cta_workspace_members ON public.client_team_assignments;
DROP POLICY IF EXISTS p_select_client_team_assignments ON public.client_team_assignments;
DROP POLICY IF EXISTS p_manage_client_team_assignments ON public.client_team_assignments;

CREATE POLICY p_select_client_team_assignments ON public.client_team_assignments
FOR SELECT TO authenticated
USING (
    private.is_workspace_member(workspace_id)
);

CREATE POLICY p_manage_client_team_assignments ON public.client_team_assignments
FOR ALL TO authenticated
USING (
    private.is_workspace_manager(workspace_id)
)
WITH CHECK (
    private.is_workspace_manager(workspace_id)
);

-- client_briefs: all active members can read; read-only roles (marketing_director, business_owner_viewer) cannot mutate
DROP POLICY IF EXISTS p_cb_workspace_members ON public.client_briefs;
DROP POLICY IF EXISTS p_select_client_briefs ON public.client_briefs;
DROP POLICY IF EXISTS p_write_client_briefs ON public.client_briefs;

CREATE POLICY p_select_client_briefs ON public.client_briefs
FOR SELECT TO authenticated
USING (
    private.is_workspace_member(workspace_id)
);

CREATE POLICY p_write_client_briefs ON public.client_briefs
FOR ALL TO authenticated
USING (
    private.is_workspace_member(workspace_id) AND
    private.caller_role(workspace_id) NOT IN ('marketing_director', 'business_owner_viewer')
)
WITH CHECK (
    private.is_workspace_member(workspace_id) AND
    private.caller_role(workspace_id) NOT IN ('marketing_director', 'business_owner_viewer')
);

-- task_deliverables: accessible to task participants/management; writable only by active task workers
DROP POLICY IF EXISTS p_td_workspace_members ON public.task_deliverables;
DROP POLICY IF EXISTS p_select_task_deliverables ON public.task_deliverables;
DROP POLICY IF EXISTS p_insert_task_deliverables ON public.task_deliverables;
DROP POLICY IF EXISTS p_delete_task_deliverables ON public.task_deliverables;

CREATE POLICY p_select_task_deliverables ON public.task_deliverables
FOR SELECT TO authenticated
USING (
    private.can_access_task(task_id)
);

CREATE POLICY p_insert_task_deliverables ON public.task_deliverables
FOR INSERT TO authenticated
WITH CHECK (
    private.can_work_on_task(task_id)
);

CREATE POLICY p_delete_task_deliverables ON public.task_deliverables
FOR DELETE TO authenticated
USING (
    private.is_workspace_manager(workspace_id)
);

-- workspace_deadline_settings: owner & company_owner can manage
DROP POLICY IF EXISTS "workspace_deadline_settings_owner_manage" ON public.workspace_deadline_settings;
CREATE POLICY "workspace_deadline_settings_owner_manage"
ON public.workspace_deadline_settings
FOR ALL TO authenticated
USING (
    private.is_workspace_owner(workspace_id)
)
WITH CHECK (
    private.is_workspace_owner(workspace_id)
);

-- =============================================================================
-- 7. HARDENED TASK CREATION, REASSIGNMENT & CALENDAR IMPORT RPCS
-- =============================================================================

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
    v_work_stage TEXT := 'design';
    v_assignee_role public.roster_role;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;

    IF v_caller.role IN ('marketing_director', 'business_owner_viewer') THEN
        RAISE EXCEPTION 'Permission denied: Your role is read-only and cannot create tasks.';
    END IF;

    IF p_title IS NULL OR btrim(p_title) = '' THEN
        RAISE EXCEPTION 'Task title cannot be empty.';
    END IF;

    IF v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
        IF p_primary_assignee_id IS NOT NULL AND p_primary_assignee_id <> v_caller.roster_person_id THEN
            RAISE EXCEPTION 'Members can only assign newly created tasks to themselves.';
        END IF;
    END IF;

    IF p_primary_assignee_id IS NOT NULL THEN
        SELECT rp.role INTO v_assignee_role
        FROM public.roster_people rp
        WHERE rp.workspace_id = p_workspace_id
          AND rp.id = p_primary_assignee_id
          AND rp.is_active = TRUE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'لا يمكن إسناد مهمة إلى عضو معطل أو محذوف.';
        END IF;
    END IF;

    IF p_reviewer_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.roster_people rp
            WHERE rp.workspace_id = p_workspace_id
              AND rp.id = p_reviewer_id
              AND rp.is_active = TRUE
              AND TRUE
              AND COALESCE(rp.role, 'designer') <> 'marketing_director'
        ) THEN
            RAISE EXCEPTION 'المراجع المختار غير نشط أو غير مصرح له بالمراجعة.';
        END IF;
    END IF;

    -- Infer work_stage from assignee role or deliverable format
    IF v_assignee_role = 'video_editor' OR lower(COALESCE(p_deliverable_format, '')) ~ '(reel|video|motion|فيديو|ريل)' THEN
        v_work_stage := 'video_editing';
    ELSIF v_assignee_role = 'content_writer' THEN
        v_work_stage := 'copywriting';
    ELSIF v_assignee_role IN ('strategist', 'strategy_lead') THEN
        v_work_stage := 'strategy';
    ELSE
        v_work_stage := 'design';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_workspace_id', p_workspace_id, 'p_client_id', p_client_id, 'p_campaign_id', p_campaign_id, 'p_title', p_title, 'p_brief', p_brief, 'p_description', p_description, 'p_deliverable_format', p_deliverable_format, 'p_deliverable_number', p_deliverable_number, 'p_priority', p_priority, 'p_primary_assignee_id', p_primary_assignee_id, 'p_reviewer_id', p_reviewer_id, 'p_due_date', p_due_date, 'p_estimated_hours', p_estimated_hours, 'p_working_file_url', p_working_file_url, 'p_reference_urls', p_reference_urls);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(p_workspace_id, v_caller.roster_person_id, 'create_task_rpc', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.clients WHERE workspace_id = p_workspace_id AND id = p_client_id) THEN
        RAISE EXCEPTION 'Client not found in workspace.';
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
        v_work_stage,
        p_primary_assignee_id,
        p_reviewer_id,
        p_due_date,
        p_estimated_hours,
        p_working_file_url,
        COALESCE(p_reference_urls, '{}'::TEXT[]),
        v_caller.roster_person_id
    ) RETURNING id INTO v_task_id;

    INSERT INTO public.task_status_events (
        workspace_id, task_id, from_status, to_status, actor_id, reason
    ) VALUES (
        p_workspace_id, v_task_id, NULL, 'backlog', v_caller.roster_person_id, 'Task created'
    );

    IF p_primary_assignee_id IS NOT NULL THEN
        INSERT INTO public.task_assignment_events (
            workspace_id, task_id, previous_assignee_id, new_assignee_id, actor_id, reason
        ) VALUES (
            p_workspace_id, v_task_id, NULL, p_primary_assignee_id, v_caller.roster_person_id, 'Initial task assignment'
        );
    END IF;

    IF p_due_date IS NOT NULL THEN
        INSERT INTO public.task_due_date_events (
            workspace_id, task_id, previous_due_date, new_due_date, actor_id, reason
        ) VALUES (
            p_workspace_id, v_task_id, NULL, p_due_date, v_caller.roster_person_id, 'Initial task due date'
        );
    END IF;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        p_workspace_id, v_caller.roster_person_id, 'create_task', 'tasks', v_task_id,
        jsonb_build_object('title', p_title, 'client_id', p_client_id, 'work_stage', v_work_stage, 'deliverable_number', COALESCE(p_deliverable_number, ''))
    );

    v_result := jsonb_build_object('success', TRUE, 'task_id', v_task_id);
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(p_workspace_id, v_caller.roster_person_id, 'create_task_rpc', p_idempotency_key, v_hash, v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Hardened import_content_calendar_tasks: supports company_owner, video_editor track & reviewer resolution, and duplicate prevention
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
    IF v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only workspace owner can import content calendar tasks.';
    END IF;

    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;

    SELECT wm.roster_person_id INTO v_owner_roster_id
    FROM public.workspace_memberships wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.role IN ('owner', 'company_owner')
      AND wm.is_active = TRUE
    ORDER BY CASE WHEN wm.role = 'owner' THEN 0 ELSE 1 END
    LIMIT 1;

    SELECT * INTO v_campaign
    FROM public.campaigns
    WHERE workspace_id = p_workspace_id AND id = p_campaign_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Campaign not found in workspace.';
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

        -- 1) Check by content_calendar_items.id if provided
        IF v_item_id IS NOT NULL THEN
            SELECT task_id INTO v_existing_task_id
            FROM public.content_calendar_items
            WHERE workspace_id = p_workspace_id AND id = v_item_id
            FOR UPDATE;

            IF v_existing_task_id IS NOT NULL THEN
                CONTINUE;
            END IF;
        END IF;

        -- 2) If v_item_id is NULL (or had no task_id), check by campaign_id + post_number in content_calendar_items and tasks
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

        -- Determine Assignee: approved_assignee_id -> suggested_assignee_id -> client_team_assignments -> client.owner_roster_id
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

        SELECT rp.role INTO v_assignee_role
        FROM public.roster_people rp
        WHERE rp.workspace_id = p_workspace_id
          AND rp.id = v_target_assignee_id
          AND rp.is_active = TRUE
          AND TRUE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'العضو المختار للبوست رقم % غير موجود أو غير نشط في مساحة العمل.', COALESCE(v_post_number, 'غير محدد');
        END IF;

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
            IF EXISTS (
                SELECT 1 FROM public.roster_people rp
                WHERE rp.workspace_id = p_workspace_id
                  AND rp.id = v_explicit_reviewer_id
                  AND rp.is_active = TRUE
                  AND TRUE
                  AND COALESCE(rp.role, 'designer') <> 'marketing_director'
            ) THEN
                v_reviewer_id := v_explicit_reviewer_id;
            ELSE
                v_reviewer_id := NULL;
            END IF;
        ELSE
            v_reviewer_id := NULL;
        END IF;

        IF v_reviewer_id IS NULL THEN
            IF EXISTS (
                SELECT 1 FROM public.workspace_memberships wm
                WHERE wm.workspace_id = p_workspace_id
                  AND wm.roster_person_id = v_target_assignee_id
                  AND wm.role IN ('owner', 'company_owner')
                  AND wm.is_active = TRUE
            ) THEN
                v_reviewer_id := NULL;
            ELSE
                -- Check client_team_assignments reviewer for track first
                IF v_work_stage = 'video_editing' AND v_team.video_reviewer_id IS NOT NULL AND v_team.video_reviewer_id <> v_target_assignee_id THEN
                    v_reviewer_id := v_team.video_reviewer_id;
                ELSIF v_work_stage = 'design' AND v_team.design_reviewer_id IS NOT NULL AND v_team.design_reviewer_id <> v_target_assignee_id THEN
                    v_reviewer_id := v_team.design_reviewer_id;
                END IF;

                IF v_reviewer_id IS NULL THEN
                    SELECT reviewer_roster_id INTO v_reviewer_id
                    FROM public.review_routing_rules
                    WHERE workspace_id = p_workspace_id
                      AND designer_roster_id = v_target_assignee_id
                      AND client_difficulty = v_client.difficulty
                    ORDER BY priority DESC
                    LIMIT 1;
                END IF;

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

        -- Ensure content_calendar_items row exists first so task has valid content_calendar_item_id
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

-- =============================================================================
-- 8. EXPAND SUPABASE REALTIME PUBLICATION TO ALL OPERATIONAL TABLES
-- =============================================================================

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'client_team_assignments',
        'client_briefs',
        'campaigns',
        'review_rounds',
        'task_deliverables'
    ]
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END;
$$;

COMMIT;
