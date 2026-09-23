// TypeScript Types for OMG Creative Workspace (V3)

export type RosterRole =
  | 'owner'
  | 'manager'
  | 'senior_reviewer'
  | 'designer'
  | 'marketing_director'
  | 'strategy_lead'
  | 'strategist'
  | 'content_writer'
  | 'video_editor'
  | 'business_owner_viewer';

export type WorkStage = 'strategy' | 'copywriting' | 'design' | 'video_editing' | 'video_cover';
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
  | 'final_preparation_export'
  | 'strategy_research'
  | 'content_writing'
  | 'video_editing'
  | 'review'
  | 'waiting';

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
  role?: RosterRole;
  specialties?: string[];
  is_active?: boolean;
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

export interface ClientTeamAssignment {
  id: string;
  workspace_id: string;
  client_id: string;
  primary_strategist_id?: string | null;
  primary_copywriter_id?: string | null;
  primary_designer_id?: string | null;
  primary_video_editor_id?: string | null;
  strategy_reviewer_id?: string | null;
  copywriting_reviewer_id?: string | null;
  design_reviewer_id?: string | null;
  video_reviewer_id?: string | null;
  marketing_director_id?: string | null;
  strategy_lead_id?: string | null;
  requires_video?: boolean;
  created_at: string;
  updated_at: string;
  primary_strategist?: RosterPerson | null;
  primary_copywriter?: RosterPerson | null;
  primary_designer?: RosterPerson | null;
  primary_video_editor?: RosterPerson | null;
  strategy_reviewer?: RosterPerson | null;
  copywriting_reviewer?: RosterPerson | null;
  design_reviewer?: RosterPerson | null;
  video_reviewer?: RosterPerson | null;
  marketing_director?: RosterPerson | null;
  strategy_lead?: RosterPerson | null;
}

export interface ClientBrief {
  id: string;
  workspace_id: string;
  client_id: string;
  objectives?: string | null;
  target_audience?: string | null;
  products_services?: string | null;
  tone_of_voice?: string | null;
  content_pillars?: string[];
  dos_and_donts?: string | null;
  brand_guidelines_url?: string | null;
  assets_drive_url?: string | null;
  strategy_summary?: string | null;
  approved_strategy_content?: string | null;
  strategy_version: number;
  status: 'draft' | 'in_review' | 'reviewed' | 'approved';
  operational_review_by?: string | null;
  operational_review_at?: string | null;
  operational_feedback?: string | null;
  approved_by_roster_id?: string | null;
  approved_at?: string | null;
  created_at: string;
  updated_at: string;
  approved_by?: RosterPerson | null;
}

