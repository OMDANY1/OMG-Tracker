-- Migration 10: Grant permissions on content_calendar_items to authenticated and service_role
BEGIN;
GRANT ALL ON TABLE public.content_calendar_items TO authenticated, service_role;
COMMIT;
