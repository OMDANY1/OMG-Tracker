-- Migration 33: Add requires_video column to client_team_assignments and harden sync
-- Purpose:
-- 1. Distinguish between 'client does not need video' and 'client needs video and unassigned'.
-- 2. Keep client_team_assignments.primary_designer_id synchronized with clients.owner_roster_id.
-- 3. Maintain strict Owner-only authorization and anti-marketing_director restrictions.

BEGIN;

-- 1. Add column requires_video
ALTER TABLE public.client_team_assignments
    ADD COLUMN IF NOT EXISTS requires_video BOOLEAN NOT NULL DEFAULT false;

-- 2. Drop existing 13-param function to avoid signature/default conflicts
DROP FUNCTION IF EXISTS public.upsert_client_team_assignment(UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, TEXT);

-- 3. Enhanced upsert_client_team_assignment RPC (with defaults for all optional parameters)
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
BEGIN
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);

    -- Strictly Owner can configure client team assignments
    IF v_caller.role <> 'owner' THEN
        RAISE EXCEPTION 'Access denied: Only Workspace Owner can configure client team assignments.';
    END IF;

    -- Determine video requirement: if explicitly passed use it; otherwise true if video editor/reviewer is selected
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

    -- Keep clients.owner_roster_id in sync with primary_designer_id if set
    IF p_primary_designer_id IS NOT NULL THEN
        UPDATE public.clients
        SET owner_roster_id = p_primary_designer_id,
            updated_at = pg_catalog.now()
        WHERE id = p_client_id AND workspace_id = p_workspace_id;
    END IF;

    RETURN to_jsonb(v_res);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 4. Grant permissions
GRANT EXECUTE ON FUNCTION public.upsert_client_team_assignment(UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, TEXT, BOOLEAN) TO authenticated, service_role;

COMMIT;
