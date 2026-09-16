import { NextRequest, NextResponse } from "next/server";
import { requireTaskAccess, validateSameOrigin } from "@/lib/auth/server-auth";
import { setTaskWaitingState } from "@/lib/services/tasks";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!validateSameOrigin(req)) {
    return NextResponse.json(
      { error: "رفض الطلب: انتهاك التحقق من مصدر الطلب (CSRF/Same-Origin)." },
      { status: 403 }
    );
  }

  const access = await requireTaskAccess(req, params.id);
  if (!access.success) return access.errorResponse;

  try {
    const body = await req.json();
    const { isWaiting, waitingReason, waitingOnRosterId } = body;

    if (typeof isWaiting !== "boolean") {
      return NextResponse.json({ error: "isWaiting must be a boolean" }, { status: 400 });
    }

    if (isWaiting && (!waitingReason || !waitingReason.trim())) {
      return NextResponse.json({ error: "سبب الانتظار إلزامي لتعليق العمل على التاسك" }, { status: 400 });
    }

    const result = await setTaskWaitingState({
      taskId: params.id,
      isWaiting,
      waitingReason: waitingReason?.trim() || undefined,
      waitingOnRosterId: waitingOnRosterId || undefined,
    });

    return NextResponse.json({ success: true, result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update waiting state" }, { status: 500 });
  }
}
