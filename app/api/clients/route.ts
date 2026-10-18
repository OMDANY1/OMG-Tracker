import { NextRequest, NextResponse } from "next/server";
import {
  createClientAtomic,
  updateClient,
  updateClientAssignment,
  upsertClientTeamAssignment,
  upsertClientBrief,
  reviewClientBriefOperational,
  approveClientBriefStrategy,
} from "@/lib/services/clients";
import {
  requireWorkspaceMembership,
  requireOwner,
  validateSameOrigin,
  isFullAdminRole,
  hasGranularPermission,
} from "@/lib/auth/server-auth";

export async function GET(req: NextRequest) {
  const authRes = await requireWorkspaceMembership(req);
  if (!authRes.success) {
    return authRes.errorResponse;
  }

  const { membership, admin } = authRes.data;
  const workspaceId = membership.workspaceId;
  const isOwner = isFullAdminRole(membership.role);
  const isViewer = membership.role === "business_owner_viewer";
  const callerRosterId = membership.rosterPersonId || null;
  const callerRole = membership.role;

  // Fetch clients with full relations scoped to workspace
  const { data: rawClients, error } = await admin
    .from("clients")
    .select(`
      *,
      owner:roster_people!fk_client_owner(id, display_name, job_title),
      campaigns(id, title, status),
      tasks(id, status, primary_assignee_id, work_stage),
      team_assignment:client_team_assignments(
        *,
        primary_strategist:roster_people!client_team_assignments_primary_strategist_id_fkey(id, display_name, job_title),
        primary_copywriter:roster_people!client_team_assignments_primary_copywriter_id_fkey(id, display_name, job_title),
        primary_designer:roster_people!client_team_assignments_primary_designer_id_fkey(id, display_name, job_title),
        primary_video_editor:roster_people!client_team_assignments_primary_video_editor_id_fkey(id, display_name, job_title),
        strategy_reviewer:roster_people!client_team_assignments_strategy_reviewer_id_fkey(id, display_name, job_title),
        copywriting_reviewer:roster_people!client_team_assignments_copywriting_reviewer_id_fkey(id, display_name, job_title),
        design_reviewer:roster_people!client_team_assignments_design_reviewer_id_fkey(id, display_name, job_title),
        video_reviewer:roster_people!client_team_assignments_video_reviewer_id_fkey(id, display_name, job_title),
        marketing_director:roster_people!client_team_assignments_marketing_director_id_fkey(id, display_name, job_title),
        strategy_lead:roster_people!client_team_assignments_strategy_lead_id_fkey(id, display_name, job_title)
      ),
      brief_data:client_briefs(*)
    `)
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Normalize array relations to single objects
  const clients = (rawClients || []).map((c: any) => ({
    ...c,
    team_assignment: Array.isArray(c.team_assignment) ? c.team_assignment[0] || null : c.team_assignment,
    brief_data: Array.isArray(c.brief_data) ? c.brief_data[0] || null : c.brief_data,
  }));

  // Fetch active roster people with memberships and invitations scoped to workspace
  const [rosterRes, membershipsRes, invitesRes, reviewRulesRes] = await Promise.all([
    admin
      .from("roster_people")
      .select("id, display_name, job_title, specialties, is_active, role, custom_permissions")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .order("display_name", { ascending: true }),
    admin
      .from("workspace_memberships")
      .select("roster_person_id, user_id, is_active")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true),
    admin
      .from("workspace_invitations")
      .select("roster_person_id, status")
      .eq("workspace_id", workspaceId),
    admin
      .from("review_routing_rules")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("priority", { ascending: false }),
  ]);

  if (rosterRes.error) {
    return NextResponse.json({ error: rosterRes.error.message }, { status: 500 });
  }

  const roster = rosterRes.data || [];
  const reviewRules = reviewRulesRes.data || [];

  const joinedSet = new Set<string>();
  membershipsRes.data?.filter((m) => m.user_id && m.roster_person_id).forEach((m) => joinedSet.add(m.roster_person_id!));
  invitesRes.data?.filter((i) => i.status === "accepted" && i.roster_person_id).forEach((i) => joinedSet.add(i.roster_person_id!));

  // Calculate stats for each active roster member
  const allActiveMembers = (roster || []).map((designer) => {
    const memberClients = (clients || []).filter((c) => {
      const team = c.team_assignment;
      if (team) {
        return (
          team.primary_designer_id === designer.id ||
          team.primary_copywriter_id === designer.id ||
          team.primary_strategist_id === designer.id ||
          team.primary_video_editor_id === designer.id ||
          c.owner_roster_id === designer.id
        );
      }
      return c.owner_roster_id === designer.id;
    });
    const clientCount = memberClients.length;
    let openTasksCount = 0;
    (clients || []).forEach((c) => {
      (c.tasks || []).forEach((t: any) => {
        if (t.primary_assignee_id === designer.id && !["delivered", "cancelled"].includes(t.status)) {
          openTasksCount++;
        }
      });
    });

    const hasJoined = joinedSet.has(designer.id) || designer.role === "owner" || designer.role === "company_owner";
    const canApproveReviews = Boolean(
      designer.role !== "marketing_director" &&
        designer.role !== "business_owner_viewer" &&
        designer.role !== "viewer" &&
        (["owner", "company_owner", "manager", "senior_reviewer", "strategy_lead"].includes(designer.role) ||
          designer.custom_permissions?.approve_reviews === true)
    );

    return {
      id: designer.id,
      rosterId: designer.id,
      displayName: designer.display_name,
      display_name: designer.display_name,
      jobTitle: designer.job_title,
      job_title: designer.job_title,
      role: designer.role || "designer",
      specialties: designer.specialties || [],
      custom_permissions: designer.custom_permissions || {},
      isActive: designer.is_active,
      is_active: designer.is_active,
      hasJoined,
      canApproveReviews,
      clientCount,
      openTasksCount,
    };
  });

  // Assignable execution & review members exclude read-only viewers and marketing_director (Ata)
  const allTeamMembers = allActiveMembers.filter(
    (m) => m.role !== "business_owner_viewer" && m.role !== "marketing_director" && m.role !== "viewer"
  );

  const designers = allTeamMembers.filter(
    (m) => m.role === "designer" || !m.specialties.length || m.specialties.includes("design")
  );
  const strategists = allTeamMembers.filter(
    (m) => m.role === "strategist" || m.role === "strategy_lead" || m.specialties.includes("strategy")
  );
  const writers = allTeamMembers.filter(
    (m) => m.role === "content_writer" || m.specialties.includes("copywriting")
  );
  const videoEditors = allTeamMembers.filter(
    (m) => m.role === "video_editor" || m.specialties.includes("video_editing") || m.specialties.includes("video")
  );
  const managers = allActiveMembers.filter(
    (m) =>
      m.role !== "business_owner_viewer" &&
      m.role !== "viewer" &&
      (m.role === "owner" || m.role === "company_owner" || m.role === "manager" || m.role === "marketing_director" || m.specialties.includes("management"))
  );
  const reviewers = allTeamMembers.filter((m) => m.canApproveReviews);

  return NextResponse.json({
    clients: clients || [],
    designers,
    allTeamMembers,
    strategists,
    writers,
    videoEditors,
    managers,
    reviewers,
    reviewRules: reviewRules || [],
    isOwner,
    isViewer,
    callerRosterId,
    callerRole,
  });
}

