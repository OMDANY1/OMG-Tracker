import { NextRequest, NextResponse } from "next/server";
import { voidTimeEntry } from "@/lib/services/time-tracking";
import { requireWorkspaceMembership, validateSameOrigin, isFullAdminRole } from "@/lib/auth/server-auth";

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
  if (!isFullAdminRole(membership.role) && membership.role !== "manager") {
    return NextResponse.json(
      { error: "غير مصرح: إلغاء جلسات العمل المسجلة مقتصر على الإدارة فقط." },
      { status: 403 }
    );
  }

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
      client: serverClient,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
