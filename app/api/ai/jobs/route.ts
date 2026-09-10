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
