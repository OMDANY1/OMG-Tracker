-- OMG Creative Workspace: Initial Schema (V3.5-R1 repaired baseline)
-- Migration: 20260906000001_initial_schema.sql
-- Strictly Transactional: Everything wrapped in BEGIN; ... COMMIT;

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. EXTENSIONS & SCHEMAS
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- Set search path for deterministic extension and type resolution
SET search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- 2. ENUM TYPES
-- -----------------------------------------------------------------------------
CREATE TYPE public.roster_role AS ENUM (
    'owner',
    'manager',
    'senior_reviewer',
    'designer'
);

CREATE TYPE public.client_difficulty AS ENUM (
    'Easy',
    'Medium',
    'Hard',
    'Unknown'
);

CREATE TYPE public.client_extra_workload AS ENUM (
    'None',
    'Many requests',
    'Many revisions',
    'Unknown'
);

CREATE TYPE public.client_state AS ENUM (
    'Active',
    'Not started',
    'Archived'
);

CREATE TYPE public.campaign_status AS ENUM (
    'Draft',
    'Active',
    'Completed',
    'Archived'
);

CREATE TYPE public.task_priority AS ENUM (
    'Low',
    'Normal',
    'High',
    'Urgent'
);

CREATE TYPE public.task_status AS ENUM (
    'backlog',
    'ready',
    'in_progress',
    'internal_review',
    'changes_requested',
    'client_review',
    'approved',
    'delivered',
    'blocked',
    'cancelled'
);

CREATE TYPE public.time_category AS ENUM (
    'research_references',
    'initial_design',
    'internal_revision',
    'client_revision',
    'final_preparation_export'
);

CREATE TYPE public.time_entry_source AS ENUM (
    'timer',
    'manual',
    'on_behalf'
);

CREATE TYPE public.review_round_type AS ENUM (
    'internal',
    'client'
);

CREATE TYPE public.review_decision AS ENUM (
    'pending',
    'approved',
    'changes_requested'
);

CREATE TYPE public.invitation_status AS ENUM (
    'pending',
    'accepted',
    'expired',
    'revoked'
);

CREATE TYPE public.correction_status AS ENUM (
    'pending',
    'approved',
    'rejected'
);

CREATE TYPE public.leave_type AS ENUM (
    'annual',
    'sick',
    'emergency',
    'unpaid'
);

