import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMembership } from "@/lib/auth/server-auth";
import { getMonthIntervalUtc } from "@/lib/timezone";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authRes = await requireWorkspaceMembership(req);
  if (!authRes.success) {
    return authRes.errorResponse;
  }

  const { membership, admin } = authRes.data;

  try {
    const { searchParams } = new URL(req.url);
    const monthKey = searchParams.get("monthKey") || "2026-09";
    const personId = searchParams.get("personId");
    const category = searchParams.get("category");
    const clientId = searchParams.get("clientId");

    const { startUtc, endUtc } = getMonthIntervalUtc(monthKey, "Africa/Cairo");

    let query = admin
      .from("time_entries")
      .select(`
        id,
        workspace_id,
        task_id,
        roster_person_id,
        started_at,
        ended_at,
        duration_seconds,
        category,
        note,
        source,
        entry_source,
        is_voided,
        void_reason,
        voided_at,
        created_at,
        worker_name_snapshot,
        person:roster_people!fk_time_person(id, display_name, job_title),
        task:tasks(
          id,
          title,
          deliverable_number,
          work_stage,
          campaign:campaigns(
            id,
            title,
            client:clients(
              id,
              name
            )
          )
        )
      `)
      .eq("workspace_id", membership.workspaceId)
      .gte("started_at", startUtc.toISOString())
      .lt("started_at", endUtc.toISOString())
      .order("started_at", { ascending: false });

    if (personId) {
      query = query.eq("roster_person_id", personId);
    }
    if (category) {
      query = query.eq("category", category);
    }

    const { data: rawEntries, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Filter by clientId in memory if specified
    let entries = rawEntries || [];
    if (clientId) {
      entries = entries.filter((e: any) => e.task?.campaign?.client?.id === clientId);
    }

    // Fetch team members list for filter options
    const { data: roster } = await admin
      .from("roster_people")
      .select("id, display_name, job_title, role")
      .eq("workspace_id", membership.workspaceId)
      .eq("is_active", true)
      .order("display_name", { ascending: true });

    return NextResponse.json({
      success: true,
      monthKey,
      entries,
      teamMembers: roster || [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
