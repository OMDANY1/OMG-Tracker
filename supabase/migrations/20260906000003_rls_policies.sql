-- OMG Creative Workspace: Row Level Security & Storage Policies (V3.5-R1 repaired baseline)
-- Migration: 20260906000003_rls_policies.sql
-- Strictly Transactional: Everything wrapped in BEGIN; ... COMMIT;

BEGIN;
-- Required private buckets. Public downloads must never bypass object RLS.
INSERT INTO storage.buckets(id,name,public,file_size_limit)
VALUES ('deliverables','deliverables',false,104857600),
       ('workspace-assets','workspace-assets',false,104857600)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 1. ENABLE RLS ON ALL PUBLIC TABLES
-- -----------------------------------------------------------------------------
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_routing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_capacities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_assignment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_due_date_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_report_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rpc_idempotency_records ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2. WORKSPACE MEMBERSHIPS & WORKSPACES
-- (Recursion-free: utilizes private.is_workspace_member helper)
-- -----------------------------------------------------------------------------

CREATE POLICY p_select_workspaces ON public.workspaces
FOR SELECT TO authenticated
USING (
    private.is_workspace_member(id)
);

CREATE POLICY p_select_workspace_memberships ON public.workspace_memberships
FOR SELECT TO authenticated
USING (
    private.is_workspace_member(workspace_id)
);

CREATE POLICY p_select_roster_people ON public.roster_people
FOR SELECT TO authenticated
USING (
    private.is_workspace_member(workspace_id)
);

CREATE POLICY p_select_workspace_invitations ON public.workspace_invitations
FOR SELECT TO authenticated
USING (
    private.is_workspace_manager(workspace_id)
);

-- -----------------------------------------------------------------------------
-- 3. ROUTING RULES, CAPACITIES, CLIENTS & CAMPAIGNS
-- -----------------------------------------------------------------------------

CREATE POLICY p_select_review_routing_rules ON public.review_routing_rules
FOR SELECT TO authenticated
USING (
    private.is_workspace_member(workspace_id)
);

CREATE POLICY p_select_member_capacities ON public.member_capacities
FOR SELECT TO authenticated
USING (
    private.is_workspace_member(workspace_id)
);

CREATE POLICY p_select_leave_days ON public.leave_days
FOR SELECT TO authenticated
USING (
    private.is_workspace_member(workspace_id)
);

CREATE POLICY p_select_clients ON public.clients
FOR SELECT TO authenticated
USING (
    private.is_workspace_member(workspace_id)
);

CREATE POLICY p_select_campaigns ON public.campaigns
FOR SELECT TO authenticated
USING (
    private.is_workspace_member(workspace_id)
);

-- -----------------------------------------------------------------------------
-- 4. TASKS & TASK ATTRIBUTES (Management sees all, Designers see assigned/involved)
-- -----------------------------------------------------------------------------

CREATE POLICY p_select_tasks ON public.tasks
FOR SELECT TO authenticated
USING (
    private.can_access_task(id)
);

CREATE POLICY p_select_task_collaborators ON public.task_collaborators
FOR SELECT TO authenticated
USING (
    private.can_access_task(task_id)
);

CREATE POLICY p_select_task_checklist_items ON public.task_checklist_items
FOR SELECT TO authenticated
USING (
    private.can_access_task(task_id)
);

-- -----------------------------------------------------------------------------
-- 5. REVIEW ROUNDS & COMMENTS
-- -----------------------------------------------------------------------------

CREATE POLICY p_select_review_rounds ON public.review_rounds
FOR SELECT TO authenticated
USING (
    private.can_access_task(task_id)
);

CREATE POLICY p_select_comments ON public.comments
FOR SELECT TO authenticated
USING (
    private.can_access_task(task_id)
);

CREATE POLICY p_insert_comments ON public.comments
FOR INSERT TO authenticated
WITH CHECK (
    author_roster_id = private.caller_roster_id(workspace_id) AND
    private.can_work_on_task(task_id)
);

CREATE POLICY p_update_comments ON public.comments
FOR UPDATE TO authenticated
USING (
    author_roster_id = private.caller_roster_id(workspace_id)
)
WITH CHECK (
    author_roster_id = private.caller_roster_id(workspace_id)
);

CREATE POLICY p_delete_comments ON public.comments
FOR DELETE TO authenticated
USING (
    author_roster_id = private.caller_roster_id(workspace_id) OR
    private.is_workspace_manager(workspace_id)
);

