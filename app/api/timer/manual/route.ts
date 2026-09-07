import { NextRequest, NextResponse } from "next/server";
import { addManualSession } from "@/lib/services/time-tracking";

export async function POST(req: NextRequest) {
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

    const result = await addManualSession({
      taskId,
      startedAtLocal,
      endedAtLocal,
      category: category || "initial_design",
      note,
      idempotencyKey,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
