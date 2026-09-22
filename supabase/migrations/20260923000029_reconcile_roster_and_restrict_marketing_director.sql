-- Migration 29: Roster Reconciliation, Encoding Repair, and Marketing Director Restriction
-- OMG Creative Workspace

-- 1. Extend roster_role ENUM safely if needed
ALTER TYPE public.roster_role ADD VALUE IF NOT EXISTS 'marketing_director';
ALTER TYPE public.roster_role ADD VALUE IF NOT EXISTS 'strategy_lead';
ALTER TYPE public.roster_role ADD VALUE IF NOT EXISTS 'strategist';
ALTER TYPE public.roster_role ADD VALUE IF NOT EXISTS 'content_writer';
ALTER TYPE public.roster_role ADD VALUE IF NOT EXISTS 'video_editor';

-- 2. Hardened RPCs for RBAC and Review Workflows
BEGIN;

-- 2.1 RPC HARDENING: APPROVE CLIENT BRIEF STRATEGY
-- Restrict final approval strictly to Workspace Owner (Emad)
-- Remove Ata / Marketing Director requirement completely
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

    -- Strict authorization: ONLY Workspace Owner can grant final workspace strategy approval
    IF v_caller.role <> 'owner' THEN
        RAISE EXCEPTION 'Access denied: Only Workspace Owner can grant final workspace strategy approval.';
    END IF;

    SELECT * INTO v_brief FROM public.client_briefs
    WHERE workspace_id = p_workspace_id AND client_id = p_client_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Client brief not found.';
    END IF;

    -- Enforce prerequisite: Operational review must be completed first
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

GRANT EXECUTE ON FUNCTION public.approve_client_brief_strategy(UUID, UUID, TEXT, TEXT) TO authenticated, service_role;

-- Hardening operational review for Strategy Lead
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

    SELECT * INTO v_brief FROM public.client_briefs
    WHERE workspace_id = p_workspace_id AND client_id = p_client_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Client brief not found.';
    END IF;

    SELECT * INTO v_team FROM public.client_team_assignments
    WHERE workspace_id = p_workspace_id AND client_id = p_client_id;

    -- Operational Reviewer authorization: Owner, Strategy Team Lead (Arwa), or assigned Strategy Reviewer for this client
    IF v_caller.role NOT IN ('owner', 'strategy_lead')
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

GRANT EXECUTE ON FUNCTION public.review_client_brief_operational(UUID, UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;


-- 7. RPC HARDENING: DECIDE REVIEW ROUND
-- Explicitly forbid marketing_director from deciding review rounds or requesting changes
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

    -- Strict Restriction: Marketing Director cannot review or approve/reject deliverables
    IF v_caller.role = 'marketing_director' THEN
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
        IF v_caller.role NOT IN ('owner', 'manager') THEN
            RAISE EXCEPTION 'Only Owner or Manager can record decisions for client review rounds.';
        END IF;
    ELSE
        IF v_caller.roster_person_id <> v_round.reviewer_id AND v_caller.role NOT IN ('owner', 'manager') THEN
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

    UPDATE public.tasks
    SET status = v_new_task_status,
        updated_at = pg_catalog.now()
    WHERE id = v_task.id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'round_id', v_round.id,
        'task_id', v_task.id,
        'decision', p_decision,
        'status', v_new_task_status
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 8. RPC HARDENING: UPSERT CLIENT TEAM ASSIGNMENT
-- Strictly Owner only can configure client team assignments
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
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller RECORD;
    v_res RECORD;
BEGIN
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);

    -- Strictly Owner can configure client team assignments
    IF v_caller.role <> 'owner' THEN
        RAISE EXCEPTION 'Access denied: Only Workspace Owner can configure client team assignments.';
    END IF;

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
        updated_at = pg_catalog.now()
    RETURNING * INTO v_res;

    RETURN to_jsonb(v_res);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

COMMIT;
