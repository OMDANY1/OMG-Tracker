import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, type User, type SupabaseClient } from "@supabase/supabase-js";
import type {
  RosterRole,
  AccessScope,
  CustomPermissions,
  GranularPermissionKey,
} from "@/types/database";
import { DEFAULT_ROLE_PERMISSIONS } from "@/types/database";
import {
  resolveEffectivePermissions,
  resolvePermissionDetails,
  resolveEffectiveAccessScope,
  mergeCustomPermissions,
  isClientInMemberScope,
  type PermissionResolutionDetail,
} from "@/lib/auth/permissions";

export interface ActiveMembershipContext {
  id: string;
  workspaceId: string;
  userId: string;
  rosterPersonId: string;
  role: RosterRole;
  accessScope?: AccessScope;
  customPermissions?: CustomPermissions;
  effectivePermissions?: Required<CustomPermissions>;
  permissionDetails?: Record<GranularPermissionKey, PermissionResolutionDetail>;
  displayName?: string;
  jobTitle?: string;
  specialties?: string[];
  updatedAt?: string;
}

export type AuthResult<T> =
  | { success: true; data: T; errorResponse?: never }
  | { success: false; data?: never; errorResponse: NextResponse };

/**
 * Returns true if the role has full administrative authority (owner or company_owner).
 */
export function isFullAdminRole(role?: string | null): boolean {
  return role === "owner" || role === "company_owner";
}

/**
 * Validates Same-Origin header for state-mutating requests (POST, PATCH, PUT, DELETE).
 */
export function validateSameOrigin(req: NextRequest): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;

  const origin = req.headers.get("origin");
  const host = req.headers.get("host");

  if (!origin) {
    const referer = req.headers.get("referer");
    if (referer) {
      try {
        const refUrl = new URL(referer);
        if (host && refUrl.host !== host) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  try {
    const originUrl = new URL(origin);
    if (host && originUrl.host === host) return true;

    const allowed = [
      "omg-creative-workspace.vercel.app",
      "localhost:3000",
      "127.0.0.1:3000",
    ];
    return allowed.includes(originUrl.host);
  } catch {
    return false;
  }
}

/**
 * Ensures the caller is an authenticated user with a valid Supabase session.
 * Does NOT instantiate admin client before session verification.
 */
export async function requireAuthenticatedUser(
  req: NextRequest
): Promise<AuthResult<{ user: User; serverClient: SupabaseClient }>> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const authHeader = req.headers.get("authorization");

    let serverClient = await createServerSupabaseClient().catch(() => null);
    let user: User | null = null;
    let clientToUse: SupabaseClient | null = serverClient;

    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      const token = authHeader.replace(/^bearer\s+/i, "").trim();
      if (supabaseUrl && supabaseAnonKey && token) {
        const tokenClient = createClient(supabaseUrl, supabaseAnonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data: tokenUser, error: tokenErr } = await tokenClient.auth.getUser(token);
        if (!tokenErr && tokenUser?.user) {
          user = tokenUser.user;
          clientToUse = tokenClient;
        }
      }
    }

    if (!user && serverClient) {
      const { data: authData, error: authErr } = await serverClient.auth.getUser();
      if (!authErr && authData?.user) {
        user = authData.user;
      }
    }

    if (!user || !clientToUse) {
      return {
        success: false,
        errorResponse: NextResponse.json(
          { error: "يجب تسجيل الدخول أولاً." },
          { status: 401 }
        ),
      };
    }

    return {
      success: true,
      data: { user, serverClient: clientToUse },
    };
  } catch (err: any) {
    return {
      success: false,
      errorResponse: NextResponse.json(
        { error: "فشل التحقق من الجلسة." },
        { status: 401 }
      ),
    };
  }
}

/**
 * Ensures caller is an authenticated user belonging to an active workspace membership.
 * Derives workspace_id, role, access_scope, custom_permissions, and roster_person_id exclusively from DB.
 */
