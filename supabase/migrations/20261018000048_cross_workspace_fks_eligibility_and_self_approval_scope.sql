-- =============================================================================
-- Migration 48: Cross-Workspace Composite FK Integrity (Column-Specific ON DELETE SET NULL),
-- Explicit Pre-Onboarding Executor/Reviewer Eligibility, and Narrow Owner-Only Self-Approval Scope
-- =============================================================================

BEGIN;

LOCK TABLE
    public.roster_people,
    public.clients,
    public.tasks,
    public.campaigns,
    public.content_calendar_items,
    public.review_rounds,
    public.time_entries,
    public.comments,
    public.task_status_events,
    public.task_assignment_events,
    public.task_due_date_events,
    public.attachments,
    public.in_app_notifications,
    public.workspace_memberships,
    public.workspace_invitations,
    public.audit_events,
    public.rpc_idempotency_records,
    public.time_change_requests,
    public.client_team_assignments,
    public.client_briefs,
    public.task_deliverables
IN ACCESS EXCLUSIVE MODE;

-- =============================================================================
-- 1. ENSURE COMPOSITE UNIQUE KEYS ON REFERENCED PARENT TABLES
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_cci_composite'
          AND conrelid = 'public.content_calendar_items'::regclass
    ) THEN
        ALTER TABLE public.content_calendar_items
            ADD CONSTRAINT uq_cci_composite UNIQUE (workspace_id, id);
    END IF;
END;
$$;

-- Ensure workspace_invitations.invited_by_roster_id is nullable so ON DELETE SET NULL (invited_by_roster_id) preserves invitation history
ALTER TABLE public.workspace_invitations ALTER COLUMN invited_by_roster_id DROP NOT NULL;

-- =============================================================================
-- 2. RESTORE COMPOSITE (workspace_id, col_id) FOREIGN KEYS WITH COLUMN-SPECIFIC
--    ON DELETE SET NULL (col_id) OR ON DELETE CASCADE ACROSS ALL TABLES
-- =============================================================================

