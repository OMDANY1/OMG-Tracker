import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMembership, validateSameOrigin } from "@/lib/auth/server-auth";
import { decideReviewRound } from "@/lib/services/reviews";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!validateSameOrigin(req)) {
    return NextResponse.json(
      { error: "رفض الطلب: انتهاك التحقق من مصدر الطلب (CSRF/Same-Origin)." },
      { status: 403 }
    );
  }

  const authRes = await requireWorkspaceMembership(req);
  if (!authRes.success) {
    return authRes.errorResponse;
  }

  try {
    const body = await req.json();
    const roundId = body.roundId || body.reviewRoundId;
    const { decision, feedback, idempotencyKey } = body;
    const headerIdempotencyKey = req.headers.get("x-idempotency-key") || undefined;

    if (!roundId || !decision) {
      return NextResponse.json(
        { error: "roundId and decision ('approved' | 'changes_requested') are required" },
        { status: 400 }
      );
    }

    if (decision === "changes_requested" && (!feedback || !feedback.trim())) {
      return NextResponse.json(
        { error: "ملاحظات التوجيه والتعديل إلزامية عند طلب تعديلات." },
        { status: 400 }
      );
    }

    // Explicit permission & anti-self-approval check
    const { data: roundData, error: roundErr } = await authRes.data.admin
      .from("review_rounds")
      .select("id, submitter_id, reviewer_id, task:tasks!review_rounds_task_id_fkey(id, primary_assignee_id, reviewer_id)")
      .eq("id", roundId)
      .eq("workspace_id", authRes.data.membership.workspaceId)
      .maybeSingle();

    if (roundErr || !roundData) {
      return NextResponse.json({ error: "جولة المراجعة غير موجودة." }, { status: 404 });
    }

    const taskData: any = roundData.task;
    const callerRosterId = authRes.data.membership.rosterPersonId;
    const callerRole = authRes.data.membership.role;

    // Zero self-approval
    if (callerRosterId === roundData.submitter_id || (taskData && callerRosterId === taskData.primary_assignee_id)) {
      return NextResponse.json(
        { error: "غير مصرح: لا يمكن لمقدم الطلب أو المنفذ اعتماد عمله بنفسه." },
        { status: 400 }
      );
    }

    // Reviewer authorization: must be designated reviewer or workspace owner/manager
    const designatedReviewerId = roundData.reviewer_id || (taskData && taskData.reviewer_id);
    if (callerRole !== "owner" && callerRole !== "manager" && callerRosterId !== designatedReviewerId) {
      return NextResponse.json(
        { error: "غير مصرح: لست المراجع المعتمد لهذه المهمة." },
        { status: 403 }
      );
    }

    const result = await decideReviewRound({
      reviewRoundId: roundId,
      decision,
      feedback,
      idempotencyKey: idempotencyKey || headerIdempotencyKey,
      client: authRes.data.serverClient,
    });

    return NextResponse.json({ round: result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
