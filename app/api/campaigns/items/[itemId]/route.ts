import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { itemId: string } }
) {
  try {
    const serverClient = await createServerSupabaseClient().catch(() => null);
    if (!serverClient) {
      return NextResponse.json({ error: "جلسة المستخدم غير متوفرة." }, { status: 401 });
    }

    const { data: authData, error: authErr } = await serverClient.auth.getUser();
    if (authErr || !authData?.user) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أولاً." }, { status: 401 });
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "تعذر الاتصال بقاعدة البيانات." }, { status: 500 });
    }

    const { data: membership } = await admin
      .from("workspace_memberships")
      .select("workspace_id, role")
      .eq("user_id", authData.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!membership || membership.role !== "owner") {
      return NextResponse.json({ error: "تعديل البوستات مسموح فقط للمدير العام." }, { status: 403 });
    }

    const body = await req.json();
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (body.title !== undefined) updateData.title = body.title;
    if (body.post_number !== undefined) updateData.post_number = body.post_number;
    if (body.caption !== undefined) updateData.caption = body.caption;
    if (body.brief !== undefined) updateData.brief = body.brief;
    if (body.platform !== undefined) updateData.platform = body.platform;
    if (body.content_format !== undefined) updateData.content_format = body.content_format;
    if (body.publish_date !== undefined) updateData.publish_date = body.publish_date || null;
    if (body.design_due_date !== undefined) updateData.design_due_date = body.design_due_date || null;
    if (body.approved_assignee_id !== undefined) updateData.approved_assignee_id = body.approved_assignee_id || null;
    if (body.is_included !== undefined) updateData.is_included = body.is_included;
    if (body.post_order !== undefined) updateData.post_order = body.post_order;

    const { data: updatedItem, error: updateErr } = await admin
      .from("content_calendar_items")
      .update(updateData)
      .eq("id", params.itemId)
      .eq("workspace_id", membership.workspace_id)
      .select()
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, item: updatedItem });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { itemId: string } }
) {
  try {
    const serverClient = await createServerSupabaseClient().catch(() => null);
    if (!serverClient) {
      return NextResponse.json({ error: "جلسة المستخدم غير متوفرة." }, { status: 401 });
    }

    const { data: authData, error: authErr } = await serverClient.auth.getUser();
    if (authErr || !authData?.user) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أولاً." }, { status: 401 });
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "تعذر الاتصال بقاعدة البيانات." }, { status: 500 });
    }

    const { data: membership } = await admin
      .from("workspace_memberships")
      .select("workspace_id, role")
      .eq("user_id", authData.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!membership || membership.role !== "owner") {
      return NextResponse.json({ error: "حذف البوستات مسموح فقط للمدير العام." }, { status: 403 });
    }

    // Ensure item has not been imported as a task
    const { data: item } = await admin
      .from("content_calendar_items")
      .select("id, task_id")
      .eq("id", params.itemId)
      .eq("workspace_id", membership.workspace_id)
      .single();

    if (!item) {
      return NextResponse.json({ error: "العنصر غير موجود." }, { status: 404 });
    }

    if (item.task_id) {
      return NextResponse.json({ error: "لا يمكن حذف بوست تم إنشاء تاسك فعلية له مسبقاً." }, { status: 400 });
    }

    const { error: delErr } = await admin
      .from("content_calendar_items")
      .delete()
      .eq("id", params.itemId);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
