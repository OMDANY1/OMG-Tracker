-- =============================================================================
-- Migration 20261101000053: Canonical RBAC, Strategy Lead Campaign Scope, & Live Permissions Sync
-- 1. Implements canonical permission & access scope resolution helpers in `private` schema.
-- 2. Enforces role security invariants (owner/company_owner full admin, marketing_director read/export only,
--    business_owner_viewer read-only, non-owners locked out of system-admin privileges).
-- 3. Implements team scope resolution (`assigned_team`) for `strategy_lead` and `senior_reviewer`
--    so Strategy Lead can upload/process/edit/import campaigns for all Strategy Team clients without
--    exposing unrelated unassigned workspace clients.
-- 4. Updates `admin_update_roster_person` and `admin_create_roster_person` to atomically sync
--    `roster_people` + `workspace_memberships`, sanitize permissions, block self-role escalation,
--    and record detailed before/after audit events.
-- 5. Updates `import_content_calendar_tasks`, `apply_calendar_revision_tasks`, `save_ai_calendar_extraction`,
--    `acquire_ai_processing_job`, and RLS policies on `campaigns`, `content_calendar_items`, and `storage.objects`
--    to honor `private.can_manage_client_campaigns(workspace_id, client_id)`.
-- 6. Reconciles Arwa (`strategy_lead`) permissions & scope and backfills `strategy_lead_id` on
--    Strategy Team client assignments.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. Canonical Effective Permissions Resolver (`private.resolve_effective_permissions`)
-- =============================================================================
CREATE OR REPLACE FUNCTION private.resolve_effective_permissions(
    p_role public.roster_role,
    p_custom_permissions JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $function$
DECLARE
    v_defaults JSONB;
    v_custom JSONB := COALESCE(p_custom_permissions, '{}'::jsonb);
    v_result JSONB := '{}'::jsonb;
    v_key TEXT;
    v_keys TEXT[] := ARRAY[
        'manage_workspace',
        'invite_members',
        'manage_members',
        'manage_clients',
        'delete_clients',
        'assign_team',
        'create_campaigns',
        'create_tasks',
        'track_timer',
        'approve_strategy',
        'approve_reviews',
        'view_time_logs',
        'export_reports',
        'comment_and_attachments'
    ];
    v_val BOOLEAN;
BEGIN
    -- Hard Role Security Invariants
    IF p_role IN ('owner', 'company_owner') THEN
        RETURN jsonb_build_object(
            'manage_workspace', true,
            'invite_members', true,
            'manage_members', true,
            'manage_clients', true,
            'delete_clients', true,
            'assign_team', true,
            'create_campaigns', true,
            'create_tasks', true,
            'track_timer', true,
            'approve_strategy', true,
            'approve_reviews', true,
            'view_time_logs', true,
            'export_reports', true,
            'comment_and_attachments', true
        );
    END IF;

    IF p_role = 'business_owner_viewer' THEN
        RETURN jsonb_build_object(
            'manage_workspace', false,
            'invite_members', false,
            'manage_members', false,
            'manage_clients', false,
            'delete_clients', false,
            'assign_team', false,
            'create_campaigns', false,
            'create_tasks', false,
            'track_timer', false,
            'approve_strategy', false,
            'approve_reviews', false,
            'view_time_logs', false,
            'export_reports', false,
            'comment_and_attachments', false
        );
    END IF;

    IF p_role = 'marketing_director' THEN
        RETURN jsonb_build_object(
            'manage_workspace', false,
            'invite_members', false,
            'manage_members', false,
            'manage_clients', false,
            'delete_clients', false,
            'assign_team', false,
            'create_campaigns', false,
            'create_tasks', false,
            'track_timer', false,
            'approve_strategy', false,
            'approve_reviews', false,
            'view_time_logs', true,
            'export_reports', true,
            'comment_and_attachments', false
        );
    END IF;

    -- Default Role Matrix for operational roles
    CASE p_role
        WHEN 'manager' THEN
            v_defaults := jsonb_build_object(
                'manage_workspace', false, 'invite_members', true, 'manage_members', true,
                'manage_clients', true, 'delete_clients', false, 'assign_team', true,
                'create_campaigns', true, 'create_tasks', true, 'track_timer', true,
                'approve_strategy', true, 'approve_reviews', true, 'view_time_logs', true,
                'export_reports', true, 'comment_and_attachments', true
            );
        WHEN 'strategy_lead' THEN
            v_defaults := jsonb_build_object(
                'manage_workspace', false, 'invite_members', false, 'manage_members', false,
                'manage_clients', true, 'delete_clients', false, 'assign_team', true,
                'create_campaigns', true, 'create_tasks', true, 'track_timer', true,
                'approve_strategy', true, 'approve_reviews', true, 'view_time_logs', true,
                'export_reports', false, 'comment_and_attachments', true
            );
        WHEN 'senior_reviewer' THEN
            v_defaults := jsonb_build_object(
                'manage_workspace', false, 'invite_members', false, 'manage_members', false,
                'manage_clients', false, 'delete_clients', false, 'assign_team', false,
                'create_campaigns', false, 'create_tasks', false, 'track_timer', true,
                'approve_strategy', false, 'approve_reviews', true, 'view_time_logs', true,
                'export_reports', false, 'comment_and_attachments', true
            );
        WHEN 'strategist' THEN
            v_defaults := jsonb_build_object(
                'manage_workspace', false, 'invite_members', false, 'manage_members', false,
                'manage_clients', false, 'delete_clients', false, 'assign_team', false,
                'create_campaigns', true, 'create_tasks', true, 'track_timer', true,
                'approve_strategy', false, 'approve_reviews', false, 'view_time_logs', true,
                'export_reports', false, 'comment_and_attachments', true
            );
        ELSE
            -- designer, content_writer, video_editor
            v_defaults := jsonb_build_object(
                'manage_workspace', false, 'invite_members', false, 'manage_members', false,
                'manage_clients', false, 'delete_clients', false, 'assign_team', false,
                'create_campaigns', false, 'create_tasks', false, 'track_timer', true,
                'approve_strategy', false, 'approve_reviews', false, 'view_time_logs', false,
                'export_reports', false, 'comment_and_attachments', true
            );
    END CASE;

    FOREACH v_key IN ARRAY v_keys LOOP
        -- System-level locks for non-owners
        IF v_key IN ('manage_workspace', 'delete_clients') THEN
            v_val := FALSE;
        ELSIF v_key IN ('manage_members', 'invite_members') AND p_role <> 'manager' THEN
            v_val := FALSE;
        ELSIF jsonb_typeof(v_custom -> v_key) = 'boolean' THEN
            v_val := (v_custom ->> v_key)::BOOLEAN;
        ELSE
            v_val := COALESCE((v_defaults ->> v_key)::BOOLEAN, FALSE);
        END IF;

        v_result := v_result || jsonb_build_object(v_key, v_val);
    END LOOP;

    RETURN v_result;
END;
$function$;

-- =============================================================================
-- 2. Granular Permission & Client Scope Helpers
-- =============================================================================
CREATE OR REPLACE FUNCTION private.caller_has_permission(
    p_workspace_id UUID,
    p_roster_person_id UUID,
    p_perm TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_role public.roster_role;
    v_mem_custom JSONB;
    v_rp_custom JSONB;
    v_merged_custom JSONB;
    v_effective JSONB;
BEGIN
    IF p_roster_person_id IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT
        COALESCE(wm.role, rp.role, 'designer'::public.roster_role),
        COALESCE(wm.custom_permissions, '{}'::jsonb),
        COALESCE(rp.custom_permissions, '{}'::jsonb)
    INTO v_role, v_mem_custom, v_rp_custom
    FROM public.roster_people rp
    LEFT JOIN public.workspace_memberships wm
      ON wm.roster_person_id = rp.id
     AND wm.workspace_id = rp.workspace_id
     AND wm.is_active = TRUE
    WHERE rp.id = p_roster_person_id
      AND rp.workspace_id = p_workspace_id
      AND rp.is_active = TRUE
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    v_merged_custom := v_rp_custom || v_mem_custom;
    v_effective := private.resolve_effective_permissions(v_role, v_merged_custom);

    RETURN COALESCE((v_effective ->> p_perm)::BOOLEAN, FALSE);
END;
$function$;

CREATE OR REPLACE FUNCTION private.can_access_client_in_scope(
    p_workspace_id UUID,
    p_roster_person_id UUID,
    p_client_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_role public.roster_role;
    v_scope TEXT;
    v_client_exists BOOLEAN;
BEGIN
    IF p_client_id IS NULL OR p_workspace_id IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.clients c
        WHERE c.id = p_client_id AND c.workspace_id = p_workspace_id
    ) INTO v_client_exists;

    IF NOT v_client_exists THEN
        RETURN FALSE;
    END IF;

    IF auth.role() = 'service_role' THEN
        RETURN TRUE;
    END IF;

    IF p_roster_person_id IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT
        COALESCE(wm.role, rp.role, 'designer'::public.roster_role),
        COALESCE(wm.access_scope, rp.access_scope,
            CASE
                WHEN COALESCE(wm.role, rp.role) IN ('owner', 'company_owner', 'manager', 'marketing_director', 'business_owner_viewer') THEN 'workspace'
                WHEN COALESCE(wm.role, rp.role) IN ('strategy_lead', 'senior_reviewer') THEN 'assigned_team'
                WHEN COALESCE(wm.role, rp.role) = 'strategist' THEN 'assigned_clients'
                ELSE 'assigned_tasks'
            END
        )
    INTO v_role, v_scope
    FROM public.roster_people rp
    LEFT JOIN public.workspace_memberships wm
      ON wm.roster_person_id = rp.id
     AND wm.workspace_id = rp.workspace_id
     AND wm.is_active = TRUE
    WHERE rp.id = p_roster_person_id
      AND rp.workspace_id = p_workspace_id
      AND rp.is_active = TRUE
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Full workspace scope roles
    IF v_role IN ('owner', 'company_owner', 'manager', 'marketing_director', 'business_owner_viewer')
       OR v_scope = 'workspace' THEN
        RETURN TRUE;
    END IF;

    -- Direct assignment on client or client_team_assignments
    IF EXISTS (
        SELECT 1
        FROM public.clients c
        LEFT JOIN public.client_team_assignments cta
          ON cta.client_id = c.id AND cta.workspace_id = c.workspace_id
        WHERE c.id = p_client_id
          AND c.workspace_id = p_workspace_id
          AND (
              c.owner_roster_id = p_roster_person_id
              OR cta.primary_strategist_id = p_roster_person_id
              OR cta.primary_copywriter_id = p_roster_person_id
              OR cta.primary_designer_id = p_roster_person_id
              OR cta.primary_video_editor_id = p_roster_person_id
              OR cta.strategy_reviewer_id = p_roster_person_id
              OR cta.copywriting_reviewer_id = p_roster_person_id
              OR cta.design_reviewer_id = p_roster_person_id
              OR cta.video_reviewer_id = p_roster_person_id
              OR cta.marketing_director_id = p_roster_person_id
              OR cta.strategy_lead_id = p_roster_person_id
          )
    ) THEN
        RETURN TRUE;
    END IF;

    -- Team Scope (`assigned_team`) for Strategy Lead
    IF v_scope = 'assigned_team' AND v_role = 'strategy_lead' THEN
        IF EXISTS (
            SELECT 1
            FROM public.client_team_assignments cta
            WHERE cta.client_id = p_client_id
              AND cta.workspace_id = p_workspace_id
              AND (
                  cta.strategy_lead_id = p_roster_person_id
                  OR cta.strategy_reviewer_id IN (
                      SELECT rp2.id FROM public.roster_people rp2
                      WHERE rp2.workspace_id = p_workspace_id
                        AND rp2.is_active = TRUE
                        AND (rp2.role IN ('strategy_lead', 'strategist') OR 'strategy' = ANY(rp2.specialties))
                  )
                  OR cta.primary_strategist_id IN (
                      SELECT rp2.id FROM public.roster_people rp2
                      WHERE rp2.workspace_id = p_workspace_id
                        AND rp2.is_active = TRUE
                        AND (rp2.role IN ('strategy_lead', 'strategist') OR 'strategy' = ANY(rp2.specialties))
                  )
              )
        ) THEN
            RETURN TRUE;
        END IF;
        RETURN FALSE;
    END IF;

    -- Team Scope (`assigned_team`) for Senior Reviewer
    IF v_scope = 'assigned_team' AND v_role = 'senior_reviewer' THEN
        IF EXISTS (
            SELECT 1
            FROM public.client_team_assignments cta
            WHERE cta.client_id = p_client_id
              AND cta.workspace_id = p_workspace_id
              AND (
                  cta.design_reviewer_id IN (
                      SELECT rp2.id FROM public.roster_people rp2
                      WHERE rp2.workspace_id = p_workspace_id
                        AND rp2.is_active = TRUE
                        AND (rp2.role IN ('senior_reviewer', 'designer') OR 'design' = ANY(rp2.specialties))
                  )
                  OR cta.primary_designer_id IN (
                      SELECT rp2.id FROM public.roster_people rp2
                      WHERE rp2.workspace_id = p_workspace_id
                        AND rp2.is_active = TRUE
                        AND (rp2.role IN ('senior_reviewer', 'designer') OR 'design' = ANY(rp2.specialties))
                  )
              )
        ) THEN
            RETURN TRUE;
        END IF;
        RETURN FALSE;
    END IF;

    -- Check task involvement for assigned_clients / assigned_tasks
    IF EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.client_id = p_client_id
          AND t.workspace_id = p_workspace_id
          AND (t.primary_assignee_id = p_roster_person_id OR t.reviewer_id = p_roster_person_id)
    ) THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$function$;

CREATE OR REPLACE FUNCTION private.can_manage_client_campaigns(
    p_workspace_id UUID,
    p_client_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_caller RECORD;
BEGIN
    IF auth.role() = 'service_role' THEN
        RETURN TRUE;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    IF v_caller IS NULL OR v_caller.roster_person_id IS NULL THEN
        RETURN FALSE;
    END IF;

    IF v_caller.role IN ('owner', 'company_owner', 'manager') THEN
        RETURN TRUE;
    END IF;

    RETURN private.caller_has_permission(p_workspace_id, v_caller.roster_person_id, 'create_campaigns')
       AND private.can_access_client_in_scope(p_workspace_id, v_caller.roster_person_id, p_client_id);
END;
$function$;

-- =============================================================================
-- 3. Update `admin_update_roster_person` and `admin_create_roster_person`
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_update_roster_person(
    p_workspace_id UUID,
    p_roster_person_id UUID,
    p_job_title TEXT,
    p_specialties TEXT[],
    p_role public.roster_role DEFAULT 'designer',
    p_access_scope TEXT DEFAULT 'assigned_tasks',
    p_custom_permissions JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_caller RECORD;
    v_is_service_role BOOLEAN;
    v_old RECORD;
    v_active_owners_count INT;
    v_target_role public.roster_role;
    v_target_scope TEXT;
    v_sanitized_permissions JSONB;
BEGIN
    v_is_service_role := (COALESCE( current_setting('request.jwt.claim.role', true), '' ) = 'service_role')
                         OR (auth.role() = 'service_role');

    IF NOT v_is_service_role THEN
        SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
        IF v_caller.role NOT IN ('owner', 'company_owner') THEN
            RAISE EXCEPTION 'غير مصرح: تعديل بيانات وصلاحيات الأعضاء مقتصر على المدير العام أو الشريك فقط.';
        END IF;
    END IF;

    SELECT id, display_name, job_title, role, access_scope, custom_permissions, specialties, is_active
    INTO v_old
    FROM public.roster_people
    WHERE id = p_roster_person_id AND workspace_id = p_workspace_id;

    IF v_old.id IS NULL THEN
        RAISE EXCEPTION 'العضو غير موجود في مساحة العمل.';
    END IF;

    v_target_role := COALESCE(p_role, v_old.role, 'designer'::public.roster_role);

    -- Prevent self-role downgrade by an authenticated caller
    IF NOT v_is_service_role AND v_caller.roster_person_id = p_roster_person_id AND v_target_role IS DISTINCT FROM v_old.role THEN
        RAISE EXCEPTION 'غير مسموح: لا يمكن للعضو تغيير دوره الأمني الخاص بنفسه.';
    END IF;

    -- Prevent downgrading the last active owner/company_owner
    IF v_old.role IN ('owner', 'company_owner') AND v_target_role NOT IN ('owner', 'company_owner') THEN
        SELECT COUNT(*) INTO v_active_owners_count
        FROM public.roster_people
        WHERE workspace_id = p_workspace_id
          AND role IN ('owner', 'company_owner')
          AND is_active = TRUE
          AND id <> p_roster_person_id;

        IF v_active_owners_count = 0 THEN
            RAISE EXCEPTION 'لا يمكن خفض رتبة المالك الوحيد النشط في مساحة العمل.';
        END IF;
    END IF;

    -- Resolve canonical access scope
    IF v_target_role IN ('owner', 'company_owner', 'manager', 'marketing_director', 'business_owner_viewer') THEN
        v_target_scope := 'workspace';
    ELSIF p_access_scope IS NOT NULL AND p_access_scope IN ('workspace', 'assigned_team', 'assigned_clients', 'assigned_tasks') THEN
        v_target_scope := p_access_scope;
    ELSIF v_old.access_scope IS NOT NULL AND v_old.access_scope IN ('workspace', 'assigned_team', 'assigned_clients', 'assigned_tasks') THEN
        v_target_scope := v_old.access_scope;
    ELSIF v_target_role IN ('strategy_lead', 'senior_reviewer') THEN
        v_target_scope := 'assigned_team';
    ELSIF v_target_role = 'strategist' THEN
        v_target_scope := 'assigned_clients';
    ELSE
        v_target_scope := 'assigned_tasks';
    END IF;

    -- Sanitize custom permissions against role security invariants
    v_sanitized_permissions := private.resolve_effective_permissions(
        v_target_role,
        COALESCE(p_custom_permissions, v_old.custom_permissions, '{}'::jsonb)
    );

    -- Atomically update roster_people
    UPDATE public.roster_people
    SET job_title = COALESCE(NULLIF(TRIM(p_job_title), ''), job_title),
        specialties = COALESCE(p_specialties, specialties),
        role = v_target_role,
        access_scope = v_target_scope,
        custom_permissions = v_sanitized_permissions,
        updated_at = pg_catalog.now()
    WHERE id = p_roster_person_id AND workspace_id = p_workspace_id;

    -- Atomically sync workspace_memberships so active sessions immediately reflect the exact same role, scope, and permissions
    UPDATE public.workspace_memberships
    SET role = v_target_role,
        access_scope = v_target_scope,
        custom_permissions = v_sanitized_permissions,
        updated_at = pg_catalog.now()
    WHERE roster_person_id = p_roster_person_id AND workspace_id = p_workspace_id;

    -- Record complete before/after audit event
    INSERT INTO public.audit_events (
        workspace_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        p_workspace_id,
        CASE WHEN v_is_service_role THEN NULL ELSE v_caller.roster_person_id END,
        'update_roster_person_permissions',
        'roster_people',
        p_roster_person_id,
        jsonb_build_object(
            'display_name', v_old.display_name,
            'old_role', v_old.role,
            'new_role', v_target_role,
            'old_access_scope', v_old.access_scope,
            'new_access_scope', v_target_scope,
            'old_custom_permissions', v_old.custom_permissions,
            'new_custom_permissions', v_sanitized_permissions,
            'old_job_title', v_old.job_title,
            'new_job_title', COALESCE(NULLIF(TRIM(p_job_title), ''), v_old.job_title),
            'old_specialties', v_old.specialties,
            'new_specialties', COALESCE(p_specialties, v_old.specialties)
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'id', p_roster_person_id,
        'role', v_target_role,
        'access_scope', v_target_scope,
        'custom_permissions', v_sanitized_permissions
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_update_roster_person(UUID, UUID, TEXT, TEXT[], public.roster_role, TEXT, JSONB) TO authenticated, service_role;

-- =============================================================================
-- 4. Update `import_content_calendar_tasks` to Honor Strategy Lead / Scoped Campaign Managers
-- =============================================================================
CREATE OR REPLACE FUNCTION public.import_content_calendar_tasks(
    p_workspace_id UUID,
    p_campaign_id UUID,
    p_idempotency_key TEXT,
    p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_caller RECORD;
    v_is_service_role BOOLEAN;
    v_existing_response JSONB;
    v_campaign RECORD;
    v_client RECORD;
    v_cta RECORD;
    v_item JSONB;
    v_item_id UUID;
    v_existing_task_id UUID;
    v_new_task_id UUID;
    v_approved_assignee UUID;
    v_is_included BOOLEAN;
    v_is_excluded BOOLEAN;
    v_reviewer_id UUID;
    v_tasks_created INTEGER := 0;
    v_tasks_skipped INTEGER := 0;
    v_result JSONB;
    v_title TEXT;
    v_brief TEXT;
    v_caption TEXT;
    v_platform TEXT;
    v_format TEXT;
    v_design_due DATE;
    v_publish_date DATE;
    v_publish_at TIMESTAMPTZ;
    v_post_order INTEGER;
    v_is_video BOOLEAN;
BEGIN
    v_is_service_role := (auth.role() = 'service_role')
                         OR (COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role');

    IF NOT v_is_service_role THEN
        SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    END IF;

    -- Check Campaign Exists in Workspace
    SELECT * INTO v_campaign
    FROM public.campaigns
    WHERE id = p_campaign_id AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Campaign % not found in workspace.', p_campaign_id;
    END IF;

    -- Enforce `create_campaigns` permission + Client Scope
    IF NOT v_is_service_role THEN
        IF NOT (
            v_caller.role IN ('owner', 'company_owner', 'manager')
            OR (
                private.caller_has_permission(p_workspace_id, v_caller.roster_person_id, 'create_campaigns')
                AND private.can_access_client_in_scope(p_workspace_id, v_caller.roster_person_id, v_campaign.client_id)
            )
        ) THEN
            RAISE EXCEPTION 'غير مصرح: ليس لديك صلاحية اعتماد واستيراد مهام تقويم المحتوى لهذا العميل.';
        END IF;
    END IF;

    -- Check Idempotency Key
    IF p_idempotency_key IS NOT NULL THEN
        SELECT response_payload INTO v_existing_response
        FROM public.idempotency_keys
        WHERE workspace_id = p_workspace_id AND key = p_idempotency_key;

        IF FOUND THEN
            RETURN v_existing_response;
        END IF;
    END IF;

    SELECT * INTO v_client
    FROM public.clients
    WHERE id = v_campaign.client_id AND workspace_id = p_workspace_id;

    SELECT * INTO v_cta
    FROM public.client_team_assignments
    WHERE client_id = v_campaign.client_id AND workspace_id = p_workspace_id;

    -- Iterate through submitted items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_id := (v_item->>'id')::UUID;
        v_is_included := COALESCE((v_item->>'is_included')::BOOLEAN, TRUE);
        v_is_excluded := COALESCE((v_item->>'is_excluded_from_tasks')::BOOLEAN, FALSE);
        v_approved_assignee := NULLIF(v_item->>'approved_assignee_id', '')::UUID;
        v_title := COALESCE(NULLIF(v_item->>'title', ''), 'Post Task');
        v_brief := v_item->>'brief';
        v_caption := v_item->>'caption';
        v_platform := v_item->>'platform';
        v_format := COALESCE(NULLIF(v_item->>'content_format', ''), 'Static');
        v_design_due := NULLIF(v_item->>'design_due_date', '')::DATE;
        v_publish_date := NULLIF(v_item->>'publish_date', '')::DATE;
        v_post_order := COALESCE((v_item->>'post_order')::INTEGER, 1);
        v_is_video := (v_format ~* '(reel|video|motion)');

        IF v_approved_assignee IS NULL THEN
            IF v_is_video THEN
                v_approved_assignee := COALESCE(v_cta.primary_video_editor_id, v_cta.primary_designer_id, v_client.owner_roster_id);
            ELSE
                v_approved_assignee := COALESCE(v_cta.primary_designer_id, v_client.owner_roster_id);
            END IF;
        END IF;

        UPDATE public.content_calendar_items
        SET title = v_title,
            brief = v_brief,
            caption = v_caption,
            platform = v_platform,
            content_format = v_format,
            design_due_date = v_design_due,
            publish_date = v_publish_date,
            approved_assignee_id = v_approved_assignee,
            is_included = v_is_included,
            updated_at = pg_catalog.now()
        WHERE id = v_item_id AND campaign_id = p_campaign_id AND workspace_id = p_workspace_id
        RETURNING task_id INTO v_existing_task_id;

        IF v_is_excluded OR NOT v_is_included THEN
            v_tasks_skipped := v_tasks_skipped + 1;
            CONTINUE;
        END IF;

        IF v_existing_task_id IS NOT NULL THEN
            v_tasks_skipped := v_tasks_skipped + 1;
            CONTINUE;
        END IF;

        IF v_approved_assignee IS NULL THEN
            RAISE EXCEPTION 'يجب تحديد منفذ (مصمم أو مونتير) للبوست (%) قبل اعتماد التقويم.', v_title;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM public.roster_people rp
            WHERE rp.id = v_approved_assignee
              AND rp.workspace_id = p_workspace_id
              AND rp.is_active = TRUE
              AND rp.role NOT IN ('business_owner_viewer', 'marketing_director')
        ) THEN
            RAISE EXCEPTION 'العضو المحدد للبوست (%) غير صالح أو غير نشط في مساحة العمل.', v_title;
        END IF;

        IF v_is_video AND v_cta.video_reviewer_id IS NOT NULL THEN
            v_reviewer_id := v_cta.video_reviewer_id;
        ELSIF NOT v_is_video AND v_cta.design_reviewer_id IS NOT NULL THEN
            v_reviewer_id := v_cta.design_reviewer_id;
        ELSE
            v_reviewer_id := private.resolve_reviewer(p_workspace_id, v_approved_assignee, v_client.difficulty);
        END IF;

        IF v_publish_date IS NOT NULL THEN
            v_publish_at := (v_publish_date::TEXT || ' 12:00:00')::TIMESTAMP AT TIME ZONE 'Africa/Cairo';
        ELSE
            v_publish_at := NULL;
        END IF;

        INSERT INTO public.tasks (
            workspace_id,
            client_id,
            campaign_id,
            content_calendar_item_id,
            title,
            brief,
            Reference_link,
            deliverable_type,
            deliverable_format,
            deliverable_number,
            platform,
            status,
            work_stage,
            priority,
            primary_assignee_id,
            reviewer_id,
            due_date,
            design_due_date,
            review_due_date,
            publish_at,
            created_by_id
        ) VALUES (
            p_workspace_id,
            v_campaign.client_id,
            p_campaign_id,
            v_item_id,
            v_title,
            COALESCE(v_brief, '') || CASE WHEN v_caption IS NOT NULL AND v_caption <> '' THEN E'\n\nCaption:\n' || v_caption ELSE '' END,
            NULL,
            v_format,
            v_format,
            v_post_order,
            v_platform,
            'ready',
            CASE WHEN v_is_video THEN 'video_editing'::public.work_stage ELSE 'design'::public.work_stage END,
            'Normal',
            v_approved_assignee,
            v_reviewer_id,
            COALESCE(v_design_due, v_publish_date),
            v_design_due,
            v_design_due,
            v_publish_at,
            CASE WHEN v_is_service_role THEN v_campaign.uploaded_by_roster_id ELSE v_caller.roster_person_id END
        ) RETURNING id INTO v_new_task_id;

        UPDATE public.content_calendar_items
        SET task_id = v_new_task_id,
            updated_at = pg_catalog.now()
        WHERE id = v_item_id;

        v_tasks_created := v_tasks_created + 1;
    END LOOP;

    UPDATE public.campaigns
    SET calendar_status = CASE WHEN v_tasks_created > 0 THEN 'imported' ELSE calendar_status END,
        status = 'Active',
        approved_by_roster_id = CASE WHEN v_is_service_role THEN approved_by_roster_id ELSE v_caller.roster_person_id END,
        approved_at = pg_catalog.now(),
        imported_at = CASE WHEN v_tasks_created > 0 THEN pg_catalog.now() ELSE imported_at END,
        updated_at = pg_catalog.now()
    WHERE id = p_campaign_id;

    v_result := jsonb_build_object(
        'campaign_id', p_campaign_id,
        'tasks_created', v_tasks_created,
        'tasks_skipped', v_tasks_skipped,
        'status', 'imported'
    );

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        p_workspace_id,
        CASE WHEN v_is_service_role THEN NULL ELSE v_caller.roster_person_id END,
        'import_content_calendar_tasks',
        'campaign',
        p_campaign_id,
        v_result
    );

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.idempotency_keys (workspace_id, key, response_payload)
        VALUES (p_workspace_id, p_idempotency_key, v_result)
        ON CONFLICT (workspace_id, key) DO NOTHING;
    END IF;

    RETURN v_result;
END;
$function$;

-- =============================================================================
-- 5. Update `apply_calendar_revision_tasks` & `save_ai_calendar_extraction`
-- =============================================================================
CREATE OR REPLACE FUNCTION public.apply_calendar_revision_tasks(
    p_workspace_id UUID,
    p_campaign_id UUID,
    p_apply_mode TEXT DEFAULT 'sync_pending',
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_caller RECORD;
    v_is_service_role BOOLEAN;
    v_actor_roster_id UUID;
    v_campaign RECORD;
    v_item RECORD;
    v_existing_task RECORD;
    v_new_task_id UUID;
    v_created_count INTEGER := 0;
    v_updated_count INTEGER := 0;
    v_skipped_count INTEGER := 0;
    v_assigned_target UUID;
    v_design_due DATE;
    v_review_due DATE;
BEGIN
    v_is_service_role := (auth.role() = 'service_role')
                         OR (COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role');

    SELECT * INTO v_campaign
    FROM public.campaigns
    WHERE id = p_campaign_id AND workspace_id = p_workspace_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Campaign % not found in workspace.', p_campaign_id;
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
            RAISE EXCEPTION 'غير مصرح: ليس لديك صلاحية تطبيق تعديلات تقويم المحتوى لهذا العميل.';
        END IF;
        v_actor_roster_id := v_caller.roster_person_id;
    ELSE
        v_actor_roster_id := v_campaign.uploaded_by_roster_id;
    END IF;

    FOR v_item IN
        SELECT *
        FROM public.content_calendar_items
        WHERE campaign_id = p_campaign_id
          AND workspace_id = p_workspace_id
          AND is_included = TRUE
          AND is_excluded_from_tasks = FALSE
        ORDER BY post_order ASC
    LOOP
        SELECT * INTO v_existing_task
        FROM public.tasks
        WHERE workspace_id = p_workspace_id
          AND (content_calendar_item_id = v_item.id OR (campaign_id = p_campaign_id AND deliverable_number = v_item.post_order))
        LIMIT 1;

        IF FOUND THEN
            IF v_existing_task.status IN ('in_progress', 'internal_review', 'client_review', 'approved', 'delivered') THEN
                v_skipped_count := v_skipped_count + 1;
                CONTINUE;
            END IF;

            IF p_apply_mode = 'new_only' THEN
                v_skipped_count := v_skipped_count + 1;
                CONTINUE;
            END IF;

            UPDATE public.tasks
            SET title = COALESCE(v_item.title, title),
                brief = COALESCE(v_item.brief, brief),
                deliverable_format = COALESCE(v_item.content_format, deliverable_format),
                content_fingerprint = v_item.content_fingerprint,
                design_due_date = COALESCE(v_item.design_due_date, design_due_date),
                publish_at = CASE WHEN v_item.publish_date IS NOT NULL THEN (v_item.publish_date::TEXT || ' 12:00:00+02')::TIMESTAMPTZ ELSE publish_at END,
                source_pdf_pages = COALESCE(v_item.source_pages, ARRAY[v_item.source_page]),
                content_calendar_item_id = v_item.id,
                updated_at = pg_catalog.now()
            WHERE id = v_existing_task.id;

            v_updated_count := v_updated_count + 1;
        ELSE
            v_new_task_id := extensions.gen_random_uuid();
            v_assigned_target := COALESCE(v_item.approved_assignee_id, v_item.suggested_assignee_id);
            v_design_due := COALESCE(v_item.design_due_date, CURRENT_DATE + INTERVAL '3 days');
            v_review_due := v_design_due + INTERVAL '1 day';

            INSERT INTO public.tasks (
                id, workspace_id, client_id, campaign_id, content_calendar_item_id,
                title, brief, deliverable_format, deliverable_number, priority, status,
                primary_assignee_id, reviewer_id, due_date, design_due_date, review_due_date,
                publish_at, source_pdf_pages, content_fingerprint, created_by_id
            ) VALUES (
                v_new_task_id, p_workspace_id, v_campaign.client_id, p_campaign_id, v_item.id,
                COALESCE(v_item.title, 'Post ' || v_item.post_order),
                v_item.brief, COALESCE(v_item.content_format, 'Static'), v_item.post_order,
                'Normal', 'backlog', v_assigned_target, v_actor_roster_id,
                v_review_due, v_design_due, v_review_due,
                CASE WHEN v_item.publish_date IS NOT NULL THEN (v_item.publish_date::TEXT || ' 12:00:00+02')::TIMESTAMPTZ ELSE NULL END,
                COALESCE(v_item.source_pages, ARRAY[v_item.source_page]),
                v_item.content_fingerprint, v_actor_roster_id
            );

            UPDATE public.content_calendar_items
            SET task_id = v_new_task_id,
                updated_at = pg_catalog.now()
            WHERE id = v_item.id;

            v_created_count := v_created_count + 1;
        END IF;
    END LOOP;

    UPDATE public.campaigns
    SET calendar_status = 'approved',
        status = 'Active',
        updated_at = pg_catalog.now()
    WHERE id = p_campaign_id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        p_workspace_id, v_actor_roster_id, 'apply_calendar_revision', 'campaigns', p_campaign_id,
        jsonb_build_object(
            'apply_mode', p_apply_mode,
            'tasks_created', v_created_count,
            'tasks_updated', v_updated_count,
            'tasks_skipped_protected', v_skipped_count,
            'idempotency_key', p_idempotency_key
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'campaign_id', p_campaign_id,
        'tasks_created', v_created_count,
        'tasks_updated', v_updated_count,
        'tasks_skipped_protected', v_skipped_count
    );
END;
$function$;

-- =============================================================================
-- 6. Update RLS Policies on `campaigns`, `content_calendar_items`, and `storage.objects`
-- =============================================================================
DROP POLICY IF EXISTS "campaigns_insert" ON public.campaigns;
CREATE POLICY "campaigns_insert" ON public.campaigns
FOR INSERT TO authenticated
WITH CHECK (
    private.is_workspace_owner(workspace_id)
    OR private.can_manage_client_campaigns(workspace_id, client_id)
);

DROP POLICY IF EXISTS "campaigns_update" ON public.campaigns;
CREATE POLICY "campaigns_update" ON public.campaigns
FOR UPDATE TO authenticated
USING (
    private.is_workspace_owner(workspace_id)
    OR private.can_manage_client_campaigns(workspace_id, client_id)
)
WITH CHECK (
    private.is_workspace_owner(workspace_id)
    OR private.can_manage_client_campaigns(workspace_id, client_id)
);

DROP POLICY IF EXISTS "cci_owner_all" ON public.content_calendar_items;
DROP POLICY IF EXISTS "cci_manage_campaigns" ON public.content_calendar_items;
CREATE POLICY "cci_manage_campaigns" ON public.content_calendar_items
FOR ALL TO authenticated
USING (
    private.is_workspace_owner(workspace_id)
    OR private.can_manage_client_campaigns(workspace_id, client_id)
)
WITH CHECK (
    private.is_workspace_owner(workspace_id)
    OR private.can_manage_client_campaigns(workspace_id, client_id)
);

DROP POLICY IF EXISTS "content_calendars_owner_insert" ON storage.objects;
CREATE POLICY "content_calendars_owner_insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'content-calendars'
    AND (
        private.is_workspace_owner(((storage.foldername(name))[1])::uuid)
        OR private.can_manage_client_campaigns(
            ((storage.foldername(name))[1])::uuid,
            ((storage.foldername(name))[2])::uuid
        )
    )
);

DROP POLICY IF EXISTS "content_calendars_owner_update" ON storage.objects;
CREATE POLICY "content_calendars_owner_update" ON storage.objects
FOR UPDATE TO authenticated
USING (
    bucket_id = 'content-calendars'
    AND (
        private.is_workspace_owner(((storage.foldername(name))[1])::uuid)
        OR private.can_manage_client_campaigns(
            ((storage.foldername(name))[1])::uuid,
            ((storage.foldername(name))[2])::uuid
        )
    )
);

DROP POLICY IF EXISTS "content_calendars_owner_delete" ON storage.objects;
CREATE POLICY "content_calendars_owner_delete" ON storage.objects
FOR DELETE TO authenticated
USING (
    bucket_id = 'content-calendars'
    AND (
        private.is_workspace_owner(((storage.foldername(name))[1])::uuid)
        OR private.can_manage_client_campaigns(
            ((storage.foldername(name))[1])::uuid,
            ((storage.foldername(name))[2])::uuid
        )
    )
);

-- =============================================================================
-- 7. Reconcile Arwa (`strategy_lead`) Permissions & Scope + Backfill `strategy_lead_id`
-- =============================================================================
DO $$
DECLARE
    v_arwa RECORD;
    v_strategy_lead_perms JSONB;
BEGIN
    v_strategy_lead_perms := private.resolve_effective_permissions('strategy_lead'::public.roster_role, '{}'::jsonb);

    -- Reconcile all strategy_lead members (Arwa) to canonical strategy_lead permissions & assigned_team scope
    FOR v_arwa IN
        SELECT id, workspace_id, display_name
        FROM public.roster_people
        WHERE role = 'strategy_lead'
    LOOP
        UPDATE public.roster_people
        SET access_scope = 'assigned_team',
            custom_permissions = v_strategy_lead_perms,
            updated_at = pg_catalog.now()
        WHERE id = v_arwa.id;

        UPDATE public.workspace_memberships
        SET role = 'strategy_lead',
            access_scope = 'assigned_team',
            custom_permissions = v_strategy_lead_perms,
            updated_at = pg_catalog.now()
        WHERE roster_person_id = v_arwa.id AND workspace_id = v_arwa.workspace_id;

        -- Backfill strategy_lead_id on client_team_assignments where Strategy Team is assigned
        UPDATE public.client_team_assignments cta
        SET strategy_lead_id = v_arwa.id,
            updated_at = pg_catalog.now()
        WHERE cta.workspace_id = v_arwa.workspace_id
          AND cta.strategy_lead_id IS NULL
          AND (
              cta.strategy_reviewer_id = v_arwa.id
              OR cta.primary_strategist_id IN (
                  SELECT rp.id FROM public.roster_people rp
                  WHERE rp.workspace_id = v_arwa.workspace_id
                    AND rp.is_active = TRUE
                    AND (rp.role IN ('strategy_lead', 'strategist') OR 'strategy' = ANY(rp.specialties))
              )
          );
    END LOOP;

    -- Also ensure Owner (Emad), Company Owner (Ahmed El Nahas), and Marketing Director (Ata) have canonical synced permissions
    UPDATE public.roster_people
    SET access_scope = 'workspace',
        custom_permissions = private.resolve_effective_permissions(role, custom_permissions)
    WHERE role IN ('owner', 'company_owner', 'marketing_director', 'business_owner_viewer');

    UPDATE public.workspace_memberships
    SET access_scope = 'workspace',
        custom_permissions = private.resolve_effective_permissions(role, custom_permissions)
    WHERE role IN ('owner', 'company_owner', 'marketing_director', 'business_owner_viewer');
END $$;

-- =============================================================================
-- 8. Ensure `workspace_memberships` and `roster_people` are in `supabase_realtime`
-- =============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'workspace_memberships'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_memberships;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'roster_people'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.roster_people;
        END IF;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
