import { NextRequest, NextResponse } from "next/server";
import { bulkUpdateTasks } from "@/lib/services/tasks";
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
    !hasGranularPermission(membership, "assign_team")
  ) {
    return NextResponse.json(
      { error: "غير مصرح: التحديث الجماعي للمهام مقتصر على الإدارة." },
      { status: 403 }
    );
  }

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
      client: serverClient,
    });

    return NextResponse.json({ updatedTasks: results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
