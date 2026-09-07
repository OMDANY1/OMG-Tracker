import { createAdminClient } from "@/lib/supabase/admin";

export interface MemberCapacitySummary {
  rosterPersonId: string;
  displayName: string;
  jobTitle: string;
  role: string;
  isConfigured: boolean;
  weeklyHours: number;
  reservedManagementHours: number;
  availableProductionHours: number;
  estimatedRemainingHours: number;
  missingEstimatesCount: number;
  plannedLoadRatioPercentage: number | null;
  activeClientCount: number;
  activeTaskCount: number;
  actualLoggedHoursCurrentMonth: number;
  notes?: string | null;
}

export async function getTeamCapacitySummaries(workspaceId: string, monthKey: string): Promise<MemberCapacitySummary[]> {
  const supabase = createAdminClient();
  if (!supabase) return [];

  const { data: roster } = await supabase
    .from("roster_people")
    .select("*, member_capacities(*), clients(id), tasks!tasks_primary_assignee_id_fkey(id, status, estimated_minutes), workspace_memberships(role)")
    .eq("workspace_id", workspaceId);

  if (!roster) return [];

  // Month interval for logged hours
  const { data: timeEntries } = await supabase
    .from("time_entries")
    .select("roster_person_id, started_at, ended_at, is_voided")
    .eq("workspace_id", workspaceId)
    .eq("is_voided", false)
    .not("ended_at", "is", null);

  const hoursMap = new Map<string, number>();
  (timeEntries || []).forEach((t) => {
    if (t.started_at && t.ended_at && t.started_at.startsWith(monthKey)) {
      const durHours = (new Date(t.ended_at).getTime() - new Date(t.started_at).getTime()) / 3600000;
      hoursMap.set(t.roster_person_id, (hoursMap.get(t.roster_person_id) || 0) + durHours);
    }
  });

  return roster.map((person) => {
    const cap = person.member_capacities?.[0];
    const isConfigured = !!cap;
    const weeklyHours = cap ? Number(cap.weekly_hours) : 0;
    const reserved = cap ? Number(cap.reserved_management_hours) : 0;
    const availableProdHours = Math.max(0, weeklyHours - reserved);

    const openTasks = (person.tasks || []).filter(
      (t: any) => !["delivered", "cancelled"].includes(t.status)
    );

    let estimatedRemainingMinutes = 0;
    let missingEstimatesCount = 0;

    openTasks.forEach((t: any) => {
      if (t.estimated_minutes !== null && t.estimated_minutes !== undefined) {
        estimatedRemainingMinutes += Number(t.estimated_minutes);
      } else {
        missingEstimatesCount++;
      }
    });

    const estimatedRemainingHours = Math.round((estimatedRemainingMinutes / 60) * 10) / 10;
    let plannedLoadRatio: number | null = null;
    if (isConfigured && availableProdHours > 0) {
      // monthly capacity roughly 4 weeks
      const monthlyProdCapacity = availableProdHours * 4;
      plannedLoadRatio = Math.round((estimatedRemainingHours / monthlyProdCapacity) * 100);
    }

    return {
      rosterPersonId: person.id,
      displayName: person.display_name,
      jobTitle: person.job_title,
      role: person.workspace_memberships?.[0]?.role || "designer",
      isConfigured,
      weeklyHours,
      reservedManagementHours: reserved,
      availableProductionHours: availableProdHours,
      estimatedRemainingHours,
      missingEstimatesCount,
      plannedLoadRatioPercentage: plannedLoadRatio,
      activeClientCount: (person.clients || []).length,
      activeTaskCount: openTasks.length,
      actualLoggedHoursCurrentMonth: Math.round((hoursMap.get(person.id) || 0) * 10) / 10,
      notes: cap?.notes || null,
    };
  });
}

export async function upsertMemberCapacity(params: {
  workspaceId: string;
  rosterPersonId: string;
  weeklyHours: number;
  reservedManagementHours?: number;
  idempotencyKey?: string;
}) {
  const supabase = createAdminClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("upsert_member_capacity", {
    p_workspace_id: params.workspaceId,
    p_roster_person_id: params.rosterPersonId,
    p_weekly_hours: params.weeklyHours,
    p_reserved_management_hours: params.reservedManagementHours || 0,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function manageLeaveDay(params: {
  workspaceId: string;
  rosterPersonId: string;
  leaveDate: string;
  hours: number;
  leaveType?: 'annual' | 'sick' | 'unpaid' | 'other';
  action?: 'add' | 'remove';
  leaveId?: string;
  idempotencyKey?: string;
}) {
  const supabase = createAdminClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("manage_leave_day", {
    p_workspace_id: params.workspaceId,
    p_roster_person_id: params.rosterPersonId,
    p_leave_date: params.leaveDate,
    p_hours: params.hours,
    p_leave_type: params.leaveType || 'annual',
    p_action: params.action || 'add',
    p_leave_id: params.leaveId || null,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}
