-- Migration 28: Agency Workflow & Time Tracking Expansion
-- Expands OMG Creative Workspace to support Strategy, Copywriting, Design, and Video Production
-- Strictly Transactional: Everything wrapped in BEGIN; ... COMMIT;

BEGIN;

-- 1. EXTEND ROSTER PEOPLE WITH SPECIALTIES
ALTER TABLE public.roster_people
    ADD COLUMN IF NOT EXISTS specialties TEXT[] DEFAULT '{design}';

-- Update existing design team with their specialties
UPDATE public.roster_people
SET specialties = '{design,management}'
WHERE display_name = 'عماد';

UPDATE public.roster_people
SET specialties = '{design}'
WHERE display_name IN ('ندى', 'سارة', 'آلاء', 'شهد', 'آية')
  AND (specialties IS NULL OR specialties = '{design}');

-- 2. SEED EXPANDED ROSTER MEMBERS (IDEMPOTENT)
DO $$
DECLARE
    v_workspace_id UUID;
BEGIN
    SELECT id INTO v_workspace_id FROM public.workspaces WHERE name = 'OMG Creative' LIMIT 1;
    IF v_workspace_id IS NULL THEN
        SELECT id INTO v_workspace_id FROM public.workspaces LIMIT 1;
    END IF;

    IF v_workspace_id IS NOT NULL THEN
        -- عطا — Marketing Director
        INSERT INTO public.roster_people (workspace_id, display_name, job_title, specialties)
        VALUES (v_workspace_id, 'عطا', 'Marketing Director', '{management,strategy}')
        ON CONFLICT (workspace_id, display_name) 
        DO UPDATE SET job_title = 'Marketing Director', specialties = '{management,strategy}';

        -- اروى — Strategy Team Lead
        INSERT INTO public.roster_people (workspace_id, display_name, job_title, specialties)
        VALUES (v_workspace_id, 'اروى', 'Strategy Team Lead', '{strategy}')
        ON CONFLICT (workspace_id, display_name) 
        DO UPDATE SET job_title = 'Strategy Team Lead', specialties = '{strategy}';

        -- تسنيم — Strategist
        INSERT INTO public.roster_people (workspace_id, display_name, job_title, specialties)
        VALUES (v_workspace_id, 'تسنيم', 'Strategist', '{strategy}')
        ON CONFLICT (workspace_id, display_name) 
        DO UPDATE SET job_title = 'Strategist', specialties = '{strategy}';

        -- هند — Strategist
        INSERT INTO public.roster_people (workspace_id, display_name, job_title, specialties)
        VALUES (v_workspace_id, 'هند', 'Strategist', '{strategy}')
        ON CONFLICT (workspace_id, display_name) 
        DO UPDATE SET job_title = 'Strategist', specialties = '{strategy}';

        -- هاجر حسن — Strategist
        INSERT INTO public.roster_people (workspace_id, display_name, job_title, specialties)
        VALUES (v_workspace_id, 'هاجر حسن', 'Strategist', '{strategy}')
        ON CONFLICT (workspace_id, display_name) 
        DO UPDATE SET job_title = 'Strategist', specialties = '{strategy}';

        -- ميرهان — Content Writer
        INSERT INTO public.roster_people (workspace_id, display_name, job_title, specialties)
        VALUES (v_workspace_id, 'ميرهان', 'Content Writer', '{copywriting}')
        ON CONFLICT (workspace_id, display_name) 
        DO UPDATE SET job_title = 'Content Writer', specialties = '{copywriting}';

        -- ميار — Content Writer
        INSERT INTO public.roster_people (workspace_id, display_name, job_title, specialties)
        VALUES (v_workspace_id, 'ميار', 'Content Writer', '{copywriting}')
        ON CONFLICT (workspace_id, display_name) 
        DO UPDATE SET job_title = 'Content Writer', specialties = '{copywriting}';

        -- ريهام — Content Writer
        INSERT INTO public.roster_people (workspace_id, display_name, job_title, specialties)
        VALUES (v_workspace_id, 'ريهام', 'Content Writer', '{copywriting}')
        ON CONFLICT (workspace_id, display_name) 
        DO UPDATE SET job_title = 'Content Writer', specialties = '{copywriting}';

        -- فيديو إيديتور (تجريبي) — Video Editor Staging Fixture
        INSERT INTO public.roster_people (workspace_id, display_name, job_title, specialties)
        VALUES (v_workspace_id, 'فيديو إيديتور (تجريبي)', 'Video Editor', '{video_editing}')
        ON CONFLICT (workspace_id, display_name) 
        DO UPDATE SET job_title = 'Video Editor', specialties = '{video_editing}';
    END IF;
