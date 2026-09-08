import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { extractPostsFromPdf, validatePdfBuffer, ExtractedPostItem } from "./pdf-extractor";
import crypto from "crypto";

export async function uploadContentCalendar(params: {
  workspaceId: string;
  clientId: string;
  monthKey: string; // 'YYYY-MM'
  fileName: string;
  fileBuffer: Buffer;
  uploaderRosterId: string;
}) {
  const admin = createAdminClient();
  if (!admin) throw new Error("تعذر الاتصال بقاعدة البيانات.");

  // 1. Validation
  const val = validatePdfBuffer(params.fileBuffer);
  if (!val.valid) throw new Error(val.error);

  if (!/^\d{4}-\d{2}$/.test(params.monthKey)) {
    throw new Error("تنسيق الشهر غير صالح. يجب أن يكون YYYY-MM.");
  }

  // 2. Client verification & load designer
  const { data: client, error: clientErr } = await admin
    .from("clients")
    .select("id, name, owner_roster_id, difficulty")
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.clientId)
    .single();

  if (clientErr || !client) {
    throw new Error("العميل غير موجود في مساحة العمل.");
  }

  // 3. Compute file hash
  const fileHash = crypto.createHash("sha256").update(params.fileBuffer).digest("hex");

  // 4. Resolve next revision number
  const { data: existingCampaigns } = await admin
    .from("campaigns")
    .select("id, revision_number")
    .eq("workspace_id", params.workspaceId)
    .eq("client_id", params.clientId)
    .eq("month_key", params.monthKey)
    .order("revision_number", { ascending: false });

  const nextRevision = existingCampaigns && existingCampaigns.length > 0
    ? existingCampaigns[0].revision_number + 1
    : 1;

  // 5. Mark older revisions as not current
  if (existingCampaigns && existingCampaigns.length > 0) {
    await admin
      .from("campaigns")
      .update({ is_current_revision: false })
      .eq("workspace_id", params.workspaceId)
      .eq("client_id", params.clientId)
      .eq("month_key", params.monthKey);
  }

  // 6. Generate new campaign ID
  const campaignId = crypto.randomUUID();
  const safeFileName = params.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${params.workspaceId}/${params.clientId}/${params.monthKey}/${campaignId}/${safeFileName}`;

  // 7. Upload to Supabase Storage bucket 'content-calendars'
  const { error: uploadErr } = await admin.storage
    .from("content-calendars")
    .upload(storagePath, params.fileBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadErr) {
    throw new Error(`فشل رفع الملف إلى التخزين: ${uploadErr.message}`);
  }

  // 8. Extract text and posts
  const extraction = await extractPostsFromPdf(params.fileBuffer, {
    targetYearMonth: params.monthKey,
  });

  const calendarStatus = extraction.isScannedOrNoText
    ? "needs_review"
    : extraction.success && extraction.items.length > 0
    ? "ready"
    : "needs_review";

  const campaignTitle = `Content Calendar — ${client.name} (${params.monthKey}) (Rev ${nextRevision})`;

  // 9. Insert Campaign
  const { data: campaign, error: campErr } = await admin
    .from("campaigns")
    .insert({
      id: campaignId,
      workspace_id: params.workspaceId,
      client_id: params.clientId,
      title: campaignTitle,
      brief: extraction.rawText ? extraction.rawText.substring(0, 1000) : null,
      month_key: params.monthKey,
      revision_number: nextRevision,
      calendar_status: calendarStatus,
      original_file_name: params.fileName,
      storage_path: storagePath,
      file_hash: fileHash,
      uploaded_by_roster_id: params.uploaderRosterId,
      uploaded_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
      parser_version: "v1.0",
      processing_error: extraction.error || null,
      is_current_revision: true,
      status: "Draft",
    })
    .select()
    .single();

  if (campErr) {
    throw new Error(`فشل إنشاء سجل الكامبين: ${campErr.message}`);
  }

  // 10. Insert extracted items
  const insertedItems: any[] = [];
  if (extraction.items.length > 0) {
    const defaultAssignee = client.owner_roster_id;

    const itemsToInsert = extraction.items.map((item) => ({
      workspace_id: params.workspaceId,
      campaign_id: campaignId,
      client_id: params.clientId,
      post_order: item.post_order,
      post_number: item.post_number,
      title: item.title,
      caption: item.caption,
      brief: item.brief,
      platform: item.platform,
      content_format: item.content_format,
      publish_date: item.publish_date,
      design_due_date: item.design_due_date,
      notes: item.warning || item.notes,
      reference_urls: item.reference_urls,
      raw_text: item.raw_text,
      source_page: item.source_page,
      confidence: item.confidence,
      needs_manual_review: item.needs_manual_review,
      suggested_assignee_id: defaultAssignee,
      approved_assignee_id: defaultAssignee,
      is_included: true,
    }));

    const { data: dbItems, error: itemsErr } = await admin
      .from("content_calendar_items")
      .insert(itemsToInsert)
      .select();

    if (itemsErr) {
      console.error("Error inserting items:", itemsErr);
    } else {
      insertedItems.push(...(dbItems || []));
    }
  }

  // 11. Generate short-lived signed preview URL (15 minutes)
  const { data: signedData } = await admin.storage
    .from("content-calendars")
    .createSignedUrl(storagePath, 900);

  return {
    campaign,
    items: insertedItems,
    extraction,
    previewUrl: signedData?.signedUrl || null,
  };
}

export async function getContentCalendarDetails(params: {
  workspaceId: string;
  clientId: string;
  monthKey: string;
  userRosterId?: string;
  isOwner?: boolean;
}) {
  const admin = createAdminClient();
  if (!admin) throw new Error("تعذر الاتصال بقاعدة البيانات.");

  // If not owner, verify client is assigned to this designer
  if (!params.isOwner && params.userRosterId) {
    const { data: client } = await admin
      .from("clients")
      .select("owner_roster_id")
      .eq("id", params.clientId)
      .single();

    if (client?.owner_roster_id !== params.userRosterId) {
      throw new Error("غير مصرح لك باستعراض تقويم هذا العميل.");
    }
  }

  // Get current revision campaign
  const { data: campaign } = await admin
    .from("campaigns")
    .select(`
      *,
      client:clients(id, name, difficulty, owner_roster_id),
      uploaded_by:roster_people!fk_campaign_uploaded_by(id, display_name),
      approved_by:roster_people!fk_campaign_approved_by(id, display_name)
    `)
    .eq("workspace_id", params.workspaceId)
    .eq("client_id", params.clientId)
    .eq("month_key", params.monthKey)
    .eq("is_current_revision", true)
    .maybeSingle();

  if (!campaign) {
    return { campaign: null, items: [], previewUrl: null, revisions: [] };
  }

  // Generate signed preview URL if storage_path exists
  let previewUrl: string | null = null;
  if (campaign.storage_path) {
    const { data: signed } = await admin.storage
      .from("content-calendars")
      .createSignedUrl(campaign.storage_path, 900);
    previewUrl = signed?.signedUrl || null;
  }

  // Get items
  const { data: items } = await admin
    .from("content_calendar_items")
    .select(`
      *,
      suggested_assignee:roster_people!fk_cci_suggested_assignee(id, display_name),
      approved_assignee:roster_people!fk_cci_approved_assignee(id, display_name),
      task:tasks(id, status, primary_assignee_id, reviewer_id)
    `)
    .eq("campaign_id", campaign.id)
    .order("post_order", { ascending: true });

  // Get revision history for this client & month
  const { data: revisions } = await admin
    .from("campaigns")
    .select("id, revision_number, calendar_status, original_file_name, created_at, is_current_revision")
    .eq("workspace_id", params.workspaceId)
    .eq("client_id", params.clientId)
    .eq("month_key", params.monthKey)
    .order("revision_number", { ascending: false });

  return {
    campaign,
    items: items || [],
    previewUrl,
    revisions: revisions || [],
  };
}

export async function listClientCalendars(params: {
  workspaceId: string;
  monthKey: string;
  userRosterId?: string;
  isOwner?: boolean;
}) {
  const admin = createAdminClient();
  if (!admin) return [];

  // Query clients
  let clientsQuery = admin
    .from("clients")
    .select(`
      id,
      name,
      difficulty,
      owner_roster_id,
      state,
      owner:roster_people!fk_client_owner(id, display_name)
    `)
    .eq("workspace_id", params.workspaceId)
    .order("name", { ascending: true });

  // If not owner, filter to clients assigned to caller
  if (!params.isOwner && params.userRosterId) {
    clientsQuery = clientsQuery.eq("owner_roster_id", params.userRosterId);
  }

  const { data: clients, error } = await clientsQuery;
  if (error || !clients) return [];

  // Fetch current campaigns for this month
  const { data: campaigns } = await admin
    .from("campaigns")
    .select(`
      id,
      client_id,
      month_key,
      revision_number,
      calendar_status,
      status,
      original_file_name,
      storage_path,
      created_at,
      updated_at
    `)
    .eq("workspace_id", params.workspaceId)
    .eq("month_key", params.monthKey)
    .eq("is_current_revision", true);

  const campaignMap = new Map<string, any>();
  const campaignIds: string[] = [];
  (campaigns || []).forEach((c) => {
    campaignMap.set(c.client_id, c);
    campaignIds.push(c.id);
  });

  // Get item counts and task counts
  const itemCountsMap = new Map<string, { total: number; tasks: number }>();
  if (campaignIds.length > 0) {
    const { data: items } = await admin
      .from("content_calendar_items")
      .select("campaign_id, task_id")
      .in("campaign_id", campaignIds);

    (items || []).forEach((it) => {
      const current = itemCountsMap.get(it.campaign_id) || { total: 0, tasks: 0 };
      current.total += 1;
      if (it.task_id) current.tasks += 1;
      itemCountsMap.set(it.campaign_id, current);
    });
  }

  return clients.map((client) => {
    const campaign = campaignMap.get(client.id) || null;
    const counts = campaign ? itemCountsMap.get(campaign.id) || { total: 0, tasks: 0 } : { total: 0, tasks: 0 };

    return {
      client,
      campaign,
      postCount: counts.total,
      tasksCreatedCount: counts.tasks,
      calendarStatus: campaign ? campaign.calendar_status : "not_uploaded",
      lastUpdated: campaign ? campaign.updated_at : null,
    };
  });
}
