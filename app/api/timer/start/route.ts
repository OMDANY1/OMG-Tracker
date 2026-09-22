import { NextRequest, NextResponse } from "next/server";
import { requireTaskAccess, validateSameOrigin } from "@/lib/auth/server-auth";
import { startOrSwitchTimer } from "@/lib/services/time-tracking";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!validateSameOrigin(req)) {
    return NextResponse.json(
      { error: "رفض الطلب: انتهاك التحقق من مصدر الطلب (CSRF/Same-Origin)." },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { taskId, category, note, targetRosterId, idempotencyKey } = body;

    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    const accessRes = await requireTaskAccess(req, taskId);
    if (!accessRes.success) {
      return accessRes.errorResponse;
    }

    const { membership, serverClient } = accessRes.data;

    // Only owner can start timer on behalf of another user
    let effectiveTargetRosterId = targetRosterId;
    if (targetRosterId && targetRosterId !== membership.rosterPersonId) {
      if (membership.role !== "owner") {
        return NextResponse.json(
          { error: "غير مصرح: بدء المؤقت نيابة عن عضو آخر مقتصر على المالك فقط." },
          { status: 403 }
        );
      }
    } else {
      effectiveTargetRosterId = undefined; // Self start
    }

    // Determine and normalize activity category based on task work_stage and status
    let effectiveCategory = category;
    if (effectiveCategory === "copywriting") effectiveCategory = "content_writing";
    if (effectiveCategory === "strategy") effectiveCategory = "strategy_research";

    if (!effectiveCategory || effectiveCategory === "initial_design") {
      const { data: taskData } = await serverClient
        .from("tasks")
        .select("work_stage, status")
        .eq("id", taskId)
        .maybeSingle();

      if (taskData) {
        if (taskData.status === "internal_review" || taskData.status === "client_review") {
          effectiveCategory = "review";
        } else if (taskData.status === "changes_requested") {
          effectiveCategory = "internal_revision";
        } else if (taskData.work_stage === "copywriting") {
          effectiveCategory = "content_writing";
        } else if (taskData.work_stage === "strategy") {
          effectiveCategory = "strategy_research";
        } else if (taskData.work_stage === "video_editing") {
          effectiveCategory = "video_editing";
        } else {
          effectiveCategory = "initial_design";
        }
      } else {
        effectiveCategory = effectiveCategory || "initial_design";
      }
    }

    const result = await startOrSwitchTimer({
      taskId,
      category: effectiveCategory,
      note,
      targetRosterId: effectiveTargetRosterId,
      idempotencyKey,
      client: serverClient,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
