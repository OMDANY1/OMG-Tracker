import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROSTER_ROLE_LABELS } from "@/lib/utils";

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
    const invitationId = searchParams.get("id");

    const { data: ws } = await admin
      .from("workspaces")
      .select("id, invitations_paused")
      .limit(1)
      .single();

    // If an invitation ID was provided in the query params, validate it specifically
    if (invitationId) {
      const { data: inv, error: invErr } = await admin
        .from("workspace_invitations")
        .select(`
          id,
          invited_email,
          role,
          status,
          expires_at,
          roster_person:roster_people!fk_invitation_roster(id, display_name, job_title, role)
        `)
        .eq("id", invitationId)
        .maybeSingle();

      if (invErr || !inv) {
        return NextResponse.json(
          { error: "رابط الدعوة غير صالح أو غير موجود. يرجى التأكد من الرابط.", invalid: true },
          { status: 404 }
        );
      }

      // Check status
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
            error: "تم إلغاء رابط الدعوة هذا من قِبل إدارة الايجنسي.",
            isRevoked: true,
          },
          { status: 410 }
        );
      }

      if (inv.status === "accepted") {
        return NextResponse.json(
          {
            error: "تم قبول رابط الدعوة هذا وتفعيل الحساب بالفعل مسبقاً. يمكنك تسجيل الدخول مباشرة.",
            isAccepted: true,
            email: inv.invited_email,
          },
          { status: 400 }
        );
      }

      // Check expiration
      const isExpired = new Date(inv.expires_at).getTime() < Date.now();
      if (isExpired) {
        return NextResponse.json(
          {
            error: "انتهت صلاحية رابط الدعوة (مدة الصلاحية 7 أيام). يرجى طلب رابط دعوة جديد من الإدارة.",
            isExpired: true,
          },
          { status: 410 }
        );
      }

      const rosterPerson: any = Array.isArray(inv.roster_person)
        ? inv.roster_person[0]
        : inv.roster_person;

      const effectiveRole = inv.role || rosterPerson?.role || "designer";

      return NextResponse.json({
        valid: true,
        invitationId: inv.id,
        email: inv.invited_email,
        maskedEmail: maskEmail(inv.invited_email),
        role: effectiveRole,
        roleLabel: ROSTER_ROLE_LABELS[effectiveRole as keyof typeof ROSTER_ROLE_LABELS] || effectiveRole,
        displayName: rosterPerson?.display_name || "عضو فريق OMG",
        jobTitle: rosterPerson?.job_title || "",
        invitationsPaused: ws?.invitations_paused ?? false,
      });
    }

    return NextResponse.json({
      invitationsPaused: ws?.invitations_paused ?? true,
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
    const { invitationId, password } = body;

    // Check if invitations are globally paused
    const { data: ws } = await admin
      .from("workspaces")
      .select("id, invitations_paused")
      .limit(1)
      .maybeSingle();

    if (ws?.invitations_paused && !invitationId) {
      return NextResponse.json(
        { error: "الدعوات متوقفة مؤقتًا لحين الانتهاء من تحديث مساحة العمل. سيصلك رابط جديد عند إعادة فتح الدعوات." },
        { status: 403 }
      );
    }

    // -------------------------------------------------------------------------
    // FLOW A: Explicit invitation acceptance via invitation link (Without pre-existing session)
    // -------------------------------------------------------------------------
    if (invitationId && password) {
      if (typeof password !== "string" || password.length < 8) {
        return NextResponse.json(
          { error: "كلمة المرور يجب أن لا تقل عن 8 أحرف." },
          { status: 400 }
        );
      }

      const { data: inv, error: invErr } = await admin
        .from("workspace_invitations")
        .select(`
          id,
          workspace_id,
          invited_email,
          role,
          roster_person_id,
          status,
          expires_at,
          roster_person:roster_people!fk_invitation_roster(id, display_name, job_title, role)
        `)
        .eq("id", invitationId)
        .maybeSingle();

      if (invErr || !inv) {
        return NextResponse.json(
          { error: "رابط الدعوة غير صالح أو غير موجود." },
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
          { error: "تم إلغاء هذه الدعوة من قِبل إدارة الايجنسي." },
          { status: 410 }
        );
      }

      if (inv.status === "accepted") {
        return NextResponse.json(
          { error: "تم قبول هذه الدعوة بالفعل مسبقاً. يمكنك التوجه لتسجيل الدخول." },
          { status: 400 }
        );
      }

      if (new Date(inv.expires_at).getTime() < Date.now()) {
        return NextResponse.json(
          { error: "انتهت صلاحية رابط الدعوة (مدة الصلاحية 7 أيام). يرجى طلب رابط جديد من الإدارة." },
          { status: 410 }
        );
      }

      const cleanEmail = inv.invited_email.trim().toLowerCase();
      const targetRosterId = inv.roster_person_id;
      const targetRole = inv.role || "designer";

      // 1. Find or create Auth User in Supabase Auth
      let authUserId: string;
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

      // 2. Fetch the target roster person
      const { data: rosterPerson, error: rErr } = await admin
        .from("roster_people")
        .select("id, workspace_id, display_name, role, job_title")
        .eq("id", targetRosterId)
        .eq("workspace_id", inv.workspace_id)
        .single();

      if (rErr || !rosterPerson) {
        return NextResponse.json(
          { error: "لم يتم العثور على سجل العضو في مساحة العمل." },
          { status: 404 }
        );
      }

      // 3. Invariant: Check if roster person is already bound to another active user
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

      // 4. Create or activate workspace membership
      const { data: memberRecord, error: memErr } = await admin
        .from("workspace_memberships")
        .upsert(
          {
            workspace_id: inv.workspace_id,
            user_id: authUserId,
            roster_person_id: rosterPerson.id,
            role: targetRole,
            is_active: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "workspace_id,user_id" }
        )
        .select()
        .single();

      if (memErr) {
        return NextResponse.json(
          { error: `فشل تفعيل عضوية مساحة العمل: ${memErr.message}` },
          { status: 500 }
        );
      }

      // 5. Update roster_people role if different
      await admin
        .from("roster_people")
        .update({
          role: targetRole,
          updated_at: new Date().toISOString(),
        })
        .eq("id", rosterPerson.id);

      // 6. Mark invitation as accepted
      await admin
        .from("workspace_invitations")
        .update({
          status: "accepted",
          accepted_at: new Date().toISOString(),
          accepted_by_id: authUserId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", inv.id);

      // 7. Audit Event
      await admin.from("audit_events").insert({
        workspace_id: inv.workspace_id,
        actor_id: rosterPerson.id,
        action: "accept_invitation",
        entity_type: "workspace_memberships",
        entity_id: memberRecord.id,
        metadata: {
          invitation_id: inv.id,
          email: cleanEmail,
          user_id: authUserId,
          roster_person_id: rosterPerson.id,
          role: targetRole,
          display_name: rosterPerson.display_name,
        },
      });

      return NextResponse.json({
        success: true,
        email: cleanEmail,
        memberName: rosterPerson.display_name,
        role: targetRole,
        message: `تم تفعيل حسابك بنجاح يا ${rosterPerson.display_name}! يمكنك الآن تسجيل الدخول.`,
      });
    }

    // -------------------------------------------------------------------------
    // FLOW B: Existing authenticated session acceptance fallback
    // -------------------------------------------------------------------------
    const serverClient = await createServerSupabaseClient().catch(() => null);
    if (!serverClient) {
      return NextResponse.json({ error: "جلسة المستخدم غير متوفرة أو رابط الدعوة مفقود." }, { status: 401 });
    }

    const { data: authData, error: authErr } = await serverClient.auth.getUser();
    if (authErr || !authData?.user) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أو إرسال معرف الدعوة." }, { status: 401 });
    }

    const user = authData.user;
    const userEmail = (user.email || "").toLowerCase().trim();

    if (!userEmail) {
      return NextResponse.json({ error: "البريد الإلكتروني غير صالح." }, { status: 400 });
    }

    // 1. Check if user already has an active workspace membership
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

    // 2. Resolve target roster person and role by invitation
    const { data: inviteRecord } = await admin
      .from("workspace_invitations")
      .select("id, workspace_id, invited_email, role, roster_person_id, status, expires_at")
      .eq("invited_email", userEmail)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let targetRosterId: string | null = null;
    let targetRole: string = "designer";
    let targetName: string = "";

    if (inviteRecord) {
      if (new Date(inviteRecord.expires_at).getTime() < Date.now()) {
        return NextResponse.json(
          { error: "انتهت صلاحية رابط الدعوة. يرجى التواصل مع الإدارة لتجديد الدعوة." },
          { status: 410 }
        );
      }
      targetRosterId = inviteRecord.roster_person_id;
      targetRole = inviteRecord.role;
    }

    if (!targetRosterId) {
      return NextResponse.json(
        { error: "لم يتم العثور على دعوة معلقة لهذا البريد الإلكتروني." },
        { status: 404 }
      );
    }

    // 3. Find active roster record
    const { data: rosterPerson, error: rosterErr } = await admin
      .from("roster_people")
      .select("id, workspace_id, display_name, is_active")
      .eq("id", targetRosterId)
      .eq("is_active", true)
      .maybeSingle();

    if (rosterErr || !rosterPerson) {
      return NextResponse.json(
        { error: "لم يتم العثور على سجل العضو في مساحة العمل." },
        { status: 404 }
      );
    }
    targetName = rosterPerson.display_name;

    // 4. Invariant: Ensure target roster person is NOT already bound to an active user
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

    // 5. Create or activate workspace membership
    const { data: newMember, error: memberErr } = await admin
      .from("workspace_memberships")
      .upsert(
        {
          workspace_id: rosterPerson.workspace_id,
          user_id: user.id,
          roster_person_id: rosterPerson.id,
          role: targetRole,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,user_id" }
      )
      .select()
      .single();

    if (memberErr) {
      return NextResponse.json({ error: `فشل تفعيل العضوية: ${memberErr.message}` }, { status: 500 });
    }

    // 6. Update workspace_invitations status if exists
    if (inviteRecord) {
      await admin
        .from("workspace_invitations")
        .update({
          status: "accepted",
          accepted_at: new Date().toISOString(),
          accepted_by_id: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", inviteRecord.id);
    }

    // 7. Audit Event
    await admin.from("audit_events").insert({
      workspace_id: rosterPerson.workspace_id,
      actor_id: rosterPerson.id,
      action: "accept_invitation",
      entity_type: "workspace_memberships",
      entity_id: newMember.id,
      metadata: {
        email: userEmail,
        user_id: user.id,
        roster_person_id: rosterPerson.id,
        role: targetRole,
        member_name: targetName,
      },
    });

    return NextResponse.json({
      success: true,
      memberName: targetName,
      role: targetRole,
      message: `أهلاً بك يا ${targetName}! تم تفعيل حسابك بنجاح.`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "حدث خطأ غير متوقع." }, { status: 500 });
  }
}
