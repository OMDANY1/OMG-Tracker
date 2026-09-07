import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateClient } from "@/lib/services/clients";

export async function GET() {
  const supabase = createAdminClient();
  if (!supabase) {
    return NextResponse.json({ clients: [], error: "Database unconfigured" });
  }

  const { data: clients, error } = await supabase
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

  return NextResponse.json({ clients: clients || [] });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const {
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
    } = body;

    if (!clientId) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
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
