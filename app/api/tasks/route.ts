import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { determineDefaultReviewer } from "@/lib/services/reviews";
import { createTask } from "@/lib/services/tasks";

export async function GET(req: NextRequest) {
  const supabase = createAdminClient();
  if (!supabase) {
    return NextResponse.json({ tasks: [], error: "Database unconfigured" });
  }

  const { searchParams } = new URL(req.url);
  const assigneeId = searchParams.get("assigneeId");
  const clientId = searchParams.get("clientId");
  const status = searchParams.get("status");
  const priority = searchParams.get("priority");
  const search = searchParams.get("search");

  let query = supabase
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
    .order("created_at", { ascending: false });

  if (assigneeId) query = query.eq("primary_assignee_id", assigneeId);
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
  const supabase = createAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Database unconfigured" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const {
      workspaceId,
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
      createdById,
    } = body;

    // Fetch client to know difficulty and owner if assignee/reviewer not explicitly provided
    let finalAssigneeId = primaryAssigneeId;
    let finalReviewerId = reviewerId;

    const { data: client } = await supabase
      .from("clients")
      .select("owner_roster_id, difficulty")
      .eq("id", clientId)
      .maybeSingle();

    if (!finalAssigneeId && client?.owner_roster_id) {
      finalAssigneeId = client.owner_roster_id;
    }

    if (!finalReviewerId) {
      const routing = await determineDefaultReviewer({
        workspaceId,
        assigneeId: finalAssigneeId,
        clientDifficulty: client?.difficulty,
      });
      finalReviewerId = routing?.reviewerId || null;
    }

    const task = await createTask({
      workspaceId,
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
