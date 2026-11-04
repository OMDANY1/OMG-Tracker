BEGIN;

-- =============================================================================
-- Migration 62: Increase content-calendars storage bucket file_size_limit
-- from 15MB (15728640) to 50MB (52428800, max direct cloud storage object size)
-- while application supports up to 250MB via client-side page extraction.
-- =============================================================================

UPDATE storage.buckets
SET file_size_limit = 52428800,
    updated_at = pg_catalog.now()
WHERE id = 'content-calendars';

COMMIT;
