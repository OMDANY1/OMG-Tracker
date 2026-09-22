import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  createClient,
  updateClient,
  updateClientAssignment,
  upsertClientTeamAssignment,
  upsertClientBrief,
  reviewClientBriefOperational,
  approveClientBriefStrategy,
} from "@/lib/services/clients";
import { requireOwner, validateSameOrigin } from "@/lib/auth/server-auth";

export async function GET() {
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Database unconfigured" }, { status: 503 });
  }

  // Determine caller role if session exists
  let isOwner = false;
  let isViewer = false;
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
      if (member?.role === "business_owner_viewer") {
        isViewer = true;
      }
      callerRosterId = member?.roster_person_id || null;
    }
  }

  // Fetch clients with full relations
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
    isViewer,
    callerRosterId,
  });
}

export async function PUT(req: NextRequest) {
  try {
    const serverClient = await createServerSupabaseClient().catch(() => null);
    if (serverClient) {
      const { data: authData } = await serverClient.auth.getUser();
      if (authData?.user) {
        const admin = createAdminClient();
        if (admin) {
          const { data: member } = await admin
            .from("workspace_memberships")
            .select("role")
            .eq("user_id", authData.user.id)
            .eq("is_active", true)
            .maybeSingle();
          if (member?.role === "business_owner_viewer") {
            return NextResponse.json(
              { error: "غير مصرح: حساب مالك الشركة للمشاهدة فقط ولا يملك صلاحية التعديل." },
              { status: 403 }
            );
          }
        }
      }
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
        requiresVideo: body.requiresVideo !== undefined ? body.requiresVideo : null,
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

    // 2.1 Operational Review (Arwa - Strategy Lead / Designated Reviewer)
    if (action === "review_strategy_operational") {
      const result = await reviewClientBriefOperational({
        workspaceId: "00000000-0000-0000-0000-000000000000",
        clientId,
        decision: body.decision || "approved",
        feedback: body.feedback || null,
        idempotencyKey: `rev-strat-${clientId}-${Date.now()}`,
      });
      return NextResponse.json({ success: true, result });
    }

    // 3. Marketing Strategy Approval (Ata - Marketing Director / Owner Emad)
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

    const { membership, admin } = authRes.data;
    const body = await req.json();
    const {
      name,
      difficulty,
      extraWorkload,
      state,
      notes,
      brandGuideUrl,
      briefUrl,
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

    // 1. Create client
    const clientResult = await createClient({
      workspaceId: membership.workspaceId,
      name: name.trim(),
      ownerRosterId: primaryDesignerId || null,
      difficulty: difficulty || "Medium",
      extraWorkload: extraWorkload || "None",
      state: state || "Active",
      notes: notes || null,
      brandGuideUrl: brandGuideUrl || null,
      briefUrl: briefUrl || null,
      idempotencyKey: `client-create-${Date.now()}`,
    });

    const createdClient = clientResult?.client || clientResult;
    const clientId = createdClient?.id;

    if (!clientId) {
      throw new Error("فشل الحصول على معرف العميل الجديد.");
    }

    // 2. Upsert team assignment
    await upsertClientTeamAssignment({
      workspaceId: membership.workspaceId,
      clientId,
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
      requiresVideo: !!requiresVideo,
      idempotencyKey: `cta-create-${clientId}-${Date.now()}`,
    });

    // 3. If brief details provided, create initial brief
    if (
      objectives ||
      targetAudience ||
      productsServices ||
      toneOfVoice ||
      contentPillars ||
      dosAndDonts ||
      strategySummary ||
      brandGuidelinesUrl ||
      assetsDriveUrl
    ) {
      await upsertClientBrief({
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
        idempotencyKey: `brief-create-${clientId}-${Date.now()}`,
      });
    }

    // 4. Audit event
    await admin.from("audit_events").insert({
      workspace_id: membership.workspaceId,
      actor_id: membership.rosterPersonId,
      action: "create_client",
      entity_type: "clients",
      entity_id: clientId,
      metadata: {
        name: name.trim(),
        difficulty: difficulty || "Medium",
        primary_designer_id: primaryDesignerId || null,
        requires_video: !!requiresVideo,
      },
    });

    return NextResponse.json({
      success: true,
      message: `تم إنشاء العميل (${name.trim()}) بنجاح.`,
      client: createdClient,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "فشل إنشاء العميل." }, { status: 400 });
  }
}

