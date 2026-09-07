import { NextRequest, NextResponse } from "next/server";
import { bulkUpdateTasks } from "@/lib/services/tasks";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { taskIds, updates } = body;

    if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
      return NextResponse.json(
        { error: "taskIds array is required" },
        { status: 400 }
      );
    }

    const results = await bulkUpdateTasks({
      taskIds,
      updates: updates || {},
    });

    return NextResponse.json({ updatedTasks: results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
