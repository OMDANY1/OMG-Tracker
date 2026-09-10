import { NextRequest, NextResponse } from "next/server";
import { requireOwner, validateSameOrigin } from "@/lib/auth/server-auth";
import { AiJobQueue } from "@/lib/services/ai-job-queue";
import { processCalendarCampaign } from "@/lib/services/content-calendars";
import { classifyGeminiError } from "@/lib/ai/gemini-client";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Public GET is rejected with 405 Method Not Allowed.
 */
export async function GET() {
  return NextResponse.json(
    { error: "طريقة الطلب غير مسموح بها. يجب استدعاء الـ Worker عبر POST فقط مع الهيدر السري المخصص أو جلسة المالك." },
    { status: 405, headers: { Allow: "POST" } }
  );
}

/**
 * POST /api/ai/worker
 * Authenticates either via Server Secret (x-worker-secret / Bearer) or Owner session + Same-Origin.
 */
export async function POST(req: NextRequest) {
  try {
    const workerSecret = (process.env.AI_WORKER_SECRET || process.env.CRON_SECRET || "").trim();
    const providedSecret = req.headers.get("x-worker-secret") ||
      (req.headers.get("authorization")?.startsWith("Bearer ")
        ? req.headers.get("authorization")?.slice(7).trim()
        : null);

    let isAuthorized = false;
    let authSource = "unknown";

    // 1. Check Worker Secret (used by Supabase pg_cron + pg_net)
    if (providedSecret) {
      if (workerSecret && providedSecret === workerSecret) {
        isAuthorized = true;
        authSource = "supabase_cron_secret_env";
      } else {
        // Fallback: Verify secret against Supabase Vault via service_role RPC
        const admin = createAdminClient();
        if (admin) {
          const { data: isValid, error: vaultErr } = await admin.rpc("verify_ai_worker_secret", {
            p_secret: providedSecret,
          });
          if (!vaultErr && isValid === true) {
            isAuthorized = true;
            authSource = "supabase_vault_secret";
          }
        }
      }

      if (!isAuthorized) {
        return NextResponse.json(
          { error: "رمز المصادقة السري للـ Worker غير صالح (Invalid Worker Secret)." },
          { status: 401 }
        );
      }
    } else {
      // 2. Allow Manual Trigger from Emad's Dashboard (requires Same-Origin + Owner session)
      if (!validateSameOrigin(req)) {
        return NextResponse.json(
          { error: "طلب غير مصرح به (Same-Origin check failed)." },
          { status: 403 }
        );
      }

      const ownerAuth = await requireOwner(req).catch(() => null);
      if (ownerAuth?.success) {
        isAuthorized = true;
        authSource = "owner_manual_session";
      }
    }

    if (!isAuthorized) {
      return NextResponse.json(
        { error: "غير مصرح: يجب توفير رمز Worker السري أو تسجيل الدخول بحساب مالك مساحة العمل." },
        { status: 401 }
      );
    }

    const workerId = `worker-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const admin = createAdminClient();

    let processedCount = 0;
    const maxJobsPerInvocation = 2; // Process up to 2 jobs per run to prevent serverless timeout
    const results: any[] = [];

    while (processedCount < maxJobsPerInvocation) {
      // 1. Atomically claim next job (with expired lease recovery & concurrency protection)
      const claim = await AiJobQueue.claimNextJob(workerId, 300);

      if (!claim.claimed || !claim.job_id || !claim.workspace_id || !claim.campaign_id) {
        break; // No eligible jobs in queue
      }

      processedCount++;
      const startTime = Date.now();
      console.log(`[${workerId}] Claimed job ${claim.job_id} (Attempt ${claim.attempt_count}, Recovered: ${Boolean(claim.is_recovered)})`);

      try {
        // 2. Execute extraction pipeline
        const result = await processCalendarCampaign({
          workspaceId: claim.workspace_id,
          campaignId: claim.campaign_id,
          jobId: claim.job_id,
          forceRefresh: true,
        });

        // 3. Complete job successfully
        await AiJobQueue.releaseJob({
          jobId: claim.job_id,
          status: "completed",
          durationMs: Date.now() - startTime,
        });

        results.push({
          jobId: claim.job_id,
          status: "completed",
          postsDetected: result.reconciled.detected_post_count,
          durationMs: Date.now() - startTime,
        });
      } catch (procErr: any) {
        const durationMs = Date.now() - startTime;
        const errorMsg = procErr.message || String(procErr);
        const classification = classifyGeminiError(errorMsg, procErr.status || 500);

        const isPermanent =
          (claim.attempt_count || 1) >= (claim.max_attempts || 3) ||
          classification.category === "INVALID_KEY" ||
          classification.category === "PERMISSION_DENIED" ||
          classification.category === "BILLING_REQUIRED";

        const nextStatus = isPermanent ? "failed" : "waiting_for_retry";
        const backoffDelay = Math.min(300, 15 * Math.pow(2, (claim.attempt_count || 1) - 1));

        console.error(`[${workerId}] Job ${claim.job_id} failed (${nextStatus}): ${classification.safeMessageAr}`);

        // Release job with error details and backoff
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
              calendar_status: nextStatus === "failed" ? "extraction_failed" : "queued_for_retry",
              processing_error: classification.safeMessageAr,
            })
            .eq("id", claim.campaign_id);
        }

        results.push({
          jobId: claim.job_id,
          status: nextStatus,
          errorCode: classification.category,
          error: classification.safeMessageAr,
          isPermanent,
        });
      }
    }

    if (processedCount === 0) {
      return NextResponse.json({
        success: true,
        message: "طابور المعالجة فارغ ولا توجد مهام جاهزة حالياً.",
        workerId,
        authSource,
        jobsProcessed: 0,
        summary: {
          claimed: 0,
          completed: 0,
          waiting_for_retry: 0,
          failed: 0,
        },
      });
    }

    const summary = {
      claimed: processedCount,
      completed: results.filter((r) => r.status === "completed").length,
      waiting_for_retry: results.filter((r) => r.status === "waiting_for_retry").length,
      failed: results.filter((r) => r.status === "failed").length,
    };

    return NextResponse.json({
      success: true,
      message: `تم معالجة ${processedCount} مهمة بنجاح عبر الـ Worker.`,
      workerId,
      authSource,
      jobsProcessed: processedCount,
      summary,
      results,
    });
  } catch (err: any) {
    console.error("Critical worker error:", err);
    return NextResponse.json(
      { error: err.message || "خطأ غير متوقع أثناء تشغيل الـ Worker" },
      { status: 500 }
    );
  }
}
