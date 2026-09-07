import { NextRequest, NextResponse } from "next/server";
import { generateMonthlyReportDraft, finalizeMonthlySnapshot } from "@/lib/services/reports";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const monthKey = searchParams.get("monthKey") || "2026-09";
    const timezone = searchParams.get("timezone") || "Africa/Cairo";

    const supabase = createAdminClient();
    if (!supabase) {
      return NextResponse.json({ error: "Database unconfigured" }, { status: 500 });
    }

    const { data: workspace } = await supabase
      .from("workspaces")
      .select("id")
      .limit(1)
      .maybeSingle();

    const workspaceId = workspace?.id || "00000000-0000-0000-0000-000000000000";

    const report = await generateMonthlyReportDraft({
      workspaceId,
      monthKey,
      timezone,
    });

    return NextResponse.json({ report });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspaceId, monthKey, commentary, idempotencyKey } = body;
    const headerIdempotencyKey = req.headers.get("x-idempotency-key") || undefined;

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
