import { NextRequest, NextResponse } from "next/server";
import { requireOwner, validateSameOrigin } from "@/lib/auth/server-auth";
import type { RosterRole } from "@/types/database";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
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

    const { membership, admin } = authRes.data;
    const body = await req.json();
    const { displayName, jobTitle, specialties, role } = body;

    if (!displayName || typeof displayName !== "string" || !displayName.trim()) {
      return NextResponse.json(
        { error: "اسم العضو مطلوب ولا يمكن أن يكون فارغاً." },
        { status: 400 }
      );
    }

    if (!jobTitle || typeof jobTitle !== "string" || !jobTitle.trim()) {
      return NextResponse.json(
        { error: "المسمى الوظيفي مطلوب." },
        { status: 400 }
      );
    }

    const validSpecialties = Array.isArray(specialties)
      ? specialties.filter((s) => typeof s === "string" && s.trim())
      : [];

    const validRole: RosterRole = role || "designer";

    // Call admin_create_roster_person RPC
    const { data: result, error: rpcErr } = await admin.rpc("admin_create_roster_person", {
      p_workspace_id: membership.workspaceId,
      p_display_name: displayName.trim(),
      p_job_title: jobTitle.trim(),
      p_specialties: validSpecialties,
      p_role: validRole,
    });

    if (rpcErr) {
      return NextResponse.json(
        { error: rpcErr.message || "فشل إضافة العضو إلى قائمة الفريق." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `تم إضافة العضو (${displayName.trim()}) بنجاح إلى الفريق.`,
      member: result,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "حدث خطأ غير متوقع." }, { status: 500 });
  }
}
