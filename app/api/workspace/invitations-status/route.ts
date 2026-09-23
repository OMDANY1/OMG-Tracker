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
      .select("id, allow_invitation_emails, allow_invitation_acceptance, invitations_paused")
      .limit(1)
      .single();

    if (error || !ws) {
      return NextResponse.json({ error: "لم يتم العثور على مساحة العمل." }, { status: 404 });
    }

    return NextResponse.json({
      workspaceId: ws.id,
      allowInvitationEmails: ws.allow_invitation_emails ?? false,
      allowInvitationAcceptance: ws.allow_invitation_acceptance ?? true,
      invitationsPaused: ws.invitations_paused ?? false,
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
    const { workspaceId, allowEmails, allowAcceptance, paused } = body;

    if (!workspaceId) {
      return NextResponse.json({ error: "معرف مساحة العمل مطلوب." }, { status: 400 });
    }

    // Determine target states supporting both new independent flags and legacy paused toggle
    let targetAcceptance = true;
    if (typeof allowAcceptance === "boolean") {
      targetAcceptance = allowAcceptance;
    } else if (typeof paused === "boolean") {
      targetAcceptance = !paused;
    }

    const targetEmails = typeof allowEmails === "boolean" ? allowEmails : false;

    // Call secure set_workspace_invitation_settings RPC with caller context (replaces legacy set_workspace_invitations_paused)
    const { data, error } = await serverClient.rpc("set_workspace_invitation_settings", {
      p_workspace_id: workspaceId,
      p_allow_emails: targetEmails,
      p_allow_acceptance: targetAcceptance,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      allowInvitationEmails: targetEmails,
      allowInvitationAcceptance: targetAcceptance,
      invitationsPaused: !targetAcceptance,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
