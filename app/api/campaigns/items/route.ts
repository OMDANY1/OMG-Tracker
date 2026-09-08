import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
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
      return NextResponse.json({ error: "إضافة البوستات مسموحة فقط للمدير العام." }, { status: 403 });
    }

    const body = await req.json();
    const {
      campaignId,
      clientId,
      postNumber,
      title,
      brief,
      caption,
      platform,
      contentFormat,
      designDueDate,
      suggestedAssigneeId,
    } = body;

    if (!campaignId || !clientId || !title) {
      return NextResponse.json({ error: "البيانات الأساسية للبوست مطلوبة." }, { status: 400 });
    }

    // Get current max post_order for this campaign
    const { data: existingItems } = await admin
      .from("content_calendar_items")
      .select("post_order")
      .eq("campaign_id", campaignId)
      .order("post_order", { ascending: false })
      .limit(1);

    const nextOrder = existingItems && existingItems.length > 0 ? existingItems[0].post_order + 1 : 1;
    const finalPostNumber = postNumber || `Post ${String(nextOrder).padStart(2, "0")}`;

    const { data: newItem, error: insertErr } = await admin
      .from("content_calendar_items")
      .insert({
        workspace_id: membership.workspace_id,
        campaign_id: campaignId,
        client_id: clientId,
        post_order: nextOrder,
        post_number: finalPostNumber,
        title,
        brief: brief || null,
        caption: caption || null,
        platform: platform || "Instagram",
        content_format: contentFormat || "Static",
        design_due_date: designDueDate || null,
        suggested_assignee_id: suggestedAssigneeId || null,
        approved_assignee_id: suggestedAssigneeId || null,
        is_included: true,
      })
      .select()
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, item: newItem });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
