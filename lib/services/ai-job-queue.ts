import { createAdminClient } from "@/lib/supabase/admin";
import crypto from "crypto";

export interface AiJobRecord {
  id: string;
  workspace_id: string;
  campaign_id: string;
  client_id: string;
  job_type: string;
  file_sha256: string;
  provider: string;
  model: string;
  status:
    | "queued"
    | "processing"
    | "completed"
    | "waiting_for_retry"
    | "rate_limited"
    | "failed"
    | "cancelled";
  attempt_count: number;
  max_attempts: number;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  next_retry_at: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_error_code: string | null;
  safe_error_message: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_hit: boolean;
  processing_duration_ms: number;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AcquireJobResult {
  jobId: string;
  status: "processing" | "queued" | "already_active";
  isResumed: boolean;
  attemptCount: number;
  action: string;
}

export interface ReleaseJobParams {
  jobId: string;
  status: "completed" | "failed" | "rate_limited" | "waiting_for_retry" | "cancelled";
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheHit?: boolean;
  durationMs?: number;
  errorCode?: string;
  safeErrorMsg?: string;
  retryDelaySeconds?: number;
}

export class AiJobQueue {
  /**
   * Atomically acquires or deduplicates an AI processing job.
   */
  static async acquireJob(params: {
    workspaceId: string;
    campaignId: string;
    clientId: string;
    fileSha256: string;
    model: string;
    forceRefresh?: boolean;
  }): Promise<AcquireJobResult> {
    const admin = createAdminClient();
    if (!admin) throw new Error("تعذر الاتصال بقاعدة البيانات لجدولة وظيفة الذكاء الاصطناعي.");

    const workerId = `worker-${process.env.VERCEL_ENV || "local"}-${crypto.randomUUID()}`;

    const { data, error } = await admin.rpc("acquire_ai_processing_job", {
      p_workspace_id: params.workspaceId,
      p_campaign_id: params.campaignId,
      p_client_id: params.clientId,
      p_file_sha256: params.fileSha256,
      p_worker_id: workerId,
      p_model: params.model,
      p_lease_seconds: 300,
      p_force_refresh: Boolean(params.forceRefresh),
    });

    if (error) {
      console.error("Failed to acquire AI processing job:", error);
      throw new Error(`فشل حجز وظيفة المعالجة: ${error.message}`);
    }

    return {
      jobId: data.job_id,
      status: data.status,
      isResumed: Boolean(data.is_resumed),
      attemptCount: data.attempt_count || 1,
      action: data.action || "unknown",
    };
  }

  /**
   * Releases or completes an AI job with execution metrics.
   */
  static async releaseJob(params: ReleaseJobParams): Promise<void> {
    const admin = createAdminClient();
    if (!admin) return;

    try {
      await admin.rpc("release_ai_processing_job", {
        p_job_id: params.jobId,
        p_status: params.status,
        p_model: params.model || null,
        p_input_tokens: params.inputTokens || 0,
        p_output_tokens: params.outputTokens || 0,
        p_total_tokens: params.totalTokens || 0,
        p_cache_hit: Boolean(params.cacheHit),
        p_duration_ms: params.durationMs || 0,
        p_error_code: params.errorCode || null,
        p_safe_error_msg: params.safeErrorMsg || null,
        p_retry_delay_seconds: params.retryDelaySeconds || null,
      });
    } catch (err: any) {
      console.error("Failed to release AI processing job:", err.message);
    }
  }

  /**
   * Retrieves aggregated AI usage metrics for Owner Dashboard.
   */
  static async getAiUsageMetrics(workspaceId: string) {
    const admin = createAdminClient();
    if (!admin) throw new Error("Database client not available");

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const { data: allJobs, error } = await admin
      .from("ai_processing_jobs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching AI job metrics:", error);
      throw new Error(error.message);
    }

    const jobs = (allJobs || []) as AiJobRecord[];

    const todayJobs = jobs.filter((j) => new Date(j.created_at) >= todayStart);
    const monthJobs = jobs.filter((j) => new Date(j.created_at) >= monthStart);

    const totalRequests = jobs.length;
    const completedCount = jobs.filter((j) => j.status === "completed").length;
    const failedCount = jobs.filter((j) => j.status === "failed").length;
    const rateLimitedCount = jobs.filter((j) => j.status === "rate_limited").length;
    const cacheHitCount = jobs.filter((j) => j.cache_hit).length;
    const cacheMissCount = totalRequests - cacheHitCount;

    const totalInputTokens = jobs.reduce((acc, j) => acc + (j.input_tokens || 0), 0);
    const totalOutputTokens = jobs.reduce((acc, j) => acc + (j.output_tokens || 0), 0);
    const totalTokens = jobs.reduce((acc, j) => acc + (j.total_tokens || 0), 0);

    const completedDurations = jobs
      .filter((j) => j.status === "completed" && j.processing_duration_ms > 0)
      .map((j) => j.processing_duration_ms);

