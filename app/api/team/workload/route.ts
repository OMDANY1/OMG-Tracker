import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/server-auth";

export const dynamic = "force-dynamic";

export interface DesignerWorkloadMetric {
  id: string;
  displayName: string;
  jobTitle: string;
  role: string;
  weeklyHours: number;
  reservedHours: number;
  activeClientsCount: number;
  activeTasksCount: number;
  weightedLoadScore: number;
  maxWeightedLoad: number;
  loadRatio: number;
  status: "underutilized" | "balanced" | "overloaded";
  dueNext7Days: number;
  dueNext14Days: number;
  clients: { id: string; name: string; difficulty: string }[];
  notes?: string | null;
}

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireOwner(req);
    if (!authResult.success) {
      return authResult.errorResponse;
    }

    const { membership, admin } = authResult.data;
    const workspaceId = membership.workspaceId;

    // 1. Get Workspace & Invitations Status
    const { data: ws } = await admin
      .from("workspaces")
      .select("id, invitations_paused")
      .eq("id", workspaceId)
      .single();

    // 2. Fetch all required data in parallel
    const [rosterRes, membershipsRes, capacitiesRes, clientsRes, tasksRes] = await Promise.all([
      admin
        .from("roster_people")
        .select("id, display_name, job_title, is_active")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .order("display_name", { ascending: true }),
      admin
        .from("workspace_memberships")
        .select("roster_person_id, role")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true),
      admin
        .from("member_capacities")
        .select("*")
        .eq("workspace_id", workspaceId),
      admin
        .from("clients")
        .select("id, name, difficulty, owner_roster_id, status")
        .eq("workspace_id", workspaceId)
        .eq("status", "Active"),
      admin
        .from("tasks")
        .select(`
          id,
          client_id,
          primary_assignee_id,
          status,
          priority,
          deliverable_format,
          deliverable_number,
          due_date,
          design_due_date,
          review_due_date,
          publish_at,
          client:clients(id, name, difficulty),
          content_calendar_item:content_calendar_items!fk_cci_task(slides)
        `)
        .eq("workspace_id", workspaceId)
        .not("status", "in", '("approved","delivered","cancelled")'),
    ]);

    if (rosterRes.error) {
      return NextResponse.json({ error: rosterRes.error.message }, { status: 500 });
    }

    const roster = rosterRes.data || [];
    const memberships = membershipsRes.data || [];
    const capacities = capacitiesRes.data || [];
    const clients = clientsRes.data || [];
    const tasks = tasksRes.data || [];

    const membershipRoleMap = new Map<string, string>();
    for (const m of memberships) {
      if (m.roster_person_id && m.role) {
        membershipRoleMap.set(m.roster_person_id, m.role);
      }
    }

    const capacityMap = new Map<string, any>();
    for (const c of capacities) {
      if (c.roster_person_id) {
        capacityMap.set(c.roster_person_id, c);
      }
    }

    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const metrics: DesignerWorkloadMetric[] = roster.map((person) => {
      let role = membershipRoleMap.get(person.id);
      if (!role) {
        const title = (person.job_title || "").toLowerCase();
        const name = (person.display_name || "").toLowerCase();
        if (name.includes("عماد") || title.includes("owner") || title.includes("art director")) {
          role = "owner";
        } else if (name.includes("ندى") || title.includes("senior") || title.includes("reviewer")) {
          role = "senior_reviewer";
        } else {
          role = "designer";
        }
      }
      const assignedClients = (clients || []).filter((c) => c.owner_roster_id === person.id);
      const personTasks = (tasks || []).filter((t) => t.primary_assignee_id === person.id);

      let totalWeightedLoad = 0;
      let due7 = 0;
      let due14 = 0;

      for (const t of personTasks) {
        // Calculate Base Deliverable Format Weight
        const format = (t.deliverable_format || "Static").toLowerCase();
        let baseWeight = 1.0;

        if (format.includes("carousel")) {
          const cci = Array.isArray(t.content_calendar_item) ? t.content_calendar_item[0] : t.content_calendar_item;
          const slidesCount = Array.isArray(cci?.slides) ? cci.slides.length : 4;
          baseWeight = 1.5 + 0.15 * Math.max(1, slidesCount);
        } else if (format.includes("reel") || format.includes("video") || format.includes("motion")) {
          baseWeight = 2.5;
        } else {
          baseWeight = 1.0;
        }

        // Calculate Client Difficulty Multiplier
        const clientObj: any = Array.isArray(t.client) ? t.client[0] : t.client;
        const clientDiff = (clientObj?.difficulty || "Medium").toLowerCase();
        let diffMultiplier = 1.0;
        if (clientDiff === "easy") diffMultiplier = 0.9;
        else if (clientDiff === "hard") diffMultiplier = 1.2;
        else diffMultiplier = 1.0;

        totalWeightedLoad += baseWeight * diffMultiplier;

        // Due date radar (prioritizing design_due_date for production, falling back to due_date)
        const targetDate = t.design_due_date || t.due_date;
        if (targetDate) {
          const dueDate = new Date(targetDate);
          if (dueDate >= now && dueDate <= in7Days) {
            due7++;
          }
          if (dueDate >= now && dueDate <= in14Days) {
            due14++;
          }
        }
      }

      const capRecord = capacityMap.get(person.id);
      const weeklyHours = capRecord?.weekly_hours_limit || 40;
      const reservedHours = role === "owner" ? 15 : role === "senior_reviewer" ? 8 : 0;
      const maxWeighted = capRecord?.max_weighted_load || 15.0;

      const loadRatio = Math.min(100, Math.round((totalWeightedLoad / maxWeighted) * 100));

      let status: "underutilized" | "balanced" | "overloaded" = "balanced";
      if (loadRatio < 60) status = "underutilized";
      else if (loadRatio > 90) status = "overloaded";

      return {
        id: person.id,
        displayName: person.display_name,
        jobTitle: person.job_title || "Graphic Designer",
        role: role || "designer",
        weeklyHours,
        reservedHours,
        activeClientsCount: assignedClients.length,
        activeTasksCount: personTasks.length,
        weightedLoadScore: Math.round(totalWeightedLoad * 10) / 10,
        maxWeightedLoad: maxWeighted,
        loadRatio,
        status,
        dueNext7Days: due7,
        dueNext14Days: due14,
        clients: assignedClients.map((c) => ({
          id: c.id,
          name: c.name,
          difficulty: c.difficulty || "Medium",
        })),
        notes:
          role === "owner"
            ? "مالك الايجنسي والمدير الفني: مراجعة الحسابات والتوجيه الإبداعي"
            : role === "senior_reviewer"
            ? "مراجع أول: مراجعة تصاميم المصممين وتدقيق الجودة"
            : null,
      };
    });

    return NextResponse.json({
      success: true,
      workspaceId,
      invitationsPaused: Boolean(ws?.invitations_paused),
      members: metrics,
    });
  } catch (err: any) {
    console.error("Error in /api/team/workload:", err);
    return NextResponse.json({ error: err.message || "Failed to load team workload" }, { status: 500 });
  }
}
