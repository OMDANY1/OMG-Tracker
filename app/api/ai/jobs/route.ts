import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AiJobQueue } from "@/lib/services/ai-job-queue";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
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
      return NextResponse.json(
        { error: "غير مصرح: لوحة استهلاك الذكاء الاصطناعي متاحة فقط للمدير العام (Owner)." },
        { status: 403 }
      );
    }

    const metrics = await AiJobQueue.getAiUsageMetrics(membership.workspace_id);

    return NextResponse.json({
      success: true,
      metrics,
    });
  } catch (err: any) {
    console.error("Error in /api/ai/jobs:", err.message);
    return NextResponse.json({ error: err.message || "Failed to load AI metrics" }, { status: 500 });
  }
}