-- -----------------------------------------------------------------------------
-- 6. ATTACHMENTS (Composite Task Deliverable Key, Canonical uploader_roster_id)
-- -----------------------------------------------------------------------------

CREATE POLICY p_select_attachments ON public.attachments
FOR SELECT TO authenticated
USING (
    private.can_access_task(task_id)
);

CREATE POLICY p_insert_attachments ON public.attachments
FOR INSERT TO authenticated
WITH CHECK (
    uploader_roster_id = private.caller_roster_id(workspace_id) AND
    private.can_work_on_task(task_id)
);

CREATE POLICY p_delete_attachments ON public.attachments
FOR DELETE TO authenticated
USING (
    (uploader_roster_id = private.caller_roster_id(workspace_id) AND private.can_work_on_task(task_id)) OR
    private.is_workspace_manager(workspace_id)
);

-- -----------------------------------------------------------------------------
-- 7. NOTIFICATIONS (Recipient Visibility, Column-Level UPDATE on is_read)
-- -----------------------------------------------------------------------------

CREATE POLICY p_select_notifications ON public.in_app_notifications
FOR SELECT TO authenticated
USING (
    recipient_roster_id = private.caller_roster_id(workspace_id)
);

CREATE POLICY p_update_notifications ON public.in_app_notifications
FOR UPDATE TO authenticated
USING (
    recipient_roster_id = private.caller_roster_id(workspace_id)
)
WITH CHECK (
    recipient_roster_id = private.caller_roster_id(workspace_id)
);

-- -----------------------------------------------------------------------------
-- 8. TASK EVENT LEDGERS (Read allowed for involved members & management)
-- -----------------------------------------------------------------------------

CREATE POLICY p_select_task_status_events ON public.task_status_events
FOR SELECT TO authenticated
USING (
    private.can_access_task(task_id)
);

CREATE POLICY p_select_task_assignment_events ON public.task_assignment_events
FOR SELECT TO authenticated
USING (
    private.can_access_task(task_id)
);

CREATE POLICY p_select_task_due_date_events ON public.task_due_date_events
FOR SELECT TO authenticated
USING (
    private.can_access_task(task_id)
);

-- -----------------------------------------------------------------------------
-- 9. TIME ENTRIES & CORRECTION REQUESTS (Designers read own; Manager reads all)
-- -----------------------------------------------------------------------------

CREATE POLICY p_select_time_entries ON public.time_entries
FOR SELECT TO authenticated
USING (
    roster_person_id = private.caller_roster_id(workspace_id) OR
    private.is_workspace_manager(workspace_id)
);

CREATE POLICY p_select_time_change_requests ON public.time_change_requests
FOR SELECT TO authenticated
USING (
    requested_by_id = private.caller_roster_id(workspace_id) OR
    private.is_workspace_manager(workspace_id)
);

-- -----------------------------------------------------------------------------
-- 10. MANAGEMENT REPORTS & AUDIT LOGS
-- -----------------------------------------------------------------------------

CREATE POLICY p_select_monthly_report_snapshots ON public.monthly_report_snapshots
FOR SELECT TO authenticated
USING (
    private.is_workspace_manager(workspace_id)
);

CREATE POLICY p_select_audit_events ON public.audit_events
FOR SELECT TO authenticated
USING (
    private.is_workspace_manager(workspace_id)
);

CREATE POLICY p_select_rpc_idempotency_records ON public.rpc_idempotency_records
FOR SELECT TO authenticated
USING (
    actor_id = private.caller_roster_id(workspace_id)
);

