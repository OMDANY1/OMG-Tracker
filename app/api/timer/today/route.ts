import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMembership } from "@/lib/auth/server-auth";
import { getCairoDayIntervalUtc, formatCairoDate, calculateSessionOverlapSeconds } from "@/lib/timezone";

export const dynamic = "force-dynamic";

export interface TodayWorkMember {
  personId: string;
  name: string;
  role: string;
  jobTitle: string;
  isRunning: boolean;
  activeTimerStartedAt?: string | null;
  totalSeconds: number;
  formattedHours: string;
  taskTitle: string;
  clientName: string;
}

export async function GET(req: NextRequest) {
  const authRes = await requireWorkspaceMembership(req);
  if (!authRes.success) {
    return authRes.errorResponse;
  }

  const { membership, admin } = authRes.data;

  try {
    const now = new Date();
    const { startUtc, endUtc } = getCairoDayIntervalUtc(now);
    const dateStr = formatCairoDate(now);

    // 1. Fetch closed sessions that occurred or overlap with today
    const { data: entries, error: entriesErr } = await admin
      .from("time_entries")
      .select(`
        id,
        task_id,
        roster_person_id,
        started_at,
        ended_at,
        duration_seconds,
        category,
        note,
        person:roster_people!fk_time_person(id, display_name, job_title, role),
        task:tasks(
          id,
          title,
          deliverable_number,
          campaign:campaigns(
            title,
            client:clients(name)
          )
        )
      `)
      .eq("workspace_id", membership.workspaceId)
      .eq("is_voided", false)
      .gte("started_at", startUtc.toISOString())
      .lt("started_at", endUtc.toISOString())
      .order("started_at", { ascending: false });

    if (entriesErr) {
      return NextResponse.json({ error: entriesErr.message }, { status: 500 });
    }

    // 2. Fetch currently running sessions in workspace
    const { data: activeTimers, error: activeErr } = await admin
      .from("time_entries")
      .select(`
        id,
        task_id,
        roster_person_id,
        started_at,
        ended_at,
        category,
        note,
        person:roster_people!fk_time_person(id, display_name, job_title, role),
        task:tasks(
          id,
          title,
          deliverable_number,
          campaign:campaigns(
            title,
            client:clients(name)
          )
        )
      `)
      .eq("workspace_id", membership.workspaceId)
      .is("ended_at", null)
      .eq("is_voided", false);

    if (activeErr) {
      return NextResponse.json({ error: activeErr.message }, { status: 500 });
    }

    // 3. Aggregate work by roster_person_id
    const memberMap = new Map<string, TodayWorkMember>();

    // Process closed sessions
    (entries || []).forEach((entry: any) => {
      const pId = entry.roster_person_id;
      if (!pId) return;

      const personObj = entry.person || {};
      const taskObj = entry.task || {};
      const campaignObj = taskObj.campaign || {};
      const clientObj = campaignObj.client || {};

      const overlapSecs = calculateSessionOverlapSeconds(
        entry.started_at,
        entry.ended_at,
        startUtc,
        endUtc
      );

      if (!memberMap.has(pId)) {
        memberMap.set(pId, {
          personId: pId,
          name: personObj.display_name || "عضو فريق",
          role: personObj.role || "designer",
          jobTitle: personObj.job_title || "فريق العمل",
          isRunning: false,
          totalSeconds: 0,
          formattedHours: "0 س",
          taskTitle: taskObj.title || "",
          clientName: clientObj.name || "",
        });
      }

      const rec = memberMap.get(pId)!;
      rec.totalSeconds += overlapSecs;
      if (!rec.taskTitle && taskObj.title) {
        rec.taskTitle = taskObj.title;
        rec.clientName = clientObj.name || "";
      }
    });

    // Process active running sessions
    (activeTimers || []).forEach((active: any) => {
      const pId = active.roster_person_id;
      if (!pId) return;

      const personObj = active.person || {};
      const taskObj = active.task || {};
      const campaignObj = taskObj.campaign || {};
      const clientObj = campaignObj.client || {};

      if (!memberMap.has(pId)) {
        memberMap.set(pId, {
          personId: pId,
          name: personObj.display_name || "عضو فريق",
          role: personObj.role || "designer",
          jobTitle: personObj.job_title || "فريق العمل",
          isRunning: true,
          activeTimerStartedAt: active.started_at,
          totalSeconds: 0,
          formattedHours: "0 س",
          taskTitle: taskObj.title || "",
          clientName: clientObj.name || "",
        });
      } else {
        const rec = memberMap.get(pId)!;
        rec.isRunning = true;
        rec.activeTimerStartedAt = active.started_at;
        if (taskObj.title) {
          rec.taskTitle = taskObj.title;
          rec.clientName = clientObj.name || "";
        }
      }
    });

    // Format hours for each member
    const membersList: TodayWorkMember[] = Array.from(memberMap.values()).map((m) => {
      const hours = Math.round((m.totalSeconds / 3600) * 10) / 10;
      return {
        ...m,
        formattedHours: `${hours} س`,
      };
    });

    // Sort: running members first, then by totalSeconds descending
    membersList.sort((a, b) => {
      if (a.isRunning && !b.isRunning) return -1;
      if (!a.isRunning && b.isRunning) return 1;
      return b.totalSeconds - a.totalSeconds;
    });

    const totalAgencySeconds = membersList.reduce((acc, cur) => acc + cur.totalSeconds, 0);
    const activeCount = membersList.filter((m) => m.isRunning).length;

    return NextResponse.json({
      success: true,
      date: dateStr,
      totalAgencySeconds,
      activeCount,
      members: membersList,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
