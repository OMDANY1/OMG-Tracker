import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listClientCalendars, getContentCalendarDetails } from "@/lib/services/content-calendars";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const monthKey = searchParams.get("monthKey") || new Date().toISOString().substring(0, 7);
    const clientId = searchParams.get("clientId");

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

    // Resolve user's active membership & role
    const { data: membership } = await admin
      .from("workspace_memberships")
      .select("workspace_id, roster_person_id, role")
      .eq("user_id", authData.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "ليس لديك عضوية نشطة في مساحة العمل." }, { status: 403 });
    }

    const isOwner = membership.role === "owner";

    // If clientId is provided, return single calendar details
    if (clientId) {
      const details = await getContentCalendarDetails({
        workspaceId: membership.workspace_id,
        clientId,
        monthKey,
        userRosterId: membership.roster_person_id,
        isOwner,
      });

      return NextResponse.json({
        ...details,
        isOwner,
        userRosterId: membership.roster_person_id,
      });
    }

    // Otherwise return list of all client calendars for this month
    const clientCalendars = await listClientCalendars({
      workspaceId: membership.workspace_id,
      monthKey,
      userRosterId: membership.roster_person_id,
      isOwner,
    });

    return NextResponse.json({
      clientCalendars,
      monthKey,
      isOwner,
      workspaceId: membership.workspace_id,
      userRosterId: membership.roster_person_id,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
