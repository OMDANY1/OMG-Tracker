import { NextRequest, NextResponse } from "next/server";
import { createCampaign } from "@/lib/services/campaigns";
import {
  requireWorkspaceMembership,
  validateSameOrigin,
  isFullAdminRole,
  hasGranularPermission,
} from "@/lib/auth/server-auth";

export async function GET(req: NextRequest) {
  const authRes = await requireWorkspaceMembership(req);
  if (!authRes.success) {
    return authRes.errorResponse;
  }

  const { membership, admin } = authRes.data;
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId");

  let query = admin
    .from("campaigns")
    .select(`
      *,
      client:clients(id, name, difficulty),
      tasks(id, status, primary_assignee_id, deliverable_number, deliverable_type)
    `)
    .eq("workspace_id", membership.workspaceId)
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
    if (!validateSameOrigin(req)) {
      return NextResponse.json(
        { error: "طلب غير مصرح به (Same-Origin check failed)." },
        { status: 403 }
      );
    }

    const authRes = await requireWorkspaceMembership(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership } = authRes.data;
    if (
      !isFullAdminRole(membership.role) &&
      membership.role !== "manager" &&
      !hasGranularPermission(membership, "create_campaigns")
    ) {
      return NextResponse.json(
        { error: "غير مصرح: إنشاء الحملات مقتصر على الإدارة." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { clientId, title, objective, brief, startDate, dueDate, status, idempotencyKey } = body;

    if (!clientId || !title) {
      return NextResponse.json(
        { error: "clientId and title are required" },
        { status: 400 }
      );
    }

    const campaign = await createCampaign({
      workspaceId: membership.workspaceId,
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
