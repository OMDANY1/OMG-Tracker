-- Migration 39: Company Owner Full Role, Hard Delete vs Deactivate, and Realtime Publications
-- OMG Creative Workspace

-- 1. Extend roster_role ENUM with company_owner
ALTER TYPE public.roster_role ADD VALUE IF NOT EXISTS 'company_owner';

-- 2. Update Ahmed Al-Nahhas's account to Company Owner with Full Permissions
UPDATE public.roster_people
SET role = 'company_owner',
    job_title = 'مالك الشركة — صلاحيات كاملة',
    custom_permissions = '{"assign_team": true, "track_timer": true, "create_tasks": true, "delete_clients": true, "export_reports": true, "invite_members": true, "manage_clients": true, "manage_members": true, "view_time_logs": true, "approve_reviews": true, "approve_strategy": true, "create_campaigns": true, "manage_workspace": true, "comment_and_attachments": true}'::jsonb,
    updated_at = pg_catalog.now()
WHERE id = '82a6a25a-3dad-4c6a-960c-6ace8389985a';

UPDATE public.workspace_memberships
SET role = 'company_owner',
    custom_permissions = '{"assign_team": true, "track_timer": true, "create_tasks": true, "delete_clients": true, "export_reports": true, "invite_members": true, "manage_clients": true, "manage_members": true, "view_time_logs": true, "approve_reviews": true, "approve_strategy": true, "create_campaigns": true, "manage_workspace": true, "comment_and_attachments": true}'::jsonb,
    updated_at = pg_catalog.now()
WHERE roster_person_id = '82a6a25a-3dad-4c6a-960c-6ace8389985a';

BEGIN;

-- 3. Decoupling and Historical Snapshots for Roster People

-- 3.1 time_entries
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS worker_name_snapshot TEXT;

UPDATE public.time_entries te
SET worker_name_snapshot = rp.display_name
FROM public.roster_people rp
WHERE te.roster_person_id = rp.id AND te.worker_name_snapshot IS NULL;

ALTER TABLE public.time_entries ALTER COLUMN roster_person_id DROP NOT NULL;
ALTER TABLE public.time_entries ALTER COLUMN created_by_id DROP NOT NULL;

ALTER TABLE public.time_entries DROP CONSTRAINT IF EXISTS fk_time_person;
ALTER TABLE public.time_entries ADD CONSTRAINT fk_time_person 
    FOREIGN KEY (workspace_id, roster_person_id) 
    REFERENCES public.roster_people(workspace_id, id) ON DELETE SET NULL;

ALTER TABLE public.time_entries DROP CONSTRAINT IF EXISTS fk_time_created_by;
ALTER TABLE public.time_entries ADD CONSTRAINT fk_time_created_by 
    FOREIGN KEY (workspace_id, created_by_id) 
    REFERENCES public.roster_people(workspace_id, id) ON DELETE SET NULL;

ALTER TABLE public.time_entries DROP CONSTRAINT IF EXISTS fk_time_voided_by;
ALTER TABLE public.time_entries ADD CONSTRAINT fk_time_voided_by 
    FOREIGN KEY (workspace_id, voided_by_id) 
    REFERENCES public.roster_people(workspace_id, id) ON DELETE SET NULL;

-- 3.2 review_rounds
ALTER TABLE public.review_rounds ADD COLUMN IF NOT EXISTS submitter_name_snapshot TEXT;
ALTER TABLE public.review_rounds ADD COLUMN IF NOT EXISTS reviewer_name_snapshot TEXT;

UPDATE public.review_rounds rr
SET submitter_name_snapshot = rp.display_name
FROM public.roster_people rp
WHERE rr.submitter_id = rp.id AND rr.submitter_name_snapshot IS NULL;

UPDATE public.review_rounds rr
SET reviewer_name_snapshot = rp.display_name
FROM public.roster_people rp
WHERE rr.reviewer_id = rp.id AND rr.reviewer_name_snapshot IS NULL;

ALTER TABLE public.review_rounds ALTER COLUMN submitter_id DROP NOT NULL;
ALTER TABLE public.review_rounds ALTER COLUMN reviewer_id DROP NOT NULL;

ALTER TABLE public.review_rounds DROP CONSTRAINT IF EXISTS fk_round_submitter;
ALTER TABLE public.review_rounds ADD CONSTRAINT fk_round_submitter 
    FOREIGN KEY (workspace_id, submitter_id) 
    REFERENCES public.roster_people(workspace_id, id) ON DELETE SET NULL;

