import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMembership, requireOwner, validateSameOrigin } from "@/lib/auth/server-auth";
import { generateInvitationToken, decryptToken } from "@/lib/crypto-tokens";
import { DEFAULT_ROLE_PERMISSIONS } from "@/types/database";
import { ROSTER_ROLE_LABELS } from "@/lib/utils";

export const dynamic = "force-dynamic";

function getBaseOrigin(req: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (envUrl && !envUrl.includes("localhost")) return envUrl;
  const reqOrigin = req.headers.get("origin") || req.headers.get("referer");
  if (reqOrigin) {
    try {
      const parsed = new URL(reqOrigin);
      if (!parsed.hostname.includes("localhost")) {
        return `${parsed.protocol}//${parsed.host}`;
      }
    } catch {}
  }
  return envUrl || "https://omg-creative-workspace.vercel.app";
}

export async function GET(req: NextRequest) {
  try {
    const authRes = await requireWorkspaceMembership(req, {
      allowedRoles: ["owner", "business_owner_viewer"],
    });
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, admin } = authRes.data;
    const isViewer = membership.role === "business_owner_viewer";
    const baseOrigin = getBaseOrigin(req);

    const { data: ws } = await admin
      .from("workspaces")
      .select("id, allow_invitation_emails, allow_invitation_acceptance, invitations_paused")
      .eq("id", membership.workspaceId)
      .single();

    if (!ws) {
      return NextResponse.json({ error: "لم يتم العثور على مساحة العمل." }, { status: 404 });
    }

    const { data: invitations, error } = await admin
      .from("workspace_invitations")
      .select(`
        id,
        invited_email,
        role,
        status,
        expires_at,
        last_sent_at,
        notes,
        encrypted_token,
        created_at,
        updated_at,
        roster_person:roster_people!fk_invitation_roster(id, display_name, job_title, is_active)
      `)
      .eq("workspace_id", membership.workspaceId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Decrypt tokens for owner so copy-link can include ?token=...
    const augmentedInvitations = (invitations || []).map((inv: any) => {
      const rawToken = decryptToken(inv.encrypted_token);
      const isExpired = inv.status === "pending" && new Date(inv.expires_at).getTime() < Date.now();
      const effectiveStatus = isExpired ? "expired" : inv.status;
      const inviteUrl = rawToken ? `${baseOrigin}/accept-invite?token=${rawToken}` : undefined;
      return {
        ...inv,
        rawToken: rawToken || undefined,
        inviteUrl,
        isExpired,
        effectiveStatus,
        canCopyLink: inv.status !== "revoked" && inv.status !== "accepted",
        canResend: inv.status === "pending" || inv.status === "draft" || isExpired,
        canRevoke: inv.status !== "revoked" && inv.status !== "accepted",
        isDraft: inv.status === "draft",
      };
    });

    return NextResponse.json({
      success: true,
      isViewer,
      allowInvitationEmails: ws.allow_invitation_emails ?? false,
      allowInvitationAcceptance: ws.allow_invitation_acceptance ?? true,
      invitationsPaused: ws.invitations_paused,
      invitations: augmentedInvitations,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!validateSameOrigin(req)) {
      return NextResponse.json({ error: "طلب غير مصرح به (Same-Origin check failed)." }, { status: 403 });
    }

    const authRes = await requireOwner(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, admin } = authRes.data;
    const baseOrigin = getBaseOrigin(req);

    const body = await req.json();
    const {
      rosterPersonId,
      fullName,
      displayName,
      email,
      role = "designer",
      jobTitle,
      isDraftOnly = false,
      action = "send",
      notes,
    } = body;

    // Check workspace pause status
    const { data: ws } = await admin
      .from("workspaces")
      .select("id, allow_invitation_emails, allow_invitation_acceptance, invitations_paused")
      .eq("id", membership.workspaceId)
      .single();

    if (!ws) {
      return NextResponse.json({ error: "مساحة العمل غير موجودة." }, { status: 404 });
    }

    // Check if invitations are paused
    const isPaused = ws.invitations_paused === true || ws.allow_invitation_acceptance === false;
    if (isPaused && action !== "create_draft") {
      return NextResponse.json(
        {
          error: "قبول وتفعيل الدعوات متوقف حالياً في مساحة العمل بناءً على إعدادات الإدارة.",
          paused: true,
        },
        { status: 403 }
      );
    }

    if (!email || typeof email !== "string" || !email.trim()) {
      return NextResponse.json({ error: "يرجى إدخال البريد الإلكتروني." }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return NextResponse.json({ error: "صيغة البريد الإلكتروني غير صالحة." }, { status: 400 });
    }

    const effectiveRole = role === "owner" ? "senior_reviewer" : role;

    // 1. SCENARIO C / TEST 4: Check if email is ALREADY an active CRM member
    const { data: listData } = await admin.auth.admin.listUsers();
    const existingAuthUser = (listData?.users || []).find(
      (u) => (u.email || "").toLowerCase() === cleanEmail
    );

    if (existingAuthUser) {
      const { data: activeMembership } = await admin
        .from("workspace_memberships")
        .select("id, is_active")
        .eq("workspace_id", membership.workspaceId)
        .eq("user_id", existingAuthUser.id)
        .eq("is_active", true)
        .maybeSingle();

      if (activeMembership) {
        return NextResponse.json(
          {
            error: "هذا المستخدم عضو نشط بالفعل في مساحة العمل (User is already a member).",
            alreadyMember: true,
          },
          { status: 400 }
        );
      }
    }

    // 2. Resolve Roster Person:
    let targetRosterId = rosterPersonId;
    let targetPersonName = fullName || displayName || "";

    if (!targetRosterId) {
      if (!targetPersonName || !targetPersonName.trim()) {
        return NextResponse.json(
          { error: "يرجى تحديد العضو من القائمة أو إدخال الاسم الكامل للعضو الجديد." },
          { status: 400 }
        );
      }

      // Check if a roster person with same display_name already exists in this workspace
      const { data: existingRoster } = await admin
        .from("roster_people")
        .select("id, display_name, role, job_title")
        .eq("workspace_id", membership.workspaceId)
        .eq("display_name", targetPersonName.trim())
        .maybeSingle();

      if (existingRoster) {
        targetRosterId = existingRoster.id;
      } else {
        const defaultPerms = DEFAULT_ROLE_PERMISSIONS[effectiveRole as keyof typeof DEFAULT_ROLE_PERMISSIONS] || {};
        const { data: newRoster, error: newRosterErr } = await admin
          .from("roster_people")
          .insert({
            workspace_id: membership.workspaceId,
            display_name: targetPersonName.trim(),
            role: effectiveRole,
            job_title: jobTitle || ROSTER_ROLE_LABELS[effectiveRole as keyof typeof ROSTER_ROLE_LABELS] || effectiveRole,
            is_active: true,
            access_scope: "assigned_tasks",
            custom_permissions: defaultPerms,
          })
          .select()
          .single();

        if (newRosterErr || !newRoster) {
          return NextResponse.json({ error: `فشل إنشاء سجل العضو: ${newRosterErr?.message}` }, { status: 500 });
        }
        targetRosterId = newRoster.id;
      }
    } else {
      const { data: existingRoster } = await admin
        .from("roster_people")
        .select("display_name")
        .eq("id", targetRosterId)
        .maybeSingle();
      if (existingRoster?.display_name) {
        targetPersonName = existingRoster.display_name;
      }
    }

    // 3. SCENARIO D / TEST 5: Check for existing pending/draft invitation
    const { data: existingInvs } = await admin
      .from("workspace_invitations")
      .select("id, status, expires_at, last_sent_at, encrypted_token")
      .eq("workspace_id", membership.workspaceId)
      .eq("invited_email", cleanEmail)
      .in("status", ["pending", "draft"])
      .order("created_at", { ascending: false })
      .limit(1);

    const existing = existingInvs?.[0];
    const isExistingValid =
      existing &&
      existing.status === "pending" &&
      new Date(existing.expires_at).getTime() > Date.now();

    // If active pending invitation already exists and action is NOT resend:
    if (isExistingValid && action !== "resend") {
      const rawToken = decryptToken(existing.encrypted_token);
      return NextResponse.json(
        {
          error: "توجد دعوة معلقة بالفعل لهذا البريد الإلكتروني (An invitation is already pending). يمكنك نسخ رابطها أو إعادة إرسالها بدلاً من إنشاء دعوة مكررة.",
          alreadyPending: true,
          existingInvitationId: existing.id,
          canResend: true,
          rawToken: rawToken || undefined,
          inviteUrl: rawToken ? `${baseOrigin}/accept-invite?token=${rawToken}` : undefined,
        },
        { status: 409 }
      );
    }

    // Generate fresh cryptographic token
    const { rawToken, tokenHash, encryptedToken } = generateInvitationToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const targetStatus = isDraftOnly && action === "create_draft" ? "draft" : "pending";
    const inviteUrl = `${baseOrigin}/accept-invite?token=${rawToken}`;

    // 4. Update existing (if expired or draft or resend requested) OR insert brand new
    let savedInvitation: any;

    if (existing) {
      const { data: updated, error: updateErr } = await admin
        .from("workspace_invitations")
        .update({
          invited_email: cleanEmail,
          role: effectiveRole,
          status: targetStatus,
          token_hash: tokenHash,
          encrypted_token: encryptedToken,
          expires_at: expiresAt,
          last_sent_at: new Date().toISOString(),
          notes: notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select(`
          id,
          invited_email,
          role,
          status,
          expires_at,
          last_sent_at,
          notes,
          created_at,
          updated_at,
          roster_person:roster_people!fk_invitation_roster(id, display_name, job_title)
        `)
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }
      savedInvitation = updated;
    } else {
      const { data: inserted, error: insertErr } = await admin
        .from("workspace_invitations")
        .insert({
          workspace_id: membership.workspaceId,
          invited_email: cleanEmail,
          role: effectiveRole,
          roster_person_id: targetRosterId,
          token_hash: tokenHash,
          encrypted_token: encryptedToken,
          status: targetStatus,
          invited_by_roster_id: membership.rosterPersonId,
          expires_at: expiresAt,
          last_sent_at: new Date().toISOString(),
          notes: notes || null,
        })
        .select(`
          id,
          invited_email,
          role,
          status,
          expires_at,
          last_sent_at,
          notes,
          created_at,
          updated_at,
          roster_person:roster_people!fk_invitation_roster(id, display_name, job_title)
        `)
        .single();

      if (insertErr) {
        return NextResponse.json({ error: insertErr.message }, { status: 500 });
      }
      savedInvitation = inserted;
    }

    // 5. Email delivery: If allow_invitation_emails is enabled and not a draft
    let emailSent = false;
    let emailError: string | null = null;
    if (ws.allow_invitation_emails && targetStatus === "pending") {
      try {
        const { error: mailErr } = await admin.auth.admin.inviteUserByEmail(cleanEmail, {
          redirectTo: `${baseOrigin}/accept-invite`,
        });
        if (mailErr) {
          console.warn("Supabase inviteUserByEmail warning:", mailErr.message);
          emailError = mailErr.message;
        } else {
          emailSent = true;
        }
      } catch (mEx: any) {
        console.warn("Email delivery exception:", mEx.message);
        emailError = mEx.message;
      }
    }

    // 6. Record Audit Event
    await admin.from("audit_events").insert({
      workspace_id: membership.workspaceId,
      actor_id: membership.rosterPersonId,
      action: action === "resend" ? "resend_invitation" : "create_invitation",
      entity_type: "workspace_invitations",
      entity_id: savedInvitation.id,
      metadata: {
        email: cleanEmail,
        role: effectiveRole,
        status: targetStatus,
        email_sent: emailSent,
        email_error: emailError,
        roster_person_id: targetRosterId,
      },
    });

    const successMessage =
      action === "resend"
        ? "تمت إعادة إرسال الدعوة وتجديد الرابط بنجاح."
        : emailSent
        ? "تم إنشاء الدعوة وإرسال الإيميل التلقائي وتفعيل الرابط بنجاح."
        : "تم إنشاء وتفعيل رابط الدعوة بنجاح. يمكنك نسخه ومشاركته مباشرة مع العضو.";

    return NextResponse.json({
      success: true,
      message: successMessage,
      rawToken,
      inviteUrl,
      emailSent,
      invitation: { ...savedInvitation, rawToken, inviteUrl },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    if (!validateSameOrigin(req)) {
      return NextResponse.json({ error: "طلب غير مصرح به (Same-Origin check failed)." }, { status: 403 });
    }

    const authRes = await requireOwner(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, admin } = authRes.data;
    const baseOrigin = getBaseOrigin(req);

    const body = await req.json();
    const { id, status, action } = body;

    if (!id) {
      return NextResponse.json({ error: "معرف الدعوة مطلوب." }, { status: 400 });
    }

    const { data: ws } = await admin
      .from("workspaces")
      .select("id, allow_invitation_emails, allow_invitation_acceptance, invitations_paused")
      .eq("id", membership.workspaceId)
      .single();

    if (!ws) {
      return NextResponse.json({ error: "مساحة العمل غير موجودة." }, { status: 404 });
    }

    // Handle RESEND action
    if (action === "resend") {
      const { data: inv } = await admin
        .from("workspace_invitations")
        .select("id, invited_email, role, roster_person_id, status")
        .eq("workspace_id", membership.workspaceId)
        .eq("id", id)
        .single();

      if (!inv) {
        return NextResponse.json({ error: "الدعوة غير موجودة." }, { status: 404 });
      }

      const { rawToken, tokenHash, encryptedToken } = generateInvitationToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const inviteUrl = `${baseOrigin}/accept-invite?token=${rawToken}`;

      const { error: updateErr } = await admin
        .from("workspace_invitations")
        .update({
          status: "pending",
          token_hash: tokenHash,
          encrypted_token: encryptedToken,
          expires_at: expiresAt,
          last_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", membership.workspaceId)
        .eq("id", id);

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      let emailSent = false;
      if (ws.allow_invitation_emails) {
        try {
          await admin.auth.admin.inviteUserByEmail(inv.invited_email, {
            redirectTo: `${baseOrigin}/accept-invite`,
          });
          emailSent = true;
        } catch {}
      }

      await admin.from("audit_events").insert({
        workspace_id: membership.workspaceId,
        actor_id: membership.rosterPersonId,
        action: "resend_invitation",
        entity_type: "workspace_invitations",
        entity_id: id,
        metadata: { action: "resend", email: inv.invited_email, email_sent: emailSent },
      });

      return NextResponse.json({
        success: true,
        rawToken,
        inviteUrl,
        message: "تم تجديد صلاحية الدعوة وإعادة إرسالها بنجاح (صالح لمدة 7 أيام).",
      });
    }

    // Handle ISSUE action (transition draft -> pending for manual sharing)
    if (action === "issue" || status === "pending") {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { rawToken, tokenHash, encryptedToken } = generateInvitationToken();
      const inviteUrl = `${baseOrigin}/accept-invite?token=${rawToken}`;

      const { error: issueErr } = await admin
        .from("workspace_invitations")
        .update({
          status: "pending",
          token_hash: tokenHash,
          encrypted_token: encryptedToken,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", membership.workspaceId)
        .eq("id", id);

      if (issueErr) {
        return NextResponse.json({ error: issueErr.message }, { status: 500 });
      }

      await admin.from("audit_events").insert({
        workspace_id: membership.workspaceId,
        actor_id: membership.rosterPersonId,
        action: "issue_invitation_link",
        entity_type: "workspace_invitations",
        entity_id: id,
        metadata: { action: "issue" },
      });

      return NextResponse.json({
        success: true,
        rawToken,
        inviteUrl,
        message: "تم إصدار وتفعيل رابط الدعوة بنجاح (صالح لمدة 7 أيام).",
      });
    }

    // Handle REVOKE action
    if (status === "revoked" || action === "revoke") {
      const { error: revokeErr } = await admin
        .from("workspace_invitations")
        .update({ status: "revoked", updated_at: new Date().toISOString() })
        .eq("workspace_id", membership.workspaceId)
        .eq("id", id);

      if (revokeErr) {
        return NextResponse.json({ error: revokeErr.message }, { status: 500 });
      }

      await admin.from("audit_events").insert({
        workspace_id: membership.workspaceId,
        actor_id: membership.rosterPersonId,
        action: "revoke_invitation",
        entity_type: "workspace_invitations",
        entity_id: id,
        metadata: { status: "revoked" },
      });

      return NextResponse.json({ success: true, message: "تم إلغاء الدعوة بنجاح." });
    }

    return NextResponse.json({ error: "إجراء غير مدعوم." }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!validateSameOrigin(req)) {
      return NextResponse.json({ error: "طلب غير مصرح به (Same-Origin check failed)." }, { status: 403 });
    }

    const authRes = await requireOwner(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, admin } = authRes.data;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "معرف الدعوة مطلوب." }, { status: 400 });
    }

    const { error } = await admin
      .from("workspace_invitations")
      .update({ status: "revoked", updated_at: new Date().toISOString() })
      .eq("workspace_id", membership.workspaceId)
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await admin.from("audit_events").insert({
      workspace_id: membership.workspaceId,
      actor_id: membership.rosterPersonId,
      action: "revoke_invitation",
      entity_type: "workspace_invitations",
      entity_id: id,
      metadata: { deleted: true },
    });

    return NextResponse.json({ success: true, message: "تم إلغاء الدعوة بنجاح." });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
