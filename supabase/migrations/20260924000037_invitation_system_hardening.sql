-- Migration 37: Invitation System Hardening & Performance Indexes
-- File: supabase/migrations/20260924000037_invitation_system_hardening.sql

-- 1. Index on token_hash for high-speed cryptographic invitation verification
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_token_hash 
ON public.workspace_invitations(token_hash);

-- 2. Composite index on workspace_id, lower(invited_email), and status for duplicate prevention
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_email_status 
ON public.workspace_invitations(workspace_id, lower(invited_email), status);

-- 3. Composite index on workspace_id and expires_at for fast expiration queries
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_expires_at 
ON public.workspace_invitations(workspace_id, expires_at);
