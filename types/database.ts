// TypeScript Types for OMG Creative Workspace (V3)

export type RosterRole = 'owner' | 'manager' | 'senior_reviewer' | 'designer';
export type ClientDifficulty = 'Easy' | 'Medium' | 'Hard' | 'Unknown';
export type ClientExtraWorkload = 'None' | 'Many requests' | 'Many revisions' | 'Unknown';
export type ClientState = 'Active' | 'Not started' | 'Archived';
export type CampaignStatus = 'Draft' | 'Active' | 'Completed' | 'Archived';
export type TaskPriority = 'Low' | 'Normal' | 'High' | 'Urgent';
export type TaskStatus =
  | 'backlog'
  | 'ready'
  | 'in_progress'
  | 'internal_review'
  | 'changes_requested'
  | 'client_review'
  | 'approved'
  | 'delivered'
  | 'blocked'
  | 'cancelled';

export type TimeCategory =
  | 'research_references'
  | 'initial_design'
  | 'internal_revision'
  | 'client_revision'
  | 'final_preparation_export';

export type TimeEntrySource = 'timer' | 'manual' | 'on_behalf';
export type ReviewRoundType = 'internal' | 'client';
export type ReviewDecision = 'pending' | 'approved' | 'changes_requested';
export type CorrectionStatus = 'pending' | 'approved' | 'rejected';

export interface Workspace {
  id: string;
  name: string;
  default_timezone: string;
  long_session_threshold_mins: number;
  created_at: string;
  updated_at: string;
}

export interface RosterPerson {
  id: string;
  workspace_id: string;
  display_name: string;
  job_title: string;
  created_at: string;
  updated_at: string;
  membership?: WorkspaceMembership | null;
}

export interface WorkspaceMembership {
  id: string;
  workspace_id: string;
  user_id: string;
  roster_person_id: string;
  role: RosterRole;
  created_at: string;
  updated_at: string;
  roster_person?: RosterPerson | null;
}

export interface WorkspaceInvitation {
  id: string;
  workspace_id: string;
  roster_person_id: string;
  email: string;
  role: RosterRole;
  token_hash: string;
  invited_by_user_id: string;
  expires_at: string;
  accepted_at?: string | null;
  revoked_at?: string | null;
  created_at: string;
  roster_person?: RosterPerson | null;
}

export interface ReviewRoutingRule {
  id: string;
  workspace_id: string;
  priority: number;
  designer_roster_id?: string | null;
  client_difficulty?: ClientDifficulty | null;
  reviewer_roster_id: string;
  fallback_reviewer_id?: string | null;
  is_workspace_default: boolean;
  created_at: string;
  updated_at: string;
  designer?: RosterPerson | null;
  reviewer?: RosterPerson | null;
  fallback_reviewer?: RosterPerson | null;
}

