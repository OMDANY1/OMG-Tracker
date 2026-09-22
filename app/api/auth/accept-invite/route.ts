import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "تعذر الاتصال بقاعدة البيانات." }, { status: 500 });
    }

    const { data: ws } = await admin
      .from("workspaces")
      .select("id, invitations_paused")
      .limit(1)
      .single();

    return NextResponse.json({
      invitationsPaused: ws?.invitations_paused ?? true,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const serverClient = await createServerSupabaseClient().catch(() => null);
    if (!serverClient) {
      return NextResponse.json({ error: "جلسة المستخدم غير متوفرة." }, { status: 401 });
    }

    const { data: authData, error: authErr } = await serverClient.auth.getUser();
    if (authErr || !authData?.user) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أو تأكيد الرابط أولاً." }, { status: 401 });
    }

    const user = authData.user;
    const userEmail = (user.email || "").toLowerCase().trim();

    if (!userEmail) {
      return NextResponse.json({ error: "البريد الإلكتروني غير صالح." }, { status: 400 });
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "تعذر الاتصال بقاعدة البيانات." }, { status: 500 });
    }

    // Phase 0: Enforce invitations_paused
    const { data: ws } = await admin
      .from("workspaces")
      .select("id, invitations_paused")
      .limit(1)
      .single();

    if (ws?.invitations_paused) {
      return NextResponse.json(
        { error: "الدعوات متوقفة مؤقتًا لحين الانتهاء من تحديث مساحة العمل. سيصلك رابط جديد عند إعادة فتح الدعوات." },
        { status: 403 }
      );
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

    // 2. Resolve target roster person and role by invitation or verified email
    let targetRosterId: string | null = null;
    let targetRole: string = "designer";
    let targetName: string = "";
    let matchedInvitationId: string | null = null;

    // Check workspace_invitations table first
    const { data: inviteRecord } = await admin
      .from("workspace_invitations")
      .select("id, workspace_id, invited_email, role, roster_person_id, status, expires_at")
      .eq("invited_email", userEmail)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (inviteRecord) {
      if (new Date(inviteRecord.expires_at).getTime() < Date.now()) {
        return NextResponse.json(
          { error: "انتهت صلاحية رابط الدعوة. يرجى التواصل مع الإدارة لتجديد الدعوة." },
          { status: 410 }
        );
      }
      targetRosterId = inviteRecord.roster_person_id;
      targetRole = inviteRecord.role;
      matchedInvitationId = inviteRecord.id;
    } else {
      // Pre-mapped fallback emails of the 5 confirmed designers
      const DESIGNER_EMAILS: Record<string, { name: string; role: "senior_reviewer" | "designer" }> = {
        "nadaabdulnabi513@gmail.com": { name: "ندى", role: "senior_reviewer" },
        "sara95gd@gmail.com": { name: "سارة", role: "designer" },
        "alaa.hossam16814@gmail.com": { name: "آلاء", role: "designer" },
        "lasheeen178@gmail.com": { name: "شهد", role: "designer" },
        "ayahamza318@gmail.com": { name: "آية", role: "designer" },
      };

      const targetDesigner = DESIGNER_EMAILS[userEmail];
      if (!targetDesigner) {
        return NextResponse.json(
          { error: "هذا البريد الإلكتروني غير مسجل ضمن قائمة الدعوات المعتمدة للايجنسي." },
          { status: 403 }
        );
      }

      const { data: legacyRoster } = await admin
        .from("roster_people")
        .select("id, workspace_id, display_name, is_active")
        .eq("display_name", targetDesigner.name)
        .eq("is_active", true)
        .maybeSingle();

      if (legacyRoster) {
        targetRosterId = legacyRoster.id;
        targetRole = targetDesigner.role;
        targetName = targetDesigner.name;
      }
    }

    if (!targetRosterId) {
      return NextResponse.json(
        { error: "لم يتم العثور على سجل العضو في مساحة العمل." },
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
    await admin
      .from("workspace_invitations")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        accepted_by_id: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", rosterPerson.workspace_id)
      .eq("invited_email", userEmail)
      .eq("status", "pending");

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
