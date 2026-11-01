import { NextRequest, NextResponse } from "next/server";
import { listClientCalendars, getContentCalendarDetails } from "@/lib/services/content-calendars";
import {
  requireWorkspaceMembership,
  isFullAdminRole,
  hasGranularPermission,
  getAccessibleClientIds,
} from "@/lib/auth/server-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const authRes = await requireWorkspaceMembership(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, admin } = authRes.data;
    const workspaceId = membership.workspaceId;
    const userRosterId = membership.rosterPersonId || null;
    const isOwner = isFullAdminRole(membership.role);
    const canManageCampaigns = hasGranularPermission(membership, "create_campaigns");
    const accessibleClientIds = await getAccessibleClientIds(admin, membership);
    const canViewAll = accessibleClientIds === null;

    const { searchParams } = new URL(req.url);
    const monthKey = searchParams.get("monthKey") || new Date().toISOString().substring(0, 7);
    const clientId = searchParams.get("clientId");

    // If clientId is provided, return single calendar details
    if (clientId) {
      const campaignId = searchParams.get("campaignId") || undefined;
      const details = await getContentCalendarDetails({
        workspaceId,
        clientId,
        monthKey,
        campaignId,
        userRosterId: userRosterId || undefined,
        isOwner,
        canViewAll,
        accessibleClientIds,
      });

      return NextResponse.json(
        {
          ...details,
          isOwner,
          canManageCampaigns,
          accessScope: membership.accessScope,
          effectivePermissions: membership.effectivePermissions,
          callerRole: membership.role,
          userRosterId,
          workspaceId,
        },
        {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          },
        }
      );
    }

    // Otherwise return list of client calendars within the caller's resolved scope
    const clientCalendars = await listClientCalendars({
      workspaceId,
      monthKey,
      userRosterId: userRosterId || undefined,
      isOwner,
      canViewAll,
      accessibleClientIds,
    });

    return NextResponse.json(
      {
        clientCalendars,
        monthKey,
        isOwner,
        canManageCampaigns,
        accessScope: membership.accessScope,
        effectivePermissions: membership.effectivePermissions,
        accessibleClientIds: accessibleClientIds ? Array.from(accessibleClientIds) : null,
        callerRole: membership.role,
        workspaceId,
        userRosterId,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        },
      }
    );
  } catch (err: any) {
    console.error("Error in /api/campaigns/calendar GET:", err.message);
    const status = err.message?.includes("غير مصرح") ? 403 : 500;
    return NextResponse.json({ error: err.message || "Internal server error" }, { status });
  }
}
