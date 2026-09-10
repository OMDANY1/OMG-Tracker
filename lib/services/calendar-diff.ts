export interface DiffFieldChange {
  field: string;
  labelAr: string;
  oldValue: any;
  newValue: any;
}

export interface DiffItemResult {
  postNumber: string;
  title: string;
  status: "added" | "removed" | "changed" | "unchanged";
  oldItem?: any;
  newItem?: any;
  changes: DiffFieldChange[];
  hasDesignerChange: boolean;
  hasDueDateChange: boolean;
  existingTask?: {
    id: string;
    title: string;
    status: string;
    assigneeName?: string;
  };
}

export interface CalendarDiffReport {
  previousCampaignId?: string;
  newCampaignId?: string;
  summary: {
    totalOld: number;
    totalNew: number;
    addedCount: number;
    removedCount: number;
    changedCount: number;
    unchangedCount: number;
    designerChangesCount: number;
    dueDateChangesCount: number;
    activeTasksAtRiskCount: number;
  };
  items: DiffItemResult[];
}

function normalizePostNumber(val?: string | null): string {
  if (!val) return "";
  return val.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function computeCalendarDiff(params: {
  oldItems: any[];
  newItems: any[];
  existingTasks?: any[];
}): CalendarDiffReport {
  const { oldItems = [], newItems = [], existingTasks = [] } = params;

  const oldMap = new Map<string, any>();
  const oldByOrder = new Map<number, any>();

  for (const item of oldItems) {
    const key = normalizePostNumber(item.post_number);
    if (key) oldMap.set(key, item);
    if (typeof item.post_order === "number") {
      oldByOrder.set(item.post_order, item);
    }
  }

  // Match tasks by content_calendar_item_id or post number / title
  const taskMap = new Map<string, any>();
  for (const task of existingTasks) {
    if (task.content_calendar_item_id) {
      taskMap.set(task.content_calendar_item_id, task);
    }
  }

  const diffItems: DiffItemResult[] = [];
  const processedOldKeys = new Set<string>();

  for (const newItem of newItems) {
    const newKey = normalizePostNumber(newItem.post_number);
    let matchedOld = newKey ? oldMap.get(newKey) : null;

    if (!matchedOld && typeof newItem.post_order === "number") {
      matchedOld = oldByOrder.get(newItem.post_order);
    }

    if (!matchedOld) {
      // Added
      diffItems.push({
        postNumber: newItem.post_number || `Post ${newItem.post_order}`,
        title: newItem.title || "بدون عنوان",
        status: "added",
        newItem,
        changes: [],
        hasDesignerChange: false,
        hasDueDateChange: false,
      });
      continue;
    }

    const matchedOldKey = normalizePostNumber(matchedOld.post_number);
    if (matchedOldKey) processedOldKeys.add(matchedOldKey);

    const changes: DiffFieldChange[] = [];
    let hasDesignerChange = false;
    let hasDueDateChange = false;

    // Check title
    if ((matchedOld.title || "").trim() !== (newItem.title || "").trim()) {
      changes.push({
        field: "title",
        labelAr: "عنوان البوست",
        oldValue: matchedOld.title,
        newValue: newItem.title,
      });
    }

    // Check content_format
    if (matchedOld.content_format !== newItem.content_format) {
      changes.push({
        field: "content_format",
        labelAr: "نوع المحتوى (Format)",
        oldValue: matchedOld.content_format,
        newValue: newItem.content_format,
      });
    }

    // Check on_design_text
    if ((matchedOld.on_design_text || "").trim() !== (newItem.on_design_text || "").trim()) {
      changes.push({
        field: "on_design_text",
        labelAr: "النص داخل التصميم",
        oldValue: matchedOld.on_design_text,
        newValue: newItem.on_design_text,
      });
    }

    // Check caption
    if ((matchedOld.caption || "").trim() !== (newItem.caption || "").trim()) {
      changes.push({
        field: "caption",
        labelAr: "الكابشن",
        oldValue: matchedOld.caption,
        newValue: newItem.caption,
      });
    }

    // Check design_due_date
    if (matchedOld.design_due_date !== newItem.design_due_date) {
      hasDueDateChange = true;
      changes.push({
        field: "design_due_date",
        labelAr: "موعد تسليم التصميم",
        oldValue: matchedOld.design_due_date,
        newValue: newItem.design_due_date,
      });
    }

    // Check publish_date
    if (matchedOld.publish_date !== newItem.publish_date) {
      changes.push({
        field: "publish_date",
        labelAr: "تاريخ النشر",
        oldValue: matchedOld.publish_date,
        newValue: newItem.publish_date,
      });
    }

    // Check assignee
    const oldAssignee = matchedOld.approved_assignee_id || matchedOld.suggested_assignee_id;
    const newAssignee = newItem.approved_assignee_id || newItem.suggested_assignee_id;
    if (oldAssignee !== newAssignee) {
      hasDesignerChange = true;
      changes.push({
        field: "assignee",
        labelAr: "المصمم المسند",
        oldValue: matchedOld.approved_assignee?.display_name || matchedOld.suggested_assignee?.display_name || oldAssignee,
        newValue: newItem.approved_assignee?.display_name || newItem.suggested_assignee?.display_name || newAssignee,
      });
    }

    // Check existing task for old item
    const existingTask = matchedOld.id ? taskMap.get(matchedOld.id) : null;

    diffItems.push({
      postNumber: newItem.post_number || matchedOld.post_number,
      title: newItem.title || matchedOld.title,
      status: changes.length > 0 ? "changed" : "unchanged",
      oldItem: matchedOld,
      newItem,
      changes,
      hasDesignerChange,
      hasDueDateChange,
      existingTask: existingTask
        ? {
            id: existingTask.id,
            title: existingTask.title,
            status: existingTask.status,
            assigneeName: existingTask.assignee?.display_name,
          }
        : undefined,
    });
  }

  // Find removed items
  for (const oldItem of oldItems) {
    const key = normalizePostNumber(oldItem.post_number);
    if (!processedOldKeys.has(key)) {
      const existingTask = oldItem.id ? taskMap.get(oldItem.id) : null;
      diffItems.push({
        postNumber: oldItem.post_number || `Post ${oldItem.post_order}`,
        title: oldItem.title || "بدون عنوان",
        status: "removed",
        oldItem,
        changes: [],
        hasDesignerChange: false,
        hasDueDateChange: false,
        existingTask: existingTask
          ? {
              id: existingTask.id,
              title: existingTask.title,
              status: existingTask.status,
              assigneeName: existingTask.assignee?.display_name,
            }
          : undefined,
      });
    }
  }

  // Count active tasks at risk (e.g. In Progress, Review, or Approved tasks on changed/removed posts)
  const activeTasksAtRiskCount = diffItems.filter(
    (item) =>
      (item.status === "changed" || item.status === "removed") &&
      item.existingTask &&
      item.existingTask.status !== "backlog" &&
      item.existingTask.status !== "cancelled"
  ).length;

  return {
    summary: {
      totalOld: oldItems.length,
      totalNew: newItems.length,
      addedCount: diffItems.filter((i) => i.status === "added").length,
      removedCount: diffItems.filter((i) => i.status === "removed").length,
      changedCount: diffItems.filter((i) => i.status === "changed").length,
      unchangedCount: diffItems.filter((i) => i.status === "unchanged").length,
      designerChangesCount: diffItems.filter((i) => i.hasDesignerChange).length,
      dueDateChangesCount: diffItems.filter((i) => i.hasDueDateChange).length,
      activeTasksAtRiskCount,
    },
    items: diffItems,
  };
}
