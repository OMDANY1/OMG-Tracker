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

    const body = await req.json();
    const { workspaceId, campaignId, idempotencyKey, items } = body;

    if (!workspaceId || !campaignId || !items || !Array.isArray(items)) {
      return NextResponse.json({ error: "بيانات غير مكتملة لاعتماد واستيراد التاسكات." }, { status: 400 });
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "تعذر الاتصال بقاعدة البيانات." }, { status: 500 });
    }

    // Verify caller has owner role in the workspace
    const { data: membership } = await admin
      .from("workspace_memberships")
      .select("workspace_id, role")
      .eq("user_id", authData.user.id)
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .maybeSingle();

    if (!membership || membership.role !== "owner") {
      return NextResponse.json({ error: "اعتماد واستيراد التاسكات مسموح فقط للمدير العام." }, { status: 403 });
    }

    // Fetch active roster members in workspace
    const { data: activeRoster } = await admin
      .from("roster_people")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true);

    const activeRosterIds = new Set((activeRoster || []).map((r) => r.id));

    // Fetch campaign and client to resolve default designer
    const { data: campaign } = await admin
      .from("campaigns")
      .select("id, client_id, client:clients(id, owner_roster_id)")
      .eq("id", campaignId)
      .eq("workspace_id", workspaceId)
      .single();

    const clientDefaultDesignerId = (campaign?.client as any)?.owner_roster_id || null;

    // Validate each operational included item
    const operationalItems = items.filter(
      (i: any) => i.is_included !== false && !i.is_excluded_from_tasks
    );

    if (operationalItems.length === 0) {
      return NextResponse.json(
        { error: "يرجى اختيار بوست تشغيلي واحد على الأقل للاعتماد وإنشاء التاسك." },
        { status: 400 }
      );
    }

    for (const item of operationalItems) {
      const targetAssigneeId = item.approved_assignee_id || item.suggested_assignee_id || clientDefaultDesignerId;
      const postLabel = item.post_number || "غير محدد";

      if (!targetAssigneeId) {
        return NextResponse.json(
          { error: `يجب تحديد مصمم صالح للبوست (${postLabel}) قبل المتابعة.` },
          { status: 400 }
        );
      }

      if (!activeRosterIds.has(targetAssigneeId)) {
        return NextResponse.json(
          { error: `المصمم المحدد للبوست (${postLabel}) غير صالح أو غير نشط في مساحة العمل.` },
          { status: 400 }
        );
      }
    }

    const finalKey = (idempotencyKey && idempotencyKey.trim()) || `import-${campaignId}-${Date.now()}`;

    // Call secure atomic RPC
    const { data, error } = await serverClient.rpc("import_content_calendar_tasks", {
      p_workspace_id: workspaceId,
      p_campaign_id: campaignId,
      p_idempotency_key: finalKey,
      p_items: items,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      result: data,
      message: `تم اعتماد التقويم وإنشاء ${data?.tasks_created || 0} تاسك بنجاح!`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