export interface MemberCapacity {
  id: string;
  workspace_id: string;
  roster_person_id: string;
  weekly_hours: number;
  workweek_days: number[];
  reserved_management_hours: number;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeaveDay {
  id: string;
  workspace_id: string;
  roster_person_id: string;
  start_date: string;
  end_date: string;
  reason?: string | null;
  approved_by_roster_id?: string | null;
  created_at: string;
  roster_person?: RosterPerson | null;
}

export interface Client {
  id: string;
  workspace_id: string;
  name: string;
  owner_roster_id?: string | null;
  difficulty: ClientDifficulty;
  extra_workload: ClientExtraWorkload;
  state: ClientState;
  notes?: string | null;
  brand_guide_url?: string | null;
  brief_url?: string | null;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
  owner?: RosterPerson | null;
}

export interface Campaign {
  id: string;
  workspace_id: string;
  client_id: string;
  title: string;
  objective?: string | null;
  brief?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  status: CampaignStatus;
  asset_links?: string[] | null;
  created_at: string;
  updated_at: string;
  client?: Client | null;
}

export interface Task {
  id: string;
  workspace_id: string;
  campaign_id: string;
  client_id: string;
  title: string;
  brief?: string | null;
  deliverable_type: string;
  deliverable_number: string;
  priority: TaskPriority;
  status: TaskStatus;
  primary_assignee_id?: string | null;
  reviewer_id?: string | null;
  due_date?: string | null;
  due_at?: string | null;
  estimated_hours?: number | null;
  estimated_minutes?: number | null;
  working_file_url?: string | null;
  final_deliverable_url?: string | null;
  final_deliverable_attachment_id?: string | null;
  block_reason?: string | null;
  cancel_reason?: string | null;
  reopen_reason?: string | null;
  created_by_id?: string | null;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
  campaign?: Campaign | null;
  client?: Client | null;
  assignee?: RosterPerson | null;
  reviewer?: RosterPerson | null;
  checklist_items?: TaskChecklistItem[];
  collaborators?: RosterPerson[];
  review_rounds?: ReviewRound[];
}

export interface TaskChecklistItem {
  id: string;
  workspace_id: string;
  task_id: string;
  title: string;
  is_completed: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TaskCollaborator {
  id: string;
  workspace_id: string;
  task_id: string;
  roster_person_id: string;
  created_at: string;
  person?: RosterPerson | null;
}

export interface ReviewRound {
  id: string;
  workspace_id: string;
  task_id: string;
  round_number: number;
  round_type: ReviewRoundType;
  submitter_id: string;
  submitted_by_id?: string;
  preview_url: string;
  note?: string | null;
  reviewer_id: string;
  decision: ReviewDecision;
  feedback?: string | null;
  decided_at?: string | null;
  created_at: string;
  submitted_by?: RosterPerson | null;
  reviewer?: RosterPerson | null;
}

export interface Comment {
  id: string;
  workspace_id: string;
  task_id: string;
  author_roster_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  author?: RosterPerson | null;
}

export interface Attachment {
  id: string;
  workspace_id: string;
  task_id: string;
  uploader_roster_id: string;
  file_name: string;
  storage_path: string;
  file_size_bytes: number;
  mime_type: string;
  created_at: string;
  uploader?: RosterPerson | null;
}

export interface InAppNotification {
  id: string;
  workspace_id: string;
  recipient_roster_id: string;
  actor_roster_id?: string | null;
  title: string;
  message: string;
  task_id?: string | null;
  is_read: boolean;
  created_at: string;
  actor?: RosterPerson | null;
}

export interface TaskStatusEvent {
  id: string;
  workspace_id: string;
  task_id: string;
  from_status: TaskStatus;
  to_status: TaskStatus;
  reason?: string | null;
  actor_id?: string | null;
  recorded_due_at?: string | null;
  recorded_assignee_id?: string | null;
  created_at: string;
  actor?: RosterPerson | null;
}

export interface TaskAssignmentEvent {
  id: string;
  workspace_id: string;
  task_id: string;
  previous_assignee_id?: string | null;
  new_assignee_id?: string | null;
  actor_id?: string | null;
  created_at: string;
  actor?: RosterPerson | null;
}

export interface TaskDueDateEvent {
  id: string;
  workspace_id: string;
  task_id: string;
  previous_due_date: string;
  new_due_date: string;
  previous_due_at?: string | null;
  new_due_at?: string | null;
  actor_id?: string | null;
  reason?: string | null;
  created_at: string;
  actor?: RosterPerson | null;
}

export interface TimeEntry {
  id: string;
  workspace_id: string;
  task_id: string;
  roster_person_id: string;
  started_at: string;
  ended_at?: string | null;
  duration_seconds?: number | null;
  category: TimeCategory;
  note?: string | null;
  source: TimeEntrySource;
  entry_source?: TimeEntrySource;
  created_by_id?: string | null;
  review_round_id?: string | null;
  is_voided: boolean;
  void_reason?: string | null;
  voided_at?: string | null;
  voided_by_id?: string | null;
  correction_request_id?: string | null;
  replaces_time_entry_id?: string | null;
  created_at: string;
  updated_at: string;
  task?: Task | null;
  person?: RosterPerson | null;
  created_by?: RosterPerson | null;
}

export interface TimeChangeRequest {
  id: string;
  workspace_id: string;
  time_entry_id: string;
  requested_by_id: string;
  original_started_at: string;
  original_ended_at?: string | null;
  proposed_started_at: string;
  proposed_ended_at: string;
  proposed_category: TimeCategory;
  proposed_note?: string | null;
  reason: string;
  status: CorrectionStatus;
  reviewed_by_id?: string | null;
  decision_reason?: string | null;
  decided_at?: string | null;
  created_at: string;
  requested_by?: RosterPerson | null;
  reviewed_by?: RosterPerson | null;
  time_entry?: TimeEntry | null;
}

export interface MonthlyReportSnapshot {
  id: string;
  workspace_id: string;
  month_key: string;
  revision_number: number;
  is_finalized: boolean;
  finalized_at: string;
  finalized_by_id?: string | null;
  timezone: string;
  snapshot_data: any;
  management_commentary: any;
  snapshot_hash: string;
  content_hash?: string;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  workspace_id: string;
  actor_id?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  metadata: any;
  target_type?: string;
  target_id?: string | null;
  details?: any;
  created_at: string;
  actor?: RosterPerson | null;
}

export interface RpcIdempotencyRecord {
  id: string;
  workspace_id: string;
  actor_id: string;
  operation_name: string;
  idempotency_key: string;
  request_hash: string;
  response_payload: any;
  created_at: string;
}

export interface DesignerProductivity {
  rosterPersonId: string;
  displayName: string;
  jobTitle: string;
  role: string;
  firstDeliveredTasks: number;
  loggedHours: number;
  designHours: number;
  internalRevisionHours: number;
  clientRevisionHours: number;
  totalRevisionHours: number;
  revisionHours: number;
  sessionCount: number;
  campaignsWorkedOn: number;
  configuredWeeklyHours?: number | null;
  reservedManagementHours?: number | null;
  monthLeaveHours?: number;
  monthlyCapacityHours?: number | null;
  capacityUtilizationRate?: number | null;
}
