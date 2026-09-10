import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/server-auth";
import { AiJobQueue } from "@/lib/services/ai-job-queue";
import { processCalendarCampaign } from "@/lib/services/content-calendars";
import { classifyGeminiError } from "@/lib/ai/gemini-client";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function verifyWorkerAuth(req: NextRequest): Promise<boolean> {
  // 1. Check Cron Secret
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = req.headers.get("authorization");
  const xCronSecret = req.headers.get("x-cron-secret");

  if (cronSecret) {
    if (xCronSecret === cronSecret) return true;
    if (authHeader === `Bearer ${cronSecret}`) return true;
  }

  // 2. Allow Owner session
  const ownerCheck = await requireOwner(req).catch(() => null);
  if (ownerCheck?.success) return true;

  // 3. Fallback for internal fire-and-forget call if in same process
  const internalSecret = req.headers.get("x-internal-worker-trigger");
  if (internalSecret && internalSecret === process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return true;
  }

  return false;
}

export async function POST(req: NextRequest) {
  return handleWorkerRequest(req);
}

export async function GET(req: NextRequest) {
  return handleWorkerRequest(req);
}

async function handleWorkerRequest(req: NextRequest) {
  try {
    const isAuthorized = await verifyWorkerAuth(req);
    if (!isAuthorized) {
      return NextResponse.json(
        { error: "غير مصرح: الوصول إلى الـ Worker مخصص للـ Owner أو نظام المهام المجدولة فقط." },
        { status: 401 }
      );
    }

    const workerId = `worker-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // 1. Atomically claim next job (with expired lease recovery & concurrency protection)
    const claim = await AiJobQueue.claimNextJob(workerId, 300);

    if (!claim.claimed || !claim.job_id || !claim.workspace_id || !claim.campaign_id) {
      return NextResponse.json({
        status: "idle",
        message: "لا توجد مهام معلقة في قائمة الانتظار حالياً.",
      });
    }

    console.log(`[Worker ${workerId}] Claimed job ${claim.job_id} for campaign ${claim.campaign_id} (Attempt ${claim.attempt_count}/${claim.max_attempts}, Recovered: ${claim.is_recovered})`);

    const admin = createAdminClient();
    const startTime = Date.now();

    try {
      // 2. Execute pipeline
      const result = await processCalendarCampaign({
        workspaceId: claim.workspace_id,
        campaignId: claim.campaign_id,
        forceRefresh: false,
      });

      console.log(`[Worker ${workerId}] Successfully processed job ${claim.job_id} in ${Date.now() - startTime}ms`);

      return NextResponse.json({
        status: "completed",
        jobId: claim.job_id,
        campaignId: claim.campaign_id,
        durationMs: Date.now() - startTime,
        detectedPostCount: result.reconciled.detected_post_count,
        itemsSaved: result.items.length,
      });
    } catch (procErr: any) {
      const durationMs = Date.now() - startTime;
      const errorMsg = procErr.message || String(procErr);
      const classification = classifyGeminiError(errorMsg, procErr.status || 500);

      const isPermanent =
        (claim.attempt_count || 1) >= (claim.max_attempts || 3) ||
        classification.category === "INVALID_KEY" ||
        classification.category === "PERMISSION_DENIED" ||
        classification.category === "BILLING_REQUIRED" ||
        classification.category === "MODEL_NOT_FOUND";

      const nextStatus = isPermanent ? "failed" : "waiting_for_retry";
      const backoffDelay = Math.min(300, 15 * Math.pow(2, (claim.attempt_count || 1) - 1));

      console.error(`[Worker ${workerId}] Job ${claim.job_id} failed (${nextStatus}): ${classification.safeMessageAr}`);

      // Release job with error details
      await AiJobQueue.releaseJob({
        jobId: claim.job_id,
        status: nextStatus,
        durationMs,
        errorCode: classification.category,
        safeErrorMsg: classification.safeMessageAr,
        retryDelaySeconds: isPermanent ? undefined : backoffDelay,
      });

      // Update campaign status
      if (admin) {
        await admin
          .from("campaigns")
          .update({
            calendar_status: nextStatus === "failed" ? "failed" : "processing",
            processing_error: classification.safeMessageAr,
            updated_at: new Date().toISOString(),
          })
          .eq("id", claim.campaign_id);
      }

      return NextResponse.json(
        {
          status: nextStatus,
          jobId: claim.job_id,
          safeMessageAr: classification.safeMessageAr,
          retryAfterSeconds: isPermanent ? null : backoffDelay,
          attemptCount: claim.attempt_count,
        },
        { status: 200 }
      );
    }
  } catch (err: any) {
    console.error("Worker unhandled exception:", err);
    return NextResponse.json(
      { error: "حدث خطأ غير متوقع أثناء معالجة قائمة المهام." },
      { status: 500 }
    );
  }
}
