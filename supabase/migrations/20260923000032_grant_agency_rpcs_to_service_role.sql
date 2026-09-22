-- Migration 32: Grant EXECUTE on agency expansion RPC functions to service_role
BEGIN;

GRANT EXECUTE ON FUNCTION public.upsert_client_team_assignment(UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_client_brief(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_task_deliverable(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_task_waiting_state(UUID, BOOLEAN, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_copywriting_and_unlock_downstream(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_review_round(public.review_decision, UUID, UUID, TEXT, UUID, TEXT) TO service_role;

COMMIT;
