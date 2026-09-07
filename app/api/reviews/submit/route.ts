import { NextRequest, NextResponse } from "next/server";
import { submitTaskForReview } from "@/lib/services/reviews";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { taskId, previewUrl, note, roundType, reviewerId, idempotencyKey } = body;

    if (!taskId || !previewUrl) {
      return NextResponse.json(
        { error: "taskId and previewUrl are required" },
        { status: 400 }
      );
    }

    const round = await submitTaskForReview({
      taskId,
      previewUrl,
      note,
      roundType,
      reviewerId,
      idempotencyKey,
    });

    return NextResponse.json({ round });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
