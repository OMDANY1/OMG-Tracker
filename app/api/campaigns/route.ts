import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCampaign } from "@/lib/services/campaigns";

export async function GET(req: NextRequest) {
  const supabase = createAdminClient();
  if (!supabase) {
    return NextResponse.json({ campaigns: [], error: "Database unconfigured" });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId");

  let query = supabase
    .from("campaigns")
    .select(`
      *,
      client:clients(id, name, difficulty),
      tasks(id, status, primary_assignee_id, deliverable_number, deliverable_type)
    `)
    .order("created_at", { ascending: false });

  if (clientId) query = query.eq("client_id", clientId);

  const { data: campaigns, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ campaigns: campaigns || [] });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspaceId, clientId, title, objective, brief, startDate, dueDate, status, idempotencyKey } = body;

    if (!workspaceId || !clientId || !title) {
      return NextResponse.json(
        { error: "workspaceId, clientId, and title are required" },
        { status: 400 }
      );
    }

    const campaign = await createCampaign({
      workspaceId,
      clientId,
      title,
      objective,
      brief,
      startDate,
      dueDate,
      status: status || "Active",
      idempotencyKey,
    });

    return NextResponse.json({ campaign });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
