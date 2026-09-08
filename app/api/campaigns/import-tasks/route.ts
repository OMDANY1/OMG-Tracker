import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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
