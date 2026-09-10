import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { cairoLocalToUtcIso } from "@/lib/timezone";
import type { CorrectionStatus, TimeCategory } from "@/types/database";

async function getClient() {
  const serverClient = await createServerSupabaseClient().catch(() => null);
  return serverClient || createAdminClient();
}

export async function startOrSwitchTimer(params: {
  taskId: string;
  category: TimeCategory;
  note?: string;
  targetRosterId?: string;
  reason?: string;
  idempotencyKey?: string;
  client?: any;
}) {
  const supabase = params.client || (await getClient());
  if (!supabase) throw new Error("Supabase is not configured.");

  // If targetRosterId is provided and distinct, call start_timer_on_behalf
  if (params.targetRosterId) {
    const { data, error } = await supabase.rpc("start_timer_on_behalf", {
      p_task_id: params.taskId,
      p_target_roster_id: params.targetRosterId,
      p_reason: params.reason || params.note || "بدء بواسطة الإدارة",
      p_category: params.category,
      p_note: params.note || null,
      p_idempotency_key: params.idempotencyKey || null,
    });
    if (error) throw new Error(`Failed to start timer on behalf: ${error.message}`);
    return data;
  }

  // Standard self start or switch timer
  const { data, error } = await supabase.rpc("start_or_switch_timer", {
    p_task_id: params.taskId,
    p_category: params.category,
    p_note: params.note || null,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) {
    throw new Error(`Failed to start timer: ${error.message}`);
  }

  return data;
}

export async function stopTimer(params: {
  timeEntryId: string;
  note?: string;
  idempotencyKey?: string;
  client?: any;
}) {
  const supabase = params.client || (await getClient());
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("stop_timer", {
    p_time_entry_id: params.timeEntryId,
    p_note: params.note || null,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) {
    throw new Error(`Failed to stop timer: ${error.message}`);
  }

  return data;
}

export async function addManualSession(params: {
  taskId: string;
  startedAtLocal: string; // "YYYY-MM-DDTHH:mm" in Cairo time
  endedAtLocal: string;   // "YYYY-MM-DDTHH:mm" in Cairo time
  category: TimeCategory;
  note?: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const startedAtUtc = cairoLocalToUtcIso(params.startedAtLocal);
  const endedAtUtc = cairoLocalToUtcIso(params.endedAtLocal);

  const { data, error } = await supabase.rpc("record_manual_time_entry", {
    p_task_id: params.taskId,
    p_started_at: startedAtUtc,
    p_ended_at: endedAtUtc,
    p_category: params.category,
    p_note: params.note || null,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function voidTimeEntry(params: {
  timeEntryId: string;
  reason: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  if (!params.reason || !params.reason.trim()) {
    throw new Error("سبب إلغاء الجلسة إلزامي لضمان الشفافية ومسار التدقيق.");
  }

  const { data, error } = await supabase.rpc("void_time_entry", {
    p_time_entry_id: params.timeEntryId,
    p_void_reason: params.reason.trim(),
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function requestTimeCorrection(params: {
  timeEntryId: string;
  proposedStartedAtLocal: string;
  proposedEndedAtLocal: string;
  proposedCategory: TimeCategory;
  proposedNote?: string;
  reason: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const startedAtUtc = cairoLocalToUtcIso(params.proposedStartedAtLocal);
  const endedAtUtc = cairoLocalToUtcIso(params.proposedEndedAtLocal);

  const { data, error } = await supabase.rpc("request_time_correction", {
    p_time_entry_id: params.timeEntryId,
    p_proposed_started_at: startedAtUtc,
    p_proposed_ended_at: endedAtUtc,
    p_proposed_category: params.proposedCategory,
    p_proposed_note: params.proposedNote || null,
    p_reason: params.reason,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function decideTimeCorrection(params: {
  requestId: string;
  decision: CorrectionStatus;
  rejectionReason?: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("decide_time_correction", {
    p_request_id: params.requestId,
    p_decision: params.decision,
    p_rejection_reason: params.rejectionReason || null,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function getActiveTimer(personId: string) {
  const supabase = await getClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("time_entries")
    .select("*, task:tasks(id, title, deliverable_number, campaign:campaigns(title, client:clients(name)))")
    .eq("roster_person_id", personId)
    .is("ended_at", null)
    .eq("is_voided", false)
    .maybeSingle();

  if (error) {
    console.error("Error fetching active timer:", error.message);
    return null;
  }
  return data;
}
