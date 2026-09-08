import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  try {
    const serverClient = await createServerSupabaseClient().catch(() => null);
    if (!serverClient) {
      return NextResponse.json({ notifications: [], unreadCount: 0 });
    }

    const { data: authData, error: authErr } = await serverClient.auth.getUser();
    if (authErr || !authData?.user) {
      return NextResponse.json({ notifications: [], unreadCount: 0 });
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ notifications: [], unreadCount: 0 });
    }

    const { data: membership } = await admin
      .from("workspace_memberships")
      .select("workspace_id, roster_person_id")
      .eq("user_id", authData.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ notifications: [], unreadCount: 0 });
    }

    // Fetch notifications using serverClient (RLS will automatically filter by recipient_roster_id)
    const { data: notifications, error } = await serverClient
      .from("in_app_notifications")
      .select(`
        id,
        title,
        message,
        task_id,
        action_url,
        notification_type,
        is_read,
        created_at,
        actor:roster_people!fk_notif_actor(id, display_name)
      `)
      .eq("workspace_id", membership.workspace_id)
      .eq("recipient_roster_id", membership.roster_person_id)
      .order("created_at", { ascending: false })
      .limit(25);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const unreadCount = (notifications || []).filter((n) => !n.is_read).length;

    return NextResponse.json({
      notifications: notifications || [],
      unreadCount,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
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
      .select("workspace_id, roster_person_id")
      .eq("user_id", authData.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "عضوية غير موجودة." }, { status: 403 });
    }

    const body = await req.json();
    const { notificationId, markAllAsRead } = body;

    if (markAllAsRead) {
      const { error } = await serverClient
        .from("in_app_notifications")
        .update({ is_read: true })
        .eq("workspace_id", membership.workspace_id)
        .eq("recipient_roster_id", membership.roster_person_id)
        .eq("is_read", false);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ success: true, message: "تم تحديد جميع الإشعارات كمقروءة." });
    }

    if (notificationId) {
      const { error } = await serverClient
        .from("in_app_notifications")
        .update({ is_read: true })
        .eq("id", notificationId)
        .eq("recipient_roster_id", membership.roster_person_id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "معرف الإشعار مطلوب." }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
