import { NextRequest, NextResponse } from "next/server";
import { decideReviewRound } from "@/lib/services/reviews";

export async function POST(req: NextRequest) {
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

    const result = await decideReviewRound({
      reviewRoundId: roundId,
      decision,
      feedback,
      idempotencyKey: idempotencyKey || headerIdempotencyKey,
    });

    return NextResponse.json({ round: result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
