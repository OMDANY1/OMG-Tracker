-- OMG Creative Workspace: Content Calendars, Notifications & Pause Invitations
-- Migration: 20260908000008_content_calendars_and_pause_invitations.sql
-- Strictly Transactional: Wrapped in BEGIN; ... COMMIT;

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. PRIVATE HELPER: is_workspace_owner
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.is_workspace_owner(p_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_memberships wm
        JOIN public.roster_people rp ON wm.roster_person_id = rp.id
        WHERE wm.workspace_id = p_workspace_id
          AND wm.user_id = auth.uid()
          AND wm.role = 'owner'
          AND wm.is_active = TRUE
          AND rp.is_active = TRUE
    );
$$;

GRANT EXECUTE ON FUNCTION private.is_workspace_owner(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 1. WORKSPACE INVITATIONS PAUSING (Immediate Phase 0 Requirement)
-- -----------------------------------------------------------------------------
ALTER TABLE public.workspaces
    ADD COLUMN IF NOT EXISTS invitations_paused BOOLEAN NOT NULL DEFAULT TRUE;

-- Ensure all existing workspaces are paused by default
UPDATE public.workspaces
SET invitations_paused = TRUE
WHERE invitations_paused IS NOT TRUE;

-- Update create_workspace_invitation to enforce invitations_paused
CREATE OR REPLACE FUNCTION public.create_workspace_invitation(
    p_workspace_id UUID,
    p_email TEXT,
    p_role public.roster_role,
    p_roster_person_id UUID,
    p_idempotency_key TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_caller RECORD;
    v_clean_email TEXT;
    v_target_roster RECORD;
    v_raw_token TEXT;
    v_token_hash TEXT;
    v_invitation_id UUID;
    v_expires_at TIMESTAMPTZ := pg_catalog.now() + INTERVAL '7 days';
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_safe_cached_result JSONB;
    v_result JSONB;
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'Idempotency key cannot be blank.';
    END IF;

    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;

    -- Phase 0: Check invitations_paused
    IF EXISTS (
        SELECT 1 FROM public.workspaces
        WHERE id = p_workspace_id AND invitations_paused = TRUE
    ) THEN
        RAISE EXCEPTION 'الدعوات متوقفة مؤقتًا لحين الانتهاء من تحديث مساحة العمل. سيصلك رابط جديد عند إعادة فتح الدعوات.';
    END IF;

    -- 1. Strictly Owner-Controlled
    IF v_caller.role <> 'owner' THEN
        RAISE EXCEPTION 'Permission denied: Only workspace owner can invite members.';
    END IF;

    -- 2. Do not permit owner role through invitation RPC
    IF p_role = 'owner' THEN
        RAISE EXCEPTION 'Owner role cannot be invited. Ownership transfer requires an explicit transfer workflow.';
    END IF;

    -- 3. Email validation
    v_clean_email := pg_catalog.lower(btrim(p_email));
    IF v_clean_email IS NULL OR v_clean_email = '' OR v_clean_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
        RAISE EXCEPTION 'Valid email address is required.';
    END IF;

    -- Concurrency-Safe Idempotency Check
    v_payload := jsonb_build_object(
        'p_workspace_id', p_workspace_id,
        'p_email', p_email,
        'p_role', p_role,
        'p_roster_person_id', p_roster_person_id
    );
    v_hash := pg_catalog.encode(extensions.digest(v_payload::TEXT, 'sha256'), 'hex');
    v_cached := private.fn_acquire_idempotency_lock(
        p_workspace_id,
        v_caller.roster_person_id,
        'create_workspace_invitation',
        p_idempotency_key,
        v_hash
    );
    IF v_cached IS NOT NULL THEN
        RETURN v_cached;
    END IF;

    -- 4. Roster Person Validation (Must exist, active, unlinked to active membership)
    IF p_roster_person_id IS NULL THEN
        RAISE EXCEPTION 'Roster person ID is required to bind the invitation.';
    END IF;

    SELECT * INTO v_target_roster
    FROM public.roster_people
    WHERE workspace_id = p_workspace_id AND id = p_roster_person_id;

    IF NOT FOUND OR v_target_roster.is_active = FALSE THEN
        RAISE EXCEPTION 'Target roster person not found or inactive in workspace.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.workspace_memberships
        WHERE workspace_id = p_workspace_id
          AND roster_person_id = p_roster_person_id
          AND is_active = TRUE
    ) THEN
        RAISE EXCEPTION 'Target roster person is already linked to an active workspace membership.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.workspace_invitations
        WHERE workspace_id = p_workspace_id
          AND roster_person_id = p_roster_person_id
          AND status = 'pending'
    ) THEN
        RAISE EXCEPTION 'There is already a pending invitation for this roster person.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.workspace_memberships wm
        JOIN auth.users u ON wm.user_id = u.id
        WHERE wm.workspace_id = p_workspace_id
          AND pg_catalog.lower(btrim(u.email)) = v_clean_email
          AND wm.is_active = TRUE
    ) THEN
        RAISE EXCEPTION 'User with email % is already an active member of this workspace.', v_clean_email;
    END IF;

    -- 5. Generate 32-byte cryptographically secure raw token and SHA-256 hash
    v_raw_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
    v_token_hash := pg_catalog.encode(extensions.digest(v_raw_token, 'sha256'), 'hex');

    -- 6. Store ONLY the hash in database
    INSERT INTO public.workspace_invitations (
        workspace_id,
        invited_email,
        role,
        roster_person_id,
        token_hash,
        status,
        invited_by_roster_id,
        expires_at
    ) VALUES (
        p_workspace_id,
        v_clean_email,
        p_role,
        p_roster_person_id,
        v_token_hash,
        'pending',
        v_caller.roster_person_id,
        v_expires_at
    ) RETURNING id INTO v_invitation_id;

    -- Audit event (NEVER contains raw token)
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
        'create_invitation',
        'workspace_invitations',
        v_invitation_id,
        jsonb_build_object(
            'invited_email', v_clean_email,
            'role', p_role,
            'roster_person_id', p_roster_person_id
        )
    );

    v_safe_cached_result := jsonb_build_object(
        'success', TRUE,
        'invitation_id', v_invitation_id,
        'message', 'Invitation created successfully (cached idempotency response).'
    );
    PERFORM private.fn_record_idempotency(
        p_workspace_id,
        v_caller.roster_person_id,
        'create_workspace_invitation',
        p_idempotency_key,
        v_hash,
        v_safe_cached_result
    );

    v_result := jsonb_build_object(
        'success', TRUE,
        'invitation_id', v_invitation_id,
        'raw_token', v_raw_token,
        'expires_at', v_expires_at
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Update accept_workspace_invitation to enforce invitations_paused
CREATE OR REPLACE FUNCTION public.accept_workspace_invitation(
    p_raw_token TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_user_email TEXT;
    v_token_hash TEXT;
    v_inv RECORD;
    v_roster RECORD;
    v_existing_membership RECORD;
    v_membership_id UUID;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required to accept an invitation.';
    END IF;

    SELECT pg_catalog.lower(btrim(email)) INTO v_user_email
    FROM auth.users
    WHERE id = v_uid;

    IF v_user_email IS NULL OR v_user_email = '' THEN
        RAISE EXCEPTION 'Authenticated user must have a valid registered email to accept invitations.';
    END IF;

    -- Compute SHA-256 hash server-side
    v_token_hash := pg_catalog.encode(extensions.digest(p_raw_token, 'sha256'), 'hex');

    PERFORM 1 FROM public.workspaces WHERE id = (SELECT workspace_id FROM public.workspace_invitations WHERE token_hash = v_token_hash) FOR UPDATE;

    -- 1. Row-lock invitation
    SELECT * INTO v_inv
    FROM public.workspace_invitations
    WHERE token_hash = v_token_hash
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid invitation token.';
    END IF;

    -- Phase 0: Check invitations_paused on workspace
    IF EXISTS (
        SELECT 1 FROM public.workspaces
        WHERE id = v_inv.workspace_id AND invitations_paused = TRUE
    ) THEN
        RAISE EXCEPTION 'الدعوات متوقفة مؤقتًا لحين الانتهاء من تحديث مساحة العمل. سيصلك رابط جديد عند إعادة فتح الدعوات.';
    END IF;

    -- Check status
    IF v_inv.status <> 'pending' THEN
        RAISE EXCEPTION 'Invitation is no longer pending (current status: %).', v_inv.status;
    END IF;

    -- Expiration handling
    IF v_inv.expires_at <= pg_catalog.now() THEN
        UPDATE public.workspace_invitations
        SET status = 'expired', updated_at = pg_catalog.now()
        WHERE id = v_inv.id;

        RETURN jsonb_build_object(
            'success', FALSE,
            'status', 'expired',
            'error', 'Invitation has expired.'
        );
    END IF;

    -- 2. Strict Email Match Verification
    IF v_user_email <> v_inv.invited_email THEN
        RAISE EXCEPTION 'Email mismatch: Authenticated user email does not match invitation recipient email.';
    END IF;

    -- 3. Row-lock target roster person
    SELECT * INTO v_roster
    FROM public.roster_people
    WHERE id = v_inv.roster_person_id
    FOR UPDATE;

    IF NOT FOUND OR v_roster.is_active = FALSE THEN
        RAISE EXCEPTION 'Bound roster person is not found or inactive.';
    END IF;

    -- 4. Check if target roster person is already bound to another ACTIVE user
    IF EXISTS (
        SELECT 1 FROM public.workspace_memberships
        WHERE workspace_id = v_inv.workspace_id
          AND roster_person_id = v_inv.roster_person_id
          AND user_id <> v_uid
          AND is_active = TRUE
    ) THEN
        RAISE EXCEPTION 'Target roster person is already actively bound to another user.';
    END IF;

    -- 5. Safe upsert: Re-activate inactive membership or create new
    SELECT * INTO v_existing_membership
    FROM public.workspace_memberships
    WHERE workspace_id = v_inv.workspace_id
      AND user_id = v_uid
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_membership.is_active = TRUE THEN
            RAISE EXCEPTION 'User is already an active member of this workspace.';
        END IF;

        UPDATE public.workspace_memberships
        SET roster_person_id = v_inv.roster_person_id,
            role = v_inv.role,
            is_active = TRUE,
            updated_at = pg_catalog.now()
        WHERE id = v_existing_membership.id
        RETURNING id INTO v_membership_id;
    ELSE
        INSERT INTO public.workspace_memberships (
            workspace_id,
            user_id,
            roster_person_id,
            role,
            is_active
        ) VALUES (
            v_inv.workspace_id,
            v_uid,
            v_inv.roster_person_id,
            v_inv.role,
            TRUE
        ) RETURNING id INTO v_membership_id;
    END IF;

    -- 6. Mark invitation accepted
    UPDATE public.workspace_invitations
    SET status = 'accepted',
        accepted_at = pg_catalog.now(),
        accepted_by_id = v_uid,
        updated_at = pg_catalog.now()
    WHERE id = v_inv.id;

    -- 7. Audit Event
    INSERT INTO public.audit_events (
        workspace_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        v_inv.workspace_id,
        v_inv.roster_person_id,
        'accept_invitation',
        'workspace_invitations',
        v_inv.id,
        jsonb_build_object(
            'accepted_by_uid', v_uid,
            'membership_id', v_membership_id,
            'roster_person_id', v_inv.roster_person_id,
            'role', v_inv.role
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'membership_id', v_membership_id,
        'workspace_id', v_inv.workspace_id,
        'role', v_inv.role
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Owner-only function to set invitations_paused
CREATE OR REPLACE FUNCTION public.set_workspace_invitations_paused(
    p_workspace_id UUID,
    p_paused BOOLEAN
)
RETURNS JSONB AS $$
DECLARE
    v_caller RECORD;
BEGIN
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    IF v_caller.role <> 'owner' THEN
        RAISE EXCEPTION 'Permission denied: Only workspace owner can change invitation pause settings.';
    END IF;

    UPDATE public.workspaces
    SET invitations_paused = p_paused,
        updated_at = pg_catalog.now()
    WHERE id = p_workspace_id;

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
        'toggle_invitations_paused',
        'workspaces',
        p_workspace_id,
        jsonb_build_object('invitations_paused', p_paused)
    );

    RETURN jsonb_build_object('success', TRUE, 'invitations_paused', p_paused);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.set_workspace_invitations_paused(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_workspace_invitations_paused(UUID, BOOLEAN) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. SUPABASE STORAGE BUCKET & POLICIES (Private content-calendars)
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'content-calendars',
    'content-calendars',
    FALSE,
    15728640, -- 15MB
    ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
    public = FALSE,
    file_size_limit = 15728640,
    allowed_mime_types = ARRAY['application/pdf'];

-- Helper to parse standard path: workspace_id/client_id/YYYY-MM/calendar_id/original_file_name.pdf
CREATE OR REPLACE FUNCTION private.parse_content_calendar_path(p_name TEXT)
RETURNS TABLE (
    is_valid BOOLEAN,
    workspace_id UUID,
    client_id UUID,
    month_key TEXT,
    calendar_id UUID,
    file_name TEXT
) AS $$
DECLARE
    parts TEXT[];
    w_id UUID;
    c_id UUID;
    cal_id UUID;
BEGIN
    parts := string_to_array(p_name, '/');
    IF array_length(parts, 1) <> 5 THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;

    w_id := public.safe_cast_uuid(parts[1]);
    c_id := public.safe_cast_uuid(parts[2]);
    cal_id := public.safe_cast_uuid(parts[4]);

    IF w_id IS NULL OR c_id IS NULL OR cal_id IS NULL OR parts[3] !~ '^\d{4}-\d{2}$' OR parts[5] = '' THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;

    RETURN QUERY SELECT TRUE, w_id, c_id, parts[3], cal_id, parts[5];
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = '';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'content_calendars_select'
    ) THEN
        CREATE POLICY content_calendars_select ON storage.objects
        FOR SELECT TO authenticated
        USING (
            bucket_id = 'content-calendars' AND
            EXISTS (
                SELECT 1 FROM private.parse_content_calendar_path(name) p
                WHERE p.is_valid AND (
                    private.is_workspace_owner(p.workspace_id) OR
                    EXISTS (
                        SELECT 1 FROM public.clients c
                        WHERE c.id = p.client_id
                          AND c.workspace_id = p.workspace_id
                          AND c.owner_roster_id = private.caller_roster_id(p.workspace_id)
                    )
                )
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'content_calendars_insert'
    ) THEN
        CREATE POLICY content_calendars_insert ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (
            bucket_id = 'content-calendars' AND
            EXISTS (
                SELECT 1 FROM private.parse_content_calendar_path(name) p
                WHERE p.is_valid AND private.is_workspace_owner(p.workspace_id)
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'content_calendars_update'
    ) THEN
        CREATE POLICY content_calendars_update ON storage.objects
        FOR UPDATE TO authenticated
        USING (
            bucket_id = 'content-calendars' AND
            EXISTS (
                SELECT 1 FROM private.parse_content_calendar_path(name) p
                WHERE p.is_valid AND private.is_workspace_owner(p.workspace_id)
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'content_calendars_delete'
    ) THEN
        CREATE POLICY content_calendars_delete ON storage.objects
        FOR DELETE TO authenticated
        USING (
            bucket_id = 'content-calendars' AND
            EXISTS (
                SELECT 1 FROM private.parse_content_calendar_path(name) p
                WHERE p.is_valid AND private.is_workspace_owner(p.workspace_id)
            )
        );
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. CAMPAIGNS TABLE EXTENSIONS
-- -----------------------------------------------------------------------------
ALTER TABLE public.campaigns
    ADD COLUMN IF NOT EXISTS month_key TEXT,
    ADD COLUMN IF NOT EXISTS revision_number INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS calendar_status TEXT NOT NULL DEFAULT 'uploaded'
        CHECK (calendar_status IN ('uploaded', 'processing', 'needs_review', 'ready', 'imported', 'failed', 'archived')),
    ADD COLUMN IF NOT EXISTS original_file_name TEXT,
    ADD COLUMN IF NOT EXISTS storage_path TEXT,
    ADD COLUMN IF NOT EXISTS file_hash TEXT,
    ADD COLUMN IF NOT EXISTS uploaded_by_roster_id UUID,
    ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approved_by_roster_id UUID,
    ADD COLUMN IF NOT EXISTS parser_version TEXT DEFAULT 'v1.0',
    ADD COLUMN IF NOT EXISTS processing_error TEXT,
    ADD COLUMN IF NOT EXISTS is_current_revision BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_campaign_uploaded_by') THEN
        ALTER TABLE public.campaigns
            ADD CONSTRAINT fk_campaign_uploaded_by
            FOREIGN KEY (workspace_id, uploaded_by_roster_id)
            REFERENCES public.roster_people(workspace_id, id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_campaign_approved_by') THEN
        ALTER TABLE public.campaigns
            ADD CONSTRAINT fk_campaign_approved_by
            FOREIGN KEY (workspace_id, approved_by_roster_id)
            REFERENCES public.roster_people(workspace_id, id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_campaigns_month ON public.campaigns (workspace_id, client_id, month_key);

-- -----------------------------------------------------------------------------
-- 4. CONTENT CALENDAR ITEMS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.content_calendar_items (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL,
    client_id UUID NOT NULL,
    post_order INT NOT NULL DEFAULT 1,
    post_number TEXT NOT NULL,
    title TEXT NOT NULL,
    caption TEXT,
    brief TEXT,
    platform TEXT DEFAULT 'Instagram',
    content_format TEXT DEFAULT 'Static',
    publish_date DATE,
    design_due_date DATE,
    notes TEXT,
    reference_urls TEXT[] DEFAULT '{}',
    raw_text TEXT,
    source_page INT,
    confidence NUMERIC(4,2) DEFAULT 1.0,
    needs_manual_review BOOLEAN NOT NULL DEFAULT FALSE,
    suggested_assignee_id UUID,
    approved_assignee_id UUID,
    task_id UUID,
    is_included BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_cci_composite UNIQUE (workspace_id, id),
    CONSTRAINT fk_cci_campaign FOREIGN KEY (workspace_id, client_id, campaign_id)
        REFERENCES public.campaigns(workspace_id, client_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_cci_suggested_assignee FOREIGN KEY (workspace_id, suggested_assignee_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE SET NULL,
    CONSTRAINT fk_cci_approved_assignee FOREIGN KEY (workspace_id, approved_assignee_id)
        REFERENCES public.roster_people(workspace_id, id) ON DELETE SET NULL,
    CONSTRAINT fk_cci_task FOREIGN KEY (workspace_id, task_id)
        REFERENCES public.tasks(workspace_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cci_campaign ON public.content_calendar_items (workspace_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_cci_client ON public.content_calendar_items (workspace_id, client_id);
CREATE INDEX IF NOT EXISTS idx_cci_task ON public.content_calendar_items (workspace_id, task_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_content_calendar_items_updated_at') THEN
        CREATE TRIGGER trg_content_calendar_items_updated_at
        BEFORE UPDATE ON public.content_calendar_items
        FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
    END IF;
END $$;

ALTER TABLE public.content_calendar_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'content_calendar_items' AND policyname = 'p_select_content_calendar_items') THEN
        CREATE POLICY p_select_content_calendar_items ON public.content_calendar_items
        FOR SELECT TO authenticated
        USING (
            private.is_workspace_owner(workspace_id)
            OR EXISTS (
                SELECT 1 FROM public.clients c
                WHERE c.id = content_calendar_items.client_id
                  AND c.workspace_id = content_calendar_items.workspace_id
                  AND c.owner_roster_id = private.caller_roster_id(content_calendar_items.workspace_id)
            )
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'content_calendar_items' AND policyname = 'p_insert_content_calendar_items') THEN
        CREATE POLICY p_insert_content_calendar_items ON public.content_calendar_items
        FOR INSERT TO authenticated
        WITH CHECK (
            private.is_workspace_owner(workspace_id)
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'content_calendar_items' AND policyname = 'p_update_content_calendar_items') THEN
        CREATE POLICY p_update_content_calendar_items ON public.content_calendar_items
        FOR UPDATE TO authenticated
        USING (
            private.is_workspace_owner(workspace_id)
        )
        WITH CHECK (
            private.is_workspace_owner(workspace_id)
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'content_calendar_items' AND policyname = 'p_delete_content_calendar_items') THEN
        CREATE POLICY p_delete_content_calendar_items ON public.content_calendar_items
        FOR DELETE TO authenticated
        USING (
            private.is_workspace_owner(workspace_id)
        );
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. IN-APP NOTIFICATIONS EXTENSIONS & PROTECTION
-- -----------------------------------------------------------------------------
ALTER TABLE public.in_app_notifications
    ADD COLUMN IF NOT EXISTS action_url TEXT,
    ADD COLUMN IF NOT EXISTS notification_type TEXT NOT NULL DEFAULT 'task_assigned',
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.fn_protect_in_app_notification_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.id <> OLD.id
       OR NEW.workspace_id <> OLD.workspace_id
       OR NEW.recipient_roster_id <> OLD.recipient_roster_id
       OR NEW.actor_roster_id IS DISTINCT FROM OLD.actor_roster_id
       OR NEW.title <> OLD.title
       OR NEW.message <> OLD.message
       OR NEW.task_id IS DISTINCT FROM OLD.task_id
       OR NEW.action_url IS DISTINCT FROM OLD.action_url
       OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Only is_read status can be modified on notifications.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_notif_update ON public.in_app_notifications;
CREATE TRIGGER trg_protect_notif_update
BEFORE UPDATE ON public.in_app_notifications
FOR EACH ROW EXECUTE FUNCTION public.fn_protect_in_app_notification_update();

-- -----------------------------------------------------------------------------
-- 6. ATOMIC IDEMPOTENT TASK GENERATION RPC (import_content_calendar_tasks)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_content_calendar_tasks(
    p_workspace_id UUID,
    p_campaign_id UUID,
    p_idempotency_key TEXT,
    p_items JSONB
)
RETURNS JSONB AS $$
DECLARE
    v_caller RECORD;
    v_campaign RECORD;
    v_client RECORD;
    v_payload JSONB;
    v_hash TEXT;
    v_cached JSONB;
    v_item JSONB;
    v_item_id UUID;
    v_target_assignee_id UUID;
    v_reviewer_id UUID;
    v_new_task_id UUID;
    v_owner_roster_id UUID;
    v_post_number TEXT;
    v_title TEXT;
    v_brief TEXT;
    v_caption TEXT;
    v_platform TEXT;
    v_format TEXT;
    v_due_date TIMESTAMPTZ;
    v_tasks_created INT := 0;
    v_notifications_created INT := 0;
    v_assignee_map JSONB := '{}'::JSONB;
    v_result JSONB;
    v_existing_task_id UUID;
BEGIN
    IF p_workspace_id IS NULL OR p_campaign_id IS NULL THEN
        RAISE EXCEPTION 'workspace_id and campaign_id are required.';
    END IF;

    -- 1. Caller identity and Owner authorization
    SELECT * INTO v_caller FROM private.get_caller_context(p_workspace_id);
    IF v_caller.role <> 'owner' THEN
        RAISE EXCEPTION 'Permission denied: Only workspace owner can import content calendar tasks.';
    END IF;

    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;

    -- Resolve Owner roster ID
    SELECT wm.roster_person_id INTO v_owner_roster_id
    FROM public.workspace_memberships wm
    WHERE wm.workspace_id = p_workspace_id AND wm.role = 'owner' AND wm.is_active = TRUE
    LIMIT 1;

    -- 2. Verify campaign and lock
    SELECT * INTO v_campaign
    FROM public.campaigns
    WHERE workspace_id = p_workspace_id AND id = p_campaign_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Campaign not found in workspace.';
    END IF;

    -- 3. Verify client
    SELECT * INTO v_client
    FROM public.clients
    WHERE workspace_id = p_workspace_id AND id = v_campaign.client_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Client not found in workspace.';
    END IF;

    -- 4. Concurrency-Safe Idempotency Check
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

    -- 5. Process Items
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'No items provided for import.';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        -- Check if included
        IF (v_item->>'is_included')::BOOLEAN IS FALSE THEN
            CONTINUE;
        END IF;

        v_item_id := public.safe_cast_uuid(v_item->>'id');
        v_post_number := btrim(COALESCE(v_item->>'post_number', ''));
        v_title := btrim(COALESCE(v_item->>'title', ''));
        v_brief := NULLIF(btrim(COALESCE(v_item->>'brief', '')), '');
        v_caption := NULLIF(btrim(COALESCE(v_item->>'caption', '')), '');
        v_platform := COALESCE(NULLIF(btrim(v_item->>'platform'), ''), 'Instagram');
        v_format := COALESCE(NULLIF(btrim(v_item->>'content_format'), ''), 'Static');

        IF v_item->>'design_due_date' IS NOT NULL AND btrim(v_item->>'design_due_date') <> '' THEN
            BEGIN
                v_due_date := (v_item->>'design_due_date')::TIMESTAMPTZ;
            EXCEPTION WHEN OTHERS THEN
                v_due_date := NULL;
            END;
        ELSE
            v_due_date := NULL;
        END IF;

        -- Check if item already has a task (idempotency per item)
        IF v_item_id IS NOT NULL THEN
            SELECT task_id INTO v_existing_task_id
            FROM public.content_calendar_items
            WHERE workspace_id = p_workspace_id AND id = v_item_id;

            IF v_existing_task_id IS NOT NULL THEN
                CONTINUE;
            END IF;
        END IF;

        -- Determine Assignee: approved_assignee_id -> suggested_assignee_id -> client.owner_roster_id
        v_target_assignee_id := public.safe_cast_uuid(v_item->>'approved_assignee_id');
        IF v_target_assignee_id IS NULL THEN
            v_target_assignee_id := public.safe_cast_uuid(v_item->>'suggested_assignee_id');
        END IF;
        IF v_target_assignee_id IS NULL THEN
            v_target_assignee_id := v_client.owner_roster_id;
        END IF;

        IF v_target_assignee_id IS NULL THEN
            RAISE EXCEPTION 'Cannot import post %: Client has no assigned designer and no assignee was selected.', v_post_number;
        END IF;

        -- Ensure assignee exists and is active in workspace
        IF NOT EXISTS (
            SELECT 1 FROM public.roster_people
            WHERE workspace_id = p_workspace_id AND id = v_target_assignee_id AND is_active = TRUE
        ) THEN
            RAISE EXCEPTION 'Target assignee (%) not found or inactive in workspace.', v_target_assignee_id;
        END IF;

        -- Determine Reviewer
        -- Review Bypass: Emad (Owner) tasks have NO reviewer
        IF v_target_assignee_id = v_owner_roster_id THEN
            v_reviewer_id := NULL;
        ELSE
            -- Check routing rules: Specific designer & client difficulty
            SELECT reviewer_roster_id INTO v_reviewer_id
            FROM public.review_routing_rules
            WHERE workspace_id = p_workspace_id
              AND designer_roster_id = v_target_assignee_id
              AND client_difficulty = v_client.difficulty
            ORDER BY priority DESC
            LIMIT 1;

            IF v_reviewer_id IS NULL THEN
                SELECT reviewer_roster_id INTO v_reviewer_id
                FROM public.review_routing_rules
                WHERE workspace_id = p_workspace_id
                  AND designer_roster_id = v_target_assignee_id
                  AND client_difficulty IS NULL
                ORDER BY priority DESC
                LIMIT 1;
            END IF;

            IF v_reviewer_id IS NULL THEN
                SELECT reviewer_roster_id INTO v_reviewer_id
                FROM public.review_routing_rules
                WHERE workspace_id = p_workspace_id
                  AND is_workspace_default = TRUE
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

        -- Construct task title
        IF v_title = '' THEN
            v_title := COALESCE(v_post_number, 'Post');
        ELSEIF v_post_number <> '' AND v_title !~ ('^' || v_post_number) THEN
            v_title := v_post_number || ' - ' || v_title;
        END IF;

        -- Create Task with initial status 'backlog' (displayed as «انتظار»)
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
            primary_assignee_id,
            reviewer_id,
            due_date,
            created_by_id
        ) VALUES (
            p_workspace_id,
            v_campaign.client_id,
            p_campaign_id,
            v_title,
            v_brief,
            v_caption,
            v_format,
            v_post_number,
            'Normal',
            'backlog',
            v_target_assignee_id,
            v_reviewer_id,
            v_due_date,
            v_caller.roster_person_id
        ) RETURNING id INTO v_new_task_id;

        v_tasks_created := v_tasks_created + 1;

        -- Update or insert content_calendar_items
        IF v_item_id IS NOT NULL THEN
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
        ELSE
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
                task_id,
                is_included
            ) VALUES (
                p_workspace_id,
                p_campaign_id,
                v_campaign.client_id,
                v_tasks_created,
                v_post_number,
                v_title,
                v_brief,
                v_caption,
                v_platform,
                v_format,
                v_due_date::DATE,
                v_target_assignee_id,
                v_target_assignee_id,
                v_new_task_id,
                TRUE
            );
        END IF;

        -- Ledger: Status event
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

        -- Ledger: Assignment event
        INSERT INTO public.task_assignment_events (
            workspace_id,
            task_id,
            from_assignee_id,
            to_assignee_id,
            actor_id
        ) VALUES (
            p_workspace_id,
            v_new_task_id,
            NULL,
            v_target_assignee_id,
            v_caller.roster_person_id
        );

        -- In-App Notification (notify assignee unless owner is creating task for himself)
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
                is_read
            ) VALUES (
                p_workspace_id,
                v_target_assignee_id,
                v_caller.roster_person_id,
                v_new_task_id,
                'تمت إضافة تاسك جديدة لك',
                'تمت إضافة تاسك جديدة لك: ' || COALESCE(v_post_number, 'Post') || ' — ' || v_client.name,
                '/tasks?taskId=' || v_new_task_id::TEXT,
                'task_assigned',
                FALSE
            );
            v_notifications_created := v_notifications_created + 1;
        END IF;

        -- Tally assignees
        v_assignee_map := jsonb_set(
            v_assignee_map,
            ARRAY[v_target_assignee_id::TEXT],
            to_jsonb(COALESCE((v_assignee_map->>v_target_assignee_id::TEXT)::INT, 0) + 1)
        );
    END LOOP;

    -- Update campaign status
    UPDATE public.campaigns
    SET status = 'Active',
        calendar_status = 'imported',
        approved_at = pg_catalog.now(),
        approved_by_roster_id = v_caller.roster_person_id,
        updated_at = pg_catalog.now()
    WHERE id = p_campaign_id AND workspace_id = p_workspace_id;

    -- Audit Event
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
        'assignees', v_assignee_map
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.import_content_calendar_tasks(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_content_calendar_tasks(UUID, UUID, TEXT, JSONB) TO authenticated;

COMMIT;