export async function requireWorkspaceMembership(
  req: NextRequest,
  options?: {
    allowedRoles?: RosterRole[];
  }
): Promise<
  AuthResult<{
    user: User;
    membership: ActiveMembershipContext;
    admin: SupabaseClient;
    serverClient: SupabaseClient;
  }>
> {
  const authRes = await requireAuthenticatedUser(req);
  if (!authRes.success) {
    return { success: false, errorResponse: authRes.errorResponse };
  }

  const { user, serverClient } = authRes.data;

  // Safe to create admin client AFTER auth verification has succeeded
  const admin = createAdminClient();
  if (!admin) {
    return {
      success: false,
      errorResponse: NextResponse.json(
        { error: "تعذر الاتصال بقاعدة البيانات." },
        { status: 500 }
      ),
    };
  }

  // Derive membership exclusively from auth.uid()
  const { data: membership, error: memErr } = await admin
    .from("workspace_memberships")
    .select(`
      id,
      workspace_id,
      user_id,
      roster_person_id,
      role,
      access_scope,
      custom_permissions,
      is_active,
      updated_at,
      roster_person:roster_people!fk_membership_roster(
        id,
        display_name,
        job_title,
        role,
        access_scope,
        custom_permissions,
        specialties,
        is_active,
        updated_at
      )
    `)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (memErr || !membership) {
    return {
      success: false,
      errorResponse: NextResponse.json(
        { error: "غير مصرح: لا توجد عضوية نشطة في مساحة العمل." },
        { status: 403 }
      ),
    };
  }

  const rosterObj: any = Array.isArray(membership.roster_person)
    ? membership.roster_person[0]
    : membership.roster_person;

  // Enforce that the linked roster_people record is also active
  if (!rosterObj || rosterObj.is_active === false) {
    return {
      success: false,
      errorResponse: NextResponse.json(
        { error: "غير مصرح: تم تعطيل حساب العضو في مساحة العمل." },
        { status: 403 }
      ),
    };
  }

  const role = (membership.role || rosterObj.role || "designer") as RosterRole;

  if (options?.allowedRoles && !options.allowedRoles.includes(role)) {
    return {
      success: false,
      errorResponse: NextResponse.json(
        { error: "غير مصرح: ليس لديك الصلاحية الكافية لإتمام هذا الإجراء." },
        { status: 403 }
      ),
    };
  }

  const mergedCustom = mergeCustomPermissions(
    membership.custom_permissions as CustomPermissions,
    rosterObj?.custom_permissions as CustomPermissions
  );
  const effectivePermissions = resolveEffectivePermissions(
    role,
    membership.custom_permissions as CustomPermissions,
    rosterObj?.custom_permissions as CustomPermissions
  );
  const permissionDetails = resolvePermissionDetails(
    role,
    membership.custom_permissions as CustomPermissions,
    rosterObj?.custom_permissions as CustomPermissions
  );
  const accessScope = resolveEffectiveAccessScope(
    role,
    (membership.access_scope || rosterObj?.access_scope) as AccessScope
  );

  return {
    success: true,
    data: {
      user,
      membership: {
        id: membership.id,
        workspaceId: membership.workspace_id,
        userId: membership.user_id,
        rosterPersonId: membership.roster_person_id,
        role,
        accessScope,
        customPermissions: mergedCustom,
        effectivePermissions,
        permissionDetails,
        displayName: rosterObj?.display_name,
        jobTitle: rosterObj?.job_title,
        specialties: Array.isArray(rosterObj?.specialties) ? rosterObj.specialties : [],
        updatedAt: membership.updated_at || rosterObj?.updated_at,
      },
      admin,
      serverClient,
    },
  };
}

/**
 * Checks whether an active membership has a specific granular permission.
 * Uses canonical permission resolution (locked role invariants -> custom_permissions -> role defaults).
 */
export function hasGranularPermission(
  membership: ActiveMembershipContext,
  permission: GranularPermissionKey
): boolean {
  const effective = resolveEffectivePermissions(
    membership.role,
    membership.customPermissions
  );
  return Boolean(effective[permission]);
}

