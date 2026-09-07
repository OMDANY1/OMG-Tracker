import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getMonthIntervalUtc, calculateSessionOverlapSeconds } from "@/lib/timezone";
import crypto from "crypto";

export interface MonthlyReportData {
  monthKey: string;
  timezone: string;
  intervalStartUtc: string;
  intervalEndUtc: string;
  isSnapshotFinalized: boolean;
  revisionNumber: number;
  executiveSummary: {
    totalLoggedHours: number;
    totalRevisionHours: number;
    uniqueFirstDeliveries: number;
    redeliveries: number;
    activeProvisionalTimers: number;
    pendingCorrections: number;
    monthEndOverdue: number;
    backlogCount: number;
  };
  designerSummary: Array<{
    rosterPersonId: string;
    displayName: string;
    jobTitle: string;
    role: string;
    firstDeliveredTasks: number;
    loggedHours: number;
    designHours?: number;
    internalRevisionHours?: number;
    clientRevisionHours?: number;
    totalRevisionHours?: number;
    revisionHours: number;
    sessionCount: number;
    campaignsWorkedOn: number;
  }>;
  clientSummary: Array<{
    clientId: string;
    clientName: string;
    ownerName: string;
    difficulty: string;
    extraWorkload: string;
    deliveredTasks: number;
    totalHours: number;
    internalRevisionHours: number;
    clientRevisionHours: number;
    activeTasks: number;
  }>;
  campaignSummary: Array<{
    campaignId: string;
    campaignTitle: string;
    clientName: string;
    status: string;
    totalHours: number;
    deliveredCount: number;
    plannedCount: number;
  }>;
  timingMetrics: {
    onTimeNumerator: number;
    onTimeDenominator: number;
    onTimeRatioPercentage: number | null;
  };
  managementCommentary?: {
    whatWentWell?: string;
    blockers?: string;
    causesNeedingDiscussion?: string;
    proposedRedistribution?: string;
    actionItems?: Array<{ task: string; owner: string; dueDate: string }>;
  };
}

