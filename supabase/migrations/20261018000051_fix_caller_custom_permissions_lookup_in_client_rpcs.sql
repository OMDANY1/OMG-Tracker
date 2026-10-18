-- =============================================================================
-- Migration: 20261018000051_fix_caller_custom_permissions_lookup_in_client_rpcs.sql
-- Purpose:
--   Fix `record "v_caller" has no field "custom_permissions"` in client RPCs by
--   resolving `custom_permissions` from `public.roster_people` via a dedicated
--   helper `private.caller_has_permission(p_workspace_id, p_roster_person_id, p_perm)`.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION private.caller_has_permission(
    p_workspace_id UUID,
    p_roster_person_id UUID,
    p_perm TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
    v_perms JSONB;
BEGIN
    IF p_roster_person_id IS NULL OR p_perm IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT rp.custom_permissions INTO v_perms
    FROM public.roster_people rp
    WHERE rp.workspace_id = p_workspace_id
      AND rp.id = p_roster_person_id
      AND rp.is_active = TRUE;

    RETURN COALESCE((v_perms ->> p_perm)::BOOLEAN, FALSE);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

-- 1. Update public.create_client
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
    v_clean_notes TEXT;
    v_clean_brand_guide_url TEXT;
    v_clean_brief_url TEXT;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'Idempotency key cannot be blank.';
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;

    IF v_caller.role NOT IN ('owner', 'company_owner', 'manager')
       AND NOT private.caller_has_permission(p_workspace_id, v_caller.roster_person_id, 'manage_clients') THEN
        RAISE EXCEPTION 'غير مصرح: إضافة العملاء مقتصرة على الإدارة فقط.';
    END IF;

    v_clean_name := btrim(COALESCE(p_name, ''));
    IF v_clean_name = '' THEN
        RAISE EXCEPTION 'اسم العميل مطلوب ولا يمكن أن يكون فارغاً.';
    END IF;

    v_clean_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');
    v_clean_brand_guide_url := private.normalize_and_validate_optional_url(p_brand_guide_url, 'رابط دليل الهوية');
    v_clean_brief_url := private.normalize_and_validate_optional_url(p_brief_url, 'رابط الـ Brief الخارجي');

    IF p_idempotency_key IS NOT NULL THEN
        v_payload := jsonb_build_object(
            'p_workspace_id', p_workspace_id,
            'p_name', lower(v_clean_name)
        );
        v_hash := pg_catalog.encode(extensions.digest(v_payload::text, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(p_workspace_id, v_caller.roster_person_id, 'create_client', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    IF p_owner_roster_id IS NOT NULL THEN
        IF NOT private.is_eligible_executor(p_workspace_id, p_owner_roster_id) THEN
            RAISE EXCEPTION 'لا يمكن إسناد عميل إلى عضو غير مؤهل للتنفيذ (مشاهد أو مدير تسويق أو معطل أو محذوف).';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.clients c
        WHERE c.workspace_id = p_workspace_id
          AND lower(btrim(c.name)) = lower(v_clean_name)
    ) THEN
        RAISE EXCEPTION 'اسم العميل (%) مسجل بالفعل في مساحة العمل.', v_clean_name;
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
        COALESCE(p_difficulty, 'Medium'),
        COALESCE(p_extra_workload, 'None'),
        COALESCE(p_state, 'Active'),
        v_clean_notes,
        v_clean_brand_guide_url,
        v_clean_brief_url
    ) RETURNING id INTO v_client_id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        p_workspace_id, v_caller.roster_person_id, 'create_client', 'clients', v_client_id,
        jsonb_build_object('name', v_clean_name, 'difficulty', COALESCE(p_difficulty, 'Medium'))
    );

    v_result := jsonb_build_object('success', TRUE, 'client_id', v_client_id);
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM private.fn_record_idempotency(p_workspace_id, v_caller.roster_person_id, 'create_client', p_idempotency_key, v_hash, v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 2. Update public.upsert_client_team_assignment
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
    v_executor_id UUID;
    v_reviewer_id UUID;
BEGIN
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);

    IF v_caller.role NOT IN ('owner', 'company_owner', 'manager')
       AND NOT private.caller_has_permission(p_workspace_id, v_caller.roster_person_id, 'manage_clients')
       AND NOT private.caller_has_permission(p_workspace_id, v_caller.roster_person_id, 'assign_team') THEN
        RAISE EXCEPTION 'غير مصرح: توزيع فريق العميل مقتصر على الإدارة فقط.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.clients c
        WHERE c.workspace_id = p_workspace_id AND c.id = p_client_id
    ) THEN
        RAISE EXCEPTION 'العميل غير موجود في مساحة العمل الحالية.';
    END IF;

    FOREACH v_executor_id IN ARRAY ARRAY[
        p_primary_strategist_id,
        p_primary_copywriter_id,
        p_primary_designer_id,
        p_primary_video_editor_id,
        p_strategy_lead_id
    ]
    LOOP
        IF v_executor_id IS NOT NULL THEN
            IF NOT private.is_eligible_executor(p_workspace_id, v_executor_id) THEN
                RAISE EXCEPTION 'العضو المختار للتنفيذ غير مؤهل (مشاهد أو مدير تسويق أو معطل أو من مساحة عمل أخرى).';
            END IF;
        END IF;
    END LOOP;

    FOREACH v_reviewer_id IN ARRAY ARRAY[
        p_strategy_reviewer_id,
        p_copywriting_reviewer_id,
        p_design_reviewer_id,
        p_video_reviewer_id
    ]
    LOOP
        IF v_reviewer_id IS NOT NULL THEN
            IF NOT private.is_eligible_reviewer(p_workspace_id, v_reviewer_id) THEN
                RAISE EXCEPTION 'المراجع المختار غير مؤهل للمراجعة (لا يملك صلاحية اعتماد المراجعات أو معطل أو من مساحة عمل أخرى).';
            END IF;
        END IF;
    END LOOP;

    IF p_marketing_director_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.roster_people rp
            LEFT JOIN public.workspace_memberships wm
              ON wm.workspace_id = rp.workspace_id AND wm.roster_person_id = rp.id AND wm.is_active = TRUE
            WHERE rp.workspace_id = p_workspace_id
              AND rp.id = p_marketing_director_id
              AND rp.is_active = TRUE
              AND COALESCE(rp.role, 'designer') <> 'business_owner_viewer'
              AND COALESCE(wm.role, rp.role, 'designer') <> 'business_owner_viewer'
        ) THEN
            RAISE EXCEPTION 'العضو المختار للإشراف غير نشط أو غير صالح في مساحة العمل.';
        END IF;
    END IF;

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

    UPDATE public.clients
    SET owner_roster_id = p_primary_designer_id,
        updated_at = pg_catalog.now()
    WHERE id = p_client_id AND workspace_id = p_workspace_id;

    RETURN to_jsonb(v_res);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 3. Update public.update_client
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
    v_clean_brand_url TEXT;
    v_clean_brief_url TEXT;
    v_reassigned_count INT := 0;
    v_t RECORD;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    IF v_caller.role NOT IN ('owner', 'company_owner', 'manager')
       AND NOT private.caller_has_permission(p_workspace_id, v_caller.roster_person_id, 'manage_clients') THEN
        RAISE EXCEPTION 'غير مصرح: تعديل بيانات العميل مقتصر على الإدارة فقط.';
    END IF;

    v_clean_brand_url := private.normalize_and_validate_optional_url(p_brand_guide_url, 'رابط دليل الهوية');
    v_clean_brief_url := private.normalize_and_validate_optional_url(p_brief_url, 'رابط الـ Brief الخارجي');

    IF p_idempotency_key IS NOT NULL THEN
        v_payload := jsonb_build_object('p_workspace_id', p_workspace_id, 'p_client_id', p_client_id, 'p_name', p_name, 'p_owner_roster_id', p_owner_roster_id, 'p_difficulty', p_difficulty, 'p_extra_workload', p_extra_workload, 'p_state', p_state, 'p_notes', p_notes, 'p_brand_guide_url', v_clean_brand_url, 'p_brief_url', v_clean_brief_url, 'p_reassign_open_tasks', p_reassign_open_tasks);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::text,'sha256'),'hex');
        v_cached := private.fn_acquire_idempotency_lock(p_workspace_id,v_caller.roster_person_id,'update_client',p_idempotency_key,v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    SELECT * INTO v_client
    FROM public.clients
    WHERE workspace_id = p_workspace_id AND id = p_client_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'العميل غير موجود في مساحة العمل الحالية.';
    END IF;

    IF p_owner_roster_id IS NOT NULL THEN
        IF NOT private.is_eligible_executor(p_workspace_id, p_owner_roster_id) THEN
            RAISE EXCEPTION 'لا يمكن إسناد عميل إلى عضو غير مؤهل للتنفيذ (مشاهد أو مدير تسويق أو معطل أو محذوف).';
        END IF;
    END IF;

    UPDATE public.clients
    SET name = COALESCE(NULLIF(btrim(p_name), ''), name),
        owner_roster_id = COALESCE(p_owner_roster_id, owner_roster_id),
        difficulty = COALESCE(p_difficulty, difficulty),
        extra_workload = COALESCE(p_extra_workload, extra_workload),
        state = COALESCE(p_state, state),
        notes = COALESCE(p_notes, notes),
        brand_guide_url = CASE WHEN p_brand_guide_url IS NOT NULL THEN v_clean_brand_url ELSE brand_guide_url END,
        brief_url = CASE WHEN p_brief_url IS NOT NULL THEN v_clean_brief_url ELSE brief_url END,
        updated_at = pg_catalog.now()
    WHERE id = p_client_id AND workspace_id = p_workspace_id;

    IF p_brand_guide_url IS NOT NULL THEN
        UPDATE public.client_briefs
        SET brand_guidelines_url = v_clean_brand_url,
            updated_at = pg_catalog.now()
        WHERE workspace_id = p_workspace_id AND client_id = p_client_id;
    END IF;

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

-- 4. Update public.create_client_atomic
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
    v_clean_name TEXT;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_client_res JSONB;
    v_client_id UUID;
    v_primary_designer_id UUID;
    v_primary_strategist_id UUID;
    v_primary_copywriter_id UUID;
    v_primary_video_editor_id UUID;
    v_strategy_reviewer_id UUID;
    v_copywriting_reviewer_id UUID;
    v_design_reviewer_id UUID;
    v_video_reviewer_id UUID;
    v_marketing_director_id UUID;
    v_strategy_lead_id UUID;
    v_enable_design BOOLEAN;
    v_enable_copywriting BOOLEAN;
    v_enable_strategy BOOLEAN;
    v_requires_video BOOLEAN;
    v_effective_brand_url TEXT;
    v_effective_brief_url TEXT;
    v_effective_assets_url TEXT;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'Idempotency key cannot be blank.';
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;

    IF v_caller.role NOT IN ('owner', 'company_owner', 'manager')
       AND NOT private.caller_has_permission(p_workspace_id, v_caller.roster_person_id, 'manage_clients') THEN
        RAISE EXCEPTION 'غير مصرح: إضافة العملاء مقتصرة على الإدارة فقط.';
    END IF;

    v_clean_name := btrim(COALESCE(p_name, ''));
    IF v_clean_name = '' THEN
        RAISE EXCEPTION 'اسم العميل مطلوب ولا يمكن أن يكون فارغاً.';
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        v_payload := jsonb_build_object(
            'p_workspace_id', p_workspace_id,
            'p_name', lower(v_clean_name)
        );
        v_hash := pg_catalog.encode(extensions.digest(v_payload::text, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(p_workspace_id, v_caller.roster_person_id, 'create_client_atomic', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    -- Normalize & validate optional URLs (Brand Guide, Assets Drive, External Brief)
    v_effective_brand_url := COALESCE(
        private.normalize_and_validate_optional_url(p_brand_guide_url, 'رابط دليل الهوية'),
        private.normalize_and_validate_optional_url(p_brief ->> 'brandGuidelinesUrl', 'رابط دليل الهوية')
    );
    v_effective_brief_url := private.normalize_and_validate_optional_url(p_brief_url, 'رابط الـ Brief الخارجي');
    v_effective_assets_url := private.normalize_and_validate_optional_url(p_brief ->> 'assetsDriveUrl', 'رابط مجلد الأصول');

    -- Parse team assignment UUIDs strictly (reject malformed non-empty UUIDs)
    v_primary_designer_id := COALESCE(
        private.parse_optional_uuid_strict(p_team_assignments ->> 'primaryDesignerId', 'معرف المصمم الأساسي'),
        p_owner_roster_id
    );
    v_primary_strategist_id := private.parse_optional_uuid_strict(p_team_assignments ->> 'primaryStrategistId', 'معرف الاستراتيجيست الأساسي');
    v_primary_copywriter_id := private.parse_optional_uuid_strict(p_team_assignments ->> 'primaryCopywriterId', 'معرف كاتب المحتوى الأساسي');
    v_primary_video_editor_id := private.parse_optional_uuid_strict(p_team_assignments ->> 'primaryVideoEditorId', 'معرف الإيديتور الأساسي');
    v_strategy_reviewer_id := private.parse_optional_uuid_strict(p_team_assignments ->> 'strategyReviewerId', 'معرف مراجع الاستراتيجية');
    v_copywriting_reviewer_id := private.parse_optional_uuid_strict(p_team_assignments ->> 'copywritingReviewerId', 'معرف مراجع المحتوى');
    v_design_reviewer_id := private.parse_optional_uuid_strict(p_team_assignments ->> 'designReviewerId', 'معرف مراجع التصميم');
    v_video_reviewer_id := private.parse_optional_uuid_strict(p_team_assignments ->> 'videoReviewerId', 'معرف مراجع الفيديو');
    v_marketing_director_id := private.parse_optional_uuid_strict(p_team_assignments ->> 'marketingDirectorId', 'معرف مدير التسويق');
    v_strategy_lead_id := private.parse_optional_uuid_strict(p_team_assignments ->> 'strategyLeadId', 'معرف ليدر الاستراتيجية');

    v_enable_design := CASE
        WHEN p_team_assignments ? 'enableDesign' AND jsonb_typeof(p_team_assignments -> 'enableDesign') = 'boolean'
        THEN (p_team_assignments ->> 'enableDesign')::BOOLEAN
        ELSE FALSE
    END;
    v_enable_copywriting := CASE
        WHEN p_team_assignments ? 'enableCopywriting' AND jsonb_typeof(p_team_assignments -> 'enableCopywriting') = 'boolean'
        THEN (p_team_assignments ->> 'enableCopywriting')::BOOLEAN
        ELSE FALSE
    END;
    v_enable_strategy := CASE
        WHEN p_team_assignments ? 'enableStrategy' AND jsonb_typeof(p_team_assignments -> 'enableStrategy') = 'boolean'
        THEN (p_team_assignments ->> 'enableStrategy')::BOOLEAN
        ELSE FALSE
    END;
    v_requires_video := CASE
        WHEN p_team_assignments ? 'requiresVideo' AND jsonb_typeof(p_team_assignments -> 'requiresVideo') = 'boolean'
        THEN (p_team_assignments ->> 'requiresVideo')::BOOLEAN
        ELSE NULL
    END;

    -- When activating a client (state = 'Active'), enforce required primary assignee for any explicitly enabled track
    IF COALESCE(p_state, 'Active') = 'Active' AND p_team_assignments IS NOT NULL THEN
        IF v_enable_design AND v_primary_designer_id IS NULL THEN
            RAISE EXCEPTION 'يرجى اختيار المصمم الأساسي لتفعيل مسار التصميم، أو استخدام خيار «حفظ كمسودة».';
        END IF;
        IF v_enable_copywriting AND v_primary_copywriter_id IS NULL THEN
            RAISE EXCEPTION 'يرجى اختيار كاتب المحتوى الأساسي لتفعيل مسار المحتوى، أو استخدام خيار «حفظ كمسودة».';
        END IF;
        IF v_enable_strategy AND v_primary_strategist_id IS NULL THEN
            RAISE EXCEPTION 'يرجى اختيار الاستراتيجيست الأساسي لتفعيل مسار الاستراتيجية، أو استخدام خيار «حفظ كمسودة».';
        END IF;
        IF COALESCE(v_requires_video, FALSE) AND v_primary_video_editor_id IS NULL THEN
            RAISE EXCEPTION 'يرجى اختيار الإيديتور الأساسي لتفعيل مسار الفيديو، أو إلغاء تفعيل مسار الفيديو مؤقتاً.';
        END IF;
    END IF;

    -- 1. Create client row atomically
    v_client_res := public.create_client(
        p_workspace_id => p_workspace_id,
        p_name => v_clean_name,
        p_owner_roster_id => v_primary_designer_id,
        p_difficulty => COALESCE(p_difficulty, 'Medium'),
        p_extra_workload => COALESCE(p_extra_workload, 'None'),
        p_state => COALESCE(p_state, 'Active'),
        p_notes => p_notes,
        p_brand_guide_url => v_effective_brand_url,
        p_brief_url => v_effective_brief_url,
        p_idempotency_key => NULL
    );

    v_client_id := (v_client_res ->> 'client_id')::UUID;

    -- 2. Upsert multi-track team assignments in the same transaction (rolls back client on any failure)
    PERFORM public.upsert_client_team_assignment(
        p_workspace_id => p_workspace_id,
        p_client_id => v_client_id,
        p_primary_strategist_id => v_primary_strategist_id,
        p_primary_copywriter_id => v_primary_copywriter_id,
        p_primary_designer_id => v_primary_designer_id,
        p_primary_video_editor_id => v_primary_video_editor_id,
        p_strategy_reviewer_id => v_strategy_reviewer_id,
        p_copywriting_reviewer_id => v_copywriting_reviewer_id,
        p_design_reviewer_id => v_design_reviewer_id,
        p_video_reviewer_id => v_video_reviewer_id,
        p_marketing_director_id => v_marketing_director_id,
        p_strategy_lead_id => v_strategy_lead_id,
        p_idempotency_key => NULL,
        p_requires_video => COALESCE(v_requires_video, FALSE)
    );

    -- 3. Upsert initial client brief in the same transaction (all URLs optional)
    PERFORM public.upsert_client_brief(
        p_workspace_id => p_workspace_id,
        p_client_id => v_client_id,
        p_objectives => NULLIF(btrim(COALESCE(p_brief ->> 'objectives', '')), ''),
        p_target_audience => NULLIF(btrim(COALESCE(p_brief ->> 'targetAudience', '')), ''),
        p_products_services => NULLIF(btrim(COALESCE(p_brief ->> 'productsServices', '')), ''),
        p_tone_of_voice => NULLIF(btrim(COALESCE(p_brief ->> 'toneOfVoice', '')), ''),
        p_content_pillars => CASE
            WHEN p_brief IS NOT NULL AND p_brief ? 'contentPillars' AND jsonb_typeof(p_brief -> 'contentPillars') = 'array'
            THEN ARRAY(SELECT jsonb_array_elements_text(p_brief -> 'contentPillars'))
            ELSE '{}'::TEXT[]
        END,
        p_dos_and_donts => NULLIF(btrim(COALESCE(p_brief ->> 'dosAndDonts', '')), ''),
        p_brand_guidelines_url => v_effective_brand_url,
        p_assets_drive_url => v_effective_assets_url,
        p_strategy_summary => NULLIF(btrim(COALESCE(p_brief ->> 'strategySummary', '')), ''),
        p_idempotency_key => NULL
    );

    v_result := jsonb_build_object('success', TRUE, 'client_id', v_client_id);
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM private.fn_record_idempotency(p_workspace_id, v_caller.roster_person_id, 'create_client_atomic', p_idempotency_key, v_hash, v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

NOTIFY pgrst, 'reload schema';

COMMIT;