ALTER TABLE public.review_rounds DROP CONSTRAINT IF EXISTS fk_round_reviewer;
ALTER TABLE public.review_rounds ADD CONSTRAINT fk_round_reviewer 
    FOREIGN KEY (workspace_id, reviewer_id) 
    REFERENCES public.roster_people(workspace_id, id) ON DELETE SET NULL;

-- 3.3 task_deliverables
ALTER TABLE public.task_deliverables ADD COLUMN IF NOT EXISTS submitted_by_name_snapshot TEXT;

UPDATE public.task_deliverables td
SET submitted_by_name_snapshot = rp.display_name
FROM public.roster_people rp
WHERE td.submitted_by_id = rp.id AND td.submitted_by_name_snapshot IS NULL;

ALTER TABLE public.task_deliverables ALTER COLUMN submitted_by_id DROP NOT NULL;

ALTER TABLE public.task_deliverables DROP CONSTRAINT IF EXISTS task_deliverables_submitted_by_id_fkey;
ALTER TABLE public.task_deliverables ADD CONSTRAINT task_deliverables_submitted_by_id_fkey 
    FOREIGN KEY (submitted_by_id) 
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

-- 3.4 comments
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS author_name_snapshot TEXT;

UPDATE public.comments c
SET author_name_snapshot = rp.display_name
FROM public.roster_people rp
WHERE c.author_roster_id = rp.id AND c.author_name_snapshot IS NULL;

ALTER TABLE public.comments ALTER COLUMN author_roster_id DROP NOT NULL;

ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS fk_comment_author;
ALTER TABLE public.comments ADD CONSTRAINT fk_comment_author 
    FOREIGN KEY (workspace_id, author_roster_id) 
    REFERENCES public.roster_people(workspace_id, id) ON DELETE SET NULL;

-- 3.5 tasks (Assignee & Reviewer FKs)
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_task_primary_assignee;
ALTER TABLE public.tasks ADD CONSTRAINT fk_task_primary_assignee 
    FOREIGN KEY (workspace_id, primary_assignee_id) 
    REFERENCES public.roster_people(workspace_id, id) ON DELETE SET NULL;

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_task_reviewer;
ALTER TABLE public.tasks ADD CONSTRAINT fk_task_reviewer 
    FOREIGN KEY (workspace_id, reviewer_id) 
    REFERENCES public.roster_people(workspace_id, id) ON DELETE SET NULL;

-- 3.6 task event ledgers
ALTER TABLE public.task_status_events DROP CONSTRAINT IF EXISTS fk_tse_actor;
ALTER TABLE public.task_status_events ADD CONSTRAINT fk_tse_actor 
    FOREIGN KEY (workspace_id, actor_id) 
    REFERENCES public.roster_people(workspace_id, id) ON DELETE SET NULL;

ALTER TABLE public.task_assignment_events DROP CONSTRAINT IF EXISTS fk_tae_actor;
ALTER TABLE public.task_assignment_events ADD CONSTRAINT fk_tae_actor 
    FOREIGN KEY (workspace_id, actor_id) 
    REFERENCES public.roster_people(workspace_id, id) ON DELETE SET NULL;

ALTER TABLE public.task_assignment_events DROP CONSTRAINT IF EXISTS fk_tae_prev;
ALTER TABLE public.task_assignment_events ADD CONSTRAINT fk_tae_prev 
    FOREIGN KEY (workspace_id, previous_assignee_id) 
    REFERENCES public.roster_people(workspace_id, id) ON DELETE SET NULL;

ALTER TABLE public.task_assignment_events DROP CONSTRAINT IF EXISTS fk_tae_new;
ALTER TABLE public.task_assignment_events ADD CONSTRAINT fk_tae_new 
    FOREIGN KEY (workspace_id, new_assignee_id) 
    REFERENCES public.roster_people(workspace_id, id) ON DELETE SET NULL;

ALTER TABLE public.task_due_date_events DROP CONSTRAINT IF EXISTS fk_tdde_actor;
ALTER TABLE public.task_due_date_events ADD CONSTRAINT fk_tdde_actor 
    FOREIGN KEY (workspace_id, actor_id) 
    REFERENCES public.roster_people(workspace_id, id) ON DELETE SET NULL;

