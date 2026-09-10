import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMembership, validateSameOrigin } from "@/lib/auth/server-auth";
import { stopTimer } from "@/lib/services/time-tracking";

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
    const { timeEntryId, note, idempotencyKey } = body;

    if (!timeEntryId) {
      return NextResponse.json({ error: "timeEntryId is required" }, { status: 400 });
    }

    const result = await stopTimer({
      timeEntryId,
      note,
      idempotencyKey,
      client: authRes.data.serverClient,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
