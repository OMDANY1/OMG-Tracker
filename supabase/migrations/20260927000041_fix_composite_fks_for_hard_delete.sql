-- Migration 41: Fix Composite Foreign Keys for Hard Delete
-- Convert composite (workspace_id, roster_person_id) SET NULL foreign keys to single-column roster_people(id)
-- to prevent PostgreSQL from attempting to set NOT NULL workspace_id to NULL upon deletion.

BEGIN;

-- 1. time_entries
ALTER TABLE public.time_entries DROP CONSTRAINT IF EXISTS fk_time_person;
ALTER TABLE public.time_entries ADD CONSTRAINT fk_time_person 
    FOREIGN KEY (roster_person_id) 
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

ALTER TABLE public.time_entries DROP CONSTRAINT IF EXISTS fk_time_created_by;
ALTER TABLE public.time_entries ADD CONSTRAINT fk_time_created_by 
    FOREIGN KEY (created_by_id) 
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

ALTER TABLE public.time_entries DROP CONSTRAINT IF EXISTS fk_time_voided_by;
ALTER TABLE public.time_entries ADD CONSTRAINT fk_time_voided_by 
    FOREIGN KEY (voided_by_id) 
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

-- 2. review_rounds
ALTER TABLE public.review_rounds DROP CONSTRAINT IF EXISTS fk_round_submitter;
ALTER TABLE public.review_rounds ADD CONSTRAINT fk_round_submitter 
    FOREIGN KEY (submitter_id) 
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

ALTER TABLE public.review_rounds DROP CONSTRAINT IF EXISTS fk_round_reviewer;
ALTER TABLE public.review_rounds ADD CONSTRAINT fk_round_reviewer 
    FOREIGN KEY (reviewer_id) 
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

-- 3. comments
ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS fk_comment_author;
ALTER TABLE public.comments ADD CONSTRAINT fk_comment_author 
    FOREIGN KEY (author_roster_id) 
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

-- 4. tasks
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_task_primary_assignee;
ALTER TABLE public.tasks ADD CONSTRAINT fk_task_primary_assignee 
    FOREIGN KEY (primary_assignee_id) 
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_task_reviewer;
ALTER TABLE public.tasks ADD CONSTRAINT fk_task_reviewer 
    FOREIGN KEY (reviewer_id) 
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

-- 5. task event ledgers
ALTER TABLE public.task_status_events DROP CONSTRAINT IF EXISTS fk_tse_actor;
ALTER TABLE public.task_status_events ADD CONSTRAINT fk_tse_actor 
    FOREIGN KEY (actor_id) 
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

ALTER TABLE public.task_assignment_events DROP CONSTRAINT IF EXISTS fk_tae_actor;
ALTER TABLE public.task_assignment_events ADD CONSTRAINT fk_tae_actor 
    FOREIGN KEY (actor_id) 
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

ALTER TABLE public.task_assignment_events DROP CONSTRAINT IF EXISTS fk_tae_prev;
ALTER TABLE public.task_assignment_events ADD CONSTRAINT fk_tae_prev 
    FOREIGN KEY (previous_assignee_id) 
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

ALTER TABLE public.task_assignment_events DROP CONSTRAINT IF EXISTS fk_tae_new;
ALTER TABLE public.task_assignment_events ADD CONSTRAINT fk_tae_new 
    FOREIGN KEY (new_assignee_id) 
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

ALTER TABLE public.task_due_date_events DROP CONSTRAINT IF EXISTS fk_tdde_actor;
ALTER TABLE public.task_due_date_events ADD CONSTRAINT fk_tdde_actor 
    FOREIGN KEY (actor_id) 
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

-- 6. attachments
ALTER TABLE public.attachments DROP CONSTRAINT IF EXISTS fk_attachment_uploader;
ALTER TABLE public.attachments ADD CONSTRAINT fk_attachment_uploader 
    FOREIGN KEY (uploader_roster_id) 
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

-- 7. in_app_notifications
ALTER TABLE public.in_app_notifications DROP CONSTRAINT IF EXISTS fk_notif_actor;
ALTER TABLE public.in_app_notifications ADD CONSTRAINT fk_notif_actor 
    FOREIGN KEY (actor_roster_id) 
    REFERENCES public.roster_people(id) ON DELETE SET NULL;

-- 8. workspace_memberships & invitations
ALTER TABLE public.workspace_memberships DROP CONSTRAINT IF EXISTS fk_membership_roster;
ALTER TABLE public.workspace_memberships ADD CONSTRAINT fk_membership_roster 
    FOREIGN KEY (roster_person_id) 
    REFERENCES public.roster_people(id) ON DELETE CASCADE;

ALTER TABLE public.workspace_invitations DROP CONSTRAINT IF EXISTS fk_invitation_roster;
ALTER TABLE public.workspace_invitations ADD CONSTRAINT fk_invitation_roster 
    FOREIGN KEY (roster_person_id) 
    REFERENCES public.roster_people(id) ON DELETE CASCADE;

ALTER TABLE public.workspace_invitations DROP CONSTRAINT IF EXISTS fk_invitation_inviter;
ALTER TABLE public.workspace_invitations ADD CONSTRAINT fk_invitation_inviter 
    FOREIGN KEY (invited_by_roster_id) 
    REFERENCES public.roster_people(id) ON DELETE CASCADE;

COMMIT;
