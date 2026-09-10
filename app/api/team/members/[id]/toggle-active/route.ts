import { NextRequest, NextResponse } from "next/server";
import { requireOwner, validateSameOrigin } from "@/lib/auth/server-auth";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!validateSameOrigin(req)) {
      return NextResponse.json({ error: "طلب غير مصرح به (Same-Origin check failed)." }, { status: 403 });
    }

    const authRes = await requireOwner(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, admin } = authRes.data;
    const rosterPersonId = params.id;

    if (!rosterPersonId) {
      return NextResponse.json({ error: "معرف العضو مطلوب." }, { status: 400 });
    }

    const body = await req.json();
    const { isActive } = body;

    if (typeof isActive !== "boolean") {
      return NextResponse.json({ error: "حالة التفعيل غير صالحة." }, { status: 400 });
    }

    // Call toggle_workspace_member_active RPC
    const { data: rpcResult, error: rpcErr } = await admin.rpc("toggle_workspace_member_active", {
      p_workspace_id: membership.workspaceId,
      p_roster_person_id: rosterPersonId,
      p_is_active: isActive,
    });

    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: isActive ? "تم تفعيل حساب العضو بنجاح." : "تم تعطيل حساب العضو بنجاح.",
      result: rpcResult,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
