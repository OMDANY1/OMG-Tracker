import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMembership } from "@/lib/auth/server-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authRes = await requireWorkspaceMembership(req);
  if (!authRes.success) {
    return authRes.errorResponse;
  }

  const { user, membership } = authRes.data;

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
    },
    membership: {
      id: membership.id,
      workspaceId: membership.workspaceId,
      userId: membership.userId,
      rosterPersonId: membership.rosterPersonId,
      role: membership.role,
      displayName: membership.displayName,
    },
  });
}