/**
 * Enforces a specific granular permission for an incoming request.
 */
export async function requireGranularPermission(
  req: NextRequest,
  permission: GranularPermissionKey
): Promise<
  AuthResult<{
    user: User;
    membership: ActiveMembershipContext;
    admin: SupabaseClient;
    serverClient: SupabaseClient;
  }>
> {
  const result = await requireWorkspaceMembership(req);
  if (!result.success) return result;

  if (!hasGranularPermission(result.data.membership, permission)) {
    return {
      success: false,
      errorResponse: NextResponse.json(
        { error: `غير مصرح: ليس لديك صلاحية (${permission}) لإتمام هذا الإجراء.` },
        { status: 403 }
      ),
    };
  }

  return result;
}

/**
 * Computes the set of client IDs accessible to the given membership according to their role and access_scope.
 * Returns null if the member has full workspace scope ('workspace').
 */
export async function getAccessibleClientIds(
  admin: SupabaseClient,
  membership: ActiveMembershipContext
): Promise<Set<string> | null> {
  const effectiveScope = resolveEffectiveAccessScope(
    membership.role,
    membership.accessScope
  );

  if (effectiveScope === "workspace") {
    return null; // Full workspace client access
  }

  const [clientsRes, rosterRes] = await Promise.all([
    admin
      .from("clients")
      .select(`
        id,
        owner_roster_id,
        team_assignment:client_team_assignments(*),
        tasks(id, primary_assignee_id, reviewer_id)
      `)
      .eq("workspace_id", membership.workspaceId),
    admin
      .from("roster_people")
      .select("id, role, specialties, is_active")
      .eq("workspace_id", membership.workspaceId)
      .eq("is_active", true),
  ]);

  const clients = clientsRes.data || [];
  const rosterMembers = rosterRes.data || [];
  const allowedIds = new Set<string>();

  for (const client of clients) {
    if (
      isClientInMemberScope({
        client,
        rosterPersonId: membership.rosterPersonId,
        role: membership.role,
        accessScope: effectiveScope,
        rosterMembers,
      })
    ) {
      allowedIds.add(client.id);
    }
  }

  return allowedIds;
}

/**
 * Checks whether the caller's membership is allowed to access a specific client within their scope.
 */
export async function canAccessClient(
  admin: SupabaseClient,
  membership: ActiveMembershipContext,
  clientId: string
): Promise<boolean> {
  if (!clientId) return false;
  const effectiveScope = resolveEffectiveAccessScope(
    membership.role,
    membership.accessScope
  );
  if (effectiveScope === "workspace") {
    const { data: client } = await admin
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .eq("workspace_id", membership.workspaceId)
      .maybeSingle();
    return Boolean(client);
  }

  const allowedIds = await getAccessibleClientIds(admin, membership);
  if (!allowedIds) return true;
  return allowedIds.has(clientId);
}

/**
 * Enforces that the caller has the `create_campaigns` granular permission (e.g. Owner, Company Owner,
 * Manager, Strategy Lead, or a member explicitly granted `create_campaigns`) AND (when clientId is provided)
 * that the target client is within the caller's resolved access scope.
 */
export async function requireCampaignAccess(
  req: NextRequest,
  clientId?: string | null
): Promise<
  AuthResult<{
    user: User;
    membership: ActiveMembershipContext;
    admin: SupabaseClient;
    serverClient: SupabaseClient;
  }>
> {
  const result = await requireWorkspaceMembership(req);
  if (!result.success) return result;

  const { membership, admin } = result.data;

  if (!hasGranularPermission(membership, "create_campaigns")) {
    return {
      success: false,
      errorResponse: NextResponse.json(
        { error: "غير مصرح: ليس لديك صلاحية إنشاء أو إدارة الكامبينز وتقاويم المحتوى." },
        { status: 403 }
      ),
    };
  }

  if (clientId) {
    const inScope = await canAccessClient(admin, membership, clientId);
    if (!inScope) {
      return {
        success: false,
        errorResponse: NextResponse.json(
          { error: "غير مصرح: هذا العميل خارج نطاق الفريق أو العملاء المسندين إليك." },
          { status: 403 }
        ),
      };
    }
  }

  return result;
}

