import { NextRequest, NextResponse } from "next/server";
import { requireOwner, validateSameOrigin } from "@/lib/auth/server-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/tasks/[id]/archive
 * Soft-deletes (archives) a task with Active Task Protection.
 * If task is in_progress, review, approved, or delivered, requireOwner + { force: true } is required.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!validateSameOrigin(req)) {
      return NextResponse.json(
        { error: "طلب غير مصرح به (Same-Origin check failed)." },
        { status: 403 }
      );
    }

    const authResult = await requireOwner(req);
    if (!authResult.success) {
      return authResult.errorResponse;
    }

    const { membership, admin } = authResult.data;
    const workspaceId = membership.workspaceId;
    const taskId = params.id;

    if (!taskId) {
      return NextResponse.json({ error: "Task ID is required" }, { status: 400 });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is acceptable
    }

    // 1. Fetch current task state
    const { data: task, error: fetchErr } = await admin
      .from("tasks")
      .select("id, title, status, client_id, primary_assignee_id, archived_at")
      .eq("id", taskId)
      .eq("workspace_id", workspaceId)
      .single();

    if (fetchErr || !task) {
      return NextResponse.json({ error: "المهمة غير موجودة أو تم حذفها مسبقاً" }, { status: 404 });
    }

    if (task.archived_at) {
      return NextResponse.json({ error: "المهمة مؤرشفة بالفعل" }, { status: 400 });
    }

    // Active Task Protection Guard
    const activeStatuses = ["in_progress", "review", "approved", "delivered"];
    if (activeStatuses.includes(task.status) && !body.force) {
      return NextResponse.json(
        {
          error: "لا يمكن أرشفة مهمة جارية أو معتمدة دون تأكيد صريح (Active Task Protection Guard).",
          requiresForce: true,
          taskStatus: task.status,
        },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();

    // 2. Soft-delete (set archived_at)
    const { error: updateErr } = await admin
      .from("tasks")
      .update({
        archived_at: now,
        updated_at: now,
      })
      .eq("id", taskId)
      .eq("workspace_id", workspaceId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // 3. Log into audit_events
    await admin.from("audit_events").insert({
      workspace_id: workspaceId,
      actor_id: membership.rosterPersonId || null,
      action: "archive_task",
      entity_type: "tasks",
      entity_id: taskId,
      metadata: {
        task_title: task.title,
        previous_status: task.status,
        force_applied: Boolean(body.force),
        reason: body.reason || "Soft-delete / archive by owner",
        timestamp: now,
      },
    });

    return NextResponse.json({
      success: true,
      message: "تم أرشفة المهمة بنجاح وحفظها في الأرشيف",
      taskId,
      archivedAt: now,
    });
  } catch (err: any) {
    console.error("Error in POST /api/tasks/[id]/archive:", err);
    return NextResponse.json({ error: err.message || "Failed to archive task" }, { status: 500 });
  }
}

/**
 * DELETE /api/tasks/[id]/archive
 * Restores (unarchives) a soft-deleted task.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!validateSameOrigin(req)) {
      return NextResponse.json(
        { error: "طلب غير مصرح به (Same-Origin check failed)." },
        { status: 403 }
      );
    }

    const authResult = await requireOwner(req);
    if (!authResult.success) {
      return authResult.errorResponse;
    }

    const { membership, admin } = authResult.data;
    const workspaceId = membership.workspaceId;
    const taskId = params.id;

    if (!taskId) {
      return NextResponse.json({ error: "Task ID is required" }, { status: 400 });
    }

    // 1. Fetch current task state
    const { data: task, error: fetchErr } = await admin
      .from("tasks")
      .select("id, title, status, archived_at")
      .eq("id", taskId)
      .eq("workspace_id", workspaceId)
      .single();

    if (fetchErr || !task) {
      return NextResponse.json({ error: "المهمة غير موجودة" }, { status: 404 });
    }

    if (!task.archived_at) {
      return NextResponse.json({ error: "المهمة ليست في الأرشيف" }, { status: 400 });
    }

    const now = new Date().toISOString();

    // 2. Unarchive (set archived_at to null)
    const { error: updateErr } = await admin
      .from("tasks")
      .update({
        archived_at: null,
        updated_at: now,
      })
      .eq("id", taskId)
      .eq("workspace_id", workspaceId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // 3. Log into audit_events
    await admin.from("audit_events").insert({
      workspace_id: workspaceId,
      actor_id: membership.rosterPersonId || null,
      action: "restore_task",
      entity_type: "tasks",
      entity_id: taskId,
      metadata: {
        task_title: task.title,
        status: task.status,
        timestamp: now,
      },
    });

    return NextResponse.json({
      success: true,
      message: "تم استعادة المهمة من الأرشيف بنجاح",
      taskId,
    });
  } catch (err: any) {
    console.error("Error in DELETE /api/tasks/[id]/archive:", err);
    return NextResponse.json({ error: err.message || "Failed to restore task" }, { status: 500 });
  }
}
