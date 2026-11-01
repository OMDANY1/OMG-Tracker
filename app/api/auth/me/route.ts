import { NextRequest, NextResponse } from "next/server";
import {
  requireWorkspaceMembership,
  getAccessibleClientIds,
  isFullAdminRole,
  hasGranularPermission,
} from "@/lib/auth/server-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authRes = await requireWorkspaceMembership(req);
  if (!authRes.success) {
    return authRes.errorResponse;
  }

  const { user, membership, admin } = authRes.data;
  const accessibleSet = await getAccessibleClientIds(admin, membership);

  return NextResponse.json(
    {
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
        jobTitle: membership.jobTitle,
        specialties: membership.specialties,
        accessScope: membership.accessScope,
        customPermissions: membership.customPermissions,
        effectivePermissions: membership.effectivePermissions,
        permissionDetails: membership.permissionDetails,
        updatedAt: membership.updatedAt,
        isOwner: isFullAdminRole(membership.role),
        canManageCampaigns: hasGranularPermission(membership, "create_campaigns"),
        canManageClients: hasGranularPermission(membership, "manage_clients"),
        canAssignTeam: hasGranularPermission(membership, "assign_team"),
        canCreateTasks: hasGranularPermission(membership, "create_tasks"),
        canExportReports: hasGranularPermission(membership, "export_reports"),
      },
      accessibleClientIds: accessibleSet ? Array.from(accessibleSet) : null,
      hasFullClientScope: accessibleSet === null,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    }
  );
}
