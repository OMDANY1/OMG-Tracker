import { NextRequest, NextResponse } from "next/server";
import { createBatchTasks } from "@/lib/services/tasks";
import {
  requireWorkspaceMembership,
  validateSameOrigin,
  isFullAdminRole,
  hasGranularPermission,
} from "@/lib/auth/server-auth";

export async function POST(req: NextRequest) {
  if (!validateSameOrigin(req)) {
    return NextResponse.json(
      { error: "طلب غير مصرح به (Same-Origin check failed)." },
      { status: 403 }
    );
  }

  const authRes = await requireWorkspaceMembership(req);
  if (!authRes.success) {
    return authRes.errorResponse;
  }

  const { membership, serverClient } = authRes.data;
  if (
    !isFullAdminRole(membership.role) &&
    membership.role !== "manager" &&
    !hasGranularPermission(membership, "create_tasks")
  ) {
    return NextResponse.json(
      { error: "غير مصرح: إنشاء المهام مقتصر على الإدارة والمخولين فقط." },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { campaignId, clientId, tasks } = body;

    if (!campaignId || !clientId || !tasks || !Array.isArray(tasks)) {
      return NextResponse.json(
        { error: "campaignId, clientId, and tasks array are required" },
        { status: 400 }
      );
    }

    const created = await createBatchTasks({
      workspaceId: membership.workspaceId,
      campaignId,
      clientId,
      tasks,
      client: serverClient,
    });

    return NextResponse.json({ tasks: created });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
