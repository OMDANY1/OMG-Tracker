import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMembership } from "@/lib/auth/server-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authRes = await requireWorkspaceMembership(req);
  if (!authRes.success) {
    return authRes.errorResponse;
  }

  const { membership, admin } = authRes.data;

  const { searchParams } = new URL(req.url);
  let personId = searchParams.get("personId");

  // If personId is specified and differs from caller's rosterPersonId, only owner can view
  if (personId && personId !== membership.rosterPersonId) {
    if (membership.role !== "owner") {
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
