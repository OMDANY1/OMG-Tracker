import { NextRequest, NextResponse } from "next/server";
import { requireOwner, validateSameOrigin } from "@/lib/auth/server-auth";
import { calculateSmartDeadlines, WorkspaceDeadlineConfig } from "@/lib/services/smart-deadlines";

export const dynamic = "force-dynamic";

/**
 * POST /api/workspace/deadline-settings/recalculate
 * Safe Recalculation Engine for existing tasks:
 * - If confirm !== true: returns Preview diff with affected count and protected tasks count.
 * - If confirm === true: updates ONLY non-active tasks (backlog, ready), logs audit event.
 * - Tasks in 'in_progress', 'review', 'approved', 'delivered' are strictly protected!
 */
export async function POST(req: NextRequest) {
  try {
    if (!validateSameOrigin(req)) {
      return NextResponse.json({ error: "طلب غير مصرح به (Same-Origin check failed)." }, { status: 403 });
    }

    const authRes = await requireOwner(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, admin } = authRes.data;
    const body = await req.json().catch(() => ({}));
    const confirmExecution = Boolean(body.confirm);

    // 1. Fetch current workspace deadline configuration
    const { data: settings } = await admin
      .from("workspace_deadline_settings")
      .select("*")
      .eq("workspace_id", membership.workspaceId)
      .single();

    const config: WorkspaceDeadlineConfig = settings || {
      static_lead_days: 2,
      carousel_lead_days: 3,
      video_lead_days: 3,
      review_lead_days: 1,
      hard_client_extra_days: 1,
      working_days: [0, 1, 2, 3, 4],
      default_publish_time: "18:00",
      timezone: "Africa/Cairo",
    };

    // 2. Fetch non-completed open tasks with their clients
    const { data: allOpenTasks, error: fetchErr } = await admin
      .from("tasks")
      .select(`
        id,
        title,
        status,
        deliverable_format,
        due_date,
        design_due_date,
        review_due_date,
        publish_at,
        client:clients(id, name, difficulty)
      `)
      .eq("workspace_id", membership.workspaceId)
      .is("archived_at", null)
      .not("status", "in", '("approved","delivered","cancelled")');

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    const tasks = allOpenTasks || [];

    // 3. Separate candidate tasks from strictly protected active tasks
    const activeProtectedTasks: any[] = [];
    const candidateTasks: any[] = [];
    const previewChanges: any[] = [];

    for (const t of tasks) {
      // STRICT ACTIVE TASK PROTECTION:
      // Any task in progress or review is protected from automatic deadline shifting
      if (["in_progress", "review"].includes(t.status)) {
        activeProtectedTasks.push(t);
        continue;
      }

      // Calculate target publish date
      const targetPublishDate = t.publish_at || t.due_date;
      if (!targetPublishDate) {
        continue; // Cannot recalculate without reference date
      }

      const clientObj: any = Array.isArray(t.client) ? t.client[0] : t.client;
      const difficulty = clientObj?.difficulty || "Medium";
      const format = t.deliverable_format || "Static";

      const calculated = calculateSmartDeadlines({
        publishDate: targetPublishDate,
        format,
        difficulty,
        settings: config,
      });

      const oldDesign = t.design_due_date || t.due_date;
      const newDesign = calculated.designDueDate;

      candidateTasks.push({
        taskId: t.id,
        title: t.title,
        status: t.status,
        clientName: clientObj?.name || "N/A",
        format,
        difficulty,
        oldDesignDueDate: oldDesign,
        newDesignDueDate: newDesign,
        newReviewDueDate: calculated.reviewDueDate,
        newPublishAt: calculated.publishAt,
      });

      previewChanges.push({
        taskId: t.id,
        title: t.title,
        status: t.status,
        oldDesignDate: oldDesign ? new Date(oldDesign).toLocaleDateString("ar-EG") : "غير محدد",
        newDesignDate: new Date(newDesign).toLocaleDateString("ar-EG"),
        publishDate: new Date(calculated.publishAt).toLocaleDateString("ar-EG"),
      });
    }

    // 4. Return Preview if not confirmed
    if (!confirmExecution) {
      return NextResponse.json({
        success: true,
        previewMode: true,
        summary: {
          totalOpenTasks: tasks.length,
          candidateTasksCount: candidateTasks.length,
          activeProtectedCount: activeProtectedTasks.length,
        },
        protectedNote: "المهام الجارية وقيد المراجعة محمية بالكامل ولن يتم تعديل مواعيدها للحفاظ على جهود المصممين.",
        previewChanges: previewChanges.slice(0, 50),
      });
    }

    // 5. Execute Recalculation under Confirmation
    let updatedCount = 0;
    const now = new Date().toISOString();

    for (const item of candidateTasks) {
      const { error: updErr } = await admin
        .from("tasks")
        .update({
          design_due_date: item.newDesignDueDate,
          review_due_date: item.newReviewDueDate,
          publish_at: item.newPublishAt,
          updated_at: now,
        })
        .eq("id", item.taskId)
        .eq("workspace_id", membership.workspaceId);

      if (!updErr) updatedCount++;
    }

    // 6. Log in audit_events
    await admin.from("audit_events").insert({
      workspace_id: membership.workspaceId,
      actor_id: membership.rosterPersonId || null,
      action: "recalculate_task_deadlines",
      entity_type: "tasks",
      entity_id: null,
      metadata: {
        recalculated_count: updatedCount,
        protected_count: activeProtectedTasks.length,
        applied_config: config,
        timestamp: now,
      },
    });

    return NextResponse.json({
      success: true,
      previewMode: false,
      message: `تمت إعادة احتساب مواعيد ${updatedCount} مهمة جديدة/معلقة بنجاح، مع حماية ${activeProtectedTasks.length} مهمة نشطة.`,
      recalculatedCount: updatedCount,
      protectedCount: activeProtectedTasks.length,
    });
  } catch (err: any) {
    console.error("Error in POST /api/workspace/deadline-settings/recalculate:", err);
    return NextResponse.json({ error: err.message || "Failed to recalculate deadlines" }, { status: 500 });
  }
}
