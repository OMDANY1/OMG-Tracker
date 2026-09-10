import { NextRequest, NextResponse } from "next/server";
import { requireOwner, validateSameOrigin } from "@/lib/auth/server-auth";
import { AiJobQueue } from "@/lib/services/ai-job-queue";
import { createAdminClient } from "@/lib/supabase/admin";

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

    const body = await req.json().catch(() => ({}));
    const { jobId } = body;

    if (!jobId) {
      return NextResponse.json(
        { error: "معرف المهمة (jobId) مطلوب لإعادة المحاولة." },
        { status: 400 }
      );
    }

    const job = await AiJobQueue.retryJob(jobId, membership.workspaceId);

    // Update associated campaign status
    await admin
      .from("campaigns")
      .update({
        calendar_status: "uploaded",
        processing_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.campaign_id)
      .eq("workspace_id", membership.workspaceId);

    // Record audit event
    await admin.from("audit_events").insert({
      workspace_id: membership.workspaceId,
      actor_id: membership.rosterPersonId,
      action: "retry_ai_job",
      entity_type: "ai_processing_jobs",
      entity_id: jobId,
      metadata: {
        campaign_id: job.campaign_id,
        client_id: job.client_id,
      },
    });

    // Trigger worker asynchronously
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const workerSecret = (process.env.AI_WORKER_SECRET || "").trim();
    fetch(`${baseUrl}/api/ai/worker`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(workerSecret ? { "x-worker-secret": workerSecret } : {}),
      },
      body: JSON.stringify({ source: "manual_retry", jobId }),
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      job,
      message: "تمت إعادة جدولة عملية التحليل بنجاح ووضعها في قائمة الانتظار.",
    });
  } catch (err: any) {
    console.error("Error retrying AI job:", err);
    return NextResponse.json(
      { error: err.message || "فشلت إعادة محاولة معالجة المهمة." },
      { status: 500 }
    );
  }
}
