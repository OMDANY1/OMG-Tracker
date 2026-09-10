import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/server-auth";
import { AiJobQueue } from "@/lib/services/ai-job-queue";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireOwner(req);
    if (!authResult.success) {
      return authResult.errorResponse;
    }

    const { membership, admin } = authResult.data;
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId");
    const campaignId = searchParams.get("campaignId");

    if (jobId) {
      const job = await AiJobQueue.getJobStatus(jobId, membership.workspaceId);
      if (!job) {
        return NextResponse.json({ error: "مهمة المعالجة غير موجودة." }, { status: 404 });
      }
      return NextResponse.json({ success: true, job });
    }

    if (campaignId) {
      const { data: campaignJobs } = await admin
        .from("ai_processing_jobs")
        .select("*")
        .eq("campaign_id", campaignId)
        .eq("workspace_id", membership.workspaceId)
        .order("created_at", { ascending: false });

      return NextResponse.json({ success: true, jobs: campaignJobs || [] });
    }

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

