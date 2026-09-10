import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, type User, type SupabaseClient } from "@supabase/supabase-js";

export interface ActiveMembershipContext {
  id: string;
  workspaceId: string;
  userId: string;
  rosterPersonId: string;
  role: "owner" | "senior_reviewer" | "designer" | "manager";
  displayName?: string;
}

export type AuthResult<T> =
  | { success: true; data: T; errorResponse?: never }
  | { success: false; data?: never; errorResponse: NextResponse };

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
 * Derives workspace_id, role, and roster_person_id exclusively from DB.
 */
export async function requireWorkspaceMembership(
  req: NextRequest,
  options?: {
    allowedRoles?: ("owner" | "senior_reviewer" | "designer" | "manager")[];
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
      is_active,
      roster_person:roster_people!fk_membership_roster(id, display_name, job_title)
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

  const role = membership.role as ActiveMembershipContext["role"];

  if (options?.allowedRoles && !options.allowedRoles.includes(role)) {
    return {
      success: false,
      errorResponse: NextResponse.json(
        { error: "غير مصرح: ليس لديك الصلاحية الكافية لإتمام هذا الإجراء." },
        { status: 403 }
      ),
    };
  }

  const rosterObj: any = Array.isArray(membership.roster_person)
    ? membership.roster_person[0]
    : membership.roster_person;

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
        displayName: rosterObj?.display_name,
      },
      admin,
      serverClient,
    },
  };
}

/**
 * Ensures caller is specifically the Workspace Owner.
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
  const result = await requireWorkspaceMembership(req, { allowedRoles: ["owner"] });
  if (!result.success) {
    return result;
  }
  return result;
}

/**
 * Ensures caller is an active workspace member with legitimate access to a specific task.
 * Owner has full access.
 * Designers have access ONLY if they are primary assignee, reviewer, collaborator, or part of a review round.
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
    .select("id, workspace_id, client_id, primary_assignee_id, reviewer_id, status")
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

  // Owner has universal access within the workspace
  if (membership.role === "owner") {
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
