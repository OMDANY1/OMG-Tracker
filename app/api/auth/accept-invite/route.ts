import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROSTER_ROLE_LABELS } from "@/lib/utils";
import { hashToken } from "@/lib/crypto-tokens";

export const dynamic = "force-dynamic";

function maskEmail(email: string): string {
  const parts = email.split("@");
  if (parts.length !== 2) return email;
  const name = parts[0];
  const domain = parts[1];
  if (name.length <= 2) return `${name}***@${domain}`;
  return `${name[0]}***${name[name.length - 1]}@${domain}`;
}

export async function GET(req: NextRequest) {
  try {
    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "تعذر الاتصال بقاعدة البيانات." }, { status: 500 });
    }

    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");
    const invitationId = searchParams.get("id");

    const { data: ws } = await admin
      .from("workspaces")
      .select("id, allow_invitation_emails, allow_invitation_acceptance, invitations_paused")
      .limit(1)
      .single();

    // Check optional active user session to detect email mismatches
    const serverClient = await createServerSupabaseClient().catch(() => null);
    let sessionUser: any = null;
    if (serverClient) {
      const { data: authData } = await serverClient.auth.getUser();
      sessionUser = authData?.user || null;
    }

    // 1. Secret token presence verification (accept token alone or id + token)
    if (token) {
      const computedHash = hashToken(token.trim());

      let query = admin
        .from("workspace_invitations")
        .select(`
          id,
          workspace_id,
          invited_email,
          role,
          token_hash,
          status,
          expires_at,
          roster_person:roster_people!fk_invitation_roster(id, display_name, job_title, role, access_scope, custom_permissions)
        `)
        .eq("token_hash", computedHash);

      if (invitationId) {
        query = query.eq("id", invitationId);
      }

      const { data: inv, error: invErr } = await query.maybeSingle();

      if (invErr || !inv) {
        return NextResponse.json(
          {
            error: "رابط الدعوة غير صالح أو غير موجود (This invitation is invalid). يرجى التأكد من الرابط.",
            invalid: true,
          },
          { status: 404 }
        );
      }

      // Workspace invitation acceptance setting check
      const isAcceptancePaused =
        ws?.allow_invitation_acceptance === false || ws?.invitations_paused === true;

      if (isAcceptancePaused) {
        return NextResponse.json(
          {
            error: "قبول وتفعيل الدعوات متوقف حالياً في مساحة العمل بناءً على إعدادات الإدارة. سيتم إعادة تفعيل الروابط قريباً.",
            isPaused: true,
          },
          { status: 403 }
        );
      }

      // Status checks
      if (inv.status === "draft") {
        return NextResponse.json(
          {
            error: "هذه الدعوة ما زالت مسودة داخلية ولم يتم تفعيلها وإصدارها بعد. يرجى التواصل مع الإدارة لتفعيل الرابط.",
            isDraft: true,
          },
          { status: 400 }
        );
      }

      if (inv.status === "revoked") {
        return NextResponse.json(
          {
            error: "تم إلغاء رابط الدعوة هذا من قِبل إدارة الايجنسي (This invitation has been revoked).",
            isRevoked: true,
          },
          { status: 410 }
        );
      }

      if (inv.status === "accepted") {
        return NextResponse.json(
          {
            error: "تم قبول رابط الدعوة هذا وتفعيل الحساب بالفعل مسبقاً (This invitation has already been accepted). يمكنك تسجيل الدخول مباشرة.",
            isAccepted: true,
            email: inv.invited_email,
          },
          { status: 400 }
        );
      }

      // Expiration check
      const isExpired = new Date(inv.expires_at).getTime() < Date.now();
      if (isExpired) {
        return NextResponse.json(
          {
            error: "انتهت صلاحية رابط الدعوة (This invitation has expired). يرجى طلب رابط دعوة جديد من الإدارة.",
            isExpired: true,
          },
          { status: 410 }
        );
      }

      const rosterPerson: any = Array.isArray(inv.roster_person)
        ? inv.roster_person[0]
        : inv.roster_person;

      const effectiveRole = inv.role || rosterPerson?.role || "designer";

      // Session Mismatch & Authenticated Link Detection
      let sessionMismatch = false;
      let sessionMatches = false;
      let loggedInEmail: string | null = null;

      if (sessionUser && sessionUser.email) {
        loggedInEmail = sessionUser.email.toLowerCase().trim();
        const invitedEmail = inv.invited_email.toLowerCase().trim();
        if (loggedInEmail === invitedEmail) {
          sessionMatches = true;
        } else {
          sessionMismatch = true;
        }
      }

      return NextResponse.json({
        valid: true,
        invitationId: inv.id,
        email: inv.invited_email,
        maskedEmail: maskEmail(inv.invited_email),
        role: effectiveRole,
        roleLabel: ROSTER_ROLE_LABELS[effectiveRole as keyof typeof ROSTER_ROLE_LABELS] || effectiveRole,
        displayName: rosterPerson?.display_name || "عضو فريق OMG",
        jobTitle: rosterPerson?.job_title || "",
        invitationsPaused: isAcceptancePaused,
        sessionMismatch,
        sessionMatches,
        loggedInEmail,
      });
    }

    // If ID was passed without token
    if (invitationId && !token) {
      return NextResponse.json(
        {
          error: "رابط الدعوة غير مكتمل. الرمز السري (token) مفقود لأسباب أمنية. يرجى استخدام الرابط الكامل المزود برمز التحقق.",
          tokenMissing: true,
          invalid: true,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      invitationsPaused: ws?.invitations_paused ?? false,
      allowInvitationAcceptance: ws?.allow_invitation_acceptance ?? true,
      allowInvitationEmails: ws?.allow_invitation_emails ?? false,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "تعذر الاتصال بقاعدة البيانات." }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const { invitationId, token, password, autoAcceptIfSessionMatches } = body;

    // Check workspace settings
    const { data: ws } = await admin
      .from("workspaces")
      .select("id, allow_invitation_acceptance, invitations_paused")
      .limit(1)
      .maybeSingle();

    const isAcceptancePaused =
      ws?.allow_invitation_acceptance === false || ws?.invitations_paused === true;

    if (isAcceptancePaused) {
      return NextResponse.json(
        { error: "قبول وتفعيل الدعوات متوقف حالياً من قِبل إدارة الايجنسي." },
        { status: 403 }
      );
    }

    // -------------------------------------------------------------------------
    // FLOW A: Explicit invitation acceptance via secure token (token or id + token)
    // -------------------------------------------------------------------------
    if (token) {
      const computedHash = hashToken(token.trim());

      let query = admin
        .from("workspace_invitations")
        .select(`
          id,
          workspace_id,
          invited_email,
          role,
          token_hash,
          roster_person_id,
          status,
          expires_at,
          roster_person:roster_people!fk_invitation_roster(id, display_name, job_title, role, access_scope, custom_permissions)
        `)
        .eq("token_hash", computedHash);

      if (invitationId) {
        query = query.eq("id", invitationId);
      }

      const { data: inv, error: invErr } = await query.maybeSingle();

      if (invErr || !inv) {
        return NextResponse.json(
          { error: "رابط الدعوة غير صالح أو غير موجود (This invitation is invalid)." },
          { status: 404 }
        );
      }

      if (inv.status === "draft") {
        return NextResponse.json(
          { error: "هذه الدعوة ما زالت مسودة داخلية ولم يتم إصدارها بعد." },
          { status: 400 }
        );
      }

      if (inv.status === "revoked") {
        return NextResponse.json(
          { error: "تم إلغاء هذه الدعوة من قِبل إدارة الايجنسي (This invitation has been revoked)." },
          { status: 410 }
        );
      }

      if (inv.status === "accepted") {
        return NextResponse.json(
          { error: "تم قبول هذه الدعوة بالفعل مسبقاً (This invitation has already been accepted). يمكنك التوجه لتسجيل الدخول مباشرة." },
          { status: 400 }
        );
      }

      if (new Date(inv.expires_at).getTime() < Date.now()) {
        return NextResponse.json(
          { error: "انتهت صلاحية رابط الدعوة (This invitation has expired). يرجى طلب رابط جديد من الإدارة." },
          { status: 410 }
        );
      }

      const cleanEmail = inv.invited_email.trim().toLowerCase();
      const targetRosterId = inv.roster_person_id;
      // ROLE SECURITY (Prompt Section 5): Strictly determined by the invitation record!
      const targetRole = inv.role || "designer";

      // Session Mismatch Check
      const serverClient = await createServerSupabaseClient().catch(() => null);
      let sessionUser: any = null;
      if (serverClient) {
        const { data: authData } = await serverClient.auth.getUser();
        sessionUser = authData?.user || null;
      }

      let authUserId: string;

      if (sessionUser && sessionUser.email) {
        const sessionEmail = sessionUser.email.toLowerCase().trim();
        if (sessionEmail !== cleanEmail) {
          return NextResponse.json(
            {
              error: `أنت مسجل حالياً بحساب (${sessionEmail}) بينما الدعوة موجهة إلى (${cleanEmail}). يرجى تسجيل الخروج أولاً لتفعيل الدعوة بالحساب الصحيح.`,
              sessionMismatch: true,
              loggedInEmail: sessionEmail,
              invitedEmail: cleanEmail,
            },
            { status: 400 }
          );
        }
        // User is already authenticated with matching email
        authUserId = sessionUser.id;
      } else {
        // User is not authenticated in current session, requires password
        if (typeof password !== "string" || password.length < 8) {
          return NextResponse.json(
            { error: "كلمة المرور مطلوبة ويجب أن لا تقل عن 8 أحرف." },
            { status: 400 }
          );
        }

        // Find or create Auth User in Supabase Auth
        const { data: listData } = await admin.auth.admin.listUsers();
        const existingAuthUser = (listData?.users || []).find(
          (u) => (u.email || "").toLowerCase() === cleanEmail
        );

        if (existingAuthUser) {
          authUserId = existingAuthUser.id;
          const { error: updateAuthErr } = await admin.auth.admin.updateUserById(authUserId, {
            password: password,
            email_confirm: true,
          });
          if (updateAuthErr) {
            return NextResponse.json(
              { error: `فشل تحديث كلمة المرور: ${updateAuthErr.message}` },
              { status: 500 }
            );
          }
        } else {
          const { data: createData, error: createAuthErr } = await admin.auth.admin.createUser({
            email: cleanEmail,
            password: password,
            email_confirm: true,
          });
          if (createAuthErr || !createData.user) {
            return NextResponse.json(
              { error: `فشل إنشاء حساب المصادقة: ${createAuthErr?.message || "خطأ غير معروف"}` },
              { status: 500 }
            );
          }
          authUserId = createData.user.id;
        }
      }

      // Fetch target roster person
      const { data: rosterPerson, error: rErr } = await admin
        .from("roster_people")
        .select("id, workspace_id, display_name, role, job_title, access_scope, custom_permissions")
        .eq("id", targetRosterId)
        .eq("workspace_id", inv.workspace_id)
        .single();

      if (rErr || !rosterPerson) {
        return NextResponse.json(
          { error: "لم يتم العثور على سجل العضو في مساحة العمل." },
          { status: 404 }
        );
      }

      // Invariant: Check if roster person is already bound to another active user
      const { data: existingRosterMem } = await admin
        .from("workspace_memberships")
        .select("id, user_id, is_active")
        .eq("workspace_id", inv.workspace_id)
        .eq("roster_person_id", rosterPerson.id)
        .eq("is_active", true)
        .maybeSingle();

      if (existingRosterMem && existingRosterMem.user_id !== authUserId) {
        return NextResponse.json(
          { error: "هذا السجل مرتبط بالفعل بحساب مستخدم آخر. يرجى التواصل مع إدارة مساحة العمل." },
          { status: 409 }
        );
      }

      // Atomic, consistent, and idempotent database acceptance via RPC
      const { data: rpcRes, error: rpcErr } = await admin.rpc(
        "accept_workspace_invitation_atomic",
        {
          p_invitation_id: inv.id,
          p_user_id: authUserId,
          p_token_hash: computedHash,
          p_user_email: cleanEmail,
        }
      );

      if (rpcErr || !rpcRes) {
        console.error("[accept-invite] Atomic RPC execution error:", rpcErr);
        return NextResponse.json(
          { error: "حدث خطأ أثناء حفظ بيانات تفعيل الحساب في قاعدة البيانات. يرجى إعادة المحاولة." },
          { status: 500 }
        );
      }

      if (!rpcRes.success) {
        const statusCode =
          rpcRes.code === "INVITATION_NOT_FOUND" ? 404 :
          rpcRes.code === "INVITATIONS_PAUSED" ? 403 :
          rpcRes.code === "INVITATION_REVOKED" || rpcRes.code === "INVITATION_EXPIRED" ? 410 :
          rpcRes.code === "ROSTER_BOUND_TO_ANOTHER_USER" || rpcRes.code === "ALREADY_ACCEPTED_BY_ANOTHER" ? 409 : 400;

        return NextResponse.json(
          { error: rpcRes.error || "تعذر إتمام قبول الدعوة." },
          { status: statusCode }
        );
      }

      return NextResponse.json({
        success: true,
        email: cleanEmail,
        memberName: rpcRes.display_name || rosterPerson.display_name,
        role: rpcRes.role || targetRole,
        message: rpcRes.message || `تم تفعيل حسابك بنجاح يا ${rosterPerson.display_name}! يمكنك الآن الدخول لمساحة العمل.`,
      });
    }

    // -------------------------------------------------------------------------
    // FLOW B: Existing authenticated session acceptance fallback (No explicit token)
    // -------------------------------------------------------------------------
    const serverClient = await createServerSupabaseClient().catch(() => null);
    if (!serverClient) {
      return NextResponse.json({ error: "جلسة المستخدم غير متوفرة أو رابط الدعوة مفقود." }, { status: 401 });
    }

    const { data: authData, error: authErr } = await serverClient.auth.getUser();
    if (authErr || !authData?.user) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أو استخدام رابط الدعوة الكامل." }, { status: 401 });
    }

    const user = authData.user;
    const userEmail = (user.email || "").toLowerCase().trim();

    if (!userEmail) {
      return NextResponse.json({ error: "البريد الإلكتروني غير صالح." }, { status: 400 });
    }

    // Check if user already has an active workspace membership
    const { data: existingUserMember } = await admin
      .from("workspace_memberships")
      .select("id, role, is_active, roster_person_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (existingUserMember) {
      return NextResponse.json({
        success: true,
        alreadyActive: true,
        message: "العضوية مفعلة بالفعل.",
      });
    }

    // Resolve target roster person and role by invitation
    const { data: inviteRecord } = await admin
      .from("workspace_invitations")
      .select("id, workspace_id, invited_email, role, roster_person_id, status, expires_at")
      .eq("invited_email", userEmail)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!inviteRecord) {
      return NextResponse.json(
        { error: "لم يتم العثور على دعوة معلقة لهذا البريد الإلكتروني." },
        { status: 404 }
      );
    }

    if (new Date(inviteRecord.expires_at).getTime() < Date.now()) {
      return NextResponse.json(
        { error: "انتهت صلاحية رابط الدعوة (This invitation has expired). يرجى التواصل مع الإدارة لتجديد الدعوة." },
        { status: 410 }
      );
    }

    const targetRosterId = inviteRecord.roster_person_id;
    const targetRole = inviteRecord.role;

    // Find active roster record
    const { data: rosterPerson, error: rosterErr } = await admin
      .from("roster_people")
      .select("id, workspace_id, display_name, is_active, access_scope, custom_permissions")
      .eq("id", targetRosterId)
      .eq("is_active", true)
      .maybeSingle();

    if (rosterErr || !rosterPerson) {
      return NextResponse.json(
        { error: "لم يتم العثور على سجل العضو في مساحة العمل." },
        { status: 404 }
      );
    }

    // Ensure target roster person is NOT already bound to another active user
    const { data: rosterMembership } = await admin
      .from("workspace_memberships")
      .select("id, user_id, is_active")
      .eq("workspace_id", rosterPerson.workspace_id)
      .eq("roster_person_id", rosterPerson.id)
      .eq("is_active", true)
      .maybeSingle();

    if (rosterMembership && rosterMembership.user_id !== user.id) {
      return NextResponse.json(
        { error: "سجل هذا العضو مرتبط بالفعل بمستخدم نشط آخر. يرجى مراجعة إدارة الايجنسي." },
        { status: 409 }
      );
    }

    // Atomic, consistent, and idempotent database acceptance via RPC
    const { data: rpcRes, error: rpcErr } = await admin.rpc(
      "accept_workspace_invitation_atomic",
      {
        p_invitation_id: inviteRecord.id,
        p_user_id: user.id,
        p_token_hash: null,
        p_user_email: userEmail,
      }
    );

    if (rpcErr || !rpcRes) {
      console.error("[accept-invite] Atomic RPC error (Flow B):", rpcErr);
      return NextResponse.json(
        { error: "حدث خطأ أثناء تفعيل العضوية في قاعدة البيانات. يرجى إعادة المحاولة." },
        { status: 500 }
      );
    }

    if (!rpcRes.success) {
      return NextResponse.json(
        { error: rpcRes.error || "تعذر تفعيل العضوية." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      memberName: rosterPerson.display_name,
      role: targetRole,
      message: `أهلاً بك يا ${rosterPerson.display_name}! تم تفعيل حسابك بنجاح.`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "حدث خطأ غير متوقع." }, { status: 500 });
  }
}
