import { NextRequest, NextResponse } from "next/server";
import { startOrSwitchTimer } from "@/lib/services/time-tracking";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { taskId, category, note, targetRosterId, idempotencyKey } = body;

    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    const result = await startOrSwitchTimer({
      taskId,
      category: category || "initial_design",
      note,
      targetRosterId,
      idempotencyKey,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
