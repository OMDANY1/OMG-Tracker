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

    const { membership, admin, serverClient } = authRes.data;
    const workspaceId = membership.workspaceId;

    if (
      !isFullAdminRole(membership.role) &&
      membership.role !== "manager" &&
      !hasGranularPermission(membership, "create_campaigns")
    ) {
      return NextResponse.json(
        { error: "اعتماد واستيراد التاسكات مسموح فقط للمدير العام أو الشريك." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { campaignId, idempotencyKey, items } = body;

    if (!campaignId || !items || !Array.isArray(items)) {
      return NextResponse.json({ error: "بيانات غير مكتملة لاعتماد واستيراد التاسكات." }, { status: 400 });
    }

    // Fetch assignable active executor roster members in workspace (including pre-onboarding members)
    const { data: activeRoster } = await admin
      .from("roster_people")
      .select("id, role")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true);

    const activeRosterIds = new Set(
      (activeRoster || [])
        .filter((r) => r.role !== "business_owner_viewer" && r.role !== "marketing_director" && (r.role as string) !== "viewer")
        .map((r) => r.id)
    );

    // Fetch campaign and client to resolve default designer & video editor
    const { data: campaign } = await admin
      .from("campaigns")
      .select("id, client_id, client:clients(id, owner_roster_id, team_assignment:client_team_assignments(*))")
      .eq("id", campaignId)
      .eq("workspace_id", workspaceId)
      .single();

    if (!campaign) {
      return NextResponse.json({ error: "سجل التقويم غير موجود في مساحة العمل." }, { status: 404 });
    }

    const rawTeam = (campaign?.client as any)?.team_assignment;
    const team = Array.isArray(rawTeam) ? rawTeam[0] : rawTeam;
    const clientDefaultDesignerId =
      team?.primary_designer_id || (campaign?.client as any)?.owner_roster_id || null;
    const clientDefaultVideoEditorId =
      team?.primary_video_editor_id || clientDefaultDesignerId;

    // Validate each operational included item
    const operationalItems = items.filter(
      (i: any) => i.is_included !== false && !i.is_excluded_from_tasks
    );

    if (operationalItems.length === 0) {
      return NextResponse.json(
        { error: "يرجى اختيار بوست تشغيلي واحد على الأقل للاعتماد وإنشاء التاسك." },
        { status: 400 }
      );
    }

    const normalizedItems = items.map((item: any) => {
      const isVideo = /reel|video|motion/i.test(String(item.content_format || ""));
      const fallbackAssignee = isVideo ? clientDefaultVideoEditorId : clientDefaultDesignerId;
      const targetAssigneeId =
        item.approved_assignee_id || item.suggested_assignee_id || fallbackAssignee;
      return {
        ...item,
        approved_assignee_id: targetAssigneeId,
        suggested_assignee_id: item.suggested_assignee_id || fallbackAssignee,
      };
    });

    for (const item of normalizedItems) {
      if (item.is_included === false || item.is_excluded_from_tasks) continue;
      const targetAssigneeId = item.approved_assignee_id;
      const postLabel = item.post_number || "غير محدد";

      if (!targetAssigneeId) {
        return NextResponse.json(
          { error: `يجب تحديد عضو فريق صالح للبوست (${postLabel}) قبل المتابعة.` },
          { status: 400 }
        );
      }

      if (!activeRosterIds.has(targetAssigneeId)) {
        return NextResponse.json(
          { error: `العضو المحدد للبوست (${postLabel}) غير صالح أو غير نشط في مساحة العمل.` },
          { status: 400 }
        );
      }
    }

    const finalKey =
      (idempotencyKey && idempotencyKey.trim()) || `import-calendar-${campaignId}`;

    // Call secure atomic RPC
    const { data, error } = await serverClient.rpc("import_content_calendar_tasks", {
      p_workspace_id: workspaceId,
      p_campaign_id: campaignId,
      p_idempotency_key: finalKey,
      p_items: normalizedItems,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      result: data,
      message: `تم اعتماد التقويم وإنشاء ${data?.tasks_created || 0} تاسك بنجاح!`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
