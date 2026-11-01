import { NextRequest, NextResponse } from "next/server";
import { requireOwner, requireOwnerOrViewer } from "@/lib/auth/server-auth";
import {
  resolveEffectivePermissions,
  resolvePermissionDetails,
  resolveEffectiveAccessScope,
  mergeCustomPermissions,
  isClientInMemberScope,
  type PermissionResolutionDetail,
} from "@/lib/auth/permissions";
import type {
  AccessScope,
  CustomPermissions,
  GranularPermissionKey,
  RosterRole,
} from "@/types/database";

export const dynamic = "force-dynamic";

export interface DesignerWorkloadMetric {
  id: string;
  displayName: string;
  jobTitle: string;
  role: string;
  accessScope: AccessScope;
  access_scope: AccessScope;
  customPermissions: CustomPermissions;
  custom_permissions: CustomPermissions;
  effectivePermissions: Required<CustomPermissions>;
  permissionDetails: Record<GranularPermissionKey, PermissionResolutionDetail>;
  specialties?: string[];
  hasJoined?: boolean;
  isActive?: boolean;
  weeklyHours: number;
  reservedHours: number;
  activeClientsCount: number;
  activeTasksCount: number;
  weightedLoadScore: number;
  maxWeightedLoad: number;
  loadRatio: number;
  status: "underutilized" | "balanced" | "overloaded";
  dueNext7Days: number;
  dueNext14Days: number;
  clients: { id: string; name: string; difficulty: string }[];
  notes?: string | null;
}

