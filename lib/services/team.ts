import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { ClientDifficulty, RosterPerson, RosterRole } from "@/types/database";

async function getClient() {
  const serverClient = await createServerSupabaseClient().catch(() => null);
  return serverClient || createAdminClient();
}

export async function createWorkspaceInvitation(params: {
  workspaceId: string;
  email: string;
  role: RosterRole;
  rosterPersonId: string;
  idempotencyKey: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  if (!params.idempotencyKey || !params.idempotencyKey.trim()) {
    throw new Error("Idempotency key is mandatory for creating invitations.");
  }

  const { data, error } = await supabase.rpc("create_workspace_invitation", {
    p_workspace_id: params.workspaceId,
    p_email: params.email.trim(),
    p_role: params.role,
    p_roster_person_id: params.rosterPersonId,
    p_idempotency_key: params.idempotencyKey.trim(),
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function acceptWorkspaceInvitation(params: {
  rawToken: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  if (!params.rawToken || !params.rawToken.trim()) {
    throw new Error("Invitation token is required.");
  }

  const { data, error } = await supabase.rpc("accept_workspace_invitation", {
    p_raw_token: params.rawToken.trim(),
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function revokeWorkspaceInvitation(params: {
  workspaceId: string;
  invitationId: string;
  idempotencyKey: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  if (!params.idempotencyKey || !params.idempotencyKey.trim()) {
    throw new Error("Idempotency key is mandatory for revoking invitations.");
  }

  const { data, error } = await supabase.rpc("revoke_workspace_invitation", {
    p_workspace_id: params.workspaceId,
    p_invitation_id: params.invitationId,
    p_idempotency_key: params.idempotencyKey.trim(),
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function createRosterPerson(params: {
  workspaceId: string;
  displayName: string;
  jobTitle: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("create_roster_person", {
    p_workspace_id: params.workspaceId,
    p_display_name: params.displayName.trim(),
    p_job_title: params.jobTitle.trim(),
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function updateRosterPerson(params: {
  workspaceId: string;
  rosterPersonId: string;
  displayName: string;
  jobTitle: string;
  isActive: boolean;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("update_roster_person", {
    p_workspace_id: params.workspaceId,
    p_roster_person_id: params.rosterPersonId,
    p_display_name: params.displayName.trim(),
    p_job_title: params.jobTitle.trim(),
    p_is_active: params.isActive,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function createReviewRoutingRule(params: {
  workspaceId: string;
  priority: number;
  designerRosterId: string;
  clientDifficulty: ClientDifficulty;
  reviewerRosterId: string;
  fallbackReviewerId: string;
  isWorkspaceDefault?: boolean;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("create_review_routing_rule", {
    p_workspace_id: params.workspaceId,
    p_priority: params.priority,
    p_designer_roster_id: params.designerRosterId,
    p_client_difficulty: params.clientDifficulty,
    p_reviewer_roster_id: params.reviewerRosterId,
    p_fallback_reviewer_id: params.fallbackReviewerId,
    p_is_workspace_default: !!params.isWorkspaceDefault,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function deleteReviewRoutingRule(params: {
  workspaceId: string;
  ruleId: string;
  idempotencyKey?: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("delete_review_routing_rule", {
    p_workspace_id: params.workspaceId,
    p_rule_id: params.ruleId,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function transferWorkspaceOwnership(params: {
  workspaceId: string;
  newOwnerRosterId: string;
  idempotencyKey: string;
}) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  if (!params.idempotencyKey || !params.idempotencyKey.trim()) {
    throw new Error("Idempotency key is mandatory for ownership transfer.");
  }

  const { data, error } = await supabase.rpc("transfer_workspace_ownership", {
    p_workspace_id: params.workspaceId,
    p_new_owner_roster_id: params.newOwnerRosterId,
    p_idempotency_key: params.idempotencyKey.trim(),
  });

  if (error) throw new Error(error.message);
  return data;
}
