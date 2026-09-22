import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/server-auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authRes = await requireOwner(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, admin } = authRes.data;
    const rosterPersonId = params.id;

    if (!rosterPersonId) {
      return NextResponse.json({ error: "معرف العضو مطلوب." }, { status: 400 });
    }

    // Call get_member_deactivation_impact RPC
    const { data: impact, error: rpcErr } = await admin.rpc("get_member_deactivation_impact", {
      p_workspace_id: membership.workspaceId,
      p_roster_person_id: rosterPersonId,
    });

    if (rpcErr) {
      return NextResponse.json(
        { error: rpcErr.message || "فشل احتساب تأثير تعطيل العضو." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      impact: impact || {
        open_tasks: [],
        open_tasks_count: 0,
        assigned_clients: [],
        assigned_clients_count: 0,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "حدث خطأ غير متوقع." }, { status: 500 });
  }
}