-- -----------------------------------------------------------------------------
-- 3. UTILITY FUNCTIONS (safe_cast_uuid, updated_at trigger, workweek validation)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.safe_cast_uuid(p_val TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
BEGIN
    RETURN p_val::UUID;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = pg_catalog.now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_validate_workweek_days(days INT[])
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    d INT;
    v_len INT;
BEGIN
    IF days IS NULL THEN
        RETURN FALSE;
    END IF;
    v_len := array_length(days, 1);
    IF v_len IS NULL OR v_len < 1 OR v_len > 7 THEN
        RETURN FALSE;
    END IF;
    FOREACH d IN ARRAY days LOOP
        IF d < 0 OR d > 6 THEN
            RETURN FALSE;
        END IF;
    END LOOP;
    -- Check uniqueness
    IF (SELECT COUNT(DISTINCT x) FROM unnest(days) AS x) <> v_len THEN
        RETURN FALSE;
    END IF;
    RETURN TRUE;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. WORKSPACES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspaces (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    name TEXT NOT NULL CHECK (btrim(name) <> ''),
    default_timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
    workweek_days INT[] NOT NULL DEFAULT '{0,1,2,3,4}', -- Sunday to Thursday default in Egypt/ME
    day_start_time TIME NOT NULL DEFAULT '09:00:00',
    day_end_time TIME NOT NULL DEFAULT '17:00:00',
    long_session_threshold_mins INT NOT NULL DEFAULT 240 CHECK (long_session_threshold_mins > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT chk_workweek_days CHECK (public.fn_validate_workweek_days(workweek_days))
);

CREATE TRIGGER trg_workspaces_updated_at
BEFORE UPDATE ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. ROSTER PEOPLE (Workspace Roster, Independent of auth.users)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roster_people (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL CHECK (btrim(display_name) <> ''),
    job_title TEXT NOT NULL CHECK (btrim(job_title) <> ''),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_roster_workspace_display UNIQUE (workspace_id, display_name),
    CONSTRAINT uq_roster_composite UNIQUE (workspace_id, id)
);

CREATE TRIGGER trg_roster_people_updated_at
BEFORE UPDATE ON public.roster_people
FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- 6. WORKSPACE MEMBERSHIPS (Explicit auth.users linking, Single Active Owner Invariant)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspace_memberships (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    roster_person_id UUID NOT NULL,
    role public.roster_role NOT NULL DEFAULT 'designer',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_membership_composite UNIQUE (workspace_id, id),
    CONSTRAINT fk_membership_roster FOREIGN KEY (workspace_id, roster_person_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT
);

-- Partial unique indexes on active memberships to resolve inactive-membership uniqueness safely
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_membership_user
ON public.workspace_memberships (workspace_id, user_id)
WHERE is_active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_membership_roster
ON public.workspace_memberships (workspace_id, roster_person_id)
WHERE is_active = TRUE;

-- Exactly one active owner per workspace
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_owner_per_workspace
ON public.workspace_memberships (workspace_id)
WHERE role = 'owner' AND is_active = TRUE;

CREATE TRIGGER trg_workspace_memberships_updated_at
BEFORE UPDATE ON public.workspace_memberships
FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- 7. WORKSPACE INVITATIONS (Cryptographic SHA-256 Hashing, Roster Binding)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspace_invitations (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    invited_email TEXT NOT NULL CHECK (btrim(invited_email) <> ''),
    role public.roster_role NOT NULL DEFAULT 'designer' CHECK (role <> 'owner'),
    roster_person_id UUID NOT NULL,
    token_hash TEXT NOT NULL,
    status public.invitation_status NOT NULL DEFAULT 'pending',
    invited_by_roster_id UUID NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    accepted_by_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_invitation_token_hash UNIQUE (token_hash),
    CONSTRAINT fk_invitation_roster FOREIGN KEY (workspace_id, roster_person_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_invitation_inviter FOREIGN KEY (workspace_id, invited_by_roster_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_workspace_invitations_updated_at
BEFORE UPDATE ON public.workspace_invitations
FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_pending_invitation_per_roster
ON public.workspace_invitations (workspace_id, roster_person_id)
WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_pending_invitation_per_email
ON public.workspace_invitations (workspace_id, lower(btrim(invited_email)))
WHERE status = 'pending';

-- -----------------------------------------------------------------------------
-- 8. REVIEW ROUTING RULES (PostgreSQL 15+ NULLS NOT DISTINCT)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.review_routing_rules (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    priority INT NOT NULL DEFAULT 0,
    designer_roster_id UUID,
    client_difficulty public.client_difficulty,
    reviewer_roster_id UUID NOT NULL,
    fallback_reviewer_id UUID,
    is_workspace_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT chk_routing_reviewer_designer CHECK (designer_roster_id IS NULL OR designer_roster_id <> reviewer_roster_id),
    CONSTRAINT chk_routing_fallback CHECK (fallback_reviewer_id IS NULL OR fallback_reviewer_id <> reviewer_roster_id),
    CONSTRAINT fk_rrr_designer FOREIGN KEY (workspace_id, designer_roster_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_rrr_reviewer FOREIGN KEY (workspace_id, reviewer_roster_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_rrr_fallback FOREIGN KEY (workspace_id, fallback_reviewer_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_review_routing_rule
ON public.review_routing_rules (workspace_id, designer_roster_id, client_difficulty)
NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_default_routing_rule
ON public.review_routing_rules (workspace_id)
WHERE is_workspace_default = TRUE;

CREATE TRIGGER trg_review_routing_rules_updated_at
BEFORE UPDATE ON public.review_routing_rules
FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- 9. MEMBER CAPACITIES (No fabricated defaults)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.member_capacities (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    roster_person_id UUID NOT NULL,
    weekly_hours NUMERIC(5,2) CHECK (weekly_hours IS NULL OR weekly_hours >= 0),
    reserved_management_hours NUMERIC(5,2) DEFAULT 0.00 CHECK (reserved_management_hours >= 0),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_capacity_member UNIQUE (workspace_id, roster_person_id),
    CONSTRAINT fk_capacity_roster FOREIGN KEY (workspace_id, roster_person_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_capacity_reserved CHECK (reserved_management_hours IS NULL OR weekly_hours IS NULL OR reserved_management_hours <= weekly_hours)
);

CREATE TRIGGER trg_member_capacities_updated_at
BEFORE UPDATE ON public.member_capacities
FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- 10. LEAVE DAYS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leave_days (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    roster_person_id UUID NOT NULL,
    leave_date DATE NOT NULL,
    hours NUMERIC(4,2) NOT NULL DEFAULT 8.00 CHECK (hours > 0 AND hours <= 24),
    leave_type public.leave_type NOT NULL DEFAULT 'annual',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_leave_person_date UNIQUE (workspace_id, roster_person_id, leave_date),
    CONSTRAINT fk_leave_roster FOREIGN KEY (workspace_id, roster_person_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE CASCADE
);

CREATE TRIGGER trg_leave_days_updated_at
BEFORE UPDATE ON public.leave_days
FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- 11. CLIENTS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clients (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (btrim(name) <> ''),
    owner_roster_id UUID,
    difficulty public.client_difficulty NOT NULL DEFAULT 'Medium',
    extra_workload public.client_extra_workload NOT NULL DEFAULT 'None',
    state public.client_state NOT NULL DEFAULT 'Active',
    notes TEXT,
    brand_guide_url TEXT,
    brief_url TEXT,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_client_name_workspace UNIQUE (workspace_id, name),
    CONSTRAINT uq_clients_composite UNIQUE (workspace_id, id),
    CONSTRAINT fk_client_owner FOREIGN KEY (workspace_id, owner_roster_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE SET NULL (owner_roster_id)
);

CREATE TRIGGER trg_clients_updated_at
BEFORE UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- 12. CAMPAIGNS (Composite client_id Key for Cross-Client Isolation)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaigns (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL,
    client_id UUID NOT NULL,
    title TEXT NOT NULL CHECK (btrim(title) <> ''),
    objective TEXT,
    brief TEXT,
    start_date DATE,
    due_date DATE,
    status public.campaign_status NOT NULL DEFAULT 'Draft',
    asset_links TEXT[] DEFAULT '{}',
    created_by_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_campaigns_composite UNIQUE (workspace_id, id),
    CONSTRAINT uq_campaigns_client_id UNIQUE (workspace_id, client_id, id),
    CONSTRAINT fk_campaign_client FOREIGN KEY (workspace_id, client_id)
        REFERENCES public.clients(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_campaign_created_by FOREIGN KEY (workspace_id, created_by_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_campaigns_updated_at
BEFORE UPDATE ON public.campaigns
FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- 13. TASKS (Workflow Mutations via RPCs Only; Composite Campaign & Attachment Integrity)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL,
    client_id UUID NOT NULL,
    campaign_id UUID,
    title TEXT NOT NULL CHECK (btrim(title) <> ''),
    brief TEXT,
    description TEXT,
    deliverable_format TEXT,
    deliverable_number TEXT NOT NULL DEFAULT '',
    priority public.task_priority NOT NULL DEFAULT 'Normal',
    status public.task_status NOT NULL DEFAULT 'backlog',
    primary_assignee_id UUID,
    reviewer_id UUID,
    due_date TIMESTAMPTZ,
    estimated_hours NUMERIC(5,2) CHECK (estimated_hours IS NULL OR estimated_hours >= 0),
    created_by_id UUID,
    delivered_at TIMESTAMPTZ,
    working_file_url TEXT,
    reference_urls TEXT[] DEFAULT '{}',
    final_deliverable_url TEXT,
    final_deliverable_attachment_id UUID,
    block_reason TEXT,
    blocked_at TIMESTAMPTZ,
    cancel_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    reopen_reason TEXT,
    reopened_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,
    archive_reason TEXT,
    archived_by_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_task_composite UNIQUE (workspace_id, id),
    CONSTRAINT chk_task_reviewer_assignee CHECK (reviewer_id IS NULL OR primary_assignee_id IS NULL OR reviewer_id <> primary_assignee_id),
    CONSTRAINT fk_task_client FOREIGN KEY (workspace_id, client_id)
        REFERENCES public.clients(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_task_campaign FOREIGN KEY (workspace_id, client_id, campaign_id)
        REFERENCES public.campaigns(workspace_id, client_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_task_assignee FOREIGN KEY (workspace_id, primary_assignee_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_task_reviewer FOREIGN KEY (workspace_id, reviewer_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_task_created_by FOREIGN KEY (workspace_id, created_by_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_task_archived_by FOREIGN KEY (workspace_id, archived_by_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_tasks_updated_at
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- 14. TASK COLLABORATORS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_collaborators (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL,
    task_id UUID NOT NULL,
    roster_person_id UUID NOT NULL,
    role_description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_task_collaborator UNIQUE (workspace_id, task_id, roster_person_id),
    CONSTRAINT fk_collab_task FOREIGN KEY (workspace_id, task_id)
        REFERENCES public.tasks(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_collab_person FOREIGN KEY (workspace_id, roster_person_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------------
-- 15. TASK CHECKLIST ITEMS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_checklist_items (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL,
    task_id UUID NOT NULL,
    title TEXT NOT NULL CHECK (btrim(title) <> ''),
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT fk_checklist_task FOREIGN KEY (workspace_id, task_id)
        REFERENCES public.tasks(workspace_id, id) ON DELETE CASCADE
);

CREATE TRIGGER trg_checklist_updated_at
BEFORE UPDATE ON public.task_checklist_items
FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- 16. REVIEW ROUNDS (1 Pending Round Constraint, Non-Self-Approval)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.review_rounds (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL,
    task_id UUID NOT NULL,
    round_number INT NOT NULL CHECK (round_number >= 1),
    round_type public.review_round_type NOT NULL DEFAULT 'internal',
    submitter_id UUID NOT NULL,
    preview_url TEXT,
    note TEXT,
    reviewer_id UUID NOT NULL,
    decision public.review_decision NOT NULL DEFAULT 'pending',
    feedback TEXT,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_review_rounds_composite UNIQUE (workspace_id, id),
    CONSTRAINT uq_task_round_number UNIQUE (workspace_id, task_id, round_number),
    CONSTRAINT chk_review_rounds_no_self_review CHECK (submitter_id <> reviewer_id),
    CONSTRAINT fk_round_task FOREIGN KEY (workspace_id, task_id)
        REFERENCES public.tasks(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_round_submitter FOREIGN KEY (workspace_id, submitter_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_round_reviewer FOREIGN KEY (workspace_id, reviewer_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_round_feedback CHECK (decision <> 'changes_requested' OR (feedback IS NOT NULL AND btrim(feedback) <> ''))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_pending_review_round
ON public.review_rounds (task_id)
WHERE decision = 'pending';

CREATE TRIGGER trg_review_rounds_updated_at
BEFORE UPDATE ON public.review_rounds
FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE OR REPLACE FUNCTION public.fn_protect_review_rounds_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Review rounds cannot be deleted.' USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Only permit transition from pending to decided (approved, changes_requested)
        IF OLD.decision <> 'pending' THEN
            RAISE EXCEPTION 'Decided review rounds are immutable and cannot be updated.' USING ERRCODE = '42501';
        END IF;

        IF NEW.decision = 'pending' THEN
            RAISE EXCEPTION 'Review round parameters cannot be updated while pending.' USING ERRCODE = '42501';
        END IF;

        IF (to_jsonb(NEW) - ARRAY['decision','feedback','decided_at','updated_at'])
           IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['decision','feedback','decided_at','updated_at']) THEN
            RAISE EXCEPTION 'Review identity and submitted content are immutable.' USING ERRCODE = '42501';
        END IF;
        IF NEW.decided_at IS NULL OR NEW.decided_at < OLD.submitted_at THEN
            RAISE EXCEPTION 'A valid decision timestamp is required.';
        END IF;
        IF NEW.decision NOT IN ('approved', 'changes_requested') THEN
            RAISE EXCEPTION 'Invalid review decision transition.' USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_review_rounds_update
BEFORE UPDATE ON public.review_rounds
FOR EACH ROW EXECUTE FUNCTION public.fn_protect_review_rounds_mutation();

CREATE TRIGGER trg_protect_review_rounds_delete
BEFORE DELETE ON public.review_rounds
FOR EACH ROW EXECUTE FUNCTION public.fn_protect_review_rounds_mutation();


-- -----------------------------------------------------------------------------
-- 17. COMMENTS (Column-Level Grant UPDATE content with Trigger Protection)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.comments (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL,
    task_id UUID NOT NULL,
    author_roster_id UUID NOT NULL,
    content TEXT NOT NULL CHECK (btrim(content) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT fk_comment_task FOREIGN KEY (workspace_id, task_id)
        REFERENCES public.tasks(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_comment_author FOREIGN KEY (workspace_id, author_roster_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.fn_protect_comment_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.id <> OLD.id OR NEW.workspace_id <> OLD.workspace_id OR NEW.task_id <> OLD.task_id OR NEW.author_roster_id <> OLD.author_roster_id THEN
        RAISE EXCEPTION 'Only comment content can be updated.' USING ERRCODE = '42501';
    END IF;
    NEW.updated_at = pg_catalog.now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_comments_immutable_fields
BEFORE UPDATE ON public.comments
FOR EACH ROW EXECUTE FUNCTION public.fn_protect_comment_immutability();

-- -----------------------------------------------------------------------------
-- 18. ATTACHMENTS (Composite Task Deliverable Key)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attachments (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL,
    task_id UUID NOT NULL,
    uploader_roster_id UUID NOT NULL,
    file_name TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 104857600), -- max 100MB
    mime_type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_attachments_composite UNIQUE (workspace_id, task_id, id),
    CONSTRAINT chk_attachment_storage_path CHECK (storage_path ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[^/]+$' AND lower(split_part(storage_path,'/',1)) = workspace_id::text AND lower(split_part(storage_path,'/',2)) = task_id::text),
    CONSTRAINT fk_attachment_task FOREIGN KEY (workspace_id, task_id)
        REFERENCES public.tasks(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_attachment_uploader FOREIGN KEY (workspace_id, uploader_roster_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT
);

-- Connect tasks.final_deliverable_attachment_id with column-specific ON DELETE SET NULL
ALTER TABLE public.tasks
ADD CONSTRAINT fk_task_final_attachment
FOREIGN KEY (workspace_id, id, final_deliverable_attachment_id)
REFERENCES public.attachments(workspace_id, task_id, id)
ON DELETE SET NULL (final_deliverable_attachment_id);

-- -----------------------------------------------------------------------------
-- 19. IN-APP NOTIFICATIONS (Column-level update on is_read only)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.in_app_notifications (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    recipient_roster_id UUID NOT NULL,
    actor_roster_id UUID,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    task_id UUID,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT fk_notif_recipient FOREIGN KEY (workspace_id, recipient_roster_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_notif_actor FOREIGN KEY (workspace_id, actor_roster_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_notif_task FOREIGN KEY (workspace_id, task_id)
        REFERENCES public.tasks(workspace_id, id) ON DELETE SET NULL (task_id)
);

-- -----------------------------------------------------------------------------
-- 20. TASK EVENT LEDGERS (Append-only Historical Ledgers)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_status_events (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL,
    task_id UUID NOT NULL,
    from_status public.task_status,
    to_status public.task_status NOT NULL,
    actor_id UUID,
    reason TEXT,
    review_round_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT fk_tse_task FOREIGN KEY (workspace_id, task_id)
        REFERENCES public.tasks(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_tse_actor FOREIGN KEY (workspace_id, actor_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_tse_round FOREIGN KEY (workspace_id, review_round_id)
        REFERENCES public.review_rounds(workspace_id, id) ON DELETE SET NULL (review_round_id)
);

CREATE TABLE IF NOT EXISTS public.task_assignment_events (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL,
    task_id UUID NOT NULL,
    previous_assignee_id UUID,
    new_assignee_id UUID,
    actor_id UUID,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT fk_tae_task FOREIGN KEY (workspace_id, task_id)
        REFERENCES public.tasks(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_tae_actor FOREIGN KEY (workspace_id, actor_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_tae_prev FOREIGN KEY (workspace_id, previous_assignee_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_tae_new FOREIGN KEY (workspace_id, new_assignee_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.task_due_date_events (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL,
    task_id UUID NOT NULL,
    previous_due_date TIMESTAMPTZ,
    new_due_date TIMESTAMPTZ,
    actor_id UUID,
    reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT fk_tdde_task FOREIGN KEY (workspace_id, task_id)
        REFERENCES public.tasks(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_tdde_actor FOREIGN KEY (workspace_id, actor_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT
);

-- -----------------------------------------------------------------------------
-- 21. TIME ENTRIES (GiST Exclusion Constraint, Overlap Prevention, Canonical source)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.time_entries (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL,
    task_id UUID NOT NULL,
    roster_person_id UUID NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    duration_seconds INT CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    category public.time_category NOT NULL DEFAULT 'initial_design',
    note TEXT,
    source public.time_entry_source NOT NULL DEFAULT 'timer',
    created_by_id UUID NOT NULL,
    review_round_id UUID,
    is_voided BOOLEAN NOT NULL DEFAULT FALSE,
    void_reason TEXT,
    voided_at TIMESTAMPTZ,
    voided_by_id UUID,
    correction_request_id UUID,
    replaces_time_entry_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_time_entries_composite UNIQUE (workspace_id, id),
    CONSTRAINT chk_time_entries_range CHECK (ended_at IS NULL OR ended_at > started_at),
    CONSTRAINT exclude_overlapping_user_sessions EXCLUDE USING gist (
        roster_person_id WITH =,
        tstzrange(started_at, COALESCE(ended_at, 'infinity'::TIMESTAMPTZ), '[)') WITH &&
    ) WHERE (is_voided = FALSE),
    CONSTRAINT fk_time_task FOREIGN KEY (workspace_id, task_id)
        REFERENCES public.tasks(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_time_person FOREIGN KEY (workspace_id, roster_person_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_time_created_by FOREIGN KEY (workspace_id, created_by_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_time_voided_by FOREIGN KEY (workspace_id, voided_by_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_time_round FOREIGN KEY (workspace_id, review_round_id)
        REFERENCES public.review_rounds(workspace_id, id) ON DELETE SET NULL (review_round_id),
    CONSTRAINT fk_time_replaces FOREIGN KEY (workspace_id, replaces_time_entry_id)
        REFERENCES public.time_entries(workspace_id, id) ON DELETE RESTRICT
);

-- Canonical single partial unique index for open timers per roster person
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_open_timer_per_person
ON public.time_entries (roster_person_id)
WHERE ended_at IS NULL AND is_voided = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_replacement_per_original
ON public.time_entries (replaces_time_entry_id)
WHERE replaces_time_entry_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_replacement_per_correction
ON public.time_entries (correction_request_id)
WHERE correction_request_id IS NOT NULL;

CREATE TRIGGER trg_time_entries_updated_at
BEFORE UPDATE ON public.time_entries
FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- 22. TIME CORRECTION REQUESTS (Audit Trail & Replacement Lineage)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.time_change_requests (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL,
    time_entry_id UUID NOT NULL,
    requested_by_id UUID NOT NULL,
    original_started_at TIMESTAMPTZ NOT NULL,
    original_ended_at TIMESTAMPTZ,
    proposed_started_at TIMESTAMPTZ NOT NULL,
    proposed_ended_at TIMESTAMPTZ NOT NULL,
    proposed_category public.time_category NOT NULL,
    proposed_note TEXT,
    reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
    status public.correction_status NOT NULL DEFAULT 'pending',
    reviewed_by_id UUID,
    decision_reason TEXT,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_time_change_requests_composite UNIQUE (workspace_id, id),
    CONSTRAINT chk_proposed_range CHECK (proposed_ended_at > proposed_started_at),
    CONSTRAINT fk_tcr_entry FOREIGN KEY (workspace_id, time_entry_id)
        REFERENCES public.time_entries(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_tcr_requester FOREIGN KEY (workspace_id, requested_by_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_tcr_reviewer FOREIGN KEY (workspace_id, reviewed_by_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_time_change_requests_updated_at
BEFORE UPDATE ON public.time_change_requests
FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- Tenant-safe composite FK from replacement time entry to its correction request
ALTER TABLE public.time_entries
ADD CONSTRAINT fk_time_entry_correction_request
FOREIGN KEY (workspace_id, correction_request_id)
REFERENCES public.time_change_requests(workspace_id, id)
ON DELETE RESTRICT;


-- -----------------------------------------------------------------------------
-- 23. MONTHLY REPORT SNAPSHOTS (Immutable Finalized Reports)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.monthly_report_snapshots (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    month_key TEXT NOT NULL CHECK (month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    revision_number INT NOT NULL DEFAULT 1 CHECK (revision_number >= 1),
    is_finalized BOOLEAN NOT NULL DEFAULT TRUE,
    finalized_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    finalized_by_id UUID NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
    snapshot_data JSONB NOT NULL,
    management_commentary JSONB DEFAULT '{}'::jsonb,
    snapshot_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_monthly_snapshot UNIQUE (workspace_id, month_key, revision_number),
    CONSTRAINT fk_snapshot_finalizer FOREIGN KEY (workspace_id, finalized_by_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.fn_protect_finalized_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'Finalized monthly report snapshots are immutable and cannot be updated or deleted.'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trg_protect_finalized_snapshot_update
BEFORE UPDATE ON public.monthly_report_snapshots
FOR EACH ROW EXECUTE FUNCTION public.fn_protect_finalized_snapshot();

CREATE TRIGGER trg_protect_finalized_snapshot_delete
BEFORE DELETE ON public.monthly_report_snapshots
FOR EACH ROW EXECUTE FUNCTION public.fn_protect_finalized_snapshot();

-- -----------------------------------------------------------------------------
-- 24. AUDIT EVENTS (Append-only Audit Trail, Canonical entity_type, entity_id UUID, metadata)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_events (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    actor_id UUID,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT fk_audit_actor FOREIGN KEY (workspace_id, actor_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT
);

-- -----------------------------------------------------------------------------
-- 25. RPC IDEMPOTENCY RECORDS (Concurrency-Safe Request Cache)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rpc_idempotency_records (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL,
    operation_name TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_idempotency_key UNIQUE (workspace_id, actor_id, operation_name, idempotency_key),
    CONSTRAINT fk_idempotency_actor FOREIGN KEY (workspace_id, actor_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE RESTRICT
);

-- -----------------------------------------------------------------------------
-- 26. RESTRICTIVE PERMISSIONS & LEAST-PRIVILEGE GRANTS
-- -----------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Workflow-sensitive tables: authenticated receives SELECT only (all mutations via secure audited RPCs)
GRANT SELECT ON public.workspaces TO authenticated;
GRANT SELECT ON public.roster_people TO authenticated;
GRANT SELECT ON public.workspace_memberships TO authenticated;
GRANT SELECT ON public.workspace_invitations TO authenticated;
GRANT SELECT ON public.review_routing_rules TO authenticated;
GRANT SELECT ON public.member_capacities TO authenticated;
GRANT SELECT ON public.leave_days TO authenticated;
GRANT SELECT ON public.clients TO authenticated;
GRANT SELECT ON public.campaigns TO authenticated;
GRANT SELECT ON public.tasks TO authenticated;
GRANT SELECT ON public.task_collaborators TO authenticated;
GRANT SELECT ON public.task_checklist_items TO authenticated;
GRANT SELECT ON public.review_rounds TO authenticated;
GRANT SELECT ON public.attachments TO authenticated;
GRANT SELECT ON public.task_status_events TO authenticated;
GRANT SELECT ON public.task_assignment_events TO authenticated;
GRANT SELECT ON public.task_due_date_events TO authenticated;
GRANT SELECT ON public.time_entries TO authenticated;
GRANT SELECT ON public.time_change_requests TO authenticated;
GRANT SELECT ON public.monthly_report_snapshots TO authenticated;
GRANT SELECT ON public.audit_events TO authenticated;
GRANT SELECT ON public.rpc_idempotency_records TO authenticated;

-- Comments: INSERT, DELETE, and column-level UPDATE on content only
GRANT INSERT, DELETE ON public.comments TO authenticated;
GRANT SELECT ON public.comments TO authenticated;
GRANT UPDATE (content) ON public.comments TO authenticated;

-- Notifications: SELECT and column-level UPDATE on is_read only
GRANT SELECT ON public.in_app_notifications TO authenticated;
GRANT UPDATE (is_read) ON public.in_app_notifications TO authenticated;

-- Public safe utilities
GRANT EXECUTE ON FUNCTION public.safe_cast_uuid(TEXT) TO authenticated, service_role;

-- Full service_role access for admin operations
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;


-- Revoke execution on trigger helper functions from PUBLIC, anon
REVOKE ALL ON FUNCTION public.fn_set_updated_at() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_protect_finalized_snapshot() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_protect_review_rounds_mutation() FROM PUBLIC, anon;

COMMIT;
