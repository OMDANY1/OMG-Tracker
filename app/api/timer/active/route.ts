import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMembership, isFullAdminRole } from "@/lib/auth/server-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authRes = await requireWorkspaceMembership(req);
  if (!authRes.success) {
    return authRes.errorResponse;
  }

  const { membership, admin } = authRes.data;
  const isFullAdmin = isFullAdminRole(membership.role);

  const { searchParams } = new URL(req.url);
  const showAll = searchParams.get("all") === "true";
  let personId = searchParams.get("personId");

  // If requesting all active timers, require full admin authority
  if (showAll) {
    if (!isFullAdmin && membership.role !== "manager" && membership.role !== "senior_reviewer") {
      return NextResponse.json(
        { error: "غير مصرح: لا يمكنك عرض كافة المؤقتات النشطة." },
        { status: 403 }
      );
    }

    const { data: activeTimers, error } = await admin
      .from("time_entries")
      .select(`
        *,
        person:roster_people!fk_time_person(id, display_name, job_title),
        task:tasks(
          id,
          title,
          deliverable_number,
          campaign:campaigns(
            title,
            client:clients(name)
          )
        )
      `)
      .eq("workspace_id", membership.workspaceId)
      .is("ended_at", null)
      .eq("is_voided", false);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ timers: activeTimers || [] });
  }

  // If personId is specified and differs from caller's rosterPersonId, only full admin or manager can view
  if (personId && personId !== membership.rosterPersonId) {
    if (!isFullAdmin && membership.role !== "manager") {
      return NextResponse.json(
        { error: "غير مصرح: لا يمكنك عرض مؤقت عضو آخر." },
        { status: 403 }
      );
    }
  } else {
    personId = membership.rosterPersonId;
  }

  const { data: timer, error } = await admin
    .from("time_entries")
    .select(`
      *,
      task:tasks(
        id,
        title,
        deliverable_number,
        campaign:campaigns(
          title,
          client:clients(name)
        )
      )
    `)
    .eq("workspace_id", membership.workspaceId)
    .eq("roster_person_id", personId)
    .is("ended_at", null)
    .eq("is_voided", false)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ timer: timer || null });
}
