import { NextRequest, NextResponse } from "next/server";
import { addManualSession } from "@/lib/services/time-tracking";
import { requireTaskAccess, validateSameOrigin } from "@/lib/auth/server-auth";

export async function POST(req: NextRequest) {
  if (!validateSameOrigin(req)) {
    return NextResponse.json(
      { error: "طلب غير مصرح به (Same-Origin check failed)." },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const {
      taskId,
      startedAtLocal,
      endedAtLocal,
      category,
      note,
      idempotencyKey,
    } = body;

    if (!taskId || !startedAtLocal || !endedAtLocal) {
      return NextResponse.json(
        { error: "taskId, startedAtLocal, and endedAtLocal are required" },
        { status: 400 }
      );
    }

    const accessRes = await requireTaskAccess(req, taskId);
    if (!accessRes.success) {
      return accessRes.errorResponse;
    }

    const result = await addManualSession({
      taskId,
      startedAtLocal,
      endedAtLocal,
      category: category || "initial_design",
      note,
      idempotencyKey,
      client: accessRes.data.serverClient,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
