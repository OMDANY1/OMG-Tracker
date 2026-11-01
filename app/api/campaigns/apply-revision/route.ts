import { NextRequest, NextResponse } from "next/server";
import {
  requireOwner,
  requireCampaignAccess,
  validateSameOrigin,
  canAccessClient,
} from "@/lib/auth/server-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (!validateSameOrigin(req)) {
      return NextResponse.json(
        { error: "طلب غير مصرح به (Same-Origin check failed)." },
        { status: 403 }
      );
    }

    const authRes = await requireCampaignAccess(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, admin } = authRes.data;

    const body = await req.json().catch(() => ({}));
    const { campaignId, applyMode = "sync_pending", idempotencyKey } = body;

    if (!campaignId) {
      return NextResponse.json(
        { error: "معرف الكامبين (campaignId) مطلوب لتطبيق التعديلات." },
        { status: 400 }
      );
    }

    const { data: camp } = await admin
      .from("campaigns")
      .select("id, client_id")
      .eq("id", campaignId)
      .eq("workspace_id", membership.workspaceId)
      .maybeSingle();

    if (!camp) {
      return NextResponse.json(
        { error: "سجل التقويم غير موجود في مساحة العمل." },
        { status: 404 }
      );
    }

    const inScope = await canAccessClient(admin, membership, camp.client_id);
    if (!inScope) {
      return NextResponse.json(
        { error: "غير مصرح: هذا العميل خارج نطاق الفريق أو العملاء المسندين إليك." },
        { status: 403 }
      );
    }

    const validModes = ["new_only", "sync_pending", "full_apply"];
    const mode = validModes.includes(applyMode) ? applyMode : "sync_pending";

    const finalKey = idempotencyKey || `apply-${campaignId}-${Date.now()}`;

    // Execute atomic safe apply RPC
    const { data, error } = await admin.rpc("apply_calendar_revision_tasks", {
      p_workspace_id: membership.workspaceId,
      p_campaign_id: campaignId,
      p_apply_mode: mode,
      p_idempotency_key: finalKey,
    });

    if (error) {
      console.error("Error in apply_calendar_revision_tasks:", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      result: data,
      message: `تم تطبيق التعديلات بنجاح: تم إنشاء ${data.tasks_created || 0} مهمة جديدة، ومزامنة ${data.tasks_updated || 0} مهمة، وحماية ${data.tasks_skipped_protected || 0} مهمة نشطة.`,
    });
  } catch (err: any) {
    console.error("Error in apply-revision:", err);
    return NextResponse.json(
      { error: err.message || "فشل تطبيق تعديلات التقويم." },
      { status: 500 }
    );
  }
}
