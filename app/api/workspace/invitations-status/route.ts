import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMembership, requireOwner, validateSameOrigin } from "@/lib/auth/server-auth";

export async function GET(req: NextRequest) {
  try {
    const authRes = await requireWorkspaceMembership(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, admin } = authRes.data;

    const { data: ws, error } = await admin
      .from("workspaces")
      .select("id, allow_invitation_emails, allow_invitation_acceptance, invitations_paused")
      .eq("id", membership.workspaceId)
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
    if (!validateSameOrigin(req)) {
      return NextResponse.json(
        { error: "طلب غير مصرح به (Same-Origin check failed)." },
        { status: 403 }
      );
    }

    const authRes = await requireOwner(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, serverClient } = authRes.data;
    const body = await req.json();
    const { allowEmails, allowAcceptance, paused } = body;

    // Determine target states supporting both new independent flags and legacy paused toggle
    let targetAcceptance = true;
    if (typeof allowAcceptance === "boolean") {
      targetAcceptance = allowAcceptance;
    } else if (typeof paused === "boolean") {
      targetAcceptance = !paused;
    }

    const targetEmails = typeof allowEmails === "boolean" ? allowEmails : false;

    // Call secure set_workspace_invitation_settings RPC with caller context
    const { error } = await serverClient.rpc("set_workspace_invitation_settings", {
      p_workspace_id: membership.workspaceId,
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
