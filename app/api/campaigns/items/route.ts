import { NextRequest, NextResponse } from "next/server";
import {
  requireWorkspaceMembership,
  validateSameOrigin,
  isFullAdminRole,
  hasGranularPermission,
} from "@/lib/auth/server-auth";

export async function POST(req: NextRequest) {
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
      return NextResponse.json({ error: "إضافة البوستات مسموحة فقط للمدير العام أو الشريك." }, { status: 403 });
    }

    const body = await req.json();
    const {
      campaignId,
      clientId,
      postNumber,
      title,
      brief,
      caption,
      platform,
      contentFormat,
      designDueDate,
      suggestedAssigneeId,
      hook,
      on_design_text,
      onDesignText,
      cta,
      reel_script,
      reelScript,
      slides,
    } = body;

    if (!campaignId || !clientId || !title) {
      return NextResponse.json({ error: "البيانات الأساسية للبوست مطلوبة." }, { status: 400 });
    }

    if (suggestedAssigneeId) {
      const { data: assignee } = await admin
        .from("roster_people")
        .select("id, is_active")
        .eq("id", suggestedAssigneeId)
        .eq("workspace_id", membership.workspaceId)
        .maybeSingle();

      if (!assignee || !assignee.is_active) {
        return NextResponse.json(
          { error: "العضو المختار غير صالح أو غير نشط في مساحة العمل." },
          { status: 400 }
        );
      }
    }

    // Get current max post_order for this campaign
    const { data: existingItems } = await admin
      .from("content_calendar_items")
      .select("post_order")
      .eq("campaign_id", campaignId)
      .eq("workspace_id", membership.workspaceId)
      .order("post_order", { ascending: false })
      .limit(1);

    const nextOrder = existingItems && existingItems.length > 0 ? existingItems[0].post_order + 1 : 1;
    const finalPostNumber = postNumber || `Post ${String(nextOrder).padStart(2, "0")}`;

    const { data: newItem, error: insertErr } = await admin
      .from("content_calendar_items")
      .insert({
        workspace_id: membership.workspaceId,
        campaign_id: campaignId,
        client_id: clientId,
        post_order: nextOrder,
        post_number: finalPostNumber,
        title,
        brief: brief || null,
        caption: caption || null,
        platform: platform || "Instagram",
        content_format: contentFormat || "Static",
        design_due_date: designDueDate || null,
        suggested_assignee_id: suggestedAssigneeId || null,
        approved_assignee_id: suggestedAssigneeId || null,
        hook: hook || null,
        on_design_text: on_design_text || onDesignText || null,
        cta: cta || null,
        reel_script: reel_script || reelScript || null,
        slides: slides && Array.isArray(slides) ? slides : [],
        is_included: true,
      })
      .select()
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, item: newItem });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
