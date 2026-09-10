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