/**
 * Ensures caller is an active workspace member with mutation permissions (not a viewer or read-only marketing director).
 */
export async function requireWritableMembership(
  req: NextRequest
): Promise<
  AuthResult<{
    user: User;
    membership: ActiveMembershipContext;
    admin: SupabaseClient;
    serverClient: SupabaseClient;
  }>
> {
  const result = await requireWorkspaceMembership(req);
  if (!result.success) return result;
  if (
    result.data.membership.role === "business_owner_viewer" ||
    result.data.membership.role === "marketing_director"
  ) {
    return {
      success: false,
      errorResponse: NextResponse.json(
        { error: "غير مصرح: دورك الحالي للقراءة والتقارير فقط ولا يملك صلاحية التعديل أو الإنشاء." },
        { status: 403 }
      ),
    };
  }
  return result;
}

/**
 * Ensures caller is specifically the Workspace Owner or Company Owner with Full Permissions.
 */
export async function requireOwner(
  req: NextRequest
): Promise<
  AuthResult<{
    user: User;
    membership: ActiveMembershipContext;
    admin: SupabaseClient;
    serverClient: SupabaseClient;
  }>
> {
  const result = await requireWorkspaceMembership(req, { allowedRoles: ["owner", "company_owner"] });
  if (!result.success) {
    return result;
  }
  return result;
}

/**
 * Ensures caller is Owner, Company Owner, or Business Owner Viewer.
 */
export async function requireOwnerOrViewer(
  req: NextRequest
): Promise<
  AuthResult<{
    user: User;
    membership: ActiveMembershipContext;
    admin: SupabaseClient;
    serverClient: SupabaseClient;
  }>
> {
  return requireWorkspaceMembership(req, { allowedRoles: ["owner", "company_owner", "business_owner_viewer"] });
}

/**
 * Ensures caller is Owner, Company Owner, Manager, or Marketing Director.
 */
export async function requireMarketingDirector(
  req: NextRequest
): Promise<
  AuthResult<{
    user: User;
    membership: ActiveMembershipContext;
    admin: SupabaseClient;
    serverClient: SupabaseClient;
  }>
> {
  return requireWorkspaceMembership(req, { allowedRoles: ["owner", "company_owner", "manager", "marketing_director"] });
}

/**
 * Ensures caller is specifically authorized to export data/reports (Owner, Company Owner, Manager, Marketing Director,
 * or any member explicitly granted `export_reports`).
 * Rejects Business Owner Viewer, Designers without grant, and other unprivileged roles.
 */
export async function requireExportPermission(
  req: NextRequest
): Promise<
  AuthResult<{
    user: User;
    membership: ActiveMembershipContext;
    admin: SupabaseClient;
    serverClient: SupabaseClient;
  }>
> {
  const result = await requireWorkspaceMembership(req);
  if (!result.success) {
    return result;
  }
  if (!hasGranularPermission(result.data.membership, "export_reports")) {
    return {
      success: false,
      errorResponse: NextResponse.json(
        { error: "غير مصرح: صلاحية تصدير التقارير وسجلات الوقت مقتصرة على الإدارة ومدير التسويق والمصرح لهم فقط." },
        { status: 403 }
      ),
    };
  }
  return result;
}

/**
 * Ensures caller is Owner, Company Owner, Manager, or Strategy Lead.
 */
export async function requireStrategyLead(
  req: NextRequest
): Promise<
  AuthResult<{
    user: User;
    membership: ActiveMembershipContext;
    admin: SupabaseClient;
    serverClient: SupabaseClient;
  }>
> {
  return requireWorkspaceMembership(req, { allowedRoles: ["owner", "company_owner", "manager", "strategy_lead"] });
}