export async function GET(req: NextRequest) {
  try {
    // Protected by requireOwner with read access for business_owner_viewer
    const authResult = await requireOwnerOrViewer(req);
    if (!authResult.success) {
      return authResult.errorResponse;
    }

    const { membership, admin } = authResult.data;
    const workspaceId = membership.workspaceId;
    const isOwner = ["owner", "company_owner"].includes(membership.role);
    const isViewer = !isOwner;

    // 1. Get Workspace & Invitations Status
    const { data: ws } = await admin
      .from("workspaces")
      .select("id, invitations_paused")
      .eq("id", workspaceId)
      .single();

    // 2. Fetch all required data in parallel
    const [rosterRes, membershipsRes, capacitiesRes, clientsRes, assignmentsRes, tasksRes, invitesRes] = await Promise.all([
      admin
        .from("roster_people")
        .select("id, display_name, job_title, is_active, specialties, role, access_scope, custom_permissions, updated_at")
        .eq("workspace_id", workspaceId)
        .order("display_name", { ascending: true }),
      admin
        .from("workspace_memberships")
        .select("roster_person_id, role, user_id, access_scope, custom_permissions, updated_at")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true),
      admin
        .from("member_capacities")
        .select("*")
        .eq("workspace_id", workspaceId),
      admin
        .from("clients")
        .select("id, name, difficulty, owner_roster_id, state")
        .eq("workspace_id", workspaceId)
        .eq("state", "Active"),
      admin
        .from("client_team_assignments")
        .select("*")
        .eq("workspace_id", workspaceId),
      admin
        .from("tasks")
        .select(`
          id,
          client_id,
          primary_assignee_id,
          status,
          priority,
          deliverable_format,
          deliverable_number,
          due_date,
          design_due_date,
          review_due_date,
          publish_at,
          client:clients(id, name, difficulty),
          content_calendar_item:content_calendar_items!fk_cci_task(slides)
        `)
        .eq("workspace_id", workspaceId)
        .not("status", "in", '("approved","delivered","cancelled")'),
      admin
        .from("workspace_invitations")
        .select("roster_person_id, status")
        .eq("workspace_id", workspaceId),
    ]);

    if (rosterRes.error) {
      return NextResponse.json({ error: rosterRes.error.message }, { status: 500 });
    }

    const roster = rosterRes.data || [];
    const memberships = membershipsRes.data || [];
    const capacities = capacitiesRes.data || [];
    const clients = clientsRes.data || [];
    const assignments = assignmentsRes.data || [];
    const tasks = tasksRes.data || [];
    const invitations = invitesRes.data || [];

    const assignmentsByClientId = new Map<string, any>();
    for (const a of assignments) {
      assignmentsByClientId.set(a.client_id, a);
    }

    const membershipMap = new Map<string, any>();
    for (const m of memberships) {
      if (m.roster_person_id) {
        membershipMap.set(m.roster_person_id, m);
      }
    }

    const acceptedInvitesRosterSet = new Set<string>();
    for (const inv of invitations) {
      if (inv.status === "accepted" && inv.roster_person_id) {
        acceptedInvitesRosterSet.add(inv.roster_person_id);
      }
    }

    const capacityMap = new Map<string, any>();
    for (const c of capacities) {
      if (c.roster_person_id) {
        capacityMap.set(c.roster_person_id, c);
      }
    }

    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const metrics: DesignerWorkloadMetric[] = roster.map((person) => {
      const mem = membershipMap.get(person.id);
      // Security role is strictly derived from DB role columns (never inferred from display_name or job_title)
      const role = ((mem?.role || (person as any).role || "designer") as RosterRole);

      const resolvedAccessScope = resolveEffectiveAccessScope(
        role,
        (mem?.access_scope || (person as any).access_scope) as AccessScope
      );
      const mergedCustomPerms = mergeCustomPermissions(
        mem?.custom_permissions as CustomPermissions,
        (person as any).custom_permissions as CustomPermissions
      );
      const effectivePermissions = resolveEffectivePermissions(
        role,
        mem?.custom_permissions as CustomPermissions,
        (person as any).custom_permissions as CustomPermissions
      );
      const permissionDetails = resolvePermissionDetails(
        role,
        mem?.custom_permissions as CustomPermissions,
        (person as any).custom_permissions as CustomPermissions
      );

      const assignedClients = (clients || []).filter((c) => {
        const team = assignmentsByClientId.get(c.id);
        if (role === "strategy_lead" || role === "senior_reviewer") {
          return isClientInMemberScope({
            client: { ...c, team_assignment: team },
            rosterPersonId: person.id,
            role,
            accessScope: resolvedAccessScope,
            rosterMembers: roster,
          });
        }
        if (team) {
          return (
            team.primary_designer_id === person.id ||
            team.primary_copywriter_id === person.id ||
            team.primary_strategist_id === person.id ||
            team.primary_video_editor_id === person.id ||
            team.strategy_reviewer_id === person.id ||
            team.copywriting_reviewer_id === person.id ||
            team.design_reviewer_id === person.id ||
            team.video_reviewer_id === person.id ||
            team.strategy_lead_id === person.id ||
            c.owner_roster_id === person.id
          );
        }
        return c.owner_roster_id === person.id;
      });
      const personTasks = (tasks || []).filter((t) => t.primary_assignee_id === person.id);

      let totalWeightedLoad = 0;
      let due7 = 0;
      let due14 = 0;

      for (const t of personTasks) {
        // Calculate Base Deliverable Format Weight
        const format = (t.deliverable_format || "Static").toLowerCase();
        let baseWeight = 1.0;

        if (format.includes("carousel")) {
          const cci = Array.isArray(t.content_calendar_item) ? t.content_calendar_item[0] : t.content_calendar_item;
          const slidesCount = Array.isArray(cci?.slides) ? cci.slides.length : 4;
          baseWeight = 1.5 + 0.15 * Math.max(1, slidesCount);
        } else if (format.includes("reel") || format.includes("video") || format.includes("motion")) {
          baseWeight = 2.5;
        } else {
          baseWeight = 1.0;
        }

        // Calculate Client Difficulty Multiplier
        const clientObj: any = Array.isArray(t.client) ? t.client[0] : t.client;
        const clientDiff = (clientObj?.difficulty || "Medium").toLowerCase();
        let diffMultiplier = 1.0;
        if (clientDiff === "easy") diffMultiplier = 0.9;
        else if (clientDiff === "hard") diffMultiplier = 1.2;
        else diffMultiplier = 1.0;

        totalWeightedLoad += baseWeight * diffMultiplier;

        // Due date radar (prioritizing design_due_date for production, falling back to due_date)
        const targetDate = t.design_due_date || t.due_date;
        if (targetDate) {
          const dueDate = new Date(targetDate);
          if (dueDate >= now && dueDate <= in7Days) {
            due7++;
          }
          if (dueDate >= now && dueDate <= in14Days) {
            due14++;
          }
        }
      }

      const capRecord = capacityMap.get(person.id);
      const weeklyHours = capRecord?.weekly_hours ?? capRecord?.weekly_hours_limit ?? 40;
      const reservedHours =
        capRecord?.reserved_management_hours ??
        (role === "owner" || role === "company_owner" ? 15 : role === "senior_reviewer" ? 8 : 0);
      const maxWeighted = capRecord?.max_weighted_load || 15.0;

      const loadRatio = Math.min(100, Math.round((totalWeightedLoad / maxWeighted) * 100));

      let status: "underutilized" | "balanced" | "overloaded" = "balanced";
      if (loadRatio < 60) status = "underutilized";
      else if (loadRatio > 90) status = "overloaded";

      const userId = mem?.user_id || null;
      // Strictly verify if member has truly joined:
      // Must have userId AND (be the active Owner/Company Owner OR have an accepted invitation)
      const hasJoined = Boolean(userId && (role === "owner" || role === "company_owner" || acceptedInvitesRosterSet.has(person.id)));

      return {
        id: person.id,
        displayName: person.display_name,
        jobTitle: person.job_title || "Graphic Designer",
        role,
        accessScope: resolvedAccessScope,
        access_scope: resolvedAccessScope,
        customPermissions: effectivePermissions,
        custom_permissions: effectivePermissions,
        rawCustomPermissions: mergedCustomPerms,
        effectivePermissions,
        permissionDetails,
        specialties: (person as any).specialties || [],
        hasJoined,
        isActive: person.is_active !== false,
        weeklyHours,
        reservedHours,
        activeClientsCount: assignedClients.length,
        activeTasksCount: personTasks.length,
        weightedLoadScore: Math.round(totalWeightedLoad * 10) / 10,
        maxWeightedLoad: maxWeighted,
        loadRatio,
        status,
        dueNext7Days: due7,
        dueNext14Days: due14,
        clients: assignedClients.map((c) => ({
          id: c.id,
          name: c.name,
          difficulty: c.difficulty || "Medium",
        })),
        notes:
          role === "owner" || role === "company_owner"
            ? "مالك الايجنسي والمدير الفني: مراجعة الحسابات والتوجيه الإبداعي"
            : role === "senior_reviewer"
            ? "مراجع أول: مراجعة تصاميم المصممين وتدقيق الجودة"
            : null,
      };
    });

    return NextResponse.json(
      {
        success: true,
        workspaceId,
        isOwner,
        isViewer,
        callerRole: membership.role,
        callerRosterId: membership.rosterPersonId,
        invitationsPaused: Boolean(ws?.invitations_paused),
        members: metrics,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
