import { NextRequest, NextResponse } from "next/server";
import { listClientCalendars, getContentCalendarDetails } from "@/lib/services/content-calendars";
import { requireWorkspaceMembership, isFullAdminRole } from "@/lib/auth/server-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const authRes = await requireWorkspaceMembership(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership } = authRes.data;
    const workspaceId = membership.workspaceId;
    const userRosterId = membership.rosterPersonId || null;
    const isOwner = isFullAdminRole(membership.role);
    const canViewAll =
      isOwner ||
      [
        "manager",
        "marketing_director",
        "business_owner_viewer",
        "strategy_lead",
        "senior_reviewer",
      ].includes(membership.role);

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
      });

      return NextResponse.json({
        ...details,
        isOwner,
        callerRole: membership.role,
        userRosterId,
        workspaceId,
      });
    }

    // Otherwise return list of all client calendars for this month
    const clientCalendars = await listClientCalendars({
      workspaceId,
      monthKey,
      userRosterId: userRosterId || undefined,
      isOwner,
      canViewAll,
    });

    return NextResponse.json({
      clientCalendars,
      monthKey,
      isOwner,
      callerRole: membership.role,
      workspaceId,
      userRosterId,
    });
  } catch (err: any) {
    console.error("Error in /api/campaigns/calendar GET:", err.message);
    const status = err.message?.includes("غير مصرح") ? 403 : 500;
    return NextResponse.json({ error: err.message || "Internal server error" }, { status });
  }
}
