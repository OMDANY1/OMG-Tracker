import { NextRequest, NextResponse } from "next/server";
import { requireOwner, requireCampaignAccess, canAccessClient } from "@/lib/auth/server-auth";
import { AiJobQueue } from "@/lib/services/ai-job-queue";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId");
    const campaignId = searchParams.get("campaignId");

    if (jobId || campaignId) {
      const authResult = await requireCampaignAccess(req);
      if (!authResult.success) {
        return authResult.errorResponse;
      }

      const { membership, admin } = authResult.data;

      if (jobId) {
        const job = await AiJobQueue.getJobStatus(jobId, membership.workspaceId);
        if (!job) {
          return NextResponse.json({ error: "مهمة المعالجة غير موجودة." }, { status: 404 });
        }
        if (job.client_id) {
          const inScope = await canAccessClient(admin, membership, job.client_id);
          if (!inScope) {
            return NextResponse.json(
              { error: "غير مصرح: مهمة المعالجة تخص عميلاً خارج نطاق صلاحياتك." },
              { status: 403 }
            );
          }
        }
        return NextResponse.json({ success: true, job });
      }

      if (campaignId) {
        const { data: camp } = await admin
          .from("campaigns")
          .select("id, client_id")
          .eq("id", campaignId)
          .eq("workspace_id", membership.workspaceId)
          .maybeSingle();

        if (!camp) {
          return NextResponse.json({ error: "سجل الكامبين غير موجود." }, { status: 404 });
        }

        const inScope = await canAccessClient(admin, membership, camp.client_id);
        if (!inScope) {
          return NextResponse.json(
            { error: "غير مصرح: هذا العميل خارج نطاق صلاحياتك." },
            { status: 403 }
          );
        }

        const { data: campaignJobs } = await admin
          .from("ai_processing_jobs")
          .select("*")
          .eq("campaign_id", campaignId)
          .eq("workspace_id", membership.workspaceId)
          .order("created_at", { ascending: false });

        return NextResponse.json({ success: true, jobs: campaignJobs || [] });
      }
    }

    // Global workspace AI metrics require Owner / Company Owner
    const authResult = await requireOwner(req);
    if (!authResult.success) {
      return authResult.errorResponse;
    }

    const { membership } = authResult.data;
    const metrics = await AiJobQueue.getAiUsageMetrics(membership.workspaceId);

    return NextResponse.json({
      success: true,
      metrics,
    });
  } catch (err: any) {
    console.error("Error in /api/ai/jobs:", err.message);
    return NextResponse.json({ error: err.message || "Failed to load AI metrics" }, { status: 500 });
  }
}