-- 2.1 time_entries
ALTER TABLE public.time_entries DROP CONSTRAINT IF EXISTS fk_time_person;
ALTER TABLE public.time_entries ADD CONSTRAINT fk_time_person
    FOREIGN KEY (workspace_id, roster_person_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (roster_person_id);

ALTER TABLE public.time_entries DROP CONSTRAINT IF EXISTS fk_time_created_by;
ALTER TABLE public.time_entries ADD CONSTRAINT fk_time_created_by
    FOREIGN KEY (workspace_id, created_by_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (created_by_id);

ALTER TABLE public.time_entries DROP CONSTRAINT IF EXISTS fk_time_voided_by;
ALTER TABLE public.time_entries ADD CONSTRAINT fk_time_voided_by
    FOREIGN KEY (workspace_id, voided_by_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (voided_by_id);

ALTER TABLE public.time_entries DROP CONSTRAINT IF EXISTS fk_time_round;
ALTER TABLE public.time_entries ADD CONSTRAINT fk_time_round
    FOREIGN KEY (workspace_id, review_round_id)
    REFERENCES public.review_rounds(workspace_id, id)
    ON DELETE SET NULL (review_round_id);

-- 2.2 review_rounds
ALTER TABLE public.review_rounds DROP CONSTRAINT IF EXISTS fk_round_submitter;
ALTER TABLE public.review_rounds ADD CONSTRAINT fk_round_submitter
    FOREIGN KEY (workspace_id, submitter_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (submitter_id);

ALTER TABLE public.review_rounds DROP CONSTRAINT IF EXISTS fk_round_reviewer;
ALTER TABLE public.review_rounds ADD CONSTRAINT fk_round_reviewer
    FOREIGN KEY (workspace_id, reviewer_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (reviewer_id);

-- 2.3 comments
ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS fk_comment_author;
ALTER TABLE public.comments ADD CONSTRAINT fk_comment_author
    FOREIGN KEY (workspace_id, author_roster_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (author_roster_id);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'comments' AND column_name = 'resolved_by_roster_id'
    ) THEN
        ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_resolved_by_roster_id_fkey;
        ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS fk_comment_resolver;
        ALTER TABLE public.comments ADD CONSTRAINT comments_resolved_by_roster_id_fkey
            FOREIGN KEY (workspace_id, resolved_by_roster_id)
            REFERENCES public.roster_people(workspace_id, id)
            ON DELETE SET NULL (resolved_by_roster_id);
    END IF;
END;
$$;

-- 2.4 tasks
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_task_primary_assignee;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_task_assignee;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_primary_assignee_id_fkey;
ALTER TABLE public.tasks ADD CONSTRAINT fk_task_assignee
    FOREIGN KEY (workspace_id, primary_assignee_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (primary_assignee_id);

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_task_reviewer;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_reviewer_id_fkey;
ALTER TABLE public.tasks ADD CONSTRAINT fk_task_reviewer
    FOREIGN KEY (workspace_id, reviewer_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (reviewer_id);

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_task_created_by;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_created_by_id_fkey;
ALTER TABLE public.tasks ADD CONSTRAINT fk_task_created_by
    FOREIGN KEY (workspace_id, created_by_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (created_by_id);

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_task_archived_by;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_archived_by_id_fkey;
ALTER TABLE public.tasks ADD CONSTRAINT fk_task_archived_by
    FOREIGN KEY (workspace_id, archived_by_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (archived_by_id);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'waiting_on_roster_id'
    ) THEN
        ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_waiting_on_roster_id_fkey;
        ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_task_waiting_on_roster;
        ALTER TABLE public.tasks ADD CONSTRAINT fk_task_waiting_on_roster
            FOREIGN KEY (workspace_id, waiting_on_roster_id)
            REFERENCES public.roster_people(workspace_id, id)
            ON DELETE SET NULL (waiting_on_roster_id);
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'dependency_task_id'
    ) THEN
        ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_dependency_task_id_fkey;
        ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_task_dependency;
        ALTER TABLE public.tasks ADD CONSTRAINT fk_task_dependency
            FOREIGN KEY (workspace_id, dependency_task_id)
            REFERENCES public.tasks(workspace_id, id)
            ON DELETE SET NULL (dependency_task_id);
    END IF;
END;
$$;

-- 2.5 task event ledgers
ALTER TABLE public.task_status_events DROP CONSTRAINT IF EXISTS fk_tse_actor;
ALTER TABLE public.task_status_events ADD CONSTRAINT fk_tse_actor
    FOREIGN KEY (workspace_id, actor_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (actor_id);

ALTER TABLE public.task_status_events DROP CONSTRAINT IF EXISTS fk_tse_round;
ALTER TABLE public.task_status_events ADD CONSTRAINT fk_tse_round
    FOREIGN KEY (workspace_id, review_round_id)
    REFERENCES public.review_rounds(workspace_id, id)
    ON DELETE SET NULL (review_round_id);

ALTER TABLE public.task_assignment_events DROP CONSTRAINT IF EXISTS fk_tae_actor;
ALTER TABLE public.task_assignment_events ADD CONSTRAINT fk_tae_actor
    FOREIGN KEY (workspace_id, actor_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (actor_id);

ALTER TABLE public.task_assignment_events DROP CONSTRAINT IF EXISTS fk_tae_prev;
ALTER TABLE public.task_assignment_events ADD CONSTRAINT fk_tae_prev
    FOREIGN KEY (workspace_id, previous_assignee_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (previous_assignee_id);

ALTER TABLE public.task_assignment_events DROP CONSTRAINT IF EXISTS fk_tae_new;
ALTER TABLE public.task_assignment_events ADD CONSTRAINT fk_tae_new
    FOREIGN KEY (workspace_id, new_assignee_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (new_assignee_id);

ALTER TABLE public.task_due_date_events DROP CONSTRAINT IF EXISTS fk_tdde_actor;
ALTER TABLE public.task_due_date_events ADD CONSTRAINT fk_tdde_actor
    FOREIGN KEY (workspace_id, actor_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (actor_id);

-- 2.6 attachments
ALTER TABLE public.attachments DROP CONSTRAINT IF EXISTS fk_attachment_uploader;
ALTER TABLE public.attachments ADD CONSTRAINT fk_attachment_uploader
    FOREIGN KEY (workspace_id, uploader_roster_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (uploader_roster_id);

-- 2.7 in_app_notifications
ALTER TABLE public.in_app_notifications DROP CONSTRAINT IF EXISTS fk_notif_actor;
ALTER TABLE public.in_app_notifications ADD CONSTRAINT fk_notif_actor
    FOREIGN KEY (workspace_id, actor_roster_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (actor_roster_id);

ALTER TABLE public.in_app_notifications DROP CONSTRAINT IF EXISTS fk_notif_task;
ALTER TABLE public.in_app_notifications ADD CONSTRAINT fk_notif_task
    FOREIGN KEY (workspace_id, task_id)
    REFERENCES public.tasks(workspace_id, id)
    ON DELETE SET NULL (task_id);

-- 2.8 workspace_memberships & workspace_invitations
ALTER TABLE public.workspace_memberships DROP CONSTRAINT IF EXISTS fk_membership_roster;
ALTER TABLE public.workspace_memberships ADD CONSTRAINT fk_membership_roster
    FOREIGN KEY (workspace_id, roster_person_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE CASCADE;

ALTER TABLE public.workspace_invitations DROP CONSTRAINT IF EXISTS fk_invitation_roster;
ALTER TABLE public.workspace_invitations ADD CONSTRAINT fk_invitation_roster
    FOREIGN KEY (workspace_id, roster_person_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE CASCADE;

ALTER TABLE public.workspace_invitations DROP CONSTRAINT IF EXISTS fk_invitation_inviter;
ALTER TABLE public.workspace_invitations ADD CONSTRAINT fk_invitation_inviter
    FOREIGN KEY (workspace_id, invited_by_roster_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (invited_by_roster_id);

-- 2.9 audit_events & rpc_idempotency_records
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS fk_audit_actor;
ALTER TABLE public.audit_events ADD CONSTRAINT fk_audit_actor
    FOREIGN KEY (workspace_id, actor_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (actor_id);

ALTER TABLE public.rpc_idempotency_records DROP CONSTRAINT IF EXISTS fk_idempotency_actor;
ALTER TABLE public.rpc_idempotency_records ADD CONSTRAINT fk_idempotency_actor
    FOREIGN KEY (workspace_id, actor_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE CASCADE;

-- 2.10 campaigns
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS fk_campaign_created_by;
ALTER TABLE public.campaigns ADD CONSTRAINT fk_campaign_created_by
    FOREIGN KEY (workspace_id, created_by_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (created_by_id);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'uploaded_by_roster_id'
    ) THEN
        ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_uploaded_by_roster_id_fkey;
        ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS fk_campaign_uploaded_by;
        ALTER TABLE public.campaigns ADD CONSTRAINT fk_campaign_uploaded_by
            FOREIGN KEY (workspace_id, uploaded_by_roster_id)
            REFERENCES public.roster_people(workspace_id, id)
            ON DELETE SET NULL (uploaded_by_roster_id);
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'uploader_roster_id'
    ) THEN
        ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_uploader_roster_id_fkey;
        ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS fk_campaign_uploader;
        ALTER TABLE public.campaigns ADD CONSTRAINT fk_campaign_uploader
            FOREIGN KEY (workspace_id, uploader_roster_id)
            REFERENCES public.roster_people(workspace_id, id)
            ON DELETE SET NULL (uploader_roster_id);
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'approved_by_roster_id'
    ) THEN
        ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_approved_by_roster_id_fkey;
        ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS fk_campaign_approved_by;
        ALTER TABLE public.campaigns ADD CONSTRAINT fk_campaign_approved_by
            FOREIGN KEY (workspace_id, approved_by_roster_id)
            REFERENCES public.roster_people(workspace_id, id)
            ON DELETE SET NULL (approved_by_roster_id);
    END IF;
END;
$$;

-- 2.11 content_calendar_items
ALTER TABLE public.content_calendar_items DROP CONSTRAINT IF EXISTS fk_cci_task;
ALTER TABLE public.content_calendar_items DROP CONSTRAINT IF EXISTS content_calendar_items_task_id_fkey;
ALTER TABLE public.content_calendar_items ADD CONSTRAINT fk_cci_task
    FOREIGN KEY (workspace_id, task_id)
    REFERENCES public.tasks(workspace_id, id)
    ON DELETE SET NULL (task_id);

ALTER TABLE public.content_calendar_items DROP CONSTRAINT IF EXISTS content_calendar_items_suggested_assignee_id_fkey;
ALTER TABLE public.content_calendar_items DROP CONSTRAINT IF EXISTS fk_cci_suggested_assignee;
ALTER TABLE public.content_calendar_items ADD CONSTRAINT fk_cci_suggested_assignee
    FOREIGN KEY (workspace_id, suggested_assignee_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (suggested_assignee_id);

ALTER TABLE public.content_calendar_items DROP CONSTRAINT IF EXISTS content_calendar_items_approved_assignee_id_fkey;
ALTER TABLE public.content_calendar_items DROP CONSTRAINT IF EXISTS fk_cci_approved_assignee;
ALTER TABLE public.content_calendar_items ADD CONSTRAINT fk_cci_approved_assignee
    FOREIGN KEY (workspace_id, approved_assignee_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (approved_assignee_id);

-- 2.12 time_change_requests
ALTER TABLE public.time_change_requests ALTER COLUMN requested_by_id DROP NOT NULL;
ALTER TABLE public.time_change_requests DROP CONSTRAINT IF EXISTS fk_tcr_requester;
ALTER TABLE public.time_change_requests ADD CONSTRAINT fk_tcr_requester
    FOREIGN KEY (workspace_id, requested_by_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (requested_by_id);

ALTER TABLE public.time_change_requests DROP CONSTRAINT IF EXISTS fk_tcr_reviewer;
ALTER TABLE public.time_change_requests ADD CONSTRAINT fk_tcr_reviewer
    FOREIGN KEY (workspace_id, reviewed_by_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (reviewed_by_id);

-- 2.13 client_team_assignments
ALTER TABLE public.client_team_assignments DROP CONSTRAINT IF EXISTS client_team_assignments_client_id_fkey;
ALTER TABLE public.client_team_assignments ADD CONSTRAINT client_team_assignments_client_id_fkey
    FOREIGN KEY (workspace_id, client_id)
    REFERENCES public.clients(workspace_id, id)
    ON DELETE CASCADE;

ALTER TABLE public.client_team_assignments DROP CONSTRAINT IF EXISTS client_team_assignments_primary_strategist_id_fkey;
ALTER TABLE public.client_team_assignments ADD CONSTRAINT client_team_assignments_primary_strategist_id_fkey
    FOREIGN KEY (workspace_id, primary_strategist_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (primary_strategist_id);

ALTER TABLE public.client_team_assignments DROP CONSTRAINT IF EXISTS client_team_assignments_primary_copywriter_id_fkey;
ALTER TABLE public.client_team_assignments ADD CONSTRAINT client_team_assignments_primary_copywriter_id_fkey
    FOREIGN KEY (workspace_id, primary_copywriter_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (primary_copywriter_id);

ALTER TABLE public.client_team_assignments DROP CONSTRAINT IF EXISTS client_team_assignments_primary_designer_id_fkey;
ALTER TABLE public.client_team_assignments ADD CONSTRAINT client_team_assignments_primary_designer_id_fkey
    FOREIGN KEY (workspace_id, primary_designer_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (primary_designer_id);

ALTER TABLE public.client_team_assignments DROP CONSTRAINT IF EXISTS client_team_assignments_primary_video_editor_id_fkey;
ALTER TABLE public.client_team_assignments ADD CONSTRAINT client_team_assignments_primary_video_editor_id_fkey
    FOREIGN KEY (workspace_id, primary_video_editor_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (primary_video_editor_id);

ALTER TABLE public.client_team_assignments DROP CONSTRAINT IF EXISTS client_team_assignments_strategy_reviewer_id_fkey;
ALTER TABLE public.client_team_assignments ADD CONSTRAINT client_team_assignments_strategy_reviewer_id_fkey
    FOREIGN KEY (workspace_id, strategy_reviewer_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (strategy_reviewer_id);

ALTER TABLE public.client_team_assignments DROP CONSTRAINT IF EXISTS client_team_assignments_copywriting_reviewer_id_fkey;
ALTER TABLE public.client_team_assignments ADD CONSTRAINT client_team_assignments_copywriting_reviewer_id_fkey
    FOREIGN KEY (workspace_id, copywriting_reviewer_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (copywriting_reviewer_id);

ALTER TABLE public.client_team_assignments DROP CONSTRAINT IF EXISTS client_team_assignments_design_reviewer_id_fkey;
ALTER TABLE public.client_team_assignments ADD CONSTRAINT client_team_assignments_design_reviewer_id_fkey
    FOREIGN KEY (workspace_id, design_reviewer_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (design_reviewer_id);

ALTER TABLE public.client_team_assignments DROP CONSTRAINT IF EXISTS client_team_assignments_video_reviewer_id_fkey;
ALTER TABLE public.client_team_assignments ADD CONSTRAINT client_team_assignments_video_reviewer_id_fkey
    FOREIGN KEY (workspace_id, video_reviewer_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (video_reviewer_id);

ALTER TABLE public.client_team_assignments DROP CONSTRAINT IF EXISTS client_team_assignments_marketing_director_id_fkey;
ALTER TABLE public.client_team_assignments ADD CONSTRAINT client_team_assignments_marketing_director_id_fkey
    FOREIGN KEY (workspace_id, marketing_director_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (marketing_director_id);

ALTER TABLE public.client_team_assignments DROP CONSTRAINT IF EXISTS client_team_assignments_strategy_lead_id_fkey;
ALTER TABLE public.client_team_assignments ADD CONSTRAINT client_team_assignments_strategy_lead_id_fkey
    FOREIGN KEY (workspace_id, strategy_lead_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (strategy_lead_id);

-- 2.14 client_briefs
ALTER TABLE public.client_briefs DROP CONSTRAINT IF EXISTS client_briefs_client_id_fkey;
ALTER TABLE public.client_briefs ADD CONSTRAINT client_briefs_client_id_fkey
    FOREIGN KEY (workspace_id, client_id)
    REFERENCES public.clients(workspace_id, id)
    ON DELETE CASCADE;

ALTER TABLE public.client_briefs DROP CONSTRAINT IF EXISTS client_briefs_approved_by_roster_id_fkey;
ALTER TABLE public.client_briefs DROP CONSTRAINT IF EXISTS fk_brief_approved_by;
ALTER TABLE public.client_briefs ADD CONSTRAINT fk_brief_approved_by
    FOREIGN KEY (workspace_id, approved_by_roster_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (approved_by_roster_id);

ALTER TABLE public.client_briefs DROP CONSTRAINT IF EXISTS client_briefs_operational_review_by_fkey;
ALTER TABLE public.client_briefs DROP CONSTRAINT IF EXISTS fk_brief_operational_review_by;
ALTER TABLE public.client_briefs ADD CONSTRAINT fk_brief_operational_review_by
    FOREIGN KEY (workspace_id, operational_review_by)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (operational_review_by);

-- 2.15 task_deliverables
ALTER TABLE public.task_deliverables DROP CONSTRAINT IF EXISTS task_deliverables_task_id_fkey;
ALTER TABLE public.task_deliverables ADD CONSTRAINT task_deliverables_task_id_fkey
    FOREIGN KEY (workspace_id, task_id)
    REFERENCES public.tasks(workspace_id, id)
    ON DELETE CASCADE;

ALTER TABLE public.task_deliverables DROP CONSTRAINT IF EXISTS task_deliverables_submitted_by_id_fkey;
ALTER TABLE public.task_deliverables ADD CONSTRAINT task_deliverables_submitted_by_id_fkey
    FOREIGN KEY (workspace_id, submitted_by_id)
    REFERENCES public.roster_people(workspace_id, id)
    ON DELETE SET NULL (submitted_by_id);

-- =============================================================================
-- 3. EXPLICIT PRE-ONBOARDING EXECUTOR & REVIEWER ELIGIBILITY HELPERS
-- =============================================================================

CREATE OR REPLACE FUNCTION private.is_eligible_executor(
    p_workspace_id UUID,
    p_roster_person_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.roster_people rp
        LEFT JOIN public.workspace_memberships wm
          ON wm.workspace_id = rp.workspace_id
         AND wm.roster_person_id = rp.id
         AND wm.is_active = TRUE
        WHERE rp.workspace_id = p_workspace_id
          AND rp.id = p_roster_person_id
          AND rp.is_active = TRUE
          AND COALESCE(rp.role, 'designer') NOT IN ('business_owner_viewer', 'marketing_director')
          AND COALESCE(wm.role, rp.role, 'designer') NOT IN ('business_owner_viewer', 'marketing_director')
    );
$$;

CREATE OR REPLACE FUNCTION private.is_eligible_reviewer(
    p_workspace_id UUID,
    p_roster_person_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.roster_people rp
        LEFT JOIN public.workspace_memberships wm
          ON wm.workspace_id = rp.workspace_id
         AND wm.roster_person_id = rp.id
         AND wm.is_active = TRUE
        WHERE rp.workspace_id = p_workspace_id
          AND rp.id = p_roster_person_id
          AND rp.is_active = TRUE
          AND COALESCE(rp.role, 'designer') NOT IN ('business_owner_viewer', 'marketing_director')
          AND COALESCE(wm.role, rp.role, 'designer') NOT IN ('business_owner_viewer', 'marketing_director')
          AND (
              COALESCE(wm.role, rp.role, 'designer') IN ('owner', 'company_owner', 'manager', 'senior_reviewer', 'strategy_lead')
              OR COALESCE((rp.custom_permissions ->> 'approve_reviews')::boolean, FALSE) = TRUE
              OR COALESCE((wm.custom_permissions ->> 'approve_reviews')::boolean, FALSE) = TRUE
          )
    );
$$;

-- Update private.resolve_task_reviewer to also enforce private.is_eligible_reviewer
CREATE OR REPLACE FUNCTION private.resolve_task_reviewer(
    p_workspace_id UUID,
    p_task_id UUID,
    p_designer_id UUID,
    p_exclude_roster_ids UUID[]
)
RETURNS UUID AS $$
DECLARE
    v_task RECORD;
    v_client RECORD;
    v_candidate UUID;
    v_fallback UUID;
    v_owner_roster_id UUID;
BEGIN
    -- Dynamically resolve active Workspace Owner (Emad, role = 'owner') roster ID
    SELECT wm.roster_person_id INTO v_owner_roster_id
    FROM public.workspace_memberships wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.role = 'owner'
      AND wm.is_active = TRUE
    LIMIT 1;

    -- Narrow Review Bypass: Only if the task designer is the Workspace Owner (Emad)
    IF p_designer_id IS NOT NULL AND p_designer_id = v_owner_roster_id THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
    SELECT * INTO v_client FROM public.clients WHERE id = v_task.client_id;

    -- 1. Specific Designer & Client Difficulty Rule
    SELECT reviewer_roster_id, fallback_reviewer_id
    INTO v_candidate, v_fallback
    FROM public.review_routing_rules
    WHERE workspace_id = p_workspace_id
      AND designer_roster_id = p_designer_id
      AND client_difficulty = v_client.difficulty
    ORDER BY priority DESC
    LIMIT 1;

    IF v_candidate IS NOT NULL AND NOT (v_candidate = ANY(p_exclude_roster_ids))
       AND private.is_eligible_reviewer(p_workspace_id, v_candidate) THEN
        RETURN v_candidate;
    END IF;

    IF v_fallback IS NOT NULL AND NOT (v_fallback = ANY(p_exclude_roster_ids))
       AND private.is_eligible_reviewer(p_workspace_id, v_fallback) THEN
        RETURN v_fallback;
    END IF;

    -- 2. Specific Designer Rule (Any Difficulty)
    SELECT reviewer_roster_id, fallback_reviewer_id
    INTO v_candidate, v_fallback
    FROM public.review_routing_rules
    WHERE workspace_id = p_workspace_id
      AND designer_roster_id = p_designer_id
      AND client_difficulty IS NULL
    ORDER BY priority DESC
    LIMIT 1;

    IF v_candidate IS NOT NULL AND NOT (v_candidate = ANY(p_exclude_roster_ids))
       AND private.is_eligible_reviewer(p_workspace_id, v_candidate) THEN
        RETURN v_candidate;
    END IF;

    IF v_fallback IS NOT NULL AND NOT (v_fallback = ANY(p_exclude_roster_ids))
       AND private.is_eligible_reviewer(p_workspace_id, v_fallback) THEN
        RETURN v_fallback;
    END IF;

    -- 3. Workspace Default Rule
    SELECT reviewer_roster_id, fallback_reviewer_id
    INTO v_candidate, v_fallback
    FROM public.review_routing_rules
    WHERE workspace_id = p_workspace_id
      AND is_workspace_default = TRUE
    ORDER BY priority DESC
    LIMIT 1;

    IF v_candidate IS NOT NULL AND NOT (v_candidate = ANY(p_exclude_roster_ids))
       AND private.is_eligible_reviewer(p_workspace_id, v_candidate) THEN
        RETURN v_candidate;
    END IF;

    IF v_fallback IS NOT NULL AND NOT (v_fallback = ANY(p_exclude_roster_ids))
       AND private.is_eligible_reviewer(p_workspace_id, v_fallback) THEN
        RETURN v_fallback;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- =============================================================================
-- 4. ENFORCE ELIGIBILITY & SAME-WORKSPACE INTEGRITY IN CLIENT & TEAM RPCS
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
    v_executor_id UUID;
    v_reviewer_id UUID;
BEGIN
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);

    IF v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
        RAISE EXCEPTION 'Access denied: Only Workspace Owner or Manager can configure client team assignments.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.clients c
        WHERE c.workspace_id = p_workspace_id AND c.id = p_client_id
    ) THEN
        RAISE EXCEPTION 'Client not found in this workspace.';
    END IF;

    -- Validate all executor & strategy lead assignments are active eligible executors (not viewer, not marketing_director, not inactive/deleted)
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

    -- Validate all reviewer assignments have explicit review authority (not granted automatically to every executor, and never marketing_director or viewer)
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

    -- Validate marketing_director_id (if provided) is active in this workspace and not a viewer
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
        IF NOT private.is_eligible_executor(p_workspace_id, p_owner_roster_id) THEN
            RAISE EXCEPTION 'لا يمكن إسناد عميل إلى عضو غير مؤهل للتنفيذ (مشاهد أو مدير تسويق أو معطل أو محذوف).';
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
        brand_guide_url = COALESCE(p_brand_guide_url, brand_guide_url),
        brief_url = COALESCE(p_brief_url, brief_url),
        updated_at = pg_catalog.now()
    WHERE id = p_client_id;

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
            SELECT id, primary_assignee_id, reviewer_id FROM public.tasks
            WHERE workspace_id = p_workspace_id
              AND client_id = p_client_id
              AND COALESCE(work_stage, 'design') = 'design'
              AND status NOT IN ('delivered', 'cancelled')
        ) LOOP
            UPDATE public.tasks
            SET primary_assignee_id = p_owner_roster_id,
                reviewer_id = CASE WHEN reviewer_id = p_owner_roster_id THEN NULL ELSE reviewer_id END,
                updated_at = pg_catalog.now()
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

    IF NOT EXISTS (
        SELECT 1 FROM public.clients c
        WHERE c.workspace_id = p_workspace_id AND c.id = p_client_id
    ) THEN
        RAISE EXCEPTION 'Client not found in this workspace.';
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

-- =============================================================================
-- 5. TASK, REVIEW, AND SELF-APPROVAL SCOPE RPCS
--    (Narrow self-approval exception strictly for role = 'owner' [Emad] on his own task;
--     company_owner [Ahmed Al-Nahhas] retains full management & review of others' work)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.transition_task_status(
    p_task_id UUID,
    p_new_status public.task_status DEFAULT NULL,
    p_to_status public.task_status DEFAULT NULL,
    p_reason TEXT DEFAULT NULL,
    p_final_deliverable_url TEXT DEFAULT NULL,
    p_deliverable_url TEXT DEFAULT NULL,
    p_final_deliverable_attachment_id UUID DEFAULT NULL,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_effective_status public.task_status;
    v_effective_deliverable_url TEXT;
    v_caller RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_task RECORD;
    v_current_status public.task_status;
    v_is_involved BOOLEAN;
    v_is_owner_assignee BOOLEAN := FALSE;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'Idempotency key cannot be blank.';
    END IF;

    v_effective_status := COALESCE(p_new_status, p_to_status);
    IF v_effective_status IS NULL THEN
        RAISE EXCEPTION 'Target status is required.';
    END IF;

    v_effective_deliverable_url := COALESCE(p_final_deliverable_url, p_deliverable_url);

    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id
        FROM public.tasks WHERE id = p_task_id;
        IF v_effective_workspace_id IS NULL THEN
            RAISE EXCEPTION 'Task not found.';
        END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;

    IF v_caller.role IN ('marketing_director', 'business_owner_viewer') THEN
        RAISE EXCEPTION 'Permission denied: Your role is read-only and cannot transition task status.';
    END IF;

    SELECT * INTO v_task
    FROM public.tasks
    WHERE workspace_id = v_effective_workspace_id AND id = p_task_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found in this workspace.';
    END IF;

    IF v_task.primary_assignee_id IS NULL AND v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
        RAISE EXCEPTION 'Access denied: Unassigned tasks can only be transitioned or managed by a manager or owner.';
    END IF;

    v_is_involved := (
        v_caller.role IN ('owner', 'company_owner', 'manager') OR
        (v_task.primary_assignee_id IS NOT NULL AND v_task.primary_assignee_id = v_caller.roster_person_id) OR
        EXISTS (
            SELECT 1 FROM public.task_collaborators tc
            JOIN public.roster_people rp ON tc.roster_person_id = rp.id
            WHERE tc.workspace_id = v_effective_workspace_id
              AND tc.task_id = p_task_id
              AND tc.roster_person_id = v_caller.roster_person_id
              AND rp.is_active = TRUE
        )
    );

    IF NOT COALESCE(v_is_involved, FALSE) THEN
        RAISE EXCEPTION 'Access denied: Caller is not assigned or collaborating on this task.';
    END IF;

    -- NARROW SELF-APPROVAL BYPASS: Strictly only when the task is assigned to Emad (role = 'owner') AND Emad himself is the caller
    IF v_task.primary_assignee_id IS NOT NULL
       AND v_task.primary_assignee_id = v_caller.roster_person_id
       AND v_caller.role = 'owner'
       AND EXISTS (
           SELECT 1 FROM public.workspace_memberships wm
           WHERE wm.workspace_id = v_effective_workspace_id
             AND wm.roster_person_id = v_task.primary_assignee_id
             AND wm.role = 'owner'
             AND wm.is_active = TRUE
       )
    THEN
        v_is_owner_assignee := TRUE;
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object(
            'p_task_id', p_task_id,
            'p_new_status', p_new_status,
            'p_to_status', p_to_status,
            'p_reason', p_reason,
            'p_final_deliverable_url', p_final_deliverable_url,
            'p_deliverable_url', p_deliverable_url,
            'p_final_deliverable_attachment_id', p_final_deliverable_attachment_id,
            'p_workspace_id', p_workspace_id
        );
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'transition_task_status', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    v_current_status := v_task.status;

    IF v_effective_status = v_current_status THEN
        v_result := jsonb_build_object(
            'success', TRUE,
            'task_id', p_task_id,
            'status', v_current_status,
            'note', 'Status already equals requested status'
        );
        IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
            PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'transition_task_status', p_idempotency_key, v_hash, v_result);
        END IF;
        RETURN v_result;
    END IF;

    IF v_effective_status IN ('internal_review', 'client_review') THEN
        RAISE EXCEPTION 'Transitions to % must be performed via submit_review_round or decide_review_round.', v_effective_status;
    END IF;

    IF v_effective_status = 'delivered' THEN
        IF v_current_status <> 'approved' THEN
            RAISE EXCEPTION 'Tasks must be approved before being delivered.';
        END IF;
        IF (v_effective_deliverable_url IS NULL OR btrim(v_effective_deliverable_url) = '')
           AND p_final_deliverable_attachment_id IS NULL
           AND v_task.final_deliverable_url IS NULL
           AND v_task.final_deliverable_attachment_id IS NULL THEN
            RAISE EXCEPTION 'A final deliverable URL or attachment is required to mark task as delivered.';
        END IF;
    END IF;

    IF v_current_status = 'backlog' THEN
        IF v_effective_status IN ('ready', 'in_progress') THEN
            NULL;
        ELSIF v_effective_status = 'cancelled' THEN
            IF v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
                RAISE EXCEPTION 'Only Owner or Manager can cancel tasks.';
            END IF;
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'Cancel reason is required when cancelling a task.';
            END IF;
        ELSE
            RAISE EXCEPTION 'Invalid transition from backlog to %.', v_effective_status;
        END IF;

    ELSIF v_current_status = 'ready' THEN
        IF v_effective_status IN ('in_progress', 'backlog') THEN
            NULL;
        ELSIF v_effective_status = 'cancelled' THEN
            IF v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
                RAISE EXCEPTION 'Only Owner or Manager can cancel tasks.';
            END IF;
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'Cancel reason is required when cancelling a task.';
            END IF;
        ELSE
            RAISE EXCEPTION 'Invalid transition from ready to %.', v_effective_status;
        END IF;

    ELSIF v_current_status = 'in_progress' THEN
        IF v_effective_status = 'ready' THEN
            NULL;
        ELSIF v_effective_status = 'blocked' THEN
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'A valid reason is mandatory when blocking a task.';
            END IF;
        ELSIF v_effective_status = 'cancelled' THEN
            IF v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
                RAISE EXCEPTION 'Only Owner or Manager can cancel tasks.';
            END IF;
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'Cancel reason is required when cancelling a task.';
            END IF;
        ELSIF v_effective_status = 'approved' THEN
            -- NARROW REVIEW BYPASS: Strictly only for Emad (role = 'owner') on his own assigned task
            IF v_is_owner_assignee THEN
                NULL;
            ELSE
                RAISE EXCEPTION 'Self-approval denied: Invalid transition from in_progress to approved. Only the primary Workspace Owner (Emad) has a direct review bypass on his own assigned work; all other tasks must pass review rounds.';
            END IF;
        ELSE
            RAISE EXCEPTION 'Invalid transition from in_progress to %.', v_effective_status;
        END IF;

    ELSIF v_current_status = 'blocked' THEN
        IF v_effective_status IN ('in_progress', 'ready') THEN
            NULL;
        ELSIF v_effective_status = 'cancelled' THEN
            IF v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
                RAISE EXCEPTION 'Only Owner or Manager can cancel tasks.';
            END IF;
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'Cancel reason is required when cancelling a task.';
            END IF;
        ELSE
            RAISE EXCEPTION 'Invalid transition from blocked to %. Can only unblock to in_progress or ready.', v_effective_status;
        END IF;

    ELSIF v_current_status = 'changes_requested' THEN
        IF v_effective_status = 'in_progress' THEN
            NULL;
        ELSIF v_effective_status = 'cancelled' THEN
            IF v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
                RAISE EXCEPTION 'Only Owner or Manager can cancel tasks.';
            END IF;
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'Cancel reason is required when cancelling a task.';
            END IF;
        ELSE
            RAISE EXCEPTION 'Invalid transition from changes_requested to %. Designer should resume work or submit new review.', v_effective_status;
        END IF;

    ELSIF v_current_status = 'approved' THEN
        IF v_effective_status = 'delivered' THEN
            NULL;
        ELSIF v_effective_status = 'in_progress' THEN
            IF v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
                RAISE EXCEPTION 'Only Owner or Manager can reopen an approved task to in_progress.';
            END IF;
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'Reopen reason is required when moving approved task back to in_progress.';
            END IF;
        ELSIF v_effective_status = 'cancelled' THEN
            IF v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
                RAISE EXCEPTION 'Only Owner or Manager can cancel tasks.';
            END IF;
            IF p_reason IS NULL OR btrim(p_reason) = '' THEN
                RAISE EXCEPTION 'Cancel reason is required when cancelling a task.';
            END IF;
        ELSE
            RAISE EXCEPTION 'Invalid transition from approved to %.', v_effective_status;
        END IF;

    ELSIF v_current_status = 'delivered' THEN
        IF v_effective_status = 'approved' THEN
            IF v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
                RAISE EXCEPTION 'Only Owner or Manager can unmark delivered tasks.';
            END IF;
        ELSE
            RAISE EXCEPTION 'Delivered tasks cannot be transitioned to %.', v_effective_status;
        END IF;

    ELSE
        RAISE EXCEPTION 'Unsupported current task status: %.', v_current_status;
    END IF;

    UPDATE public.tasks
    SET status = v_effective_status,
        final_deliverable_url = CASE
            WHEN v_effective_status = 'delivered' AND v_effective_deliverable_url IS NOT NULL
            THEN v_effective_deliverable_url
            ELSE final_deliverable_url
        END,
        final_deliverable_attachment_id = CASE
            WHEN v_effective_status = 'delivered' AND p_final_deliverable_attachment_id IS NOT NULL
            THEN p_final_deliverable_attachment_id
            ELSE final_deliverable_attachment_id
        END,
        delivered_at = CASE
            WHEN v_effective_status = 'delivered' AND delivered_at IS NULL
            THEN pg_catalog.now()
            ELSE delivered_at
        END,
        blocked_at = CASE
            WHEN v_effective_status = 'blocked' AND blocked_at IS NULL
            THEN pg_catalog.now()
            ELSE blocked_at
        END,
        block_reason = CASE
            WHEN v_effective_status = 'blocked'
            THEN p_reason
            ELSE block_reason
        END,
        cancelled_at = CASE
            WHEN v_effective_status = 'cancelled' AND cancelled_at IS NULL
            THEN pg_catalog.now()
            ELSE cancelled_at
        END,
        cancel_reason = CASE
            WHEN v_effective_status = 'cancelled'
            THEN p_reason
            ELSE cancel_reason
        END,
        reopened_at = CASE
            WHEN v_current_status = 'approved' AND v_effective_status = 'in_progress'
            THEN pg_catalog.now()
            ELSE reopened_at
        END,
        reopen_reason = CASE
            WHEN v_current_status = 'approved' AND v_effective_status = 'in_progress'
            THEN p_reason
            ELSE reopen_reason
        END,
        updated_at = pg_catalog.now()
    WHERE id = p_task_id;

    INSERT INTO public.task_status_events (
        workspace_id, task_id, from_status, to_status, actor_id, reason
    ) VALUES (
        v_effective_workspace_id, p_task_id, v_current_status, v_effective_status, v_caller.roster_person_id, p_reason
    );

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id,
        v_caller.roster_person_id,
        'transition_task_status',
        'tasks',
        p_task_id,
        jsonb_build_object(
            'from_status', v_current_status,
            'to_status', v_effective_status,
            'reason', p_reason,
            'is_owner_assignee', v_is_owner_assignee,
            'final_deliverable_url', v_effective_deliverable_url
        )
    );

    v_result := jsonb_build_object(
        'success', TRUE,
        'task_id', p_task_id,
        'previous_status', v_current_status,
        'status', v_effective_status
    );

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'transition_task_status', p_idempotency_key, v_hash, v_result);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION public.submit_review_round(
    p_task_id UUID,
    p_preview_url TEXT,
    p_note TEXT DEFAULT NULL,
    p_round_type public.review_round_type DEFAULT 'internal',
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL,
    p_reviewer_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_caller RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_task RECORD;
    v_exclude_ids UUID[];
    v_reviewer_id UUID;
    v_owner_roster_id UUID;
    v_next_round_number INT;
    v_round_id UUID;
    v_new_task_status public.task_status;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'Idempotency key cannot be blank.';
    END IF;

    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.tasks WHERE id = p_task_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Task not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;

    IF NOT private.can_work_on_task(p_task_id) THEN
        RAISE EXCEPTION 'Access denied: You are not assigned to or collaborating on this task.';
    END IF;

    IF p_preview_url IS NULL OR btrim(p_preview_url) = '' THEN
        RAISE EXCEPTION 'Preview URL cannot be empty.';
    END IF;

    SELECT * INTO v_task
    FROM public.tasks
    WHERE workspace_id = v_effective_workspace_id AND id = p_task_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found in this workspace.';
    END IF;

    -- Narrow Review Bypass: Strictly only for Emad (role = 'owner')
    SELECT wm.roster_person_id INTO v_owner_roster_id
    FROM public.workspace_memberships wm
    WHERE wm.workspace_id = v_effective_workspace_id
      AND wm.role = 'owner'
      AND wm.is_active = TRUE
    LIMIT 1;

    IF v_task.primary_assignee_id IS NOT NULL AND v_task.primary_assignee_id = v_owner_roster_id THEN
        RAISE EXCEPTION 'Tasks executed by the Workspace Owner bypass internal review and do not require review rounds.' USING ERRCODE = '42501';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object(
            'p_task_id', p_task_id,
            'p_preview_url', p_preview_url,
            'p_note', p_note,
            'p_round_type', p_round_type,
            'p_workspace_id', p_workspace_id,
            'p_reviewer_id', p_reviewer_id
        );
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'submit_review_round', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    IF p_round_type = 'client' AND v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
        RAISE EXCEPTION 'Designers cannot submit directly to client review. Client review must be initiated by Management.';
    END IF;

    IF p_round_type = 'internal' THEN
        IF v_task.status NOT IN ('in_progress', 'changes_requested') THEN
            RAISE EXCEPTION 'Internal review can only be submitted from in_progress or changes_requested (current status: %).', v_task.status;
        END IF;
        v_new_task_status := 'internal_review';
    ELSE
        IF v_task.status NOT IN ('in_progress', 'changes_requested', 'approved') THEN
            RAISE EXCEPTION 'Client review can only be initiated from in_progress, changes_requested, or approved (current status: %).', v_task.status;
        END IF;
        v_new_task_status := 'client_review';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.review_rounds
        WHERE task_id = p_task_id AND decision = 'pending'
    ) THEN
        RAISE EXCEPTION 'There is already an active pending review round for this task.';
    END IF;

    UPDATE public.time_entries
    SET ended_at = pg_catalog.now(),
        duration_seconds = EXTRACT(EPOCH FROM (pg_catalog.now() - started_at))::INT,
        updated_at = pg_catalog.now()
    WHERE task_id = p_task_id
      AND ended_at IS NULL
      AND is_voided = FALSE;

    SELECT ARRAY_AGG(roster_person_id) INTO v_exclude_ids
    FROM (
        SELECT v_task.primary_assignee_id AS roster_person_id WHERE v_task.primary_assignee_id IS NOT NULL
        UNION
        SELECT v_caller.roster_person_id AS roster_person_id
        UNION
        SELECT roster_person_id FROM public.task_collaborators WHERE task_id = p_task_id
    ) t;

    IF p_reviewer_id IS NOT NULL THEN
        IF NOT private.is_eligible_reviewer(v_effective_workspace_id, p_reviewer_id) THEN
            RAISE EXCEPTION 'المراجع المختار غير مؤهل للمراجعة.';
        END IF;
        IF p_reviewer_id = ANY(v_exclude_ids) THEN
            RAISE EXCEPTION 'Self-review invariant violation: Submitter or assignee cannot be the reviewer.';
        END IF;
        v_reviewer_id := p_reviewer_id;
    ELSE
        v_reviewer_id := private.resolve_task_reviewer(
            v_effective_workspace_id,
            p_task_id,
            COALESCE(v_task.primary_assignee_id, v_caller.roster_person_id),
            v_exclude_ids
        );
    END IF;

    IF v_reviewer_id IS NULL THEN
        RAISE EXCEPTION 'No eligible reviewer found for this task. An independent reviewer is required.';
    END IF;

    IF v_reviewer_id = v_caller.roster_person_id THEN
        RAISE EXCEPTION 'Self-review invariant violation: Submitter cannot be the reviewer.';
    END IF;

    SELECT COALESCE(MAX(round_number), 0) + 1 INTO v_next_round_number
    FROM public.review_rounds
    WHERE task_id = p_task_id;

    INSERT INTO public.review_rounds (
        workspace_id,
        task_id,
        round_number,
        round_type,
        submitter_id,
        reviewer_id,
        preview_url,
        notes
    ) VALUES (
        v_effective_workspace_id,
        p_task_id,
        v_next_round_number,
        p_round_type,
        v_caller.roster_person_id,
        v_reviewer_id,
        p_preview_url,
        p_note
    ) RETURNING id INTO v_round_id;

    UPDATE public.tasks
    SET status = v_new_task_status,
        reviewer_id = v_reviewer_id,
        updated_at = pg_catalog.now()
    WHERE id = p_task_id;

    IF v_reviewer_id <> v_caller.roster_person_id THEN
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
            v_reviewer_id,
            v_caller.roster_person_id,
            'طلب مراجعة جديد',
            'أرسل ' || v_caller.display_name || ' مهمة "' || v_task.title || '" للمراجعة.',
            p_task_id,
            '/tasks?taskId=' || p_task_id,
            'review_requested',
            jsonb_build_object('round_id', v_round_id, 'round_number', v_next_round_number)
        );
    END IF;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id,
        v_caller.roster_person_id,
        'submit_review_round',
        'tasks',
        p_task_id,
        jsonb_build_object(
            'round_id', v_round_id,
            'round_number', v_next_round_number,
            'round_type', p_round_type,
            'reviewer_id', v_reviewer_id,
            'preview_url', p_preview_url
        )
    );

    v_result := jsonb_build_object(
        'success', TRUE,
        'round_id', v_round_id,
        'round_number', v_next_round_number,
        'task_status', v_new_task_status,
        'reviewer_id', v_reviewer_id
    );

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'submit_review_round', p_idempotency_key, v_hash, v_result);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

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

    IF NOT private.is_eligible_reviewer(v_copy_task.workspace_id, v_caller.roster_person_id) THEN
        RAISE EXCEPTION 'Permission denied: Caller does not have review approval authority.';
    END IF;

    IF v_caller.roster_person_id IS DISTINCT FROM v_copy_task.reviewer_id
       AND v_caller.role NOT IN ('owner', 'company_owner', 'manager', 'senior_reviewer', 'strategy_lead') THEN
        RAISE EXCEPTION 'Permission denied: Only the designated reviewer or management can approve copywriting.';
    END IF;

    -- Narrow Anti-Self-Approval Exception: Strictly only Emad (role = 'owner') can self-approve his own copywriting task
    IF v_copy_task.primary_assignee_id = v_caller.roster_person_id
       AND v_caller.role <> 'owner' THEN
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

    IF NOT private.is_eligible_reviewer(v_effective_workspace_id, v_caller.roster_person_id) THEN
        RAISE EXCEPTION 'Permission denied: Caller does not have review approval authority.';
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

    -- ZERO SELF-APPROVAL ENFORCEMENT ON REVIEW ROUNDS
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

-- Harden set_task_waiting_state to validate waiting_on_roster_id belongs to same workspace
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

    IF p_waiting_on_roster_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.roster_people rp
            WHERE rp.workspace_id = v_task.workspace_id
              AND rp.id = p_waiting_on_roster_id
              AND rp.is_active = TRUE
        ) THEN
            RAISE EXCEPTION 'Waiting-on roster member not found or inactive in this workspace.';
        END IF;
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

-- Harden create_task_rpc with private.is_eligible_executor and private.is_eligible_reviewer
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
        IF NOT private.is_eligible_executor(p_workspace_id, p_primary_assignee_id) THEN
            RAISE EXCEPTION 'لا يمكن إسناد مهمة إلى عضو غير مؤهل للتنفيذ (مشاهد أو مدير تسويق أو معطل أو محذوف).';
        END IF;

        SELECT rp.role INTO v_assignee_role
        FROM public.roster_people rp
        WHERE rp.workspace_id = p_workspace_id
          AND rp.id = p_primary_assignee_id;
    END IF;

    IF p_reviewer_id IS NOT NULL THEN
        IF NOT private.is_eligible_reviewer(p_workspace_id, p_reviewer_id) THEN
            RAISE EXCEPTION 'المراجع المختار غير نشط أو غير مصرح له بالمراجعة.';
        END IF;
        IF p_primary_assignee_id IS NOT NULL AND p_reviewer_id = p_primary_assignee_id THEN
            RAISE EXCEPTION 'لا يجوز أن يكون المراجع هو نفسه المنفذ الأساسي للمهمة.';
        END IF;
    END IF;

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

    IF p_campaign_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.campaigns WHERE workspace_id = p_workspace_id AND client_id = p_client_id AND id = p_campaign_id
    ) THEN
        RAISE EXCEPTION 'Campaign not found for this client in workspace.';
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

-- Harden reassign_task and change_task_reviewer and add_task_collaborator
CREATE OR REPLACE FUNCTION public.reassign_task(
    p_task_id UUID,
    p_new_assignee_id UUID,
    p_reason TEXT DEFAULT 'Reassigned by management',
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_caller RECORD;
    v_task RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.tasks WHERE id = p_task_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Task not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;

    IF v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can reassign tasks.';
    END IF;

    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'A non-empty reason is required for reassignment.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_task_id', p_task_id, 'p_new_assignee_id', p_new_assignee_id, 'p_reason', p_reason, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'reassign_task', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    SELECT * INTO v_task
    FROM public.tasks
    WHERE workspace_id = v_effective_workspace_id AND id = p_task_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found in this workspace.';
    END IF;

    IF p_new_assignee_id IS NOT NULL THEN
        IF NOT private.is_eligible_executor(v_effective_workspace_id, p_new_assignee_id) THEN
            RAISE EXCEPTION 'Target assignee is not an eligible active executor in this workspace.';
        END IF;
    END IF;

    UPDATE public.tasks
    SET primary_assignee_id = p_new_assignee_id,
        reviewer_id = CASE WHEN reviewer_id = p_new_assignee_id THEN NULL ELSE reviewer_id END,
        updated_at = pg_catalog.now()
    WHERE id = p_task_id;

    INSERT INTO public.task_assignment_events (
        workspace_id,
        task_id,
        previous_assignee_id,
        new_assignee_id,
        actor_id,
        reason
    ) VALUES (
        v_effective_workspace_id,
        p_task_id,
        v_task.primary_assignee_id,
        p_new_assignee_id,
        v_caller.roster_person_id,
        p_reason
    );

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id, v_caller.roster_person_id, 'reassign_task', 'tasks', p_task_id,
        jsonb_build_object('previous_assignee', v_task.primary_assignee_id, 'new_assignee', p_new_assignee_id, 'reason', p_reason)
    );

    v_result := jsonb_build_object('success', TRUE, 'task_id', p_task_id, 'primary_assignee_id', p_new_assignee_id);
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'reassign_task', p_idempotency_key, v_hash, v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION public.change_task_reviewer(
    p_task_id UUID,
    p_new_reviewer_id UUID,
    p_reason TEXT DEFAULT NULL,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_caller RECORD;
    v_task RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.tasks WHERE id = p_task_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Task not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;

    IF v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can change task reviewer.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_task_id', p_task_id, 'p_new_reviewer_id', p_new_reviewer_id, 'p_reason', p_reason, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'change_task_reviewer', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    SELECT * INTO v_task
    FROM public.tasks
    WHERE workspace_id = v_effective_workspace_id AND id = p_task_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found in this workspace.';
    END IF;

    IF p_new_reviewer_id IS NOT NULL THEN
        IF NOT private.is_eligible_reviewer(v_effective_workspace_id, p_new_reviewer_id) THEN
            RAISE EXCEPTION 'Target reviewer is not an eligible active reviewer in this workspace.';
        END IF;

        IF v_task.primary_assignee_id = p_new_reviewer_id THEN
            RAISE EXCEPTION 'Reviewer cannot be the primary assignee of the task.';
        END IF;
    END IF;

    UPDATE public.tasks
    SET reviewer_id = p_new_reviewer_id,
        updated_at = pg_catalog.now()
    WHERE id = p_task_id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id, v_caller.roster_person_id, 'change_task_reviewer', 'tasks', p_task_id,
        jsonb_build_object('previous_reviewer', v_task.reviewer_id, 'new_reviewer', p_new_reviewer_id, 'reason', p_reason)
    );

    v_result := jsonb_build_object('success', TRUE, 'task_id', p_task_id, 'reviewer_id', p_new_reviewer_id);
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'change_task_reviewer', p_idempotency_key, v_hash, v_result);
    END IF;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION public.add_task_collaborator(
    p_task_id UUID,
    p_roster_person_id UUID,
    p_workspace_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_effective_workspace_id UUID;
    v_caller RECORD;
    v_task RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_collab_id UUID;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN RAISE EXCEPTION 'Idempotency key cannot be blank.'; END IF;
    IF p_workspace_id IS NOT NULL THEN
        v_effective_workspace_id := p_workspace_id;
    ELSE
        SELECT workspace_id INTO v_effective_workspace_id FROM public.tasks WHERE id = p_task_id;
        IF v_effective_workspace_id IS NULL THEN RAISE EXCEPTION 'Task not found.'; END IF;
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_effective_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = v_effective_workspace_id FOR UPDATE;
    IF v_caller.role NOT IN ('owner', 'company_owner', 'manager') THEN
        RAISE EXCEPTION 'Permission denied: Only Owner or Manager can manage task collaborators.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_payload := jsonb_build_object('p_task_id', p_task_id, 'p_roster_person_id', p_roster_person_id, 'p_workspace_id', p_workspace_id);
        v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
        v_cached := private.fn_acquire_idempotency_lock(v_effective_workspace_id, v_caller.roster_person_id, 'add_task_collaborator', p_idempotency_key, v_hash);
        IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
    END IF;

    SELECT * INTO v_task FROM public.tasks WHERE workspace_id = v_effective_workspace_id AND id = p_task_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Task not found in this workspace.'; END IF;

    IF NOT private.is_eligible_executor(v_effective_workspace_id, p_roster_person_id) THEN
        RAISE EXCEPTION 'Collaborator is not an eligible active executor in this workspace.';
    END IF;

    INSERT INTO public.task_collaborators (workspace_id, task_id, roster_person_id)
    VALUES (v_effective_workspace_id, p_task_id, p_roster_person_id)
    ON CONFLICT (workspace_id, task_id, roster_person_id) DO NOTHING
    RETURNING id INTO v_collab_id;

    INSERT INTO public.audit_events (
        workspace_id, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
        v_effective_workspace_id, v_caller.roster_person_id, 'add_task_collaborator', 'tasks', p_task_id,
        jsonb_build_object('collaborator_roster_id', p_roster_person_id)
    );

    v_result := jsonb_build_object('success', TRUE, 'task_id', p_task_id, 'roster_person_id', p_roster_person_id);
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        PERFORM private.fn_record_idempotency(v_effective_workspace_id, v_caller.roster_person_id, 'add_task_collaborator', p_idempotency_key, v_hash, v_result);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Harden import_content_calendar_tasks: enforce private.is_eligible_executor, private.is_eligible_reviewer, and narrow Emad-only review bypass
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

-- Harden admin_hard_delete_roster_member to also verify reassign_to_roster_id is an eligible executor
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

    SELECT * INTO v_target_person
    FROM public.roster_people
    WHERE workspace_id = p_workspace_id AND id = p_roster_person_id;

    IF v_target_person.id IS NULL THEN
        RAISE EXCEPTION 'عضو الفريق غير موجود.';
    END IF;

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

    IF p_reassign_to_roster_id IS NOT NULL THEN
        IF p_reassign_to_roster_id = p_roster_person_id THEN
            RAISE EXCEPTION 'لا يمكن إعادة الإسناد لنفس العضو المراد حذفه.';
        END IF;
        IF NOT private.is_eligible_executor(p_workspace_id, p_reassign_to_roster_id) THEN
            RAISE EXCEPTION 'عضو إعادة الإسناد غير موجود أو معطل أو غير مؤهل للتنفيذ.';
        END IF;
        SELECT * INTO v_reassign_person
        FROM public.roster_people
        WHERE workspace_id = p_workspace_id AND id = p_reassign_to_roster_id AND is_active = TRUE;
    END IF;

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

    IF p_reassign_to_roster_id IS NOT NULL THEN
        UPDATE public.tasks
        SET primary_assignee_id = p_reassign_to_roster_id,
            reviewer_id = CASE WHEN reviewer_id = p_reassign_to_roster_id THEN NULL ELSE reviewer_id END,
            updated_at = pg_catalog.now()
        WHERE workspace_id = p_workspace_id AND primary_assignee_id = p_roster_person_id;

        IF private.is_eligible_reviewer(p_workspace_id, p_reassign_to_roster_id) THEN
            UPDATE public.tasks
            SET reviewer_id = CASE WHEN primary_assignee_id = p_reassign_to_roster_id THEN NULL ELSE p_reassign_to_roster_id END,
                updated_at = pg_catalog.now()
            WHERE workspace_id = p_workspace_id AND reviewer_id = p_roster_person_id;
        ELSE
            UPDATE public.tasks
            SET reviewer_id = NULL,
                updated_at = pg_catalog.now()
            WHERE workspace_id = p_workspace_id AND reviewer_id = p_roster_person_id;
        END IF;
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
            strategy_reviewer_id = CASE WHEN strategy_reviewer_id = p_roster_person_id THEN (CASE WHEN private.is_eligible_reviewer(p_workspace_id, p_reassign_to_roster_id) THEN p_reassign_to_roster_id ELSE NULL END) ELSE strategy_reviewer_id END,
            copywriting_reviewer_id = CASE WHEN copywriting_reviewer_id = p_roster_person_id THEN (CASE WHEN private.is_eligible_reviewer(p_workspace_id, p_reassign_to_roster_id) THEN p_reassign_to_roster_id ELSE NULL END) ELSE copywriting_reviewer_id END,
            design_reviewer_id = CASE WHEN design_reviewer_id = p_roster_person_id THEN (CASE WHEN private.is_eligible_reviewer(p_workspace_id, p_reassign_to_roster_id) THEN p_reassign_to_roster_id ELSE NULL END) ELSE design_reviewer_id END,
            video_reviewer_id = CASE WHEN video_reviewer_id = p_roster_person_id THEN (CASE WHEN private.is_eligible_reviewer(p_workspace_id, p_reassign_to_roster_id) THEN p_reassign_to_roster_id ELSE NULL END) ELSE video_reviewer_id END,
            marketing_director_id = CASE WHEN marketing_director_id = p_roster_person_id THEN NULL ELSE marketing_director_id END,
            strategy_lead_id = CASE WHEN strategy_lead_id = p_roster_person_id THEN p_reassign_to_roster_id ELSE strategy_lead_id END,
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
            marketing_director_id = CASE WHEN marketing_director_id = p_roster_person_id THEN NULL ELSE marketing_director_id END,
            strategy_lead_id = CASE WHEN strategy_lead_id = p_roster_person_id THEN NULL ELSE strategy_lead_id END,
            updated_at = pg_catalog.now()
        WHERE workspace_id = p_workspace_id;
    END IF;

    DELETE FROM public.task_collaborators
    WHERE workspace_id = p_workspace_id AND roster_person_id = p_roster_person_id;

    DELETE FROM public.review_routing_rules
    WHERE workspace_id = p_workspace_id AND (designer_roster_id = p_roster_person_id OR reviewer_roster_id = p_roster_person_id OR fallback_reviewer_id = p_roster_person_id);

    DELETE FROM public.workspace_invitations
    WHERE workspace_id = p_workspace_id AND roster_person_id = p_roster_person_id;

    DELETE FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id AND roster_person_id = p_roster_person_id;

    DELETE FROM public.roster_people
    WHERE workspace_id = p_workspace_id AND id = p_roster_person_id;

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

NOTIFY pgrst, 'reload schema';

COMMIT;
