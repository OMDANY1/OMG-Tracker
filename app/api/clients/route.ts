import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { updateClient, updateClientAssignment } from "@/lib/services/clients";

export async function GET() {
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ clients: [], error: "Database unconfigured" });
  }

  // Determine caller role if session exists
  let isOwner = false;
  let callerRosterId: string | null = null;
  const serverClient = await createServerSupabaseClient().catch(() => null);
  if (serverClient) {
    const { data: authData } = await serverClient.auth.getUser();
    if (authData?.user) {
      const { data: member } = await admin
        .from("workspace_memberships")
        .select("role, roster_person_id")
        .eq("user_id", authData.user.id)
        .eq("is_active", true)
        .maybeSingle();
      if (member?.role === "owner") {
        isOwner = true;
      }
      callerRosterId = member?.roster_person_id || null;
    }
  }

  // Fetch clients
  const { data: clients, error } = await admin
    .from("clients")
    .select(`
      *,
      owner:roster_people!fk_client_owner(id, display_name, job_title),
      campaigns(id, title, status),
      tasks(id, status, primary_assignee_id)
    `)
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fetch active roster people (excluding generic owner)
  const { data: roster } = await admin
    .from("roster_people")
    .select("id, display_name, job_title, is_active")
    .eq("is_active", true)
    .order("display_name", { ascending: true });

  // Calculate stats for each designer
  const designers = (roster || []).map((designer) => {
    const clientCount = (clients || []).filter((c) => c.owner_roster_id === designer.id).length;
    let openTasksCount = 0;
    (clients || []).forEach((c) => {
      (c.tasks || []).forEach((t: any) => {
        if (t.primary_assignee_id === designer.id && !["delivered", "cancelled"].includes(t.status)) {
          openTasksCount++;
        }
      });
    });
    return {
      id: designer.id,
      displayName: designer.display_name,
      jobTitle: designer.job_title,
      clientCount,
      openTasksCount,
    };
  });

  return NextResponse.json({
    clients: clients || [],
    designers,
    isOwner,
    callerRosterId,
  });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      clientId,
      action,
      newOwnerRosterId,
      reassignOpenTasksToNewOwner,
      name,
      ownerRosterId,
      difficulty,
      extraWorkload,
      state,
      notes,
      brandGuideUrl,
      briefUrl,
      actorId,
    } = body;

    if (!clientId) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }

    if (action === "reassign" || newOwnerRosterId !== undefined) {
      const result = await updateClientAssignment({
        clientId,
        newOwnerRosterId: newOwnerRosterId !== undefined ? newOwnerRosterId : ownerRosterId,
        reassignOpenTasks: !!reassignOpenTasksToNewOwner,
      });
      return NextResponse.json({ success: true, result });
    }

    const updated = await updateClient({
      clientId,
      name,
      ownerRosterId,
      difficulty,
      extraWorkload,
      state,
      notes,
      brandGuideUrl,
      briefUrl,
      reassignOpenTasksToNewOwner,
      actorId,
    });

    return NextResponse.json({ client: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
