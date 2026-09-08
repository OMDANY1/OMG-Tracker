import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  try {
    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "تعذر الاتصال بقاعدة البيانات." }, { status: 500 });
    }

    const { data: ws, error } = await admin
      .from("workspaces")
      .select("id, invitations_paused")
      .limit(1)
      .single();

    if (error || !ws) {
      return NextResponse.json({ error: "لم يتم العثور على مساحة العمل." }, { status: 404 });
    }

    return NextResponse.json({
      workspaceId: ws.id,
      invitationsPaused: ws.invitations_paused,
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

    const body = await req.json();
    const { workspaceId, paused } = body;

    if (!workspaceId || typeof paused !== "boolean") {
      return NextResponse.json({ error: "بيانات غير صالحة." }, { status: 400 });
    }

    // Call secure set_workspace_invitations_paused RPC with caller context
    const { data, error } = await serverClient.rpc("set_workspace_invitations_paused", {
      p_workspace_id: workspaceId,
      p_paused: paused,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    return NextResponse.json({ success: true, invitationsPaused: paused });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