export async function PUT(req: NextRequest) {
  try {
    if (!validateSameOrigin(req)) {
      return NextResponse.json(
        { error: "طلب غير مصرح به (Same-Origin check failed)." },
        { status: 403 }
      );
    }

    const authRes = await requireWorkspaceMembership(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, serverClient } = authRes.data;

    if (membership.role === "business_owner_viewer" || membership.role === "marketing_director") {
      return NextResponse.json(
        { error: "غير مصرح: دورك الحالي للقراءة والتقارير فقط ولا يملك صلاحية التعديل أو الاعتماد." },
        { status: 403 }
      );
    }

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
      idempotencyKey,
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

    const isAdminOrManager =
      isFullAdminRole(membership.role) ||
      membership.role === "manager" ||
      hasGranularPermission(membership, "manage_clients");

    // 1. Update Team Assignment
    if (action === "update_team") {
      if (!isAdminOrManager && !hasGranularPermission(membership, "assign_team")) {
        return NextResponse.json(
          { error: "غير مصرح: توزيع فريق العميل مقتصر على الإدارة فقط." },
          { status: 403 }
        );
      }
      const result = await upsertClientTeamAssignment({
        workspaceId: membership.workspaceId,
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
        requiresVideo: body.requiresVideo !== undefined ? body.requiresVideo : null,
        idempotencyKey: idempotencyKey || `cta-${clientId}-${Date.now()}`,
        supabaseClient: serverClient,
      });
      return NextResponse.json({ success: true, result });
    }

    // 2. Update Client Brief
    if (action === "update_brief") {
      const result = await upsertClientBrief({
        workspaceId: membership.workspaceId,
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
        idempotencyKey: idempotencyKey || `cb-${clientId}-${Date.now()}`,
        supabaseClient: serverClient,
      });
      return NextResponse.json({ success: true, result });
    }

    // 2.1 Operational Review (Arwa - Strategy Lead / Designated Reviewer / Owner / Company Owner)
    if (action === "review_strategy_operational") {
      const result = await reviewClientBriefOperational({
        workspaceId: membership.workspaceId,
        clientId,
        decision: body.decision || "approved",
        feedback: body.feedback || null,
        idempotencyKey: idempotencyKey || `rev-strat-${clientId}-${Date.now()}`,
        supabaseClient: serverClient,
      });
      return NextResponse.json({ success: true, result });
    }

    // 3. Final Strategy Approval (Strictly Owner / Company Owner only)
    if (action === "approve_strategy") {
      if (!isFullAdminRole(membership.role)) {
        return NextResponse.json(
          { error: "غير مصرح: الاعتماد النهائي للاستراتيجية مقتصر على مالك النظام أو الشريك فقط." },
          { status: 403 }
        );
      }
      if (!approvedContent || !approvedContent.trim()) {
        return NextResponse.json({ error: "Approved content cannot be empty" }, { status: 400 });
      }
      const result = await approveClientBriefStrategy({
        workspaceId: membership.workspaceId,
        clientId,
        approvedContent,
        idempotencyKey: idempotencyKey || `appr-strat-${clientId}-${Date.now()}`,
        supabaseClient: serverClient,
      });
      return NextResponse.json({ success: true, result });
    }

    // 4. Legacy Reassign
    if (action === "reassign" || newOwnerRosterId !== undefined) {
      if (!isAdminOrManager && !hasGranularPermission(membership, "assign_team")) {
        return NextResponse.json(
          { error: "غير مصرح: إعادة إسناد العميل مقتصرة على الإدارة فقط." },
          { status: 403 }
        );
      }
      const result = await updateClientAssignment({
        workspaceId: membership.workspaceId,
        clientId,
        newOwnerRosterId: newOwnerRosterId !== undefined ? newOwnerRosterId : ownerRosterId,
        reassignOpenTasks: !!reassignOpenTasksToNewOwner,
        idempotencyKey: idempotencyKey || `reassign-${clientId}-${Date.now()}`,
        supabaseClient: serverClient,
      });
      return NextResponse.json({ success: true, result });
    }

    if (!isAdminOrManager) {
      return NextResponse.json(
        { error: "غير مصرح: تعديل بيانات العميل مقتصر على الإدارة فقط." },
        { status: 403 }
      );
    }

    const updated = await updateClient({
      workspaceId: membership.workspaceId,
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
      idempotencyKey: idempotencyKey || `upd-client-${clientId}-${Date.now()}`,
      supabaseClient: serverClient,
    });

    return NextResponse.json({ client: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!validateSameOrigin(req)) {
      return NextResponse.json(
        { error: "طلب غير مصرح به (Same-Origin check failed)." },
        { status: 403 }
      );
    }

    const authRes = await requireOwner(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, admin, serverClient } = authRes.data;
    const body = await req.json();
    const {
      name,
      difficulty,
      extraWorkload,
      state,
      notes,
      brandGuideUrl,
      briefUrl,
      idempotencyKey,
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
      requiresVideo,
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
    } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "اسم العميل مطلوب ولا يمكن أن يكون فارغاً." }, { status: 400 });
    }

    const cleanName = name.trim();
    const stableKey =
      typeof idempotencyKey === "string" && idempotencyKey.trim()
        ? idempotencyKey.trim()
        : `client-create-atomic-${membership.workspaceId}-${cleanName.toLowerCase()}`;

    // Single atomic transaction for client + team assignment + brief
    const atomicRes = await createClientAtomic({
      workspaceId: membership.workspaceId,
      name: cleanName,
      difficulty: difficulty || "Medium",
      extraWorkload: extraWorkload || "None",
      state: state || "Active",
      notes: notes || null,
      brandGuideUrl: brandGuideUrl || null,
      briefUrl: briefUrl || null,
      primaryStrategistId: primaryStrategistId || null,
      primaryCopywriterId: primaryCopywriterId || null,
      primaryDesignerId: primaryDesignerId || null,
      primaryVideoEditorId: primaryVideoEditorId || null,
      strategyReviewerId: strategyReviewerId || null,
      copywritingReviewerId: copywritingReviewerId || null,
      designReviewerId: designReviewerId || null,
      videoReviewerId: videoReviewerId || null,
      marketingDirectorId: marketingDirectorId || null,
      strategyLeadId: strategyLeadId || null,
      requiresVideo: Boolean(requiresVideo),
      objectives: objectives || null,
      targetAudience: targetAudience || null,
      productsServices: productsServices || null,
      toneOfVoice: toneOfVoice || null,
      contentPillars: Array.isArray(contentPillars) ? contentPillars : [],
      dosAndDonts: dosAndDonts || null,
      brandGuidelinesUrl: brandGuidelinesUrl || null,
      assetsDriveUrl: assetsDriveUrl || null,
      strategySummary: strategySummary || null,
      idempotencyKey: stableKey,
      supabaseClient: serverClient,
    });

    const clientId = atomicRes?.client_id || atomicRes?.client?.id;
    if (!clientId) {
      throw new Error("فشل الحصول على معرف العميل الجديد.");
    }

    const { data: createdClient } = await admin
      .from("clients")
      .select(`
        *,
        team_assignment:client_team_assignments(*),
        brief_data:client_briefs(*)
      `)
      .eq("id", clientId)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      message: `تم إنشاء العميل (${cleanName}) بنجاح.`,
      client: createdClient || { id: clientId, name: cleanName },
      clientId,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "فشل إنشاء العميل." }, { status: 400 });
  }
}

