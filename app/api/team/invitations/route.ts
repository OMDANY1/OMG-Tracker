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
        created_at,
        roster_person:roster_people!fk_invitation_roster(id, display_name, job_title)
      `)
      .eq("workspace_id", membership.workspaceId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      invitationsPaused: ws.invitations_paused,
      invitations: invitations || [],
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
    const { rosterPersonId, email, role = "designer", isDraftOnly = true } = body;

    if (!rosterPersonId || !email) {
      return NextResponse.json({ error: "يرجى تحديد العضو والبريد الإلكتروني." }, { status: 400 });
    }

    // Check workspace pause status
    const { data: ws } = await admin
      .from("workspaces")
      .select("id, invitations_paused")
      .eq("id", membership.workspaceId)
      .single();

    if (!ws) {
      return NextResponse.json({ error: "مساحة العمل غير موجودة." }, { status: 404 });
    }

    // If invitations are paused, forbid sending live invitation emails
    if (ws.invitations_paused && !isDraftOnly) {
      return NextResponse.json(
        {
          error: "الدعوات متوقفة مؤقتًا لحين الانتهاء من تحديث مساحة العمل. تم حفظ الدعوة كمسودة فقط ولا يمكن إرسالها الآن.",
          paused: true,
        },
        { status: 403 }
      );
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: invitation, error: insertErr } = await admin
      .from("workspace_invitations")
      .insert({
        workspace_id: membership.workspaceId,
        invited_email: email.trim().toLowerCase(),
        role: role === "owner" ? "senior_reviewer" : role, // Owner cannot be invited via invitation
        roster_person_id: rosterPersonId,
        token_hash: tokenHash,
        status: "pending",
        invited_by_roster_id: membership.rosterPersonId,
        expires_at: expiresAt,
      })
      .select(`
        id,
        invited_email,
        role,
        status,
        expires_at,
        created_at,
        roster_person:roster_people!fk_invitation_roster(id, display_name, job_title)
      `)
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

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
    const { id, status } = body;

    if (!id || !["revoked"].includes(status)) {
      return NextResponse.json({ error: "بيانات التعديل غير صالحة." }, { status: 400 });
    }

    const { error } = await admin
      .from("workspace_invitations")
      .update({ status })
      .eq("workspace_id", membership.workspaceId)
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
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
      .update({ status: "revoked" })
      .eq("workspace_id", membership.workspaceId)
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
