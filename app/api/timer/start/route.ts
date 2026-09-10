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

    const result = await startOrSwitchTimer({
      taskId,
      category: category || "initial_design",
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
