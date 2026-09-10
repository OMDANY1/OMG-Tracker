import { NextRequest, NextResponse } from "next/server";
import { requireOwner, validateSameOrigin } from "@/lib/auth/server-auth";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const authRes = await requireOwner(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, admin } = authRes.data;

    const { data: ws } = await admin
      .from("workspaces")
      .select("id, invitations_paused")
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
        created_at,
        updated_at,
        roster_person:roster_people!fk_invitation_roster(id, display_name, job_title, is_active)
      `)
      .eq("workspace_id", membership.workspaceId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Augment with safe UI indicators (e.g. can_copy_link is false for draft or paused)
    const augmentedInvitations = (invitations || []).map((inv: any) => ({
      ...inv,
      canCopyLink: inv.status !== "draft" && !ws.invitations_paused,
      isDraft: inv.status === "draft",
    }));

    return NextResponse.json({
      success: true,
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

    const body = await req.json();
    const {
      rosterPersonId,
      email,
      role = "designer",
      isDraftOnly = true,
      action = "create_draft",
      notes,
    } = body;

    // Check workspace pause status
    const { data: ws } = await admin
      .from("workspaces")
      .select("id, invitations_paused")
      .eq("id", membership.workspaceId)
      .single();

    if (!ws) {
      return NextResponse.json({ error: "مساحة العمل غير موجودة." }, { status: 404 });
    }

    // If attempting to SEND while paused, return strict 403
    if (action === "send" || (!isDraftOnly && action !== "create_draft")) {
      if (ws.invitations_paused) {
        return NextResponse.json(
          {
            error: "الدعوات متوقفة مؤقتًا لحين الانتهاء من تحديث مساحة العمل. تم منع إرسال الدعوة حفاظًا على الأمان.",
            paused: true,
          },
          { status: 403 }
        );
      }
    }

    if (!rosterPersonId || !email) {
      return NextResponse.json({ error: "يرجى تحديد العضو والبريد الإلكتروني." }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Idempotency / Deduplication Check:
    // Look for existing active/draft invitation for the same roster person or email
    const { data: existingInvs } = await admin
      .from("workspace_invitations")
      .select("id, status, last_sent_at, created_at, updated_at")
      .eq("workspace_id", membership.workspaceId)
      .or(`roster_person_id.eq.${rosterPersonId},invited_email.eq.${cleanEmail}`)
      .in("status", ["draft", "pending"])
      .order("created_at", { ascending: false })
      .limit(1);

    const existing = existingInvs?.[0];

    // If an existing pending/draft invitation was found
    if (existing) {
      // If action is resend / send:
      if (action === "send" || action === "resend") {
        if (ws.invitations_paused) {
          return NextResponse.json(
            {
              error: "الدعوات متوقفة مؤقتًا لحين الانتهاء من تحديث مساحة العمل. تم منع إرسال الدعوة.",
              paused: true,
            },
            { status: 403 }
          );
        }

        // Cooldown check (60 seconds)
        const lastSent = existing.last_sent_at ? new Date(existing.last_sent_at).getTime() : 0;
        const now = Date.now();
        if (now - lastSent < 60000) {
          const remainingSecs = Math.ceil((60000 - (now - lastSent)) / 1000);
          return NextResponse.json(
            {
              error: `يرجى الانتظار ${remainingSecs} ثانية قبل إعادة إرسال الدعوة (Cooldown).`,
              cooldownRemainingSeconds: remainingSecs,
            },
            { status: 429 }
          );
        }
      }

      // Update existing draft record (idempotency)
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const { data: updated, error: updateErr } = await admin
        .from("workspace_invitations")
        .update({
          invited_email: cleanEmail,
          role: role === "owner" ? "senior_reviewer" : role,
          status: ws.invitations_paused ? "draft" : isDraftOnly ? "draft" : "pending",
          token_hash: tokenHash,
          expires_at: expiresAt,
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

      return NextResponse.json({
        success: true,
        isExisting: true,
        message: ws.invitations_paused
          ? "تم تحديث مسودة الدعوة القائمة بنجاح. (الإرسال متوقف مؤقتًا)"
          : "تم تحديث الدعوة بنجاح.",
        invitation: updated,
      });
    }

    // Otherwise create brand new draft
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const targetStatus = ws.invitations_paused ? "draft" : isDraftOnly ? "draft" : "pending";

    const { data: invitation, error: insertErr } = await admin
      .from("workspace_invitations")
      .insert({
        workspace_id: membership.workspaceId,
        invited_email: cleanEmail,
        role: role === "owner" ? "senior_reviewer" : role, // Owner cannot be invited
        roster_person_id: rosterPersonId,
        token_hash: tokenHash,
        status: targetStatus,
        invited_by_roster_id: membership.rosterPersonId,
        expires_at: expiresAt,
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

    // Audit Event
    await admin.from("audit_events").insert({
      workspace_id: membership.workspaceId,
      actor_id: membership.rosterPersonId,
      action: "create_invitation_draft",
      entity_type: "workspace_invitations",
      entity_id: invitation.id,
      metadata: {
        email: cleanEmail,
        roster_person_id: rosterPersonId,
        role,
        status: targetStatus,
        paused: ws.invitations_paused,
      },
    });

    return NextResponse.json({
      success: true,
      message: ws.invitations_paused
        ? "تم حفظ مسودة الدعوة بنجاح. (الإرسال الفعلي متوقف لحين إعادة فتح الدعوات)"
        : "تم إنشاء الدعوة بنجاح.",
      invitation,
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

    const body = await req.json();
    const { id, status, action } = body;

    if (!id) {
      return NextResponse.json({ error: "معرف الدعوة مطلوب." }, { status: 400 });
    }

    const { data: ws } = await admin
      .from("workspaces")
      .select("id, invitations_paused")
      .eq("id", membership.workspaceId)
      .single();

    if (!ws) {
      return NextResponse.json({ error: "مساحة العمل غير موجودة." }, { status: 404 });
    }

    // Handle SEND or RESEND action
    if (action === "send" || action === "resend") {
      if (ws.invitations_paused) {
        return NextResponse.json(
          {
            error: "الدعوات متوقفة مؤقتًا لحين الانتهاء من تحديث مساحة العمل. تم منع إرسال الدعوة.",
            paused: true,
          },
          { status: 403 }
        );
      }

      // Check existing invitation & cooldown
      const { data: inv } = await admin
        .from("workspace_invitations")
        .select("id, status, last_sent_at")
        .eq("workspace_id", membership.workspaceId)
        .eq("id", id)
        .single();

      if (!inv) {
        return NextResponse.json({ error: "الدعوة غير موجودة." }, { status: 404 });
      }

      const lastSent = inv.last_sent_at ? new Date(inv.last_sent_at).getTime() : 0;
      const now = Date.now();
      if (now - lastSent < 60000) {
        const remainingSecs = Math.ceil((60000 - (now - lastSent)) / 1000);
        return NextResponse.json(
          {
            error: `يرجى الانتظار ${remainingSecs} ثانية قبل إعادة الإرسال (Cooldown).`,
            cooldownRemainingSeconds: remainingSecs,
          },
          { status: 429 }
        );
      }

      // Transition draft -> pending and record last_sent_at
      const { error: updateErr } = await admin
        .from("workspace_invitations")
        .update({
          status: "pending",
          last_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", membership.workspaceId)
        .eq("id", id);

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      // Audit send
      await admin.from("audit_events").insert({
        workspace_id: membership.workspaceId,
        actor_id: membership.rosterPersonId,
        action: "send_invitation",
        entity_type: "workspace_invitations",
        entity_id: id,
        metadata: { action },
      });

      return NextResponse.json({ success: true, message: "تم إرسال الدعوة بنجاح." });
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

      // Audit revocation
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

    // Audit
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
