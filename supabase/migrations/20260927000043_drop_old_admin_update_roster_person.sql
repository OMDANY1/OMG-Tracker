-- ==============================================================================
-- Migration: 20260927000043_drop_old_admin_update_roster_person.sql
-- Description: Drop the obsolete 7-parameter admin_update_roster_person function
-- overload to resolve PostgREST ambiguity with the 8-parameter version.
-- ==============================================================================

DROP FUNCTION IF EXISTS public.admin_update_roster_person(UUID, UUID, TEXT, TEXT[], public.roster_role, TEXT, JSONB);