END $$;

-- 3. CLIENT TEAM ASSIGNMENTS TABLE
CREATE TABLE IF NOT EXISTS public.client_team_assignments (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    primary_strategist_id UUID REFERENCES public.roster_people(id) ON DELETE SET NULL,
    primary_copywriter_id UUID REFERENCES public.roster_people(id) ON DELETE SET NULL,
    primary_designer_id UUID REFERENCES public.roster_people(id) ON DELETE SET NULL,
    primary_video_editor_id UUID REFERENCES public.roster_people(id) ON DELETE SET NULL,
    strategy_reviewer_id UUID REFERENCES public.roster_people(id) ON DELETE SET NULL,
    copywriting_reviewer_id UUID REFERENCES public.roster_people(id) ON DELETE SET NULL,
    design_reviewer_id UUID REFERENCES public.roster_people(id) ON DELETE SET NULL,
    video_reviewer_id UUID REFERENCES public.roster_people(id) ON DELETE SET NULL,
    marketing_director_id UUID REFERENCES public.roster_people(id) ON DELETE SET NULL,
    strategy_lead_id UUID REFERENCES public.roster_people(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_client_team_assignment UNIQUE (workspace_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_cta_client ON public.client_team_assignments (workspace_id, client_id);
CREATE INDEX IF NOT EXISTS idx_cta_strategist ON public.client_team_assignments (workspace_id, primary_strategist_id);
CREATE INDEX IF NOT EXISTS idx_cta_copywriter ON public.client_team_assignments (workspace_id, primary_copywriter_id);
CREATE INDEX IF NOT EXISTS idx_cta_designer ON public.client_team_assignments (workspace_id, primary_designer_id);
CREATE INDEX IF NOT EXISTS idx_cta_video_editor ON public.client_team_assignments (workspace_id, primary_video_editor_id);

-- 4. CLIENT BRIEFS & STRATEGY TABLE
CREATE TABLE IF NOT EXISTS public.client_briefs (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    objectives TEXT,
    target_audience TEXT,
    products_services TEXT,
    tone_of_voice TEXT,
    content_pillars TEXT[] DEFAULT '{}',
    dos_and_donts TEXT,
    brand_guidelines_url TEXT,
    assets_drive_url TEXT,
    strategy_summary TEXT,
    approved_strategy_content TEXT,
    strategy_version INT NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'reviewed', 'approved')),
    operational_review_by UUID REFERENCES public.roster_people(id) ON DELETE SET NULL,
    operational_review_at TIMESTAMPTZ,
    operational_feedback TEXT,
    approved_by_roster_id UUID REFERENCES public.roster_people(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_client_brief UNIQUE (workspace_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_cb_client ON public.client_briefs (workspace_id, client_id);

-- 5. EXTEND TASKS TABLE WITH WORK STAGE, DEPENDENCY & WAITING REASON
ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS work_stage TEXT NOT NULL DEFAULT 'design',
    ADD COLUMN IF NOT EXISTS content_version_used INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS dependency_task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS waiting_reason TEXT,
    ADD COLUMN IF NOT EXISTS waiting_since TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS waiting_on_roster_id UUID REFERENCES public.roster_people(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS is_waiting BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_task_work_stage') THEN
        ALTER TABLE public.tasks
            ADD CONSTRAINT chk_task_work_stage
            CHECK (work_stage IN ('strategy', 'copywriting', 'design', 'video_editing', 'video_cover'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_task_item_stage') THEN
        ALTER TABLE public.tasks
            ADD CONSTRAINT uq_task_item_stage
            UNIQUE (workspace_id, content_calendar_item_id, work_stage);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_work_stage ON public.tasks (workspace_id, work_stage);
CREATE INDEX IF NOT EXISTS idx_tasks_dependency ON public.tasks (dependency_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_waiting ON public.tasks (workspace_id, is_waiting) WHERE is_waiting = TRUE;

-- 6. TASK DELIVERABLES TABLE (Versioned Deliverables for Copy, Video, Strategy)
CREATE TABLE IF NOT EXISTS public.task_deliverables (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    version_number INT NOT NULL DEFAULT 1,
    deliverable_type TEXT NOT NULL DEFAULT 'text' CHECK (deliverable_type IN ('strategy', 'copywriting', 'design', 'video', 'video_cover', 'text')),
    title TEXT,
    body_content TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    deliverable_url TEXT,
    notes TEXT,
    submitted_by_id UUID NOT NULL REFERENCES public.roster_people(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_task_deliverable_version UNIQUE (task_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_task_deliv_task ON public.task_deliverables (task_id, version_number);

-- 7. ROW LEVEL SECURITY ON NEW TABLES
ALTER TABLE public.client_team_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_deliverables ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    -- client_team_assignments policy
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'client_team_assignments' AND policyname = 'p_cta_workspace_members') THEN
        CREATE POLICY p_cta_workspace_members ON public.client_team_assignments
            FOR ALL
            USING (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid() AND is_active = TRUE))
            WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid() AND is_active = TRUE));
    END IF;

    -- client_briefs policy
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'client_briefs' AND policyname = 'p_cb_workspace_members') THEN
        CREATE POLICY p_cb_workspace_members ON public.client_briefs
            FOR ALL
            USING (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid() AND is_active = TRUE))
            WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid() AND is_active = TRUE));
    END IF;

    -- task_deliverables policy
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_deliverables' AND policyname = 'p_td_workspace_members') THEN
        CREATE POLICY p_td_workspace_members ON public.task_deliverables
            FOR ALL
            USING (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid() AND is_active = TRUE))
            WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid() AND is_active = TRUE));
    END IF;
