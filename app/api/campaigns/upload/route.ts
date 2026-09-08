import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadContentCalendar } from "@/lib/services/content-calendars";

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
        { error: "صلاحية غير كافية: رفع تقويم المحتوى مسموح فقط للمدير العام (Owner)." },
        { status: 403 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const clientId = formData.get("clientId") as string | null;
    const monthKey = formData.get("monthKey") as string | null;

    if (!file || !clientId || !monthKey) {
      return NextResponse.json(
        { error: "الملف والعميل والشهر مطلوبون لإتمام عملية الرفع." },
        { status: 400 }
      );
    }

    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      return NextResponse.json(
        { error: "تنسيق الشهر غير صالح. يرجى استخدام تنسيق YYYY-MM." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const result = await uploadContentCalendar({
      workspaceId: membership.workspace_id,
      clientId,
      monthKey,
      fileName: file.name,
      fileBuffer: buffer,
      uploaderRosterId: membership.roster_person_id,
    });

    return NextResponse.json({
      success: true,
      campaign: result.campaign,
      itemsCount: result.items.length,
      items: result.items,
      previewUrl: result.previewUrl,
      isScannedOrNoText: result.extraction.isScannedOrNoText,
      warning: result.extraction.error || null,
      message: result.extraction.isScannedOrNoText
        ? "تم حفظ الملف ولكن تعذر استخراج نصوص كافية (الملف ممسوح ضوئياً). يمكنك إدخال البوستات يدوياً."
        : `تم رفع ومعالجة التقويم واستخراج ${result.items.length} بوست بنجاح!`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
