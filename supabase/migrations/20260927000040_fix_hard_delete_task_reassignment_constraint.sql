-- Migration 40: Fix Task Reassignment Constraint in Hard Delete RPC
-- Ensures primary_assignee_id <> reviewer_id when reassigning tasks to prevent chk_task_reviewer_assignee violation

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

    -- 6. Reassign or unassign tasks cleanly preventing chk_task_reviewer_assignee conflict
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