-- 3.7 attachments
ALTER TABLE public.attachments ALTER COLUMN uploader_roster_id DROP NOT NULL;
ALTER TABLE public.attachments DROP CONSTRAINT IF EXISTS fk_attachment_uploader;
ALTER TABLE public.attachments ADD CONSTRAINT fk_attachment_uploader 
    FOREIGN KEY (workspace_id, uploader_roster_id) 
    REFERENCES public.roster_people(workspace_id, id) ON DELETE SET NULL;

-- 3.8 in_app_notifications
ALTER TABLE public.in_app_notifications DROP CONSTRAINT IF EXISTS fk_notif_actor;
ALTER TABLE public.in_app_notifications ADD CONSTRAINT fk_notif_actor 
    FOREIGN KEY (workspace_id, actor_roster_id) 
    REFERENCES public.roster_people(workspace_id, id) ON DELETE SET NULL;

-- 3.9 workspace_memberships & invitations: Cascade when roster person is permanently deleted
ALTER TABLE public.workspace_memberships DROP CONSTRAINT IF EXISTS fk_membership_roster;
ALTER TABLE public.workspace_memberships ADD CONSTRAINT fk_membership_roster 
    FOREIGN KEY (workspace_id, roster_person_id) 
    REFERENCES public.roster_people(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE public.workspace_invitations DROP CONSTRAINT IF EXISTS fk_invitation_roster;
ALTER TABLE public.workspace_invitations ADD CONSTRAINT fk_invitation_roster 
    FOREIGN KEY (workspace_id, roster_person_id) 
    REFERENCES public.roster_people(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE public.workspace_invitations DROP CONSTRAINT IF EXISTS fk_invitation_inviter;
ALTER TABLE public.workspace_invitations ADD CONSTRAINT fk_invitation_inviter 
    FOREIGN KEY (workspace_id, invited_by_roster_id) 
    REFERENCES public.roster_people(workspace_id, id) ON DELETE CASCADE;


-- 4. RPC: get_member_delete_impact
CREATE OR REPLACE FUNCTION public.get_member_delete_impact(
    p_workspace_id UUID,
    p_roster_person_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
    v_open_tasks JSONB;
    v_assigned_clients JSONB;
    v_has_active_timer BOOLEAN := FALSE;
    v_active_admins_count INT := 0;
    v_is_last_admin BOOLEAN := FALSE;
    v_target_person RECORD;
    v_target_membership RECORD;
BEGIN
    SELECT * INTO v_target_person
    FROM public.roster_people
    WHERE workspace_id = p_workspace_id AND id = p_roster_person_id;

    IF v_target_person.id IS NULL THEN
        RAISE EXCEPTION 'العضو غير موجود.';
    END IF;

    SELECT * INTO v_target_membership
    FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id AND roster_person_id = p_roster_person_id AND is_active = TRUE;

    -- Check if target is last admin
    IF v_target_person.role IN ('owner', 'company_owner') OR (v_target_membership.id IS NOT NULL AND v_target_membership.role IN ('owner', 'company_owner')) THEN
        SELECT COUNT(*) INTO v_active_admins_count
        FROM public.workspace_memberships
        WHERE workspace_id = p_workspace_id AND role IN ('owner', 'company_owner') AND is_active = TRUE;

        IF v_active_admins_count <= 1 THEN
            v_is_last_admin := TRUE;
        END IF;
    END IF;

    -- Active timer
    SELECT EXISTS (
        SELECT 1 FROM public.time_entries
        WHERE workspace_id = p_workspace_id AND roster_person_id = p_roster_person_id AND ended_at IS NULL
    ) INTO v_has_active_timer;

    -- Open tasks
    SELECT jsonb_agg(jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'status', t.status,
        'is_assignee', (t.primary_assignee_id = p_roster_person_id),
        'is_reviewer', (t.reviewer_id = p_roster_person_id)
    )) INTO v_open_tasks
    FROM public.tasks t
    WHERE t.workspace_id = p_workspace_id
      AND (t.primary_assignee_id = p_roster_person_id OR t.reviewer_id = p_roster_person_id)
      AND t.status NOT IN ('delivered', 'cancelled');

    -- Assigned clients
    SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'track', CASE
            WHEN c.owner_roster_id = p_roster_person_id OR cta.primary_designer_id = p_roster_person_id THEN 'التصميم'
            WHEN cta.primary_strategist_id = p_roster_person_id THEN 'الاستراتيجية'
            WHEN cta.primary_copywriter_id = p_roster_person_id THEN 'كتابة المحتوى'
            WHEN cta.primary_video_editor_id = p_roster_person_id THEN 'المونتاج'
            WHEN cta.design_reviewer_id = p_roster_person_id THEN 'مراجعة التصميم'
            WHEN cta.strategy_reviewer_id = p_roster_person_id THEN 'مراجعة الاستراتيجية'
            WHEN cta.copywriting_reviewer_id = p_roster_person_id THEN 'مراجعة المحتوى'
            WHEN cta.video_reviewer_id = p_roster_person_id THEN 'مراجعة الفيديو'
            ELSE 'مسؤول'
        END
    )) INTO v_assigned_clients
    FROM public.clients c
    LEFT JOIN public.client_team_assignments cta ON c.id = cta.client_id
    WHERE c.workspace_id = p_workspace_id
      AND (
          c.owner_roster_id = p_roster_person_id OR
          cta.primary_designer_id = p_roster_person_id OR
          cta.primary_strategist_id = p_roster_person_id OR
          cta.primary_copywriter_id = p_roster_person_id OR
          cta.primary_video_editor_id = p_roster_person_id OR
          cta.design_reviewer_id = p_roster_person_id OR
          cta.strategy_reviewer_id = p_roster_person_id OR
          cta.copywriting_reviewer_id = p_roster_person_id OR
          cta.video_reviewer_id = p_roster_person_id
      );

    RETURN jsonb_build_object(
        'display_name', v_target_person.display_name,
        'role', v_target_person.role,
        'is_last_admin', v_is_last_admin,
        'has_active_timer', v_has_active_timer,
        'open_tasks', COALESCE(v_open_tasks, '[]'::jsonb),
        'open_tasks_count', jsonb_array_length(COALESCE(v_open_tasks, '[]'::jsonb)),
        'assigned_clients', COALESCE(v_assigned_clients, '[]'::jsonb),
        'assigned_clients_count', jsonb_array_length(COALESCE(v_assigned_clients, '[]'::jsonb))
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_member_delete_impact(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_delete_impact(UUID, UUID) TO authenticated, service_role;


-- 5. RPC: admin_hard_delete_roster_member
CREATE OR REPLACE FUNCTION public.admin_hard_delete_roster_member(
    p_workspace_id UUID,
    p_roster_person_id UUID,
    p_reassign_to_roster_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
    v_is_service_role BOOLEAN;
    v_caller RECORD;
    v_actor_roster UUID;
    v_target_person RECORD;
    v_target_membership RECORD;
    v_reassign_person RECORD;
    v_active_admins_count INT;
    v_active_timer RECORD;
    v_elapsed_seconds INT;
BEGIN
    v_is_service_role := (current_setting('request.jwt.claim.role', true) = 'service_role');
    IF NOT v_is_service_role THEN
        SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
        IF v_caller.role NOT IN ('owner', 'company_owner') THEN
            RAISE EXCEPTION 'غير مصرح: حذف الأعضاء مقتصر على المدير العام ومالك الشركة فقط.';
        END IF;
        v_actor_roster := v_caller.roster_person_id;
    ELSE
        SELECT roster_person_id INTO v_actor_roster
        FROM public.workspace_memberships
        WHERE workspace_id = p_workspace_id AND role IN ('owner', 'company_owner') AND is_active = TRUE
        LIMIT 1;
    END IF;

    -- 1. Check target existence
    SELECT * INTO v_target_person
    FROM public.roster_people
    WHERE workspace_id = p_workspace_id AND id = p_roster_person_id;

    IF v_target_person.id IS NULL THEN
        RAISE EXCEPTION 'عضو الفريق غير موجود.';
    END IF;

    -- 2. Check if target is last active admin
    SELECT * INTO v_target_membership
    FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id AND roster_person_id = p_roster_person_id AND is_active = TRUE;

    IF v_target_person.role IN ('owner', 'company_owner') OR (v_target_membership.id IS NOT NULL AND v_target_membership.role IN ('owner', 'company_owner')) THEN
        SELECT COUNT(*) INTO v_active_admins_count
        FROM public.workspace_memberships
        WHERE workspace_id = p_workspace_id AND role IN ('owner', 'company_owner') AND is_active = TRUE;

        IF v_active_admins_count <= 1 THEN
            RAISE EXCEPTION 'لا يمكن حذف آخر مدير نظام نشط في مساحة العمل.';
        END IF;
    END IF;

    -- 3. If reassign target is provided, verify it exists and is active
    IF p_reassign_to_roster_id IS NOT NULL THEN
        IF p_reassign_to_roster_id = p_roster_person_id THEN
            RAISE EXCEPTION 'لا يمكن إعادة الإسناد لنفس العضو المراد حذفه.';
        END IF;
        SELECT * INTO v_reassign_person
        FROM public.roster_people
        WHERE workspace_id = p_workspace_id AND id = p_reassign_to_roster_id AND is_active = TRUE;
        IF v_reassign_person.id IS NULL THEN
            RAISE EXCEPTION 'عضو إعادة الإسناد غير موجود أو معطل.';
        END IF;
    END IF;

    -- 4. Stop active timer if running
    SELECT * INTO v_active_timer
    FROM public.time_entries
    WHERE workspace_id = p_workspace_id AND roster_person_id = p_roster_person_id AND ended_at IS NULL
    LIMIT 1;

    IF v_active_timer.id IS NOT NULL THEN
        v_elapsed_seconds := GREATEST(1, EXTRACT(EPOCH FROM (pg_catalog.now() - v_active_timer.started_at))::INT);
        UPDATE public.time_entries
        SET ended_at = pg_catalog.now(),
            duration_seconds = v_elapsed_seconds,
            updated_at = pg_catalog.now()
        WHERE id = v_active_timer.id;
    END IF;

    -- 5. Snapshot name into historical records
    UPDATE public.time_entries
    SET worker_name_snapshot = COALESCE(worker_name_snapshot, v_target_person.display_name)
    WHERE workspace_id = p_workspace_id AND roster_person_id = p_roster_person_id;

    UPDATE public.review_rounds
    SET submitter_name_snapshot = COALESCE(submitter_name_snapshot, v_target_person.display_name)
    WHERE workspace_id = p_workspace_id AND submitter_id = p_roster_person_id;

    UPDATE public.review_rounds
    SET reviewer_name_snapshot = COALESCE(reviewer_name_snapshot, v_target_person.display_name)
    WHERE workspace_id = p_workspace_id AND reviewer_id = p_roster_person_id;

    UPDATE public.task_deliverables
    SET submitted_by_name_snapshot = COALESCE(submitted_by_name_snapshot, v_target_person.display_name)
    WHERE workspace_id = p_workspace_id AND submitted_by_id = p_roster_person_id;

    UPDATE public.comments
    SET author_name_snapshot = COALESCE(author_name_snapshot, v_target_person.display_name)
    WHERE workspace_id = p_workspace_id AND author_roster_id = p_roster_person_id;

    -- 6. Reassign or unassign tasks
    IF p_reassign_to_roster_id IS NOT NULL THEN
        -- When reassigning primary_assignee_id: if reviewer_id is already the reassign target, clear reviewer_id to satisfy chk_task_reviewer_assignee
        UPDATE public.tasks
        SET primary_assignee_id = p_reassign_to_roster_id,
            reviewer_id = CASE WHEN reviewer_id = p_reassign_to_roster_id THEN NULL ELSE reviewer_id END,
            updated_at = pg_catalog.now()
        WHERE workspace_id = p_workspace_id AND primary_assignee_id = p_roster_person_id;

        -- When reassigning reviewer_id: if primary_assignee_id is already the reassign target, leave reviewer_id NULL to satisfy chk_task_reviewer_assignee
        UPDATE public.tasks
        SET reviewer_id = CASE WHEN primary_assignee_id = p_reassign_to_roster_id THEN NULL ELSE p_reassign_to_roster_id END,
            updated_at = pg_catalog.now()
        WHERE workspace_id = p_workspace_id AND reviewer_id = p_roster_person_id;
    ELSE
        UPDATE public.tasks
        SET primary_assignee_id = NULL,
            updated_at = pg_catalog.now()
        WHERE workspace_id = p_workspace_id AND primary_assignee_id = p_roster_person_id;

        UPDATE public.tasks
        SET reviewer_id = NULL,
            updated_at = pg_catalog.now()
        WHERE workspace_id = p_workspace_id AND reviewer_id = p_roster_person_id;
    END IF;

    -- 7. Reassign or clear client assignments
    IF p_reassign_to_roster_id IS NOT NULL THEN
        UPDATE public.clients
        SET owner_roster_id = p_reassign_to_roster_id,
            updated_at = pg_catalog.now()
        WHERE workspace_id = p_workspace_id AND owner_roster_id = p_roster_person_id;

        UPDATE public.client_team_assignments
        SET primary_designer_id = CASE WHEN primary_designer_id = p_roster_person_id THEN p_reassign_to_roster_id ELSE primary_designer_id END,
            primary_strategist_id = CASE WHEN primary_strategist_id = p_roster_person_id THEN p_reassign_to_roster_id ELSE primary_strategist_id END,
            primary_copywriter_id = CASE WHEN primary_copywriter_id = p_roster_person_id THEN p_reassign_to_roster_id ELSE primary_copywriter_id END,
            primary_video_editor_id = CASE WHEN primary_video_editor_id = p_roster_person_id THEN p_reassign_to_roster_id ELSE primary_video_editor_id END,
            strategy_reviewer_id = CASE WHEN strategy_reviewer_id = p_roster_person_id THEN p_reassign_to_roster_id ELSE strategy_reviewer_id END,
            copywriting_reviewer_id = CASE WHEN copywriting_reviewer_id = p_roster_person_id THEN p_reassign_to_roster_id ELSE copywriting_reviewer_id END,
            design_reviewer_id = CASE WHEN design_reviewer_id = p_roster_person_id THEN p_reassign_to_roster_id ELSE design_reviewer_id END,
            video_reviewer_id = CASE WHEN video_reviewer_id = p_roster_person_id THEN p_reassign_to_roster_id ELSE video_reviewer_id END,
            updated_at = pg_catalog.now()
        WHERE workspace_id = p_workspace_id;
    ELSE
        UPDATE public.clients
        SET owner_roster_id = NULL,
            updated_at = pg_catalog.now()
        WHERE workspace_id = p_workspace_id AND owner_roster_id = p_roster_person_id;

        UPDATE public.client_team_assignments
        SET primary_designer_id = CASE WHEN primary_designer_id = p_roster_person_id THEN NULL ELSE primary_designer_id END,
            primary_strategist_id = CASE WHEN primary_strategist_id = p_roster_person_id THEN NULL ELSE primary_strategist_id END,
            primary_copywriter_id = CASE WHEN primary_copywriter_id = p_roster_person_id THEN NULL ELSE primary_copywriter_id END,
            primary_video_editor_id = CASE WHEN primary_video_editor_id = p_roster_person_id THEN NULL ELSE primary_video_editor_id END,
            strategy_reviewer_id = CASE WHEN strategy_reviewer_id = p_roster_person_id THEN NULL ELSE strategy_reviewer_id END,
            copywriting_reviewer_id = CASE WHEN copywriting_reviewer_id = p_roster_person_id THEN NULL ELSE copywriting_reviewer_id END,
            design_reviewer_id = CASE WHEN design_reviewer_id = p_roster_person_id THEN NULL ELSE design_reviewer_id END,
            video_reviewer_id = CASE WHEN video_reviewer_id = p_roster_person_id THEN NULL ELSE video_reviewer_id END,
            updated_at = pg_catalog.now()
        WHERE workspace_id = p_workspace_id;
    END IF;

    -- 8. Delete task collaborators
    DELETE FROM public.task_collaborators
    WHERE workspace_id = p_workspace_id AND roster_person_id = p_roster_person_id;

    -- 9. Delete routing rules
    DELETE FROM public.review_routing_rules
    WHERE workspace_id = p_workspace_id AND (designer_roster_id = p_roster_person_id OR reviewer_roster_id = p_roster_person_id OR fallback_reviewer_id = p_roster_person_id);

    -- 10. Delete pending/draft invitations
    DELETE FROM public.workspace_invitations
    WHERE workspace_id = p_workspace_id AND roster_person_id = p_roster_person_id;

    -- 11. Delete workspace memberships (revoking access immediately)
    DELETE FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id AND roster_person_id = p_roster_person_id;

    -- 12. Delete from roster_people permanently
    DELETE FROM public.roster_people
    WHERE workspace_id = p_workspace_id AND id = p_roster_person_id;

    -- 13. Audit log
    INSERT INTO public.audit_events (
        workspace_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        p_workspace_id,
        v_actor_roster,
        'hard_delete_roster_member',
        'roster_people',
        p_roster_person_id,
        jsonb_build_object(
            'deleted_display_name', v_target_person.display_name,
            'deleted_role', v_target_person.role,
            'reassigned_to', p_reassign_to_roster_id
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'deleted_roster_id', p_roster_person_id,
        'reassigned_to', p_reassign_to_roster_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_hard_delete_roster_member(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_hard_delete_roster_member(UUID, UUID, UUID) TO authenticated, service_role;


-- 6. Update toggle_workspace_member_active to protect Company Owner and allow Company Owner execution
CREATE OR REPLACE FUNCTION public.toggle_workspace_member_active(
    p_workspace_id UUID,
    p_roster_person_id UUID,
    p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
    v_caller RECORD;
    v_target_membership RECORD;
    v_target_person RECORD;
    v_is_service_role BOOLEAN;
    v_actor_roster UUID;
    v_active_admins_count INT;
BEGIN
    v_is_service_role := (current_setting('request.jwt.claim.role', true) = 'service_role');

    IF NOT v_is_service_role THEN
        SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
        IF v_caller.role NOT IN ('owner', 'company_owner') THEN
            RAISE EXCEPTION 'غير مصرح: تعديل حالة التفعيل مقتصر على المدير العام ومالك الشركة فقط.';
        END IF;
        v_actor_roster := v_caller.roster_person_id;
    ELSE
        SELECT roster_person_id INTO v_actor_roster
        FROM public.workspace_memberships
        WHERE workspace_id = p_workspace_id AND role IN ('owner', 'company_owner') AND is_active = TRUE
        LIMIT 1;
    END IF;

    -- Target checks
    SELECT * INTO v_target_person
    FROM public.roster_people
    WHERE workspace_id = p_workspace_id AND id = p_roster_person_id;

    IF v_target_person.id IS NULL THEN
        RAISE EXCEPTION 'العضو غير موجود.';
    END IF;

    SELECT * INTO v_target_membership
    FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id AND roster_person_id = p_roster_person_id;

    -- Protect last active admin from deactivation
    IF (v_target_person.role IN ('owner', 'company_owner') OR (v_target_membership.id IS NOT NULL AND v_target_membership.role IN ('owner', 'company_owner'))) AND p_is_active = FALSE THEN
        SELECT COUNT(*) INTO v_active_admins_count
        FROM public.workspace_memberships
        WHERE workspace_id = p_workspace_id AND role IN ('owner', 'company_owner') AND is_active = TRUE;

        IF v_active_admins_count <= 1 THEN
            RAISE EXCEPTION 'لا يمكن تعطيل حساب آخر مدير نظام نشط في مساحة العمل.';
        END IF;
    END IF;

    -- Update roster_people
    UPDATE public.roster_people
    SET is_active = p_is_active,
        updated_at = pg_catalog.now()
    WHERE workspace_id = p_workspace_id AND id = p_roster_person_id;

    -- Update workspace_memberships if exists
    IF v_target_membership.id IS NOT NULL THEN
        UPDATE public.workspace_memberships
        SET is_active = p_is_active,
            updated_at = pg_catalog.now()
        WHERE id = v_target_membership.id;
    END IF;

    -- Audit log
    INSERT INTO public.audit_events (
        workspace_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        p_workspace_id,
        v_actor_roster,
        CASE WHEN p_is_active THEN 'activate_member' ELSE 'deactivate_member' END,
        'workspace_memberships',
        COALESCE(v_target_membership.id, p_roster_person_id),
        jsonb_build_object(
            'roster_person_id', p_roster_person_id,
            'is_active', p_is_active
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'roster_person_id', p_roster_person_id,
        'is_active', p_is_active
    );
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_workspace_member_active(UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_workspace_member_active(UUID, UUID, BOOLEAN) TO authenticated, service_role;


-- 7. Realtime Publications
DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
    EXCEPTION WHEN duplicate_object THEN END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.clients;
    EXCEPTION WHEN duplicate_object THEN END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.roster_people;
    EXCEPTION WHEN duplicate_object THEN END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_memberships;
    EXCEPTION WHEN duplicate_object THEN END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.in_app_notifications;
    EXCEPTION WHEN duplicate_object THEN END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.time_entries;
    EXCEPTION WHEN duplicate_object THEN END;
END $$;

COMMIT;
