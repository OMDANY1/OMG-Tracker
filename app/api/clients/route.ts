import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  updateClient,
  updateClientAssignment,
  upsertClientTeamAssignment,
  upsertClientBrief,
  approveClientBriefStrategy,
} from "@/lib/services/clients";

export async function GET() {
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ clients: [], error: "Database unconfigured" });
  }

  // Determine caller role if session exists
  let isOwner = false;
  let callerRosterId: string | null = null;
  const serverClient = await createServerSupabaseClient().catch(() => null);
  if (serverClient) {
    const { data: authData } = await serverClient.auth.getUser();
    if (authData?.user) {
      const { data: member } = await admin
        .from("workspace_memberships")
        .select("role, roster_person_id")
        .eq("user_id", authData.user.id)
        .eq("is_active", true)
        .maybeSingle();
      if (member?.role === "owner") {
        isOwner = true;
      }
      callerRosterId = member?.roster_person_id || null;
    }
  }

  // Fetch clients
  const { data: clients, error } = await admin
    .from("clients")
    .select(`
      *,
      owner:roster_people!fk_client_owner(id, display_name, job_title),
      campaigns(id, title, status),
      tasks(id, status, primary_assignee_id, work_stage),
      team_assignment:client_team_assignments(*),
      brief_data:client_briefs(*)
    `)
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fetch active roster people (excluding generic owner)
  const { data: roster } = await admin
    .from("roster_people")
    .select("id, display_name, job_title, specialties, is_active")
    .eq("is_active", true)
    .order("display_name", { ascending: true });

  // Fetch review routing rules
  const { data: reviewRules } = await admin
    .from("review_routing_rules")
    .select("*")
    .order("priority", { ascending: false });

  // Calculate stats for each team member
  const allTeamMembers = (roster || []).map((designer) => {
    const clientCount = (clients || []).filter((c) => c.owner_roster_id === designer.id).length;
    let openTasksCount = 0;
    (clients || []).forEach((c) => {
      (c.tasks || []).forEach((t: any) => {
        if (t.primary_assignee_id === designer.id && !["delivered", "cancelled"].includes(t.status)) {
          openTasksCount++;
        }
      });
    });
    return {
      id: designer.id,
      rosterId: designer.id,
      displayName: designer.display_name,
      display_name: designer.display_name,
      jobTitle: designer.job_title,
      job_title: designer.job_title,
      specialties: designer.specialties || [],
      isActive: designer.is_active,
      is_active: designer.is_active,
      clientCount,
      openTasksCount,
    };
  });

  const designers = allTeamMembers.filter(
    (m) => !m.specialties.length || m.specialties.includes("design")
  );
  const strategists = allTeamMembers.filter((m) => m.specialties.includes("strategy"));
  const writers = allTeamMembers.filter((m) => m.specialties.includes("copywriting"));
  const videoEditors = allTeamMembers.filter((m) => m.specialties.includes("video_editing"));
  const managers = allTeamMembers.filter((m) => m.specialties.includes("management"));

  return NextResponse.json({
    clients: clients || [],
    designers,
    allTeamMembers,
    strategists,
    writers,
    videoEditors,
    managers,
    reviewRules: reviewRules || [],
    isOwner,
    callerRosterId,
  });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      clientId,
      action,
      newOwnerRosterId,
      reassignOpenTasksToNewOwner,
      name,
      ownerRosterId,
      difficulty,
      extraWorkload,
      state,
      notes,
      brandGuideUrl,
      briefUrl,
      actorId,
      // Team assignment fields
      primaryStrategistId,
      primaryCopywriterId,
      primaryDesignerId,
      primaryVideoEditorId,
      strategyReviewerId,
      copywritingReviewerId,
      designReviewerId,
      videoReviewerId,
      marketingDirectorId,
      strategyLeadId,
      // Brief fields
      objectives,
      targetAudience,
      productsServices,
      toneOfVoice,
      contentPillars,
      dosAndDonts,
      brandGuidelinesUrl,
      assetsDriveUrl,
      strategySummary,
      approvedContent,
    } = body;

    if (!clientId) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }

    // 1. Update Team Assignment
    if (action === "update_team") {
      const result = await upsertClientTeamAssignment({
        workspaceId: "00000000-0000-0000-0000-000000000000",
        clientId,
        primaryStrategistId,
        primaryCopywriterId,
        primaryDesignerId,
        primaryVideoEditorId,
        strategyReviewerId,
        copywritingReviewerId,
        designReviewerId,
        videoReviewerId,
        marketingDirectorId,
        strategyLeadId,
        idempotencyKey: `cta-${clientId}-${Date.now()}`,
      });
      return NextResponse.json({ success: true, result });
    }

    // 2. Update Client Brief
    if (action === "update_brief") {
      const result = await upsertClientBrief({
        workspaceId: "00000000-0000-0000-0000-000000000000",
        clientId,
        objectives,
        targetAudience,
        productsServices,
        toneOfVoice,
        contentPillars,
        dosAndDonts,
        brandGuidelinesUrl,
        assetsDriveUrl,
        strategySummary,
        idempotencyKey: `cb-${clientId}-${Date.now()}`,
      });
      return NextResponse.json({ success: true, result });
    }

    // 3. Approve Strategy
    if (action === "approve_strategy") {
      if (!approvedContent || !approvedContent.trim()) {
        return NextResponse.json({ error: "Approved content cannot be empty" }, { status: 400 });
      }
      const result = await approveClientBriefStrategy({
        workspaceId: "00000000-0000-0000-0000-000000000000",
        clientId,
        approvedContent,
        idempotencyKey: `appr-strat-${clientId}-${Date.now()}`,
      });
      return NextResponse.json({ success: true, result });
    }

    // 4. Legacy Reassign
    if (action === "reassign" || newOwnerRosterId !== undefined) {
      const result = await updateClientAssignment({
        clientId,
        newOwnerRosterId: newOwnerRosterId !== undefined ? newOwnerRosterId : ownerRosterId,
        reassignOpenTasks: !!reassignOpenTasksToNewOwner,
      });
      return NextResponse.json({ success: true, result });
    }

    const updated = await updateClient({
      clientId,
      name,
      ownerRosterId,
      difficulty,
      extraWorkload,
      state,
      notes,
      brandGuideUrl,
      briefUrl,
      reassignOpenTasksToNewOwner,
      actorId,
    });

    return NextResponse.json({ client: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
