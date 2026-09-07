import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Campaign, CampaignStatus, TaskPriority } from "@/types/database";

async function getClient() {
  const serverClient = await createServerSupabaseClient().catch(() => null);
  return serverClient || createAdminClient();
}

export async function getCampaigns(workspaceId: string, clientId?: string): Promise<Campaign[]> {
  const supabase = await getClient();
  if (!supabase) return [];

  let query = supabase
    .from("campaigns")
    .select(`
      *,
      client:clients(id, name, difficulty),
      tasks(id, status, primary_assignee_id, deliverable_number, deliverable_type)
    `)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (clientId) query = query.eq("client_id", clientId);

  const { data: campaigns, error } = await query;
  if (error) {
    console.error("Error fetching campaigns:", error.message);
    return [];
  }

  return campaigns || [];
}

export async function createCampaign(params: {
  workspaceId: string;
  clientId: string;
  title: string;
  objective?: string | null;
  brief?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  status?: CampaignStatus;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("create_campaign", {
    p_workspace_id: params.workspaceId,
    p_client_id: params.clientId,
    p_title: params.title,
    p_objective: params.objective || null,
    p_brief: params.brief || null,
    p_start_date: params.startDate || null,
    p_due_date: params.dueDate || null,
    p_status: params.status || "Draft",
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function updateCampaign(params: {
  campaignId: string;
  workspaceId?: string;
  title?: string;
  objective?: string | null;
  brief?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  status?: CampaignStatus;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("update_campaign", {
    p_campaign_id: params.campaignId,
    p_workspace_id: params.workspaceId || null,
    p_title: params.title || null,
    p_objective: params.objective !== undefined ? params.objective : null,
    p_brief: params.brief !== undefined ? params.brief : null,
    p_start_date: params.startDate || null,
    p_due_date: params.dueDate || null,
    p_status: params.status || null,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function archiveCampaign(params: {
  campaignId: string;
  workspaceId?: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("archive_campaign", {
    p_campaign_id: params.campaignId,
    p_workspace_id: params.workspaceId || null,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function generateCampaignPosts(params: {
  workspaceId: string;
  campaignId: string;
  clientId: string;
  postCount?: number;
  deliverableType?: string;
  priority?: TaskPriority;
  primaryAssigneeId?: string | null;
  reviewerId?: string | null;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("generate_campaign_posts", {
    p_workspace_id: params.workspaceId,
    p_campaign_id: params.campaignId,
    p_client_id: params.clientId,
    p_post_count: params.postCount || 12,
    p_deliverable_type: params.deliverableType || "Post",
    p_priority: params.priority || "Normal",
    p_primary_assignee_id: params.primaryAssigneeId || null,
    p_reviewer_id: params.reviewerId || null,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}
