import { NextRequest, NextResponse } from "next/server";
import { generateMonthlyReportDraft, finalizeMonthlySnapshot } from "@/lib/services/reports";
import { requireWorkspaceMembership, requireOwner, validateSameOrigin } from "@/lib/auth/server-auth";

export async function GET(req: NextRequest) {
  try {
    const authRes = await requireWorkspaceMembership(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership } = authRes.data;
    const { searchParams } = new URL(req.url);
    const monthKey = searchParams.get("monthKey") || "2026-09";
    const timezone = searchParams.get("timezone") || "Africa/Cairo";

    const report = await generateMonthlyReportDraft({
      workspaceId: membership.workspaceId,
      monthKey,
      timezone,
    });

    return NextResponse.json({
      report,
      isOwner: membership.role === "owner" || membership.role === "company_owner",
      callerRole: membership.role,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!validateSameOrigin(req)) {
      return NextResponse.json(
        { error: "طلب غير مصرح به (Same-Origin check failed)." },
        { status: 403 }
      );
    }

    const authRes = await requireOwner(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership } = authRes.data;
    const body = await req.json();
    const { monthKey, commentary, idempotencyKey } = body;
    const headerIdempotencyKey = req.headers.get("x-idempotency-key") || undefined;
    const workspaceId = membership.workspaceId;

    if (!workspaceId || !monthKey) {
      return NextResponse.json(
        { error: "workspaceId and monthKey are required" },
        { status: 400 }
      );
    }

    const snapshot = await finalizeMonthlySnapshot({
      workspaceId,
      monthKey,
      commentary: commentary || {},
      idempotencyKey: idempotencyKey || headerIdempotencyKey,
    });

    return NextResponse.json({ snapshot });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
