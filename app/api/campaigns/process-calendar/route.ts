import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processCalendarCampaign } from "@/lib/services/content-calendars";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

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

    // Check membership & verify Owner
    const { data: membership } = await admin
      .from("workspace_memberships")
      .select("workspace_id, roster_person_id, role")
      .eq("user_id", authData.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!membership || membership.role !== "owner") {
      return NextResponse.json(
        { error: "صلاحية غير كافية: معالجة تقويم المحتوى مسموح فقط للمدير العام (Owner)." },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { campaignId, forceRefresh } = body;

    if (!campaignId) {
      return NextResponse.json(
        { error: "معرف الكامبين (campaignId) مطلوب لبدء المعالجة." },
        { status: 400 }
      );
    }

    const result = await processCalendarCampaign({
      workspaceId: membership.workspace_id,
      campaignId,
      forceRefresh: Boolean(forceRefresh),
    });

    return NextResponse.json({
      success: true,
      campaignId: result.campaign.id,
      campaign: result.campaign,
      itemsCount: result.items.length,
      detectedPostCount: result.reconciled.detected_post_count,
      declaredPostCount: result.reconciled.declared_post_count,
      confidence: result.reconciled.overall_confidence,
      items: result.items,
      warnings: result.reconciled.warnings,
      message: `تمت معالجة التقويم بنجاح واستخراج ${result.reconciled.detected_post_count} بوست بدقة ${(result.reconciled.overall_confidence * 100).toFixed(0)}%!`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
