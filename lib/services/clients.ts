import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Client, ClientDifficulty, ClientExtraWorkload, ClientState } from "@/types/database";

async function getClient() {
  const serverClient = await createServerSupabaseClient().catch(() => null);
  return serverClient || createAdminClient();
}

export async function getClients(workspaceId: string): Promise<Client[]> {
  const supabase = await getClient();
  if (!supabase) return [];

  const { data: clients, error } = await supabase
    .from("clients")
    .select(`
      *,
      owner:roster_people!clients_owner_roster_id_fkey(id, display_name, job_title),
      campaigns(id, title, status),
      tasks(id, status, primary_assignee_id)
    `)
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });

  if (error) {
    console.error("Error fetching clients:", error.message);
    return [];
  }

  return clients || [];
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
