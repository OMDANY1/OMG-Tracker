import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "تعذر الاتصال بقاعدة البيانات." }, { status: 500 });
    }

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
    const { id: taskId } = await params;
    const body = await req.json();
    const { content, commentType = "general", mentions = [] } = body;

    if (!content || !content.trim()) {
      return NextResponse.json({ error: "نص التعليق مطلوب." }, { status: 400 });
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "تعذر الاتصال بقاعدة البيانات." }, { status: 500 });
    }

    // Get task to retrieve workspace_id
    const { data: task, error: taskErr } = await admin
      .from("tasks")
      .select("id, workspace_id")
      .eq("id", taskId)
      .single();

    if (taskErr || !task) {
      return NextResponse.json({ error: "المهمة غير موجودة." }, { status: 404 });
    }

    // Determine caller roster person
    const serverClient = await createServerSupabaseClient().catch(() => null);
    let authorRosterId: string | null = null;

    if (serverClient) {
      const { data: authData } = await serverClient.auth.getUser();
      if (authData?.user) {
        const { data: member } = await admin
          .from("workspace_memberships")
          .select("roster_person_id")
          .eq("workspace_id", task.workspace_id)
          .eq("user_id", authData.user.id)
          .maybeSingle();

        if (member?.roster_person_id) {
          authorRosterId = member.roster_person_id;
        }
      }
    }

    // Fallback to Owner roster person if auth user not linked yet
    if (!authorRosterId) {
      const { data: owner } = await admin
        .from("workspace_memberships")
        .select("roster_person_id")
        .eq("workspace_id", task.workspace_id)
        .eq("role", "owner")
        .maybeSingle();

      authorRosterId = owner?.roster_person_id || null;
    }

    if (!authorRosterId) {
      return NextResponse.json({ error: "تعذر تحديد هوية كاتب التعليق في الفريق." }, { status: 403 });
    }

    const { data: inserted, error: insertErr } = await admin
      .from("comments")
      .insert({
        workspace_id: task.workspace_id,
        task_id: taskId,
        author_roster_id: authorRosterId,
        content: content.trim(),
        comment_type: commentType,
        mentions: Array.isArray(mentions) ? mentions : [],
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
    const { id: taskId } = await params;
    const body = await req.json();
    const { commentId, isResolved } = body;

    if (!commentId || typeof isResolved !== "boolean") {
      return NextResponse.json({ error: "بيانات غير صالحة لتحديث حالة التعليق." }, { status: 400 });
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "تعذر الاتصال بقاعدة البيانات." }, { status: 500 });
    }

    // Determine resolver roster ID
    const serverClient = await createServerSupabaseClient().catch(() => null);
    let resolverRosterId: string | null = null;

    if (serverClient) {
      const { data: authData } = await serverClient.auth.getUser();
      if (authData?.user) {
        const { data: member } = await admin
          .from("workspace_memberships")
          .select("roster_person_id")
          .eq("user_id", authData.user.id)
          .maybeSingle();

        resolverRosterId = member?.roster_person_id || null;
      }
    }

    const updatePayload: any = {
      is_resolved: isResolved,
      resolved_at: isResolved ? new Date().toISOString() : null,
      resolved_by_roster_id: isResolved ? resolverRosterId : null,
    };

    const { data: updated, error } = await admin
      .from("comments")
      .update(updatePayload)
      .eq("id", commentId)
      .eq("task_id", taskId)
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

    return NextResponse.json({ success: true, comment: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
