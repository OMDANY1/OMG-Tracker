import { NextRequest, NextResponse } from "next/server";
import { generateMonthlyReportDraft } from "@/lib/services/reports";
import { generateAnalysisPackZip } from "@/lib/services/exports";
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