-- -----------------------------------------------------------------------------
-- 11. STORAGE POLICIES (Strict Path Pair Validation & Safe UUID Casts)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.parse_deliverable_storage_path(p_name TEXT)
RETURNS TABLE (workspace_id UUID, task_id UUID, is_valid BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_parts TEXT[];
    v_ws UUID;
    v_task UUID;
BEGIN
    v_parts := pg_catalog.string_to_array(p_name, '/');
    IF array_length(v_parts, 1) IS DISTINCT FROM 3 OR btrim(COALESCE(v_parts[3],'')) = '' THEN
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, FALSE;
        RETURN;
    END IF;

    v_ws := public.safe_cast_uuid(v_parts[1]);
    v_task := public.safe_cast_uuid(v_parts[2]);

    IF v_ws IS NULL OR v_task IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, FALSE;
        RETURN;
    END IF;

    RETURN QUERY SELECT v_ws, v_task, TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION private.parse_workspace_asset_path(p_name TEXT)
RETURNS TABLE (workspace_id UUID, is_valid BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_parts TEXT[];
    v_ws UUID;
BEGIN
    v_parts := pg_catalog.string_to_array(p_name, '/');
    IF array_length(v_parts, 1) IS DISTINCT FROM 2 OR btrim(COALESCE(v_parts[2],'')) = '' THEN
        RETURN QUERY SELECT NULL::UUID, FALSE;
        RETURN;
    END IF;

    v_ws := public.safe_cast_uuid(v_parts[1]);
    IF v_ws IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, FALSE;
        RETURN;
    END IF;

    RETURN QUERY SELECT v_ws, TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.parse_deliverable_storage_path(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.parse_workspace_asset_path(TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.parse_deliverable_storage_path(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION private.parse_workspace_asset_path(TEXT) TO authenticated;

-- Storage RLS applies if storage.objects table exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'storage' AND table_name = 'objects'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'storage' AND c.relname = 'objects' AND c.relrowsecurity = true
        ) THEN
            ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
        END IF;

        DROP POLICY IF EXISTS p_storage_deliverables_select ON storage.objects;
        DROP POLICY IF EXISTS p_storage_deliverables_insert ON storage.objects;
        DROP POLICY IF EXISTS p_storage_deliverables_delete ON storage.objects;
        DROP POLICY IF EXISTS p_storage_assets_select ON storage.objects;
        DROP POLICY IF EXISTS p_storage_assets_insert ON storage.objects;
        DROP POLICY IF EXISTS p_storage_assets_delete ON storage.objects;

        -- Deliverables Bucket Policies: enforces path workspace equals task's actual workspace_id
        CREATE POLICY p_storage_deliverables_select ON storage.objects
        FOR SELECT TO authenticated
        USING (
            bucket_id = 'deliverables' AND
            EXISTS (
                SELECT 1 FROM private.parse_deliverable_storage_path(name) p
                JOIN public.tasks t ON t.id = p.task_id AND t.workspace_id = p.workspace_id
                WHERE p.is_valid AND private.can_access_task(p.task_id)
            )
        );

        CREATE POLICY p_storage_deliverables_insert ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (
            bucket_id = 'deliverables' AND
            EXISTS (
                SELECT 1 FROM private.parse_deliverable_storage_path(name) p
                JOIN public.tasks t ON t.id = p.task_id AND t.workspace_id = p.workspace_id
                WHERE p.is_valid AND private.can_work_on_task(p.task_id)
            )
        );

        CREATE POLICY p_storage_deliverables_delete ON storage.objects
        FOR DELETE TO authenticated
        USING (
            bucket_id = 'deliverables' AND
            EXISTS (
                SELECT 1 FROM private.parse_deliverable_storage_path(name) p
                JOIN public.tasks t ON t.id = p.task_id AND t.workspace_id = p.workspace_id
                WHERE p.is_valid AND (
                    private.is_workspace_manager(p.workspace_id) OR (
                        private.can_access_task(p.task_id) AND
                        EXISTS (
                            SELECT 1 FROM public.attachments a
                            WHERE a.workspace_id = p.workspace_id
                              AND a.task_id = p.task_id
                              AND a.storage_path = name
                              AND a.uploader_roster_id = private.caller_roster_id(p.workspace_id)
                        )
                    )
                )
            )
        );

        -- Workspace Assets Bucket Policies (Path: workspace_id/file_name)
        CREATE POLICY p_storage_assets_select ON storage.objects
        FOR SELECT TO authenticated
        USING (
            bucket_id = 'workspace-assets' AND
            EXISTS (
                SELECT 1 FROM private.parse_workspace_asset_path(name) p
                WHERE p.is_valid AND private.is_workspace_member(p.workspace_id)
            )
        );

        CREATE POLICY p_storage_assets_insert ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (
            bucket_id = 'workspace-assets' AND
            EXISTS (
                SELECT 1 FROM private.parse_workspace_asset_path(name) p
                WHERE p.is_valid AND private.is_workspace_manager(p.workspace_id)
            )
        );

        CREATE POLICY p_storage_assets_delete ON storage.objects
        FOR DELETE TO authenticated
        USING (
            bucket_id = 'workspace-assets' AND
            EXISTS (
                SELECT 1 FROM private.parse_workspace_asset_path(name) p
                WHERE p.is_valid AND private.is_workspace_manager(p.workspace_id)
            )
        );
    END IF;
END;
$$;

COMMIT;
