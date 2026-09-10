import { NextRequest, NextResponse } from "next/server";
import { requireTaskAccess, validateSameOrigin } from "@/lib/auth/server-auth";
import { updateTaskStatus } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";

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

  const taskId = params.id;
  const accessRes = await requireTaskAccess(req, taskId);
  if (!accessRes.success) {
    return accessRes.errorResponse;
  }

  try {
    const body = await req.json();
    const { toStatus, reason, deliverableUrl, finalDeliverableAttachmentId, idempotencyKey } = body;

    if (!toStatus) {
      return NextResponse.json(
        { error: "toStatus is required" },
        { status: 400 }
      );
    }

    const result = await updateTaskStatus({
      taskId,
      toStatus,
      reason,
      deliverableUrl,
      finalDeliverableAttachmentId,
      idempotencyKey,
      client: accessRes.data.serverClient,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
