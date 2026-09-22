-- Migration 31: Grant permissions on agency expansion tables to authenticated and service_role
BEGIN;

GRANT ALL ON TABLE public.client_team_assignments TO authenticated, service_role;
GRANT ALL ON TABLE public.client_briefs TO authenticated, service_role;
GRANT ALL ON TABLE public.task_deliverables TO authenticated, service_role;

COMMIT;