export interface TaskDeliverable {
  id: string;
  workspace_id: string;
  task_id: string;
  version_number: number;
  deliverable_type: 'strategy' | 'copywriting' | 'design' | 'video' | 'video_cover' | 'text';
  title?: string | null;
  body_content?: string | null;
  payload?: any;
  deliverable_url?: string | null;
  notes?: string | null;
  submitted_by_id: string;
  created_at: string;
  submitted_by?: RosterPerson | null;
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
  team_assignment?: ClientTeamAssignment | null;
  brief_data?: ClientBrief | null;
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
  work_stage?: WorkStage;
  content_version_used?: number;
  dependency_task_id?: string | null;
  waiting_reason?: string | null;
  waiting_since?: string | null;
  waiting_on_roster_id?: string | null;
  is_waiting?: boolean;
  primary_assignee_id?: string | null;
  reviewer_id?: string | null;
  due_date?: string | null;
  due_at?: string | null;
  design_due_date?: string | null;
  estimated_hours?: number | null;
  estimated_minutes?: number | null;
  working_file_url?: string | null;
  final_deliverable_url?: string | null;
  final_deliverable_attachment_id?: string | null;
  content_calendar_item_id?: string | null;
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
  content_calendar_item?: any;
  deliverables?: TaskDeliverable[];
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

// -----------------------------------------------------------------------------
// Permissions System: Capabilities, Scopes, and Role Matrix
// -----------------------------------------------------------------------------

export type PermissionKey =
  | 'view_data'
  | 'manage_clients'
  | 'assign_team'
  | 'approve_reviews'
  | 'track_time'
  | 'export_reports'
  | 'manage_workspace';

export type PermissionScope =
  | 'workspace'
  | 'assigned_team'
  | 'assigned_clients'
  | 'own_tasks'
  | 'none';

export interface RolePermissionConfig {
  label: string;
  description: string;
  scope: PermissionScope;
  canViewData: boolean;
  canManageClients: boolean;
  canAssignTeam: boolean;
  canApproveReviews: boolean;
  canTrackTime: boolean;
  canExportReports: boolean;
  canManageWorkspace: boolean;
}

export const ROLE_PERMISSIONS_MATRIX: Record<RosterRole, RolePermissionConfig> = {
  owner: {
    label: "المدير العام (Owner)",
    description: "إدارة كاملة للمنظومة والعملاء والفرق والدعوات والإعدادات والتقارير",
    scope: "workspace",
    canViewData: true,
    canManageClients: true,
    canAssignTeam: true,
    canApproveReviews: true,
    canTrackTime: true,
    canExportReports: true,
    canManageWorkspace: true,
  },
  manager: {
    label: "مدير العمليات (Manager)",
    description: "إدارة التشغيل والعملاء وتوزيع الفرق والتقارير والتصدير دون إدارة النظام",
    scope: "workspace",
    canViewData: true,
    canManageClients: true,
    canAssignTeam: true,
    canApproveReviews: true,
    canTrackTime: true,
    canExportReports: true,
    canManageWorkspace: false,
  },
  marketing_director: {
    label: "مدير التسويق (عطا)",
    description: "اطلاع شامل على المؤشرات وسجلات الوقت والتقييمات والتصدير فقط دون تعديل أو إسناد",
    scope: "workspace",
    canViewData: true,
    canManageClients: false,
    canAssignTeam: false,
    canApproveReviews: false,
    canTrackTime: true,
    canExportReports: true,
    canManageWorkspace: false,
  },
  strategy_lead: {
    label: "قائد فريق استراتيجية (أروى)",
    description: "قيادة الاستراتيجية ومراجعة واعتماد البريفات وإسناد فريق الاستراتيجية",
    scope: "assigned_team",
    canViewData: true,
    canManageClients: true,
    canAssignTeam: true,
    canApproveReviews: true,
    canTrackTime: true,
    canExportReports: false,
    canManageWorkspace: false,
  },
  senior_reviewer: {
    label: "مراجع أول (ندى)",
    description: "مراجعة واعتماد تصاميم الفريق والتوجيه الفني",
    scope: "assigned_team",
    canViewData: true,
    canManageClients: false,
    canAssignTeam: false,
    canApproveReviews: true,
    canTrackTime: true,
    canExportReports: false,
    canManageWorkspace: false,
  },
  strategist: {
    label: "استراتيجي (Strategist)",
    description: "إعداد الاستراتيجيات والبريفات وسجلات الوقت للعملاء المسندين",
    scope: "assigned_clients",
    canViewData: true,
    canManageClients: false,
    canAssignTeam: false,
    canApproveReviews: false,
    canTrackTime: true,
    canExportReports: false,
    canManageWorkspace: false,
  },
  content_writer: {
    label: "كاتب محتوى (Content Writer)",
    description: "كتابة خطط المحتوى والاسكريبتات وتتبع الوقت للمهام المسندة",
    scope: "own_tasks",
    canViewData: true,
    canManageClients: false,
    canAssignTeam: false,
    canApproveReviews: false,
    canTrackTime: true,
    canExportReports: false,
    canManageWorkspace: false,
  },
  designer: {
    label: "مصمم (Designer)",
    description: "تنفيذ التصاميم ورفع التسليمات وتتبع الوقت للمهام المسندة",
    scope: "own_tasks",
    canViewData: true,
    canManageClients: false,
    canAssignTeam: false,
    canApproveReviews: false,
    canTrackTime: true,
    canExportReports: false,
    canManageWorkspace: false,
  },
  video_editor: {
    label: "مونتير (Video Editor)",
    description: "تنفيذ ومونتاج الفيديو ورفع التسليمات وتتبع الوقت للمهام المسندة",
    scope: "own_tasks",
    canViewData: true,
    canManageClients: false,
    canAssignTeam: false,
    canApproveReviews: false,
    canTrackTime: true,
    canExportReports: false,
    canManageWorkspace: false,
  },
  business_owner_viewer: {
    label: "مالك الشركة (مشاهد فقط)",
    description: "اطلاع وقراءة كاملة للعملاء والفرق والتقارير دون أي صلاحيات كتابة أو تصدير أو تعديل",
    scope: "workspace",
    canViewData: true,
    canManageClients: false,
    canAssignTeam: false,
    canApproveReviews: false,
    canTrackTime: false,
    canExportReports: false,
    canManageWorkspace: false,
  },
};