END $$;

-- 8. RPC: UPSERT CLIENT TEAM ASSIGNMENT
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

    -- Only Owner, Manager, or Marketing Director can configure client team
    IF v_caller.role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Access denied: Only Owner or Management can configure client team assignments.';
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

    -- Also keep legacy clients.owner_roster_id in sync if primary_designer_id is specified
    IF p_primary_designer_id IS NOT NULL THEN
        UPDATE public.clients
        SET owner_roster_id = p_primary_designer_id, updated_at = pg_catalog.now()
        WHERE workspace_id = p_workspace_id AND id = p_client_id;
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE,
        'client_id', p_client_id,
        'team_assignment', row_to_json(v_res)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 9. RPC: UPSERT CLIENT BRIEF
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

-- 10. RPC: OPERATIONAL STRATEGY REVIEW (Arwa - Strategy Lead / Designated Strategy Reviewer)
CREATE OR REPLACE FUNCTION public.review_client_brief_operational(
    p_workspace_id UUID,
    p_client_id UUID,
    p_decision TEXT DEFAULT 'approved', -- 'approved' or 'changes_requested'
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
    IF v_caller.role <> 'owner' 
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

-- 10.1 RPC: MARKETING STRATEGY APPROVAL (Ata - Marketing Director / Owner Emad)
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
    v_team RECORD;
    v_new_version INT;
BEGIN
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);

    SELECT * INTO v_brief FROM public.client_briefs
    WHERE workspace_id = p_workspace_id AND client_id = p_client_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Client brief not found.';
    END IF;

    SELECT * INTO v_team FROM public.client_team_assignments
    WHERE workspace_id = p_workspace_id AND client_id = p_client_id;

    -- Marketing Approval authorization: Owner (Emad) or Marketing Director (Ata) assigned for this client
    IF v_caller.role <> 'owner' 
       AND v_caller.roster_person_id <> COALESCE(v_team.marketing_director_id, '00000000-0000-0000-0000-000000000000'::UUID) THEN
        RAISE EXCEPTION 'Access denied: Only Marketing Director (Ata) or Workspace Owner can grant final marketing strategy approval.';
    END IF;

    -- Enforce prerequisite: Operational review must be completed first (or bypassed by Owner)
    IF v_caller.role <> 'owner' AND v_brief.status <> 'reviewed' THEN
        RAISE EXCEPTION 'Prerequisite not met: Strategy must pass operational review by Strategy Lead before final marketing approval.';
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
        'strategy_version', v_new_version,
        'approved_by', v_caller.roster_person_id,
        'approved_at', pg_catalog.now()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 11. RPC: SUBMIT TASK DELIVERABLE (Copywriting, Video, Strategy)
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
BEGIN
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Task not found.'; END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_task.workspace_id);

    -- Check involvement
    IF NOT private.can_work_on_task(p_task_id) AND v_caller.role <> 'owner' THEN
        RAISE EXCEPTION 'Access denied: You are not assigned to this task.';
    END IF;

    -- Calculate next version number
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

    -- Automatically stop any active timer for caller on this task upon submission
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

    -- Insert Review Round automatically if not exists
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
        v_next_ver,
        'internal',
        v_caller.roster_person_id,
        COALESCE(p_deliverable_url, 'https://workspace.internal/deliverable/' || v_deliv_id::TEXT),
        p_notes,
        COALESCE(v_task.reviewer_id, v_caller.roster_person_id),
        'pending'
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'deliverable_id', v_deliv_id,
        'version_number', v_next_ver,
        'status', 'internal_review'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 12. RPC: SET TASK WAITING STATE (Pause timer & log waiting reason)
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
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Task not found.'; END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_task.workspace_id);

    IF p_is_waiting THEN
        IF p_waiting_reason IS NULL OR btrim(p_waiting_reason) = '' THEN
            RAISE EXCEPTION 'Waiting reason is mandatory when pausing work.';
        END IF;

        -- Auto-pause any active timer for caller
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