/**
 * Ensures caller is an active workspace member with legitimate access to a specific task.
 * Owner, Company Owner, and Manager have full access.
 * Marketing Director and Business Owner Viewer have read-only access.
 * Team members have access if they are primary assignee, reviewer, collaborator, or part of a review round.
 */
export async function requireTaskAccess(
  req: NextRequest,
  taskId: string
): Promise<
  AuthResult<{
    user: User;
    membership: ActiveMembershipContext;
    task: any;
    admin: SupabaseClient;
    serverClient: SupabaseClient;
  }>
> {
  const memRes = await requireWorkspaceMembership(req);
  if (!memRes.success) {
    return { success: false, errorResponse: memRes.errorResponse };
  }

  const { user, membership, admin, serverClient } = memRes.data;

  // Retrieve task strictly scoped by caller's workspace_id
  const { data: task, error: taskErr } = await admin
    .from("tasks")
    .select("id, workspace_id, client_id, primary_assignee_id, reviewer_id, status, work_stage")
    .eq("id", taskId)
    .eq("workspace_id", membership.workspaceId)
    .maybeSingle();

  if (taskErr || !task) {
    return {
      success: false,
      errorResponse: NextResponse.json(
        { error: "المهمة غير موجودة." },
        { status: 404 }
      ),
    };
  }

  // Owner, Company Owner, and Manager have universal access within the workspace
  if (
    membership.role === "owner" ||
    membership.role === "company_owner" ||
    membership.role === "manager"
  ) {
    return {
      success: true,
      data: { user, membership, task, admin, serverClient },
    };
  }

  // Business Owner Viewer and Marketing Director (Ata) have read-only access to all workspace tasks
  if (
    membership.role === "business_owner_viewer" ||
    membership.role === "marketing_director"
  ) {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      return {
        success: false,
        errorResponse: NextResponse.json(
          { error: "غير مصرح: دورك الحالي للقراءة والتقارير فقط ولا يملك صلاحية التعديل أو المراجعة أو تتبع الوقت." },
          { status: 403 }
        ),
      };
    }
    return {
      success: true,
      data: { user, membership, task, admin, serverClient },
    };
  }

  // Strategy Lead and Senior Reviewer can read workspace tasks, and mutate if involved or reviewing
  if (
    (membership.role === "strategy_lead" || membership.role === "senior_reviewer") &&
    ["GET", "HEAD", "OPTIONS"].includes(req.method)
  ) {
    return {
      success: true,
      data: { user, membership, task, admin, serverClient },
    };
  }

  // Check involvement: Primary Assignee or Designated Reviewer
  if (
    task.primary_assignee_id === membership.rosterPersonId ||
    task.reviewer_id === membership.rosterPersonId
  ) {
    return {
      success: true,
      data: { user, membership, task, admin, serverClient },
    };
  }

  // Check involvement: Collaborator
  const { data: collab } = await admin
    .from("task_collaborators")
    .select("id")
    .eq("workspace_id", membership.workspaceId)
    .eq("task_id", taskId)
    .eq("roster_person_id", membership.rosterPersonId)
    .limit(1)
    .maybeSingle();

  if (collab) {
    return {
      success: true,
      data: { user, membership, task, admin, serverClient },
    };
  }

  // Check involvement: Reviewer / Submitter in Review Rounds
  const { data: round } = await admin
    .from("review_rounds")
    .select("id")
    .eq("workspace_id", membership.workspaceId)
    .eq("task_id", taskId)
    .or(`reviewer_id.eq.${membership.rosterPersonId},submitter_id.eq.${membership.rosterPersonId}`)
    .limit(1)
    .maybeSingle();

  if (round) {
    return {
      success: true,
      data: { user, membership, task, admin, serverClient },
    };
  }

  // Non-involved designer: Deny access (403/404)
  return {
    success: false,
    errorResponse: NextResponse.json(
      { error: "غير مصرح: لا تملك صلاحية الوصول لهذه المهمة." },
      { status: 403 }
    ),
  };
}
