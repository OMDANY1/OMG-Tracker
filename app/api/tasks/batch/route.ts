import { NextRequest, NextResponse } from "next/server";
import { createBatchTasks } from "@/lib/services/tasks";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspaceId, campaignId, clientId, tasks } = body;

    if (!workspaceId || !campaignId || !clientId || !tasks || !Array.isArray(tasks)) {
      return NextResponse.json(
        { error: "workspaceId, campaignId, clientId, and tasks array are required" },
        { status: 400 }
      );
    }

    const created = await createBatchTasks({
      workspaceId,
      campaignId,
      clientId,
      tasks,
    });

    return NextResponse.json({ tasks: created });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
