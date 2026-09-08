import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateAndConsumeSetupToken, hasExistingOwner } from "@/lib/auth/owner-setup-token";

export async function POST(request: NextRequest) {
  try {
    // 1. Strict Environment Guard: Only permitted in local development
    if (process.env.NODE_ENV !== "development") {
      return NextResponse.json(
        { error: "غير مسموح بتهيئة المالك عبر هذه الواجهة خارج بيئة التطوير المحلية." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { email, password, token, fullName } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "البريد الإلكتروني وكلمة المرور مطلوبان." },
        { status: 400 }
      );
    }

    if (!token) {
      return NextResponse.json(
        { error: "رمز التهيئة لمرة واحدة (Setup Token) مطلوب لإتمام العملية." },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: "خادم قاعدة البيانات غير مهيأ بعد أو تنقصه المتغيرات البيئية." },
        { status: 500 }
      );
    }

    // 2. Lockout Guard: Check if an active owner already exists in workspace_memberships
    const ownerExists = await hasExistingOwner(admin);
    if (ownerExists) {
      return NextResponse.json(
        { error: "تم تهيئة حساب المالك للايجنسي مسبقاً. هذه العملية مقفلة ومحمية بشكل نهائي." },
        { status: 403 }
      );
    }

    // 3. One-Time Setup Token Validation & Consumption
    const isTokenValid = validateAndConsumeSetupToken(token);
    if (!isTokenValid) {
      return NextResponse.json(
        { error: "رمز التهيئة (Setup Token) غير صحيح أو تم استهلاكه مسبقاً. يرجى مراجعة ملف .owner-setup-token في مجلد المشروع." },
        { status: 403 }
      );
    }

    // 4. Fetch the target agency workspace
    const { data: workspaces, error: wsErr } = await admin
      .from("workspaces")
      .select("id, name")
      .limit(1);

    if (wsErr || !workspaces || workspaces.length === 0) {
      return NextResponse.json(
        { error: "لم يتم العثور على مساحة العمل في النظام." },
        { status: 500 }
      );
    }
    const workspaceId = workspaces[0].id;

    // 5. Fetch the unlinked owner roster person
    const { data: rosterOwners, error: rErr } = await admin
      .from("roster_people")
      .select("id, display_name")
      .eq("workspace_id", workspaceId)
      .eq("display_name", "المدير العام (Owner)")
      .limit(1);

    if (rErr || !rosterOwners || rosterOwners.length === 0) {
      return NextResponse.json(
        { error: "لم يتم العثور على حساب المدير العام في قائمة أعضاء الايجنسي." },
        { status: 500 }
      );
    }
    const rosterPersonId = rosterOwners[0].id;

    // 6. Create or link user in Supabase auth.users
    let userId: string;
    const displayName = (fullName && fullName.trim()) ? fullName.trim() : "المدير العام";

    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { full_name: displayName },
    });

    if (createErr) {
      if (createErr.message.includes("already been registered") || createErr.message.includes("unique")) {
        const { data: listData, error: listErr } = await admin.auth.admin.listUsers();
        if (listErr) {
          return NextResponse.json({ error: createErr.message }, { status: 400 });
        }
        const existing = listData.users.find(u => u.email?.toLowerCase() === email.trim().toLowerCase());
        if (!existing) {
          return NextResponse.json({ error: "المستخدم مسجل ولكن تعذر استرداده." }, { status: 400 });
        }
        userId = existing.id;
        await admin.auth.admin.updateUserById(userId, {
          password,
          user_metadata: { full_name: displayName }
        });
      } else {
        return NextResponse.json({ error: createErr.message }, { status: 400 });
      }
    } else {
      userId = newUser.user.id;
    }

    // 7. Invoke the database bootstrap_owner RPC using service_role
    const { data: bootstrapData, error: bootErr } = await admin.rpc("bootstrap_owner", {
      p_workspace_id: workspaceId,
      p_owner_user_id: userId,
      p_roster_person_id: rosterPersonId,
    });

    if (bootErr) {
      return NextResponse.json(
        { error: `فشل تفعيل حساب المالك في قاعدة البيانات: ${bootErr.message}` },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "تم تهيئة وتفعيل حساب المدير العام بنجاح! تم استهلاك رمز التهيئة وحماية النظام. يمكنك الآن تسجيل الدخول.",
      bootstrap: bootstrapData,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "حدث خطأ غير متوقع أثناء تهيئة الحساب." },
      { status: 500 }
    );
  }
}
