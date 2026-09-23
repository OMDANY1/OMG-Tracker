import { NextRequest, NextResponse } from "next/server";
import { generateMonthlyReportDraft } from "@/lib/services/reports";
import { generateAnalysisPackZip } from "@/lib/services/exports";
import { requireExportPermission } from "@/lib/auth/server-auth";

export async function GET(req: NextRequest) {
  try {
    const authRes = await requireExportPermission(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, admin: supabase } = authRes.data;
    const { searchParams } = new URL(req.url);
    const monthKey = searchParams.get("monthKey") || "2026-09";
    const timezone = searchParams.get("timezone") || "Africa/Cairo";

    const workspaceId = membership.workspaceId;

    const report = await generateMonthlyReportDraft({
      workspaceId,
      monthKey,
      timezone,
    });

    // Fetch time entries for this month
    const { data: timeEntries } = await supabase
      .from("time_entries")
      .select(`
        *,
        person:roster_people(display_name),
        task:tasks(
          title,
          deliverable_number,
          campaign:campaigns(
            title,
            client:clients(name)
          )
        )
      `)
      .eq("workspace_id", workspaceId)
      .eq("is_voided", false);

    // Fetch tasks
    const { data: tasks } = await supabase
      .from("tasks")
      .select(`
        *,
        client:clients(name),
        campaign:campaigns(title),
        assignee:roster_people!fk_task_assignee(display_name)
      `)
      .eq("workspace_id", workspaceId);

    const zipBuffer = await generateAnalysisPackZip({
      report,
      timeEntries: timeEntries || [],
      tasks: tasks || [],
    });

    const response = new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="omg-analysis-pack-${monthKey}.zip"`,
      },
    });

    return response;
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
