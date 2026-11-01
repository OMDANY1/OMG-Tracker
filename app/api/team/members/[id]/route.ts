import { NextRequest, NextResponse } from "next/server";
import { requireOwner, validateSameOrigin } from "@/lib/auth/server-auth";
import {
  resolveEffectiveAccessScope,
  resolveEffectivePermissions,
  resolvePermissionDetails,
  sanitizeCustomPermissionsForRole,
} from "@/lib/auth/permissions";
import type { RosterRole } from "@/types/database";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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
    const rosterPersonId = params.id;

    if (!rosterPersonId) {
      return NextResponse.json({ error: "معرف العضو مطلوب." }, { status: 400 });
    }

    const body = await req.json();
    const { jobTitle, specialties, role, accessScope, customPermissions, displayName } = body;

    if (!jobTitle || typeof jobTitle !== "string" || !jobTitle.trim()) {
      return NextResponse.json({ error: "المسمى الوظيفي مطلوب." }, { status: 400 });
    }

    const validSpecialties = Array.isArray(specialties)
      ? specialties.filter((s) => typeof s === "string" && s.trim())
      : [];

    const validRole: RosterRole = role || "designer";

    // Prevent self-role downgrade or self-permission alteration
    if (membership.rosterPersonId === rosterPersonId && validRole !== membership.role) {
      return NextResponse.json(
        { error: "غير مسموح: لا يمكن للعضو تغيير دوره الأمني الخاص بنفسه." },
        { status: 400 }
      );
    }

    const sanitizedScope = resolveEffectiveAccessScope(validRole, accessScope);
    const sanitizedPermissions = sanitizeCustomPermissionsForRole(
      validRole,
      customPermissions
    );

    // Call admin_update_roster_person RPC with authenticated serverClient
    const { data: result, error: rpcErr } = await serverClient.rpc("admin_update_roster_person", {
      p_workspace_id: membership.workspaceId,
      p_roster_person_id: rosterPersonId,
      p_job_title: jobTitle.trim(),
      p_specialties: validSpecialties,
      p_role: validRole,
      p_access_scope: sanitizedScope,
      p_custom_permissions: sanitizedPermissions,
      p_display_name: typeof displayName === "string" && displayName.trim() ? displayName.trim() : null,
    });

    if (rpcErr) {
      return NextResponse.json(
        { error: rpcErr.message || "فشل تحديث بيانات العضو." },
        { status: 400 }
      );
    }

    const effectivePermissions = resolveEffectivePermissions(validRole, sanitizedPermissions);
    const permissionDetails = resolvePermissionDetails(validRole, sanitizedPermissions);

    return NextResponse.json({
      success: true,
      message: "تم تحديث بيانات وصلاحيات العضو بنجاح.",
      member: {
        ...(result || {}),
        id: rosterPersonId,
        role: validRole,
        access_scope: sanitizedScope,
        accessScope: sanitizedScope,
        custom_permissions: effectivePermissions,
        customPermissions: effectivePermissions,
        effectivePermissions,
        permissionDetails,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "حدث خطأ غير متوقع." }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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
    const rosterPersonId = params.id;

    if (!rosterPersonId) {
      return NextResponse.json({ error: "معرف العضو مطلوب." }, { status: 400 });
    }

    let reassignToRosterId: string | null = null;
    try {
      const body = await req.json().catch(() => null);
      if (body?.reassignToRosterId) {
        reassignToRosterId = body.reassignToRosterId;
      }
    } catch {}

    const { data: result, error: rpcErr } = await serverClient.rpc("admin_hard_delete_roster_member", {
      p_workspace_id: membership.workspaceId,
      p_roster_person_id: rosterPersonId,
      p_reassign_to_roster_id: reassignToRosterId || null,
    });

    if (rpcErr) {
      return NextResponse.json(
        { error: rpcErr.message || "فشل حذف العضو نهائياً." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "تم حذف العضو نهائياً من مساحة العمل بنجاح.",
      result,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع أثناء حذف العضو." },
      { status: 500 }
    );
  }
}
