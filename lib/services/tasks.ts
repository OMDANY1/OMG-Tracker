import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { TaskPriority, TaskStatus } from "@/types/database";

async function getClient() {
  const serverClient = await createServerSupabaseClient().catch(() => null);
  return serverClient || createAdminClient();
}

export interface BatchTaskDraft {
  title: string;
  deliverableType: string;
  deliverableNumber: string;
  primaryAssigneeId?: string | null;
  reviewerId?: string | null;
  dueAt?: string | null;
  estimatedMinutes?: number | null;
  priority: TaskPriority;
  brief?: string | null;
}

export async function createTask(params: {
  workspaceId: string;
  campaignId: string;
  clientId: string;
  title: string;
  deliverableType?: string;
  deliverableNumber?: string;
  priority?: TaskPriority;
  primaryAssigneeId?: string | null;
  reviewerId?: string | null;
  dueAt?: string | null;
  estimatedMinutes?: number | null;
  brief?: string | null;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("create_task", {
    p_workspace_id: params.workspaceId,
    p_campaign_id: params.campaignId,
    p_client_id: params.clientId,
    p_title: params.title,
    p_deliverable_type: params.deliverableType || "Post",
    p_deliverable_number: params.deliverableNumber || "01",
    p_priority: params.priority || "Normal",
    p_primary_assignee_id: params.primaryAssigneeId || null,
    p_reviewer_id: params.reviewerId || null,
    p_due_at: params.dueAt || null,
    p_estimated_minutes: params.estimatedMinutes || null,
    p_brief: params.brief || null,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(`Failed to create task: ${error.message}`);
  return data;
}

export async function createBatchTasks(params: {
  workspaceId: string;
  campaignId: string;
  clientId: string;
  tasks: BatchTaskDraft[];
}) {
  const createdTasks: any[] = [];

  for (const draft of params.tasks) {
    const res = await createTask({
      workspaceId: params.workspaceId,
      campaignId: params.campaignId,
      clientId: params.clientId,
      title: draft.title,
      deliverableType: draft.deliverableType,
      deliverableNumber: draft.deliverableNumber,
      primaryAssigneeId: draft.primaryAssigneeId,
      reviewerId: draft.reviewerId,
      dueAt: draft.dueAt,
      estimatedMinutes: draft.estimatedMinutes,
      priority: draft.priority,
      brief: draft.brief,
    });
    createdTasks.push(res?.task || res);
  }

  return createdTasks;
}

export async function updateTaskStatus(params: {
  taskId: string;
  toStatus: TaskStatus;
  reason?: string;
  deliverableUrl?: string;
  finalDeliverableAttachmentId?: string;
  idempotencyKey?: string;
  client?: any;
}) {
  const supabase = params.client || (await getClient());
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("transition_task_status", {
    p_task_id: params.taskId,
    p_to_status: params.toStatus,
    p_reason: params.reason || null,
    p_deliverable_url: params.deliverableUrl || null,
    p_final_deliverable_attachment_id: params.finalDeliverableAttachmentId || null,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function reassignTask(params: {
  taskId: string;
  newAssigneeId: string;
  reason?: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("reassign_task", {
    p_task_id: params.taskId,
    p_new_assignee_id: params.newAssigneeId,
    p_reason: params.reason || "Reassigned by management",
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function changeTaskReviewer(params: {
  taskId: string;
  newReviewerId: string;
  reason: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("change_task_reviewer", {
    p_task_id: params.taskId,
    p_new_reviewer_id: params.newReviewerId,
    p_reason: params.reason,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function updateTaskDueDate(params: {
  taskId: string;
  newDueAt?: string;
  newDueDate?: string;
  reason?: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const targetDueDate = params.newDueDate || params.newDueAt;
  if (!targetDueDate) throw new Error("Due date is required.");

  const { data, error } = await supabase.rpc("update_task_due_date", {
    p_task_id: params.taskId,
    p_new_due_date: targetDueDate,
    p_reason: params.reason || "Due date updated",
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function bulkUpdateTasks(params: {
  taskIds: string[];
  updates: {
    primaryAssigneeId?: string;
    dueAt?: string;
  };
}) {
  const results = [];
  for (const taskId of params.taskIds) {
    if (params.updates.primaryAssigneeId) {
      const res = await reassignTask({ taskId, newAssigneeId: params.updates.primaryAssigneeId });
      results.push(res);
    }
    if (params.updates.dueAt) {
      const res = await updateTaskDueDate({ taskId, newDueAt: params.updates.dueAt });
      results.push(res);
    }
  }
  return results;
}

export async function updateTaskPriority(params: {
  taskId: string;
  newPriority: TaskPriority;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("update_task_priority", {
    p_task_id: params.taskId,
    p_priority: params.newPriority,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function addTaskCollaborator(params: {
  taskId: string;
  rosterPersonId: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("add_task_collaborator", {
    p_task_id: params.taskId,
    p_roster_person_id: params.rosterPersonId,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function removeTaskCollaborator(params: {
  taskId: string;
  rosterPersonId: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("remove_task_collaborator", {
    p_task_id: params.taskId,
    p_roster_person_id: params.rosterPersonId,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function createTaskChecklistItem(params: {
  taskId: string;
  title: string;
  sortOrder?: number;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("create_task_checklist_item", {
    p_task_id: params.taskId,
    p_title: params.title,
    p_sort_order: params.sortOrder || 0,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function updateTaskChecklistItem(params: {
  itemId: string;
  title?: string;
  isCompleted?: boolean;
  sortOrder?: number;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("update_task_checklist_item", {
    p_item_id: params.itemId,
    p_title: params.title || null,
    p_is_completed: params.isCompleted !== undefined ? params.isCompleted : null,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function deleteTaskChecklistItem(params: {
  itemId: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("delete_task_checklist_item", {
    p_item_id: params.itemId,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function createTaskAttachment(params: {
  taskId: string;
  fileName: string;
  storagePath: string;
  fileSizeBytes: number;
  mimeType: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("create_task_attachment", {
    p_task_id: params.taskId,
    p_file_name: params.fileName,
    p_storage_path: params.storagePath,
    p_file_size_bytes: params.fileSizeBytes,
    p_mime_type: params.mimeType,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function deleteTaskAttachment(params: {
  attachmentId: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("delete_task_attachment", {
    p_attachment_id: params.attachmentId,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function submitTaskDeliverable(params: {
  taskId: string;
  deliverableType: string;
  title?: string;
  bodyContent?: string;
  payload?: any;
  deliverableUrl?: string;
  notes?: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("submit_task_deliverable", {
    p_task_id: params.taskId,
    p_deliverable_type: params.deliverableType,
    p_title: params.title || null,
    p_body_content: params.bodyContent || null,
    p_payload: params.payload || {},
    p_deliverable_url: params.deliverableUrl || null,
    p_notes: params.notes || null,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function setTaskWaitingState(params: {
  taskId: string;
  isWaiting: boolean;
  waitingReason?: string;
  waitingOnRosterId?: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("set_task_waiting_state", {
    p_task_id: params.taskId,
    p_is_waiting: params.isWaiting,
    p_waiting_reason: params.waitingReason || null,
    p_waiting_on_roster_id: params.waitingOnRosterId || null,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function approveCopywritingAndUnlockDownstream(params: {
  copyTaskId: string;
  approvedCopy: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("approve_copywriting_and_unlock_downstream", {
    p_copy_task_id: params.copyTaskId,
    p_approved_copy: params.approvedCopy,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function getTaskDeliverables(taskId: string) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase
    .from("task_deliverables")
    .select("*, submitted_by:roster_people(id, display_name, job_title)")
    .eq("task_id", taskId)
    .order("version_number", { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}
