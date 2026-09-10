import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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
    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "تعذر الاتصال بقاعدة البيانات." }, { status: 500 });
    }

    // 1. Get Workspace & Invitations Status
    const { data: ws } = await admin
      .from("workspaces")
      .select("id, invitations_paused")
      .limit(1)
      .single();

    if (!ws) {
      return NextResponse.json({ error: "لم يتم العثور على مساحة العمل." }, { status: 404 });
    }

    const workspaceId = ws.id;

    // 2. Fetch all roster people
    const { data: roster, error: rosterErr } = await admin
      .from("roster_people")
      .select(`
        id,
        display_name,
        job_title,
        role,
        is_active,
        capacity:member_capacities(*)
      `)
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .order("display_name", { ascending: true });

    if (rosterErr) {
      return NextResponse.json({ error: rosterErr.message }, { status: 500 });
    }

    // 3. Fetch all active clients
    const { data: clients } = await admin
      .from("clients")
      .select("id, name, difficulty, owner_roster_id, status")
      .eq("workspace_id", workspaceId)
      .eq("status", "Active");

    // 4. Fetch all active tasks with deliverable details
    const { data: tasks } = await admin
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
        client:clients(id, name, difficulty),
        content_calendar_item:content_calendar_items!fk_cci_task(slides)
      `)
      .eq("workspace_id", workspaceId)
      .not("status", "in", '("approved","delivered","cancelled")');

    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const metrics: DesignerWorkloadMetric[] = (roster || []).map((person) => {
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

        // Due date radar
        if (t.due_date) {
          const dueDate = new Date(t.due_date);
          if (dueDate >= now && dueDate <= in7Days) {
            due7++;
          }
          if (dueDate >= now && dueDate <= in14Days) {
            due14++;
          }
        }
      }

      const capRecord = Array.isArray(person.capacity) ? person.capacity[0] : person.capacity;
      const weeklyHours = capRecord?.weekly_hours_limit || 40;
      const reservedHours = person.role === "owner" ? 15 : person.role === "senior_reviewer" ? 8 : 0;
      const maxWeighted = capRecord?.max_weighted_load || 15.0;

      const loadRatio = Math.min(100, Math.round((totalWeightedLoad / maxWeighted) * 100));

      let status: "underutilized" | "balanced" | "overloaded" = "balanced";
      if (loadRatio < 60) status = "underutilized";
      else if (loadRatio > 90) status = "overloaded";

      return {
        id: person.id,
        displayName: person.display_name,
        jobTitle: person.job_title || "Graphic Designer",
        role: person.role,
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
          person.role === "owner"
            ? "مالك الايجنسي والمدير الفني: مراجعة الحسابات والتوجيه الإبداعي"
            : person.role === "senior_reviewer"
            ? "مراجع أول: مراجعة تصاميم المصممين وتدقيق الجودة"
            : null,
      };
    });

    return NextResponse.json({
      success: true,
      workspaceId,
      invitationsPaused: ws.invitations_paused,
      members: metrics,
    });
  } catch (err: any) {
    console.error("Error in /api/team/workload:", err);
    return NextResponse.json({ error: err.message || "Failed to load team workload" }, { status: 500 });
  }
}
