import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMembership, validateSameOrigin } from "@/lib/auth/server-auth";
import { createManualContentCalendar } from "@/lib/services/content-calendars";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!validateSameOrigin(req)) {
    return NextResponse.json(
      { error: "رفض الطلب: انتهاك التحقق من مصدر الطلب (CSRF/Same-Origin)." },
      { status: 403 }
    );
  }

  const authRes = await requireWorkspaceMembership(req);
  if (!authRes.success) return authRes.errorResponse;

  const { membership } = authRes.data;
  try {
    const body = await req.json();
    const { clientId, monthKey } = body;

    if (!clientId || !monthKey) {
      return NextResponse.json(
        { error: "العميل والشهر مطلوبان لإنشاء خطة المحتوى." },
        { status: 400 }
      );
    }

    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      return NextResponse.json(
        { error: "تنسيق الشهر غير صالح. يرجى استخدام تنسيق YYYY-MM." },
        { status: 400 }
      );
    }

    const campaign = await createManualContentCalendar({
      workspaceId: membership.workspaceId,
      clientId,
      monthKey,
      creatorRosterId: membership.rosterPersonId,
    });

    return NextResponse.json({
      success: true,
      campaign,
      message: "تم إنشاء مسودة خطة المحتوى بنجاح.",
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "فشل إنشاء خطة المحتوى" }, { status: 500 });
  }
}
