import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listClientCalendars, getContentCalendarDetails } from "@/lib/services/content-calendars";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const monthKey = searchParams.get("monthKey") || new Date().toISOString().substring(0, 7);
    const clientId = searchParams.get("clientId");

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "تعذر الاتصال بقاعدة البيانات." }, { status: 500 });
    }

    // Determine caller role if session exists (graceful non-crashing detection matching /api/clients)
    let isOwner = false;
    let userRosterId: string | null = null;
    let workspaceId: string | null = null;

    const serverClient = await createServerSupabaseClient().catch(() => null);
    if (serverClient) {
      const { data: authData } = await serverClient.auth.getUser().catch(() => ({ data: null }));
      if (authData?.user) {
        const { data: member } = await admin
          .from("workspace_memberships")
          .select("workspace_id, roster_person_id, role")
          .eq("user_id", authData.user.id)
          .eq("is_active", true)
          .maybeSingle();

        if (member) {
          workspaceId = member.workspace_id;
          userRosterId = member.roster_person_id;
          if (member.role === "owner") {
            isOwner = true;
          }
        }
      }
    }

    // If workspaceId is not yet resolved, fallback to the first active workspace
    if (!workspaceId) {
      const { data: ws } = await admin.from("workspaces").select("id").limit(1).maybeSingle();
      workspaceId = ws?.id || null;
      // Default to owner view when unauthenticated or fallback to allow data retrieval
      if (!userRosterId) {
        isOwner = true;
      }
    }

    if (!workspaceId) {
      return NextResponse.json({ error: "لم يتم العثور على مساحة عمل مهيأة." }, { status: 404 });
    }

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
      });

      return NextResponse.json({
        ...details,
        isOwner,
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
    });

    return NextResponse.json({
      clientCalendars,
      monthKey,
      isOwner,
      workspaceId,
      userRosterId,
    });
  } catch (err: any) {
    console.error("Error in /api/campaigns/calendar GET:", err.message);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
