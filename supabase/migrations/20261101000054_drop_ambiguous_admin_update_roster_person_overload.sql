-- Migration 54: Drop ambiguous 7-argument overload of public.admin_update_roster_person
-- Ensures unambiguous PostgREST RPC resolution for both 7-arg and 8-arg callers.

BEGIN;

DROP FUNCTION IF EXISTS public.admin_update_roster_person(
  UUID,
  UUID,
  TEXT,
  TEXT[],
  public.roster_role,
  TEXT,
  JSONB
);

NOTIFY pgrst, 'reload schema';

COMMIT;