    const avgDurationMs =
      completedDurations.length > 0
        ? Math.round(completedDurations.reduce((a, b) => a + b, 0) / completedDurations.length)
        : 0;

    const lastSuccessJob = jobs.find((j) => j.status === "completed");
    const lastFailedJob = jobs.find((j) => j.status === "failed" || j.status === "rate_limited");

    // Pricing estimation (configurable standard Gemini Flash tier: $0.075 / 1M input, $0.30 / 1M output)
    const estimatedCostUsd = (
      (totalInputTokens / 1_000_000) * 0.075 +
      (totalOutputTokens / 1_000_000) * 0.30
    ).toFixed(4);

    return {
      todayFilesAnalyzed: todayJobs.length,
      monthFilesAnalyzed: monthJobs.length,
      totalGeminiRequests: totalRequests,
      completedRequests: completedCount,
      failedRequests: failedCount,
      rateLimitedRequests: rateLimitedCount,
      cacheHits: cacheHitCount,
      cacheMisses: cacheMissCount,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens,
      estimatedCostUsd,
      avgDurationSeconds: Math.round(avgDurationMs / 1000),
      activeModel: process.env.GEMINI_DOCUMENT_MODEL || "gemini-3.6-flash",
      fallbackModel: process.env.GEMINI_FALLBACK_MODEL || null,
      lastSuccessAt: lastSuccessJob?.completed_at || null,
      lastError: lastFailedJob
        ? {
            code: lastFailedJob.last_error_code,
            message: lastFailedJob.safe_error_message,
            timestamp: lastFailedJob.updated_at,
          }
        : null,
      recentJobs: jobs.slice(0, 20).map((j) => ({
        id: j.id,
        campaignId: j.campaign_id,
        status: j.status,
        model: j.model,
        tokens: j.total_tokens,
        durationSeconds: Math.round((j.processing_duration_ms || 0) / 1000),
        cacheHit: j.cache_hit,
        createdAt: j.created_at,
        error: j.safe_error_message,
      })),
    };
  }

  /**
   * Atomically claims the next eligible job for worker execution.
   */
  static async claimNextJob(workerId: string, leaseSeconds: number = 300) {
    const admin = createAdminClient();
    if (!admin) throw new Error("Database client not available");

    const { data, error } = await admin.rpc("claim_next_ai_job", {
      p_worker_id: workerId,
      p_lease_seconds: leaseSeconds,
    });

    if (error) {
      console.error("Error claiming next AI job:", error);
      throw new Error(`Failed to claim AI job: ${error.message}`);
    }

    return data as {
      claimed: boolean;
      job_id?: string;
      workspace_id?: string;
      campaign_id?: string;
      client_id?: string;
      file_sha256?: string;
      model?: string;
      attempt_count?: number;
      max_attempts?: number;
      is_recovered?: boolean;
    };
  }

  /**
   * Enqueues a new background AI extraction job.
   */
  static async enqueueJob(params: {
    workspaceId: string;
    campaignId: string;
    clientId: string;
    fileSha256: string;
    model?: string;
    createdById?: string;
  }) {
    const admin = createAdminClient();
    if (!admin) throw new Error("Database client not available");

    const { data, error } = await admin
      .from("ai_processing_jobs")
      .insert({
        workspace_id: params.workspaceId,
        campaign_id: params.campaignId,
        client_id: params.clientId,
        file_sha256: params.fileSha256,
        model: params.model || process.env.GEMINI_DOCUMENT_MODEL || "gemini-3.6-flash",
        status: "queued",
        attempt_count: 0,
        max_attempts: 3,
        created_by_id: params.createdById || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Error enqueuing AI job:", error);
      throw new Error(`Failed to enqueue AI job: ${error.message}`);
    }

    return data as AiJobRecord;
  }

  /**
   * Resets a failed or stalled job for an immediate retry.
   */
  static async retryJob(jobId: string, workspaceId: string) {
    const admin = createAdminClient();
    if (!admin) throw new Error("Database client not available");

    const { data, error } = await admin
      .from("ai_processing_jobs")
      .update({
        status: "queued",
        attempt_count: 0,
        next_retry_at: null,
        lease_owner: null,
        lease_expires_at: null,
        last_error_code: null,
        safe_error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("workspace_id", workspaceId)
      .select()
      .single();

    if (error) {
      console.error("Error retrying AI job:", error);
      throw new Error(`Failed to reset AI job: ${error.message}`);
    }

    return data as AiJobRecord;
  }

  /**
   * Fetches status of a specific job.
   */
  static async getJobStatus(jobId: string, workspaceId: string) {
    const admin = createAdminClient();
    if (!admin) throw new Error("Database client not available");

    const { data, error } = await admin
      .from("ai_processing_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (error) {
      console.error("Error getting job status:", error);
      throw new Error(`Failed to get job status: ${error.message}`);
    }

    return data as AiJobRecord | null;
  }
}
