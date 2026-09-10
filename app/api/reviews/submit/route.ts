import { NextRequest, NextResponse } from "next/server";
import { requireTaskAccess, validateSameOrigin } from "@/lib/auth/server-auth";
import { submitTaskForReview } from "@/lib/services/reviews";

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
    const { taskId, previewUrl, note, roundType, reviewerId, idempotencyKey } = body;

    if (!taskId || !previewUrl) {
      return NextResponse.json(
        { error: "taskId and previewUrl are required" },
        { status: 400 }
      );
    }

    const accessRes = await requireTaskAccess(req, taskId);
    if (!accessRes.success) {
      return accessRes.errorResponse;
    }

    const round = await submitTaskForReview({
      taskId,
      previewUrl,
      note,
      roundType,
      reviewerId,
      idempotencyKey,
      client: accessRes.data.serverClient,
    });

    return NextResponse.json({ round });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
