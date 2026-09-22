import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Client, ClientDifficulty, ClientExtraWorkload, ClientState } from "@/types/database";

async function getClient() {
  const serverClient = await createServerSupabaseClient().catch(() => null);
  return serverClient || createAdminClient();
}

export async function getClients(workspaceId: string): Promise<Client[]> {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data: clients, error } = await supabase
    .from("clients")
    .select(`
      *,
      owner:roster_people!clients_owner_roster_id_fkey(id, display_name, job_title),
      campaigns(id, title, status),
      tasks(id, status, primary_assignee_id, work_stage),
      team_assignment:client_team_assignments(*),
      brief_data:client_briefs(*)
    `)
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });

  if (error) {
    console.error("Error fetching clients:", error.message);
    throw new Error(`فشل تحميل قائمة العملاء: ${error.message}`);
  }

  return (clients as any[]) || [];
}

export async function createClient(params: {
  workspaceId: string;
  name: string;
  ownerRosterId?: string | null;
  difficulty?: ClientDifficulty;
  extraWorkload?: ClientExtraWorkload;
  state?: ClientState;
  notes?: string;
  brandGuideUrl?: string;
  briefUrl?: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("create_client", {
    p_workspace_id: params.workspaceId,
    p_name: params.name,
    p_owner_roster_id: params.ownerRosterId || null,
    p_difficulty: params.difficulty || "Medium",
    p_extra_workload: params.extraWorkload || "None",
    p_state: params.state || "Active",
    p_notes: params.notes || null,
    p_brand_guide_url: params.brandGuideUrl || null,
    p_brief_url: params.briefUrl || null,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function updateClient(params: {
  clientId: string;
  workspaceId?: string;
  name?: string;
  ownerRosterId?: string | null;
  difficulty?: ClientDifficulty;
  extraWorkload?: ClientExtraWorkload;
  state?: ClientState;
  notes?: string;
  brandGuideUrl?: string;
  briefUrl?: string;
  reassignOpenTasksToNewOwner?: boolean;
  actorId?: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  let workspaceId = params.workspaceId;
  if (!workspaceId) {
    const { data: c } = await supabase
      .from("clients")
      .select("workspace_id")
      .eq("id", params.clientId)
      .maybeSingle();
    workspaceId = c?.workspace_id;
  }

  if (!workspaceId) {
    const { data: ws } = await supabase.from("workspaces").select("id").limit(1).maybeSingle();
    workspaceId = ws?.id;
  }

  if (!workspaceId) {
    throw new Error("Workspace ID could not be determined for updating client.");
  }

  const { data, error } = await supabase.rpc("update_client", {
    p_workspace_id: workspaceId,
    p_client_id: params.clientId,
    p_name: params.name !== undefined ? params.name : null,
    p_owner_roster_id: params.ownerRosterId !== undefined ? params.ownerRosterId : null,
    p_difficulty: params.difficulty !== undefined ? params.difficulty : null,
    p_extra_workload: params.extraWorkload !== undefined ? params.extraWorkload : null,
    p_state: params.state !== undefined ? params.state : null,
    p_notes: params.notes !== undefined ? params.notes : null,
    p_brand_guide_url: params.brandGuideUrl !== undefined ? params.brandGuideUrl : null,
    p_brief_url: params.briefUrl !== undefined ? params.briefUrl : null,
    p_reassign_open_tasks: !!params.reassignOpenTasksToNewOwner,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function updateClientAssignment(params: {
  clientId: string;
  workspaceId?: string;
  newOwnerRosterId?: string | null;
  reassignOpenTasks?: boolean;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  let workspaceId = params.workspaceId;
  if (!workspaceId) {
    const { data: c } = await supabase
      .from("clients")
      .select("workspace_id")
      .eq("id", params.clientId)
      .maybeSingle();
    workspaceId = c?.workspace_id;
  }

  if (!workspaceId) {
    const { data: ws } = await supabase.from("workspaces").select("id").limit(1).maybeSingle();
    workspaceId = ws?.id;
  }

  if (!workspaceId) {
    throw new Error("Workspace ID could not be determined for updating client assignment.");
  }

  const { data, error } = await supabase.rpc("update_client_assignment", {
    p_workspace_id: workspaceId,
    p_client_id: params.clientId,
    p_new_owner_roster_id: params.newOwnerRosterId || null,
    p_reassign_open_tasks: !!params.reassignOpenTasks,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function archiveClient(params: {
  workspaceId: string;
  clientId: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("archive_client", {
    p_workspace_id: params.workspaceId,
    p_client_id: params.clientId,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function upsertClientTeamAssignment(params: {
  workspaceId?: string;
  clientId: string;
  primaryStrategistId?: string | null;
  primaryCopywriterId?: string | null;
  primaryDesignerId?: string | null;
  primaryVideoEditorId?: string | null;
  strategyReviewerId?: string | null;
  copywritingReviewerId?: string | null;
  designReviewerId?: string | null;
  videoReviewerId?: string | null;
  marketingDirectorId?: string | null;
  strategyLeadId?: string | null;
  requiresVideo?: boolean | null;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  let workspaceId = params.workspaceId;
  if (!workspaceId || workspaceId === "00000000-0000-0000-0000-000000000000") {
    const { data: c } = await supabase
      .from("clients")
      .select("workspace_id")
      .eq("id", params.clientId)
      .maybeSingle();
    workspaceId = c?.workspace_id;
  }

  if (!workspaceId) {
    const { data: ws } = await supabase.from("workspaces").select("id").limit(1).maybeSingle();
    workspaceId = ws?.id;
  }

  if (!workspaceId) {
    throw new Error("Workspace ID could not be determined for updating client team assignment.");
  }

  const { data, error } = await supabase.rpc("upsert_client_team_assignment", {
    p_workspace_id: workspaceId,
    p_client_id: params.clientId,
    p_primary_strategist_id: params.primaryStrategistId || null,
    p_primary_copywriter_id: params.primaryCopywriterId || null,
    p_primary_designer_id: params.primaryDesignerId || null,
    p_primary_video_editor_id: params.primaryVideoEditorId || null,
    p_strategy_reviewer_id: params.strategyReviewerId || null,
    p_copywriting_reviewer_id: params.copywritingReviewerId || null,
    p_design_reviewer_id: params.designReviewerId || null,
    p_video_reviewer_id: params.videoReviewerId || null,
    p_marketing_director_id: params.marketingDirectorId || null,
    p_strategy_lead_id: params.strategyLeadId || null,
    p_idempotency_key: params.idempotencyKey || null,
    p_requires_video: params.requiresVideo !== undefined ? params.requiresVideo : null,
  });

  if (error) throw new Error(`فشل تحديث فريق العمل: ${error.message}`);
  return data;
}

export async function upsertClientBrief(params: {
  workspaceId?: string;
  clientId: string;
  objectives?: string | null;
  targetAudience?: string | null;
  productsServices?: string | null;
  toneOfVoice?: string | null;
  contentPillars?: string[];
  dosAndDonts?: string | null;
  brandGuidelinesUrl?: string | null;
  assetsDriveUrl?: string | null;
  strategySummary?: string | null;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  let workspaceId = params.workspaceId;
  if (!workspaceId || workspaceId === "00000000-0000-0000-0000-000000000000") {
    const { data: c } = await supabase
      .from("clients")
      .select("workspace_id")
      .eq("id", params.clientId)
      .maybeSingle();
    workspaceId = c?.workspace_id;
  }

  if (!workspaceId) {
    const { data: ws } = await supabase.from("workspaces").select("id").limit(1).maybeSingle();
    workspaceId = ws?.id;
  }

  if (!workspaceId) {
    throw new Error("Workspace ID could not be determined for updating client brief.");
  }

  const { data, error } = await supabase.rpc("upsert_client_brief", {
    p_workspace_id: workspaceId,
    p_client_id: params.clientId,
    p_objectives: params.objectives || null,
    p_target_audience: params.targetAudience || null,
    p_products_services: params.productsServices || null,
    p_tone_of_voice: params.toneOfVoice || null,
    p_content_pillars: params.contentPillars || [],
    p_dos_and_donts: params.dosAndDonts || null,
    p_brand_guidelines_url: params.brandGuidelinesUrl || null,
    p_assets_drive_url: params.assetsDriveUrl || null,
    p_strategy_summary: params.strategySummary || null,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(`فشل تحديث Brief العميل: ${error.message}`);
  return data;
}

export async function reviewClientBriefOperational(params: {
  workspaceId?: string;
  clientId: string;
  decision?: "approved" | "changes_requested";
  feedback?: string | null;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  let workspaceId = params.workspaceId;
  if (!workspaceId || workspaceId === "00000000-0000-0000-0000-000000000000") {
    const { data: c } = await supabase
      .from("clients")
      .select("workspace_id")
      .eq("id", params.clientId)
      .maybeSingle();
    workspaceId = c?.workspace_id;
  }

  if (!workspaceId) {
    const { data: ws } = await supabase.from("workspaces").select("id").limit(1).maybeSingle();
    workspaceId = ws?.id;
  }

  if (!workspaceId) {
    throw new Error("Workspace ID could not be determined for reviewing client brief.");
  }

  const { data, error } = await supabase.rpc("review_client_brief_operational", {
    p_workspace_id: workspaceId,
    p_client_id: params.clientId,
    p_decision: params.decision || "approved",
    p_feedback: params.feedback || null,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(`فشل المراجعة التشغيلية للاستراتيجية: ${error.message}`);
  return data;
}

export async function approveClientBriefStrategy(params: {
  workspaceId?: string;
  clientId: string;
  approvedContent: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  let workspaceId = params.workspaceId;
  if (!workspaceId || workspaceId === "00000000-0000-0000-0000-000000000000") {
    const { data: c } = await supabase
      .from("clients")
      .select("workspace_id")
      .eq("id", params.clientId)
      .maybeSingle();
    workspaceId = c?.workspace_id;
  }

  if (!workspaceId) {
    const { data: ws } = await supabase.from("workspaces").select("id").limit(1).maybeSingle();
    workspaceId = ws?.id;
  }

  if (!workspaceId) {
    throw new Error("Workspace ID could not be determined for approving client brief.");
  }

  const { data, error } = await supabase.rpc("approve_client_brief_strategy", {
    p_workspace_id: workspaceId,
    p_client_id: params.clientId,
    p_approved_content: params.approvedContent,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(`فشل اعتماد الاستراتيجية: ${error.message}`);
  return data;
}


