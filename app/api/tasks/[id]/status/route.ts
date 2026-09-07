import { NextRequest, NextResponse } from "next/server";
import { updateTaskStatus } from "@/lib/services/tasks";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const taskId = params.id;
    const body = await req.json();
    const { toStatus, reason, deliverableUrl, idempotencyKey } = body;

    if (!toStatus) {
      return NextResponse.json(
        { error: "toStatus is required" },
        { status: 400 }
      );
    }

    const result = await updateTaskStatus({
      taskId,
      toStatus,
      reason,
      deliverableUrl,
      idempotencyKey,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