-- 13. RPC: APPROVE UPSTREAM & UNLOCK DOWNSTREAM (Copywriting -> Design / Video)
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
    SELECT * INTO v_copy_task FROM public.tasks WHERE id = p_copy_task_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Copywriting task not found.'; END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(v_copy_task.workspace_id);

    -- Anti-self-approval
    IF v_copy_task.primary_assignee_id = v_caller.roster_person_id AND v_caller.role <> 'owner' THEN
        RAISE EXCEPTION 'Anti-Self-Approval violation: You cannot approve your own copywriting work.';
    END IF;

    -- Mark copy task as approved
    UPDATE public.tasks
    SET status = 'approved',
        final_deliverable_url = COALESCE(final_deliverable_url, 'approved-copy-text'),
        updated_at = pg_catalog.now()
    WHERE id = p_copy_task_id;

    -- Update review round
    UPDATE public.review_rounds
    SET decision = 'approved',
        decided_at = pg_catalog.now()
    WHERE task_id = p_copy_task_id AND decision = 'pending';

    -- Lock copy onto content_calendar_items if linked
    v_cci_id := v_copy_task.content_calendar_item_id;
    IF v_cci_id IS NOT NULL THEN
        UPDATE public.content_calendar_items
        SET on_design_text = COALESCE(p_approved_copy, on_design_text),
            updated_at = pg_catalog.now()
        WHERE id = v_cci_id;
    END IF;

    -- Unlock downstream tasks (e.g. design or video_editing) linked to this item or dependent on this task
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

-- 14. REVOKE EXECUTION PRIVILEGES FROM PUBLIC AND ANON, GRANT TO AUTHENTICATED
REVOKE EXECUTE ON FUNCTION public.upsert_client_team_assignment(UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_client_team_assignment(UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.upsert_client_brief(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_client_brief(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.approve_client_brief_strategy(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_client_brief_strategy(UUID, UUID, TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.submit_task_deliverable(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_task_deliverable(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.set_task_waiting_state(UUID, BOOLEAN, TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_task_waiting_state(UUID, BOOLEAN, TEXT, UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.approve_copywriting_and_unlock_downstream(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_copywriting_and_unlock_downstream(UUID, TEXT, TEXT) TO authenticated;

COMMIT;
