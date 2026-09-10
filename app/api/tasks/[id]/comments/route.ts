import { NextRequest, NextResponse } from "next/server";
import { requireTaskAccess, validateSameOrigin } from "@/lib/auth/server-auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;

    const accessResult = await requireTaskAccess(req, taskId);
    if (!accessResult.success) {
      return accessResult.errorResponse;
    }

    const { membership, admin } = accessResult.data;

    const { data: comments, error } = await admin
      .from("comments")
      .select(`
        id,
        task_id,
        content,
        comment_type,
        is_resolved,
        resolved_at,
        mentions,
        created_at,
        author:roster_people!fk_comment_author(id, display_name),
        resolver:roster_people!comments_resolved_by_roster_id_fkey(id, display_name)
      `)
      .eq("task_id", taskId)
      .eq("workspace_id", membership.workspaceId)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, comments: comments || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!validateSameOrigin(req)) {
      return NextResponse.json({ error: "طلب غير مصرح به (Same-Origin check failed)." }, { status: 403 });
    }

    const { id: taskId } = await params;

    const accessResult = await requireTaskAccess(req, taskId);
    if (!accessResult.success) {
      return accessResult.errorResponse;
    }

    const { membership, admin } = accessResult.data;

    const body = await req.json();
    const { content, commentType = "general", mentions = [] } = body;

    // Strict validation: clean content and length bounds
    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "نص التعليق مطلوب." }, { status: 400 });
    }

    const trimmedContent = content.trim();
    if (trimmedContent.length > 5000) {
      return NextResponse.json({ error: "نص التعليق طويل جداً (الحد الأقصى 5000 حرف)." }, { status: 400 });
    }

    const validTypes = ["general", "internal_review", "client_note"];
    const resolvedType = validTypes.includes(commentType) ? commentType : "general";

    // Validate mentions: ensure IDs belong to roster_people in the same workspace
    let validMentions: string[] = [];
    if (Array.isArray(mentions) && mentions.length > 0) {
      const { data: validPeople } = await admin
        .from("roster_people")
        .select("id")
        .eq("workspace_id", membership.workspaceId)
        .in("id", mentions.slice(0, 10)); // max 10 mentions

      validMentions = (validPeople || []).map((p: any) => p.id);
    }

    // Author identity is strictly derived from authenticated session — never from body!
    const { data: inserted, error: insertErr } = await admin
      .from("comments")
      .insert({
        workspace_id: membership.workspaceId,
        task_id: taskId,
        author_roster_id: membership.rosterPersonId,
        content: trimmedContent,
        comment_type: resolvedType,
        mentions: validMentions,
      })
      .select(`
        id,
        task_id,
        content,
        comment_type,
        is_resolved,
        resolved_at,
        mentions,
        created_at,
        author:roster_people!fk_comment_author(id, display_name)
      `)
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, comment: inserted });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!validateSameOrigin(req)) {
      return NextResponse.json({ error: "طلب غير مصرح به (Same-Origin check failed)." }, { status: 403 });
    }

    const { id: taskId } = await params;

    const accessResult = await requireTaskAccess(req, taskId);
    if (!accessResult.success) {
      return accessResult.errorResponse;
    }

    const { membership, task, admin } = accessResult.data;

    const body = await req.json();
    const { commentId, isResolved } = body;

    if (!commentId || typeof isResolved !== "boolean") {
      return NextResponse.json({ error: "بيانات غير صالحة لتحديث حالة التعليق." }, { status: 400 });
    }

    // Only Owner, task assignee, or task reviewer can resolve/reopen comments
    const canResolve =
      membership.role === "owner" ||
      task.primary_assignee_id === membership.rosterPersonId ||
      task.reviewer_id === membership.rosterPersonId;

    if (!canResolve) {
      return NextResponse.json(
        { error: "غير مصرح: يحق فقط للمالك أو منفذ المهمة أو مراجعها حل التعليقات." },
        { status: 403 }
      );
    }

    const updatePayload: any = {
      is_resolved: isResolved,
      resolved_at: isResolved ? new Date().toISOString() : null,
      resolved_by_roster_id: isResolved ? membership.rosterPersonId : null,
    };

    const { data: updated, error } = await admin
      .from("comments")
      .update(updatePayload)
      .eq("id", commentId)
      .eq("task_id", taskId)
      .eq("workspace_id", membership.workspaceId)
      .select(`
        id,
        task_id,
        content,
        comment_type,
        is_resolved,
        resolved_at,
        mentions,
        created_at,
        author:roster_people!fk_comment_author(id, display_name),
        resolver:roster_people!comments_resolved_by_roster_id_fkey(id, display_name)
      `)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Log to audit_events
    try {
      await admin
        .from("audit_events")
        .insert({
          workspace_id: membership.workspaceId,
          actor_id: membership.rosterPersonId,
          action: isResolved ? "resolve_comment" : "reopen_comment",
          entity_type: "comments",
          entity_id: commentId,
          metadata: { task_id: taskId },
        });
    } catch {
      // Non-blocking audit log error
    }

    return NextResponse.json({ success: true, comment: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
