import { NextRequest, NextResponse } from "next/server";
import { voidTimeEntry } from "@/lib/services/time-tracking";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { timeEntryId, reason, idempotencyKey } = body;

    if (!timeEntryId || !reason) {
      return NextResponse.json(
        { error: "timeEntryId and reason are required" },
        { status: 400 }
      );
    }

    const result = await voidTimeEntry({
      timeEntryId,
      reason,
      idempotencyKey,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
