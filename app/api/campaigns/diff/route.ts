import { NextRequest, NextResponse } from "next/server";
import { computeCalendarDiff } from "@/lib/services/calendar-diff";
import { requireWorkspaceMembership } from "@/lib/auth/server-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const authRes = await requireWorkspaceMembership(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, admin } = authRes.data;
    const { searchParams } = new URL(req.url);
    const campaignId = searchParams.get("campaignId");
    let previousCampaignId = searchParams.get("previousCampaignId");

    if (!campaignId) {
      return NextResponse.json({ error: "معرف الحملة (campaignId) مطلوب." }, { status: 400 });
    }

    // 1. Fetch current campaign scoped to workspace
    const { data: campaign, error: campErr } = await admin
      .from("campaigns")
      .select("id, workspace_id, client_id, month_key, revision_number, parent_campaign_id, title")
      .eq("id", campaignId)
      .eq("workspace_id", membership.workspaceId)
      .single();

    if (campErr || !campaign) {
      return NextResponse.json({ error: "لم يتم العثور على سجل التقويم المحدد." }, { status: 404 });
    }

    // 2. Fetch items for current campaign
    const { data: newItems, error: newItemsErr } = await admin
      .from("content_calendar_items")
      .select(`
        *,
        suggested_assignee:roster_people!fk_cci_suggested_assignee(id, display_name),
        approved_assignee:roster_people!fk_cci_approved_assignee(id, display_name)
      `)
      .eq("campaign_id", campaignId)
      .order("post_order", { ascending: true });

    if (newItemsErr) {
      return NextResponse.json({ error: "تعذر جلب عناصر التقويم الجديد." }, { status: 500 });
    }

    // 3. Resolve previous campaign if not specified
    if (!previousCampaignId) {
      if (campaign.parent_campaign_id) {
        previousCampaignId = campaign.parent_campaign_id;
      } else {
        // Find previous revision for same client and month
        const { data: prevCamp } = await admin
          .from("campaigns")
          .select("id, revision_number")
          .eq("workspace_id", campaign.workspace_id)
          .eq("client_id", campaign.client_id)
          .eq("month_key", campaign.month_key)
          .lt("revision_number", campaign.revision_number || 1)
          .order("revision_number", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (prevCamp) {
          previousCampaignId = prevCamp.id;
        }
      }
    }

    let oldItems: any[] = [];
    let previousCampaign: any = null;
    let existingTasks: any[] = [];

    if (previousCampaignId) {
      const { data: prevCamp } = await admin
        .from("campaigns")
        .select("id, revision_number, title, calendar_status")
        .eq("id", previousCampaignId)
        .eq("workspace_id", membership.workspaceId)
        .maybeSingle();

      previousCampaign = prevCamp;

      const { data: prevItems } = await admin
        .from("content_calendar_items")
        .select(`
          *,
          suggested_assignee:roster_people!fk_cci_suggested_assignee(id, display_name),
          approved_assignee:roster_people!fk_cci_approved_assignee(id, display_name)
        `)
        .eq("campaign_id", previousCampaignId)
        .order("post_order", { ascending: true });

      oldItems = prevItems || [];

      // Fetch tasks associated with previous campaign
      const { data: tasks } = await admin
        .from("tasks")
        .select(`
          id,
          title,
          status,
          content_calendar_item_id,
          deliverable_number,
          assignee:roster_people!fk_task_assignee(id, display_name)
        `)
        .eq("campaign_id", previousCampaignId)
        .eq("workspace_id", membership.workspaceId);

      existingTasks = tasks || [];
    }

    // 4. Compute Diff
    const report = computeCalendarDiff({
      oldItems,
      newItems: newItems || [],
      existingTasks,
    });

    report.previousCampaignId = previousCampaignId || undefined;
    report.newCampaignId = campaignId;

    return NextResponse.json({
      success: true,
      report,
      campaign,
      previousCampaign,
    });
  } catch (err: any) {
    console.error("Error in /api/campaigns/diff:", err);
    return NextResponse.json({ error: err.message || "فشل مقارنة التعديلات" }, { status: 500 });
  }
}