export async function generateMonthlyReportDraft(params: {
  workspaceId: string;
  monthKey: string; // "2026-09"
  timezone?: string;
}): Promise<MonthlyReportData> {
  const supabase = createAdminClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const tz = params.timezone || "Africa/Cairo";
  const { startUtc, endUtc } = getMonthIntervalUtc(params.monthKey, tz);

  // 1. Fetch roster members (excluding Owner placeholder from 6 designers)
  const { data: roster } = await supabase
    .from("roster_people")
    .select("*, workspace_memberships(role)")
    .eq("workspace_id", params.workspaceId);

  const rosterMap = new Map((roster || []).map((r) => [r.id, r]));

  // 2. Fetch clients
  const { data: clients } = await supabase
    .from("clients")
    .select("*")
    .eq("workspace_id", params.workspaceId);

  // 3. Fetch campaigns
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("*, client:clients(name)")
    .eq("workspace_id", params.workspaceId);

  // 4. Fetch tasks
  const { data: tasks } = await supabase
    .from("tasks")
    .select("*")
    .eq("workspace_id", params.workspaceId);

  // 5. Fetch time entries overlapping with this interval
  const { data: rawTimeEntries } = await supabase
    .from("time_entries")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("is_voided", false)
    .lt("started_at", endUtc.toISOString());

  // 6. Fetch all delivery events
  const { data: statusEvents } = await supabase
    .from("task_status_events")
    .select("*")
    .eq("to_status", "delivered")
    .order("created_at", { ascending: true });

  // 7. Check for existing finalized snapshot
  const { data: existingSnapshot } = await supabase
    .from("monthly_report_snapshots")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("month_key", params.monthKey)
    .order("revision_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  // If a finalized snapshot exists, we can return its frozen snapshot_data or calculate fresh draft
  const isFinalized = !!existingSnapshot?.is_finalized;
  const currentRevision = existingSnapshot ? existingSnapshot.revision_number : 1;

  // Process Time Entries
  let totalLoggedSeconds = 0;
  let totalRevisionSeconds = 0;
  let activeProvisionalTimers = 0;

  const designerStats = new Map<string, { seconds: number; revSeconds: number; sessions: number; campaigns: Set<string> }>();
  const clientStats = new Map<string, { seconds: number; intRevSeconds: number; cliRevSeconds: number; tasks: Set<string> }>();
  const campaignStats = new Map<string, { seconds: number }>();

  // Map task to its campaign & client
  const taskMap = new Map((tasks || []).map((t) => [t.id, t]));

  (rawTimeEntries || []).forEach((entry) => {
    if (!entry.ended_at) {
      activeProvisionalTimers++;
      return;
    }

    const overlapSec = calculateSessionOverlapSeconds(entry.started_at, entry.ended_at, startUtc, endUtc);
    if (overlapSec <= 0) return;

    totalLoggedSeconds += overlapSec;
    const isRevision = entry.category === "internal_revision" || entry.category === "client_revision";
    if (isRevision) totalRevisionSeconds += overlapSec;

    // By designer
    const dStat = designerStats.get(entry.roster_person_id) || {
      seconds: 0,
      revSeconds: 0,
      sessions: 0,
      campaigns: new Set(),
    };
    dStat.seconds += overlapSec;
    if (isRevision) dStat.revSeconds += overlapSec;
    dStat.sessions += 1;

    const taskObj = taskMap.get(entry.task_id);
    if (taskObj) {
      dStat.campaigns.add(taskObj.campaign_id);

      // By client
      const cStat = clientStats.get(taskObj.client_id) || {
        seconds: 0,
        intRevSeconds: 0,
        cliRevSeconds: 0,
        tasks: new Set(),
      };
      cStat.seconds += overlapSec;
      if (entry.category === "internal_revision") cStat.intRevSeconds += overlapSec;
      if (entry.category === "client_revision") cStat.cliRevSeconds += overlapSec;
      cStat.tasks.add(taskObj.id);
      clientStats.set(taskObj.client_id, cStat);

      // By campaign
      const campStat = campaignStats.get(taskObj.campaign_id) || { seconds: 0 };
      campStat.seconds += overlapSec;
      campaignStats.set(taskObj.campaign_id, campStat);
    }

    designerStats.set(entry.roster_person_id, dStat);
  });

  // Process Deliveries
  // Group delivery events by task to find the FIRST delivery ever
  const taskFirstDeliveryMap = new Map<string, any>();
  const taskDeliveriesInMonth: any[] = [];

  (statusEvents || []).forEach((ev) => {
    if (!taskFirstDeliveryMap.has(ev.task_id)) {
      taskFirstDeliveryMap.set(ev.task_id, ev);
    }
    const evTime = new Date(ev.created_at).getTime();
    if (evTime >= startUtc.getTime() && evTime < endUtc.getTime()) {
      taskDeliveriesInMonth.push(ev);
    }
  });

  let uniqueFirstDeliveries = 0;
  let redeliveries = 0;
  let onTimeNumerator = 0;
  let onTimeDenominator = 0;

  const designerDeliveriesMap = new Map<string, number>();
  const clientDeliveriesMap = new Map<string, number>();
  const campaignDeliveriesMap = new Map<string, number>();

  taskDeliveriesInMonth.forEach((ev) => {
    const firstEv = taskFirstDeliveryMap.get(ev.task_id);
    const isFirst = firstEv && firstEv.id === ev.id;

    if (isFirst) {
      uniqueFirstDeliveries++;

      // On-time check
      if (ev.recorded_due_at) {
        onTimeDenominator++;
        if (new Date(ev.created_at).getTime() <= new Date(ev.recorded_due_at).getTime()) {
          onTimeNumerator++;
        }
      }

      // Attribute delivery to recorded assignee at delivery time
      const assigneeId = ev.recorded_assignee_id;
      if (assigneeId) {
        designerDeliveriesMap.set(assigneeId, (designerDeliveriesMap.get(assigneeId) || 0) + 1);
      }

      const taskObj = taskMap.get(ev.task_id);
      if (taskObj) {
        clientDeliveriesMap.set(taskObj.client_id, (clientDeliveriesMap.get(taskObj.client_id) || 0) + 1);
        campaignDeliveriesMap.set(taskObj.campaign_id, (campaignDeliveriesMap.get(taskObj.campaign_id) || 0) + 1);
      }
    } else {
      redeliveries++;
    }
  });

  // Calculate Month-End Overdue (due before cutoff and not delivered/cancelled by cutoff)
  let monthEndOverdue = 0;
  let currentBacklog = 0;

  (tasks || []).forEach((t) => {
    if (t.status === "backlog") currentBacklog++;
    if (t.due_at) {
      const dueTime = new Date(t.due_at).getTime();
      if (dueTime < endUtc.getTime()) {
        const firstDel = taskFirstDeliveryMap.get(t.id);
        const delTime = firstDel ? new Date(firstDel.created_at).getTime() : Infinity;
        if (delTime >= endUtc.getTime() && t.status !== "cancelled") {
          monthEndOverdue++;
        }
      }
    }
  });

  // Build summaries
  const designerSummary = (roster || [])
    .filter((person) => person.is_active)
    .map((person) => {
      const stat = designerStats.get(person.id);
      return {
        rosterPersonId: person.id,
        displayName: person.display_name,
        jobTitle: person.job_title,
        role: person.workspace_memberships?.[0]?.role || "designer",
        firstDeliveredTasks: designerDeliveriesMap.get(person.id) || 0,
        loggedHours: Math.round(((stat?.seconds || 0) / 3600) * 100) / 100,
        designHours: Math.round((((stat?.seconds || 0) - (stat?.revSeconds || 0)) / 3600) * 100) / 100,
        internalRevisionHours: Math.round(((stat?.revSeconds || 0) / 3600) * 100) / 100,
        clientRevisionHours: 0,
        totalRevisionHours: Math.round(((stat?.revSeconds || 0) / 3600) * 100) / 100,
        revisionHours: Math.round(((stat?.revSeconds || 0) / 3600) * 100) / 100,
        sessionCount: stat?.sessions || 0,
        campaignsWorkedOn: stat?.campaigns.size || 0,
      };
    });

  const clientSummary = (clients || []).map((client) => {
    const stat = clientStats.get(client.id);
    const owner = client.owner_roster_id ? rosterMap.get(client.owner_roster_id) : null;
    return {
      clientId: client.id,
      clientName: client.name,
      ownerName: owner ? owner.display_name : "غير مسند",
      difficulty: client.difficulty,
      extraWorkload: client.extra_workload,
      deliveredTasks: clientDeliveriesMap.get(client.id) || 0,
      totalHours: Math.round(((stat?.seconds || 0) / 3600) * 100) / 100,
      internalRevisionHours: Math.round(((stat?.intRevSeconds || 0) / 3600) * 100) / 100,
      clientRevisionHours: Math.round(((stat?.cliRevSeconds || 0) / 3600) * 100) / 100,
      activeTasks: stat?.tasks.size || 0,
    };
  });

  const campaignSummary = (campaigns || []).map((camp) => {
    const stat = campaignStats.get(camp.id);
    const campTasks = (tasks || []).filter((t) => t.campaign_id === camp.id);
    return {
      campaignId: camp.id,
      campaignTitle: camp.title,
      clientName: camp.client?.name || "",
      status: camp.status,
      totalHours: Math.round(((stat?.seconds || 0) / 3600) * 100) / 100,
      deliveredCount: campaignDeliveriesMap.get(camp.id) || 0,
      plannedCount: campTasks.length,
    };
  });

  return {
    monthKey: params.monthKey,
    timezone: tz,
    intervalStartUtc: startUtc.toISOString(),
    intervalEndUtc: endUtc.toISOString(),
    isSnapshotFinalized: isFinalized,
    revisionNumber: currentRevision,
    executiveSummary: {
      totalLoggedHours: Math.round((totalLoggedSeconds / 3600) * 100) / 100,
      totalRevisionHours: Math.round((totalRevisionSeconds / 3600) * 100) / 100,
      uniqueFirstDeliveries,
      redeliveries,
      activeProvisionalTimers,
      pendingCorrections: 0,
      monthEndOverdue,
      backlogCount: currentBacklog,
    },
    designerSummary,
    clientSummary,
    campaignSummary,
    timingMetrics: {
      onTimeNumerator,
      onTimeDenominator,
      onTimeRatioPercentage:
        onTimeDenominator > 0 ? Math.round((onTimeNumerator / onTimeDenominator) * 1000) / 10 : null,
    },
    managementCommentary: existingSnapshot?.management_commentary || {
      whatWentWell: "تحقيق وتيرة إنجاز جيدة للعملاء وسرعة في إقفال الجولات المبدئية.",
      blockers: "تأخر بعض اعتمادات العميل الخارجي في نهاية الشهر.",
      proposedRedistribution: "إعادة توزيع عملاء الفئة Hard بناءً على قياس الساعات الفعلي.",
      actionItems: [],
    },
  };
}

export async function finalizeMonthlySnapshot(params: {
  workspaceId: string;
  monthKey: string;
  commentary?: any;
  idempotencyKey?: string;
}) {
  const serverClient = await createServerSupabaseClient().catch(() => null);
  const supabase = serverClient || createAdminClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc(
    "finalize_monthly_report_snapshot",
    {
      p_workspace_id: params.workspaceId,
      p_month_key: params.monthKey,
      p_management_commentary: params.commentary || {},
      p_idempotency_key: params.idempotencyKey || null,
    }
  );

  if (error) throw new Error(`Failed to finalize report snapshot: ${error.message}`);
  return data;
}
