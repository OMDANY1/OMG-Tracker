import { NextRequest, NextResponse } from "next/server";
import { stopTimer } from "@/lib/services/time-tracking";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { timeEntryId, note } = body;

    if (!timeEntryId) {
      return NextResponse.json({ error: "timeEntryId is required" }, { status: 400 });
    }

    const result = await stopTimer({
      timeEntryId,
      note,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
