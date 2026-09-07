import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { ReviewDecision, ReviewRoundType } from "@/types/database";

async function getClient() {
  const serverClient = await createServerSupabaseClient().catch(() => null);
  return serverClient || createAdminClient();
}

export interface ReviewRoutingDecision {
  reviewerId: string;
  reviewerName: string;
  reason: string;
}

/**
 * Automatically determines default reviewer based on configurable review_routing_rules table
 */
export async function determineDefaultReviewer(params: {
  workspaceId: string;
  assigneeId?: string | null;
  clientDifficulty?: string;
}): Promise<ReviewRoutingDecision | null> {
  const supabase = await getClient();
  if (!supabase) return null;

  // Query review_routing_rules table
  const { data: rules } = await supabase
    .from("review_routing_rules")
    .select("*, reviewer:roster_people!fk_rrr_reviewer(id, display_name), fallback:roster_people!fk_rrr_fallback(id, display_name)")
    .eq("workspace_id", params.workspaceId)
    .order("priority", { ascending: false });

  if (rules && rules.length > 0) {
    for (const r of rules) {
      const matchDesigner = !r.designer_roster_id || r.designer_roster_id === params.assigneeId;
      const matchDiff = !r.client_difficulty || r.client_difficulty === params.clientDifficulty;
      if (matchDesigner && matchDiff && r.reviewer_roster_id !== params.assigneeId) {
        return {
          reviewerId: r.reviewer_roster_id,
          reviewerName: r.reviewer?.display_name || "المراجع المحدد",
          reason: `توجيه معتمد حسب قاعدة التوجيه (أولوية ${r.priority}).`,
        };
      }
      if (matchDesigner && matchDiff && r.fallback_reviewer_id && r.fallback_reviewer_id !== params.assigneeId) {
        return {
          reviewerId: r.fallback_reviewer_id,
          reviewerName: r.fallback?.display_name || "المراجع الاحتياطي",
          reason: `المراجع الرئيسي هو نفس المنفذ؛ تم التحويل للمراجع الاحتياطي لمنع الموافقة الذاتية.`,
        };
      }
    }
  }

  return null;
}

export async function submitTaskForReview(params: {
  taskId: string;
  previewUrl: string;
  note?: string;
  roundType?: ReviewRoundType;
  reviewerId?: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  if (!params.previewUrl || !params.previewUrl.trim()) {
    throw new Error("رابط المعاينة أو التصميم المرفوع إلزامي لطلب المراجعة.");
  }

  const { data, error } = await supabase.rpc("submit_review_round", {
    p_task_id: params.taskId,
    p_preview_url: params.previewUrl.trim(),
    p_note: params.note || null,
    p_round_type: params.roundType || "internal",
    p_idempotency_key: params.idempotencyKey || null,
    p_reviewer_id: params.reviewerId || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function decideReviewRound(params: {
  reviewRoundId: string;
  decision: ReviewDecision;
  feedback?: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  if (params.decision === "changes_requested" && (!params.feedback || !params.feedback.trim())) {
    throw new Error("ملاحظات التعديل والتوجيه إلزامية عند طلب تعديلات على التصميم.");
  }

  const { data, error } = await supabase.rpc("decide_review_round", {
    p_review_round_id: params.reviewRoundId,
    p_decision: params.decision,
    p_feedback: params.feedback?.trim() || null,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}
