import { NextRequest, NextResponse } from "next/server";
import {
  requireWorkspaceMembership,
  validateSameOrigin,
  isFullAdminRole,
  hasGranularPermission,
} from "@/lib/auth/server-auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { itemId: string } }
) {
  try {
    if (!validateSameOrigin(req)) {
      return NextResponse.json(
        { error: "طلب غير مصرح به (Same-Origin check failed)." },
        { status: 403 }
      );
    }

    const authRes = await requireWorkspaceMembership(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, admin } = authRes.data;

    if (
      !isFullAdminRole(membership.role) &&
      membership.role !== "manager" &&
      !hasGranularPermission(membership, "create_campaigns")
    ) {
      return NextResponse.json({ error: "تعديل البوستات مسموح فقط للمدير العام أو الشريك." }, { status: 403 });
    }

    const body = await req.json();
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (body.title !== undefined) updateData.title = body.title;
    if (body.post_number !== undefined) updateData.post_number = body.post_number;
    if (body.caption !== undefined) updateData.caption = body.caption;
    if (body.brief !== undefined) updateData.brief = body.brief;
    if (body.platform !== undefined) updateData.platform = body.platform;
    if (body.content_format !== undefined) updateData.content_format = body.content_format;
    if (body.publish_date !== undefined) updateData.publish_date = body.publish_date || null;
    if (body.design_due_date !== undefined) updateData.design_due_date = body.design_due_date || null;
    if (body.approved_assignee_id !== undefined) {
      if (body.approved_assignee_id) {
        const { data: assignee } = await admin
          .from("roster_people")
          .select("id, role")
          .eq("id", body.approved_assignee_id)
          .eq("workspace_id", membership.workspaceId)
          .neq("role", "viewer")
          .maybeSingle();

        if (!assignee) {
          return NextResponse.json(
            { error: "العضو المختار غير صالح في مساحة العمل." },
            { status: 400 }
          );
        }
        updateData.approved_assignee_id = body.approved_assignee_id;
      } else {
        updateData.approved_assignee_id = null;
      }
    }
    if (body.is_included !== undefined) updateData.is_included = body.is_included;
    if (body.post_order !== undefined) updateData.post_order = body.post_order;
    if (body.on_design_text !== undefined) updateData.on_design_text = body.on_design_text;
    if (body.onDesignText !== undefined) updateData.on_design_text = body.onDesignText;
    if (body.hook !== undefined) updateData.hook = body.hook;
    if (body.cta !== undefined) updateData.cta = body.cta;
    if (body.reel_script !== undefined) updateData.reel_script = body.reel_script;
    if (body.reelScript !== undefined) updateData.reel_script = body.reelScript;
    if (body.slides !== undefined) updateData.slides = body.slides;

    const { data: updatedItem, error: updateErr } = await admin
      .from("content_calendar_items")
      .update(updateData)
      .eq("id", params.itemId)
      .eq("workspace_id", membership.workspaceId)
      .select()
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, item: updatedItem });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { itemId: string } }
) {
  try {
    if (!validateSameOrigin(req)) {
      return NextResponse.json(
        { error: "طلب غير مصرح به (Same-Origin check failed)." },
        { status: 403 }
      );
    }

    const authRes = await requireWorkspaceMembership(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, admin } = authRes.data;

    if (
      !isFullAdminRole(membership.role) &&
      membership.role !== "manager" &&
      !hasGranularPermission(membership, "create_campaigns")
    ) {
      return NextResponse.json({ error: "حذف البوستات مسموح فقط للمدير العام أو الشريك." }, { status: 403 });
    }

    // Ensure item has not been imported as a task
    const { data: item } = await admin
      .from("content_calendar_items")
      .select("id, task_id")
      .eq("id", params.itemId)
      .eq("workspace_id", membership.workspaceId)
      .single();

    if (!item) {
      return NextResponse.json({ error: "العنصر غير موجود." }, { status: 404 });
    }

    if (item.task_id) {
      return NextResponse.json({ error: "لا يمكن حذف بوست تم إنشاء تاسك فعلية له مسبقاً." }, { status: 400 });
    }

    const { error: delErr } = await admin
      .from("content_calendar_items")
      .delete()
      .eq("id", params.itemId)
      .eq("workspace_id", membership.workspaceId);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
