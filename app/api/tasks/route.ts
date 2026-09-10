import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMembership, requireOwner, validateSameOrigin } from "@/lib/auth/server-auth";
import { determineDefaultReviewer } from "@/lib/services/reviews";
import { createTask } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authRes = await requireWorkspaceMembership(req);
  if (!authRes.success) {
    return authRes.errorResponse;
  }

  const { membership, admin } = authRes.data;

  const { searchParams } = new URL(req.url);
  const myWork = searchParams.get("myWork");
  const assigneeId = searchParams.get("assigneeId");
  const clientId = searchParams.get("clientId");
  const status = searchParams.get("status");
  const priority = searchParams.get("priority");
  const search = searchParams.get("search");

  let query = admin
    .from("tasks")
    .select(`
      *,
      campaign:campaigns(id, title, month_key, revision_number, original_file_name, storage_path),
      client:clients(id, name, difficulty),
      assignee:roster_people!fk_task_assignee(id, display_name, job_title),
      reviewer:roster_people!fk_task_reviewer(id, display_name, job_title),
      content_calendar_item:content_calendar_items!fk_cci_task(*),
      checklist_items:task_checklist_items(*),
      review_rounds(*)
    `)
    .eq("workspace_id", membership.workspaceId)
    .order("created_at", { ascending: false });

  // Role-based scoping
  if (myWork === "true") {
    query = query.eq("primary_assignee_id", membership.rosterPersonId);
  } else if (membership.role === "designer") {
    // Find task IDs where user is a collaborator
    const { data: collabs } = await admin
      .from("task_collaborators")
      .select("task_id")
      .eq("workspace_id", membership.workspaceId)
      .eq("roster_person_id", membership.rosterPersonId);

    const collabTaskIds = collabs?.map((c: any) => c.task_id) || [];
    if (collabTaskIds.length > 0) {
      query = query.or(`primary_assignee_id.eq.${membership.rosterPersonId},id.in.(${collabTaskIds.join(",")})`);
    } else {
      query = query.eq("primary_assignee_id", membership.rosterPersonId);
    }
  } else if (membership.role === "senior_reviewer") {
    const { data: collabs } = await admin
      .from("task_collaborators")
      .select("task_id")
      .eq("workspace_id", membership.workspaceId)
      .eq("roster_person_id", membership.rosterPersonId);

    const collabTaskIds = collabs?.map((c: any) => c.task_id) || [];
    if (collabTaskIds.length > 0) {
      query = query.or(`reviewer_id.eq.${membership.rosterPersonId},primary_assignee_id.eq.${membership.rosterPersonId},id.in.(${collabTaskIds.join(",")})`);
    } else {
      query = query.or(`reviewer_id.eq.${membership.rosterPersonId},primary_assignee_id.eq.${membership.rosterPersonId}`);
    }
  }

  // Filters (for management/owner or within user scope)
  if (assigneeId && (membership.role === "owner" || membership.role === "manager" || assigneeId === membership.rosterPersonId)) {
    query = query.eq("primary_assignee_id", assigneeId);
  }
  if (clientId) query = query.eq("client_id", clientId);
  if (status) query = query.eq("status", status);
  if (priority) query = query.eq("priority", priority);
  if (search) query = query.ilike("title", `%${search}%`);

  const { data: tasks, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tasks: tasks || [] });
}

export async function POST(req: NextRequest) {
  if (!validateSameOrigin(req)) {
    return NextResponse.json(
      { error: "رفض الطلب: انتهاك التحقق من مصدر الطلب (CSRF/Same-Origin)." },
      { status: 403 }
    );
  }

  const ownerRes = await requireOwner(req);
  if (!ownerRes.success) {
    return ownerRes.errorResponse;
  }

  const { membership, admin } = ownerRes.data;

  try {
    const body = await req.json();
    const {
      campaignId,
      clientId,
      title,
      brief,
      deliverableType,
      deliverableNumber,
      priority,
      primaryAssigneeId,
      reviewerId,
      dueAt,
      estimatedMinutes,
    } = body;

    // Fetch client to know difficulty and owner if assignee/reviewer not explicitly provided
    let finalAssigneeId = primaryAssigneeId;
    let finalReviewerId = reviewerId;

    const { data: client } = await admin
      .from("clients")
      .select("owner_roster_id, difficulty")
      .eq("id", clientId)
      .maybeSingle();

    if (!finalAssigneeId && client?.owner_roster_id) {
      finalAssigneeId = client.owner_roster_id;
    }

    if (!finalReviewerId) {
      const routing = await determineDefaultReviewer({
        workspaceId: membership.workspaceId,
        assigneeId: finalAssigneeId,
        clientDifficulty: client?.difficulty,
      });
      finalReviewerId = routing?.reviewerId || null;
    }

    const task = await createTask({
      workspaceId: membership.workspaceId,
      campaignId,
      clientId,
      title,
      brief,
      deliverableType,
      deliverableNumber,
      priority,
      primaryAssigneeId: finalAssigneeId,
      reviewerId: finalReviewerId,
      dueAt,
      estimatedMinutes,
      idempotencyKey: body.idempotencyKey,
    });

    return NextResponse.json({ task: task?.task || task });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
