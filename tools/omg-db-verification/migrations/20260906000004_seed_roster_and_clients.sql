-- OMG Creative Workspace: Seed Data (Roster, Configurable Routing & Clients) (V3.5-R1 repaired baseline)
-- Migration: 20260906000004_seed_roster_and_clients.sql
-- Strictly Transactional: Everything wrapped in BEGIN; ... COMMIT;

BEGIN;

DO $$
DECLARE
    v_workspace_id UUID;
    v_owner_id UUID;
    v_nada_id UUID;
    v_emad_id UUID;
    v_sarah_id UUID;
    v_alaa_id UUID;
    v_shahd_id UUID;
    v_aya_id UUID;
BEGIN
    -- 1. Ensure Default Workspace exists
    SELECT id INTO v_workspace_id FROM public.workspaces WHERE name = 'OMG Creative' LIMIT 1;
    IF v_workspace_id IS NULL THEN
        INSERT INTO public.workspaces (name, default_timezone, long_session_threshold_mins)
        VALUES ('OMG Creative', 'Africa/Cairo', 240)
        RETURNING id INTO v_workspace_id;
    END IF;

    -- 2. Seed Unlinked Roster Owner (Real auth user will be linked via bootstrap_owner)
    SELECT id INTO v_owner_id FROM public.roster_people WHERE workspace_id = v_workspace_id AND display_name = 'المدير العام (Owner)' LIMIT 1;
    IF v_owner_id IS NULL THEN
        INSERT INTO public.roster_people (workspace_id, display_name, job_title)
        VALUES (v_workspace_id, 'المدير العام (Owner)', 'Agency Owner & Creative Director')
        RETURNING id INTO v_owner_id;
    END IF;

    -- 3. Seed Exactly 6 Agency Designers with Exact Specification Job Titles
    -- Job titles are strictly decoupled from permission roles (managed in workspace_memberships)

    -- ندى — Senior Graphic Designer (Role: senior_reviewer)
    SELECT id INTO v_nada_id FROM public.roster_people WHERE workspace_id = v_workspace_id AND display_name = 'ندى' LIMIT 1;
    IF v_nada_id IS NULL THEN
        INSERT INTO public.roster_people (workspace_id, display_name, job_title)
        VALUES (v_workspace_id, 'ندى', 'Senior Graphic Designer')
        RETURNING id INTO v_nada_id;
    END IF;

    -- عماد — Art Director (Role: manager)
    SELECT id INTO v_emad_id FROM public.roster_people WHERE workspace_id = v_workspace_id AND display_name = 'عماد' LIMIT 1;
    IF v_emad_id IS NULL THEN
        INSERT INTO public.roster_people (workspace_id, display_name, job_title)
        VALUES (v_workspace_id, 'عماد', 'Art Director')
        RETURNING id INTO v_emad_id;
    END IF;

    -- سارة — Midlevel Graphic Designer (Role: designer)
    SELECT id INTO v_sarah_id FROM public.roster_people WHERE workspace_id = v_workspace_id AND display_name = 'سارة' LIMIT 1;
    IF v_sarah_id IS NULL THEN
        INSERT INTO public.roster_people (workspace_id, display_name, job_title)
        VALUES (v_workspace_id, 'سارة', 'Midlevel Graphic Designer')
        RETURNING id INTO v_sarah_id;
    END IF;

    -- آلاء — Midlevel Graphic Designer (Role: designer)
    SELECT id INTO v_alaa_id FROM public.roster_people WHERE workspace_id = v_workspace_id AND display_name = 'آلاء' LIMIT 1;
    IF v_alaa_id IS NULL THEN
        INSERT INTO public.roster_people (workspace_id, display_name, job_title)
        VALUES (v_workspace_id, 'آلاء', 'Midlevel Graphic Designer')
        RETURNING id INTO v_alaa_id;
    END IF;

    -- شهد — Midlevel Graphic Designer (Role: designer)
    SELECT id INTO v_shahd_id FROM public.roster_people WHERE workspace_id = v_workspace_id AND display_name = 'شهد' LIMIT 1;
    IF v_shahd_id IS NULL THEN
        INSERT INTO public.roster_people (workspace_id, display_name, job_title)
        VALUES (v_workspace_id, 'شهد', 'Midlevel Graphic Designer')
        RETURNING id INTO v_shahd_id;
    END IF;

    -- آية — Junior Graphic Designer (Role: designer)
    SELECT id INTO v_aya_id FROM public.roster_people WHERE workspace_id = v_workspace_id AND display_name = 'آية' LIMIT 1;
    IF v_aya_id IS NULL THEN
        INSERT INTO public.roster_people (workspace_id, display_name, job_title)
        VALUES (v_workspace_id, 'آية', 'Junior Graphic Designer')
        RETURNING id INTO v_aya_id;
    END IF;

    -- 4. Seed Review Routing Rules (Idempotent - Never duplicates on re-run)

    -- Rule 1: Aya's deliverables route to Nada (fallback: Owner)
    IF NOT EXISTS (
        SELECT 1 FROM public.review_routing_rules
        WHERE workspace_id = v_workspace_id
          AND designer_roster_id = v_aya_id
          AND client_difficulty IS NULL
    ) THEN
        INSERT INTO public.review_routing_rules (
            workspace_id, priority, designer_roster_id, client_difficulty, reviewer_roster_id, fallback_reviewer_id, is_workspace_default
        ) VALUES (
            v_workspace_id, 10, v_aya_id, NULL, v_nada_id, v_owner_id, FALSE
        );
    END IF;

    -- Rule 2: Sarah's Hard-client tasks route to Emad (fallback: Owner)
    IF NOT EXISTS (
        SELECT 1 FROM public.review_routing_rules
        WHERE workspace_id = v_workspace_id
          AND designer_roster_id = v_sarah_id
          AND client_difficulty = 'Hard'
    ) THEN
        INSERT INTO public.review_routing_rules (
            workspace_id, priority, designer_roster_id, client_difficulty, reviewer_roster_id, fallback_reviewer_id, is_workspace_default
        ) VALUES (
            v_workspace_id, 20, v_sarah_id, 'Hard', v_emad_id, v_owner_id, FALSE
        );
    END IF;

    -- Rule 3: Emad's own Hard-client tasks route to Owner (fallback: Nada)
    IF NOT EXISTS (
        SELECT 1 FROM public.review_routing_rules
        WHERE workspace_id = v_workspace_id
          AND designer_roster_id = v_emad_id
          AND client_difficulty = 'Hard'
    ) THEN
        INSERT INTO public.review_routing_rules (
            workspace_id, priority, designer_roster_id, client_difficulty, reviewer_roster_id, fallback_reviewer_id, is_workspace_default
        ) VALUES (
            v_workspace_id, 30, v_emad_id, 'Hard', v_owner_id, v_nada_id, FALSE
        );
    END IF;

    -- Rule 4: Guaranteed Default Fallback Routing for workspace (reviewer: Emad, fallback: Owner)
    IF NOT EXISTS (
        SELECT 1 FROM public.review_routing_rules
        WHERE workspace_id = v_workspace_id
          AND is_workspace_default = TRUE
    ) THEN
        INSERT INTO public.review_routing_rules (
            workspace_id, priority, designer_roster_id, client_difficulty, reviewer_roster_id, fallback_reviewer_id, is_workspace_default
        ) VALUES (
            v_workspace_id, 0, NULL, NULL, v_emad_id, v_owner_id, TRUE
        );
    END IF;

    -- 5. Member Capacities:
    -- Intentionally unconfigured. No fake default 40h capacity row is seeded.

    -- 6. Seed Exactly 28 Client Accounts (Idempotent via ON CONFLICT DO NOTHING)

    -- ندى (5 active accounts)
    INSERT INTO public.clients (workspace_id, name, owner_roster_id, difficulty, extra_workload, state)
    VALUES
        (v_workspace_id, 'masar', v_nada_id, 'Hard', 'None', 'Active'),
        (v_workspace_id, 'ghada el otaby', v_nada_id, 'Hard', 'None', 'Active'),
        (v_workspace_id, 'hmd', v_nada_id, 'Medium', 'None', 'Active'),
        (v_workspace_id, 'dullys', v_nada_id, 'Medium', 'None', 'Active'),
        (v_workspace_id, 'mona taha', v_nada_id, 'Easy', 'None', 'Active')
    ON CONFLICT (workspace_id, name) DO NOTHING;

    -- عماد (3 active accounts)
    INSERT INTO public.clients (workspace_id, name, owner_roster_id, difficulty, extra_workload, state)
    VALUES
        (v_workspace_id, 'karma', v_emad_id, 'Hard', 'None', 'Active'),
        (v_workspace_id, 'solution max', v_emad_id, 'Medium', 'None', 'Active'),
        (v_workspace_id, 'dr reham', v_emad_id, 'Easy', 'None', 'Active')
    ON CONFLICT (workspace_id, name) DO NOTHING;

    -- سارة (5 active accounts)
    INSERT INTO public.clients (workspace_id, name, owner_roster_id, difficulty, extra_workload, state)
    VALUES
        (v_workspace_id, 'dr khalaf', v_sarah_id, 'Hard', 'None', 'Active'),
        (v_workspace_id, 'wael samir', v_sarah_id, 'Medium', 'None', 'Active'),
        (v_workspace_id, 'dalia', v_sarah_id, 'Medium', 'None', 'Active'),
        (v_workspace_id, 'dr nora', v_sarah_id, 'Medium', 'None', 'Active'),
        (v_workspace_id, 'faten', v_sarah_id, 'Easy', 'None', 'Active')
    ON CONFLICT (workspace_id, name) DO NOTHING;

    -- آلاء (5 active accounts)
    INSERT INTO public.clients (workspace_id, name, owner_roster_id, difficulty, extra_workload, state)
    VALUES
        (v_workspace_id, 'travia care', v_alaa_id, 'Medium', 'Many requests', 'Active'),
        (v_workspace_id, 'naama inn', v_alaa_id, 'Medium', 'None', 'Active'),
        (v_workspace_id, 'weqaya', v_alaa_id, 'Medium', 'None', 'Active'),
        (v_workspace_id, 'hadia', v_alaa_id, 'Medium', 'None', 'Active'),
        (v_workspace_id, 'kishk', v_alaa_id, 'Easy', 'None', 'Active')
    ON CONFLICT (workspace_id, name) DO NOTHING;

    -- شهد (5 active accounts)
    INSERT INTO public.clients (workspace_id, name, owner_roster_id, difficulty, extra_workload, state)
    VALUES
        (v_workspace_id, 'nasef', v_shahd_id, 'Medium', 'Many revisions', 'Active'),
        (v_workspace_id, 'al nemr', v_shahd_id, 'Medium', 'None', 'Active'),
        (v_workspace_id, 'el rahman', v_shahd_id, 'Medium', 'None', 'Active'),
        (v_workspace_id, 'shalabya', v_shahd_id, 'Medium', 'None', 'Active'),
        (v_workspace_id, 'kalido', v_shahd_id, 'Medium', 'None', 'Active')
    ON CONFLICT (workspace_id, name) DO NOTHING;

    -- آية (4 active accounts)
    INSERT INTO public.clients (workspace_id, name, owner_roster_id, difficulty, extra_workload, state)
    VALUES
        (v_workspace_id, 'rejuva', v_aya_id, 'Easy', 'None', 'Active'),
        (v_workspace_id, 'ibn sina', v_aya_id, 'Easy', 'None', 'Active'),
        (v_workspace_id, 'kuwaity', v_aya_id, 'Easy', 'None', 'Active'),
        (v_workspace_id, 'al farid', v_aya_id, 'Easy', 'None', 'Active')
    ON CONFLICT (workspace_id, name) DO NOTHING;

    -- الحساب الـ 28: غير مبدوء وغير مسند (Not started & Unassigned)
    INSERT INTO public.clients (workspace_id, name, owner_roster_id, difficulty, extra_workload, state)
    VALUES
        (v_workspace_id, 'zanzi', NULL, 'Unknown', 'Unknown', 'Not started')
    ON CONFLICT (workspace_id, name) DO NOTHING;

END $$;

COMMIT;
