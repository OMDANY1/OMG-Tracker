import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { validatePdfBuffer } from "./pdf-extractor";
import { aiDocumentPipeline } from "./ai-document-pipeline";
import crypto from "crypto";

export async function uploadCalendarFileOnly(params: {
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

  const campaignTitle = `Content Calendar — ${client.name} (${params.monthKey}) (Rev ${nextRevision})`;

  // 8. Insert Campaign with status 'uploaded'
  const { data: campaign, error: campErr } = await admin
    .from("campaigns")
    .insert({
      id: campaignId,
      workspace_id: params.workspaceId,
      client_id: params.clientId,
      title: campaignTitle,
      brief: null,
      month_key: params.monthKey,
      revision_number: nextRevision,
      calendar_status: "uploaded",
      original_file_name: params.fileName,
      storage_path: storagePath,
      file_hash: fileHash,
      file_sha256: fileHash,
      uploaded_by_roster_id: params.uploaderRosterId,
      uploaded_at: new Date().toISOString(),
      is_current_revision: true,
      status: "Draft",
    })
    .select()
    .single();

  if (campErr) {
    throw new Error(`فشل إنشاء سجل الكامبين: ${campErr.message}`);
  }

  // 9. Generate short-lived signed preview URL (15 minutes)
  const { data: signedData } = await admin.storage
    .from("content-calendars")
    .createSignedUrl(storagePath, 900);

  return {
    campaign,
    storagePath,
    fileHash,
    previewUrl: signedData?.signedUrl || null,
  };
}

export async function processCalendarCampaign(params: {
  workspaceId: string;
  campaignId: string;
  forceRefresh?: boolean;
}) {
  const admin = createAdminClient();
  if (!admin) throw new Error("تعذر الاتصال بقاعدة البيانات.");

  // 1. Fetch campaign
  const { data: campaign, error: campErr } = await admin
    .from("campaigns")
    .select("*, client:clients(id, name, owner_roster_id)")
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.campaignId)
    .single();

  if (campErr || !campaign) {
    throw new Error("سجل التقويم غير موجود في مساحة العمل.");
  }

  // 2. Update status to 'processing'
  await admin
    .from("campaigns")
    .update({
      calendar_status: "processing",
      processing_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaign.id);

  try {
    // 3. Download PDF buffer from storage
    if (!campaign.storage_path) {
      throw new Error("مسار تخزين الملف مفقود من سجل الكامبين.");
    }

    const { data: fileBlob, error: downloadErr } = await admin.storage
      .from("content-calendars")
      .download(campaign.storage_path);

    if (downloadErr || !fileBlob) {
      throw new Error(`تعذر تحميل الملف من التخزين: ${downloadErr?.message}`);
    }

    const buffer = Buffer.from(await fileBlob.arrayBuffer());

    // 4. Run AI Document Pipeline
    const reconciled = await aiDocumentPipeline.processCalendar(buffer, {
      workspaceId: params.workspaceId,
      clientId: campaign.client_id,
      monthKey: campaign.month_key,
      fileName: campaign.original_file_name || "calendar.pdf",
      forceRefresh: params.forceRefresh,
    });

    // 5. Default assignee is client's assigned designer
    const defaultAssignee = campaign.client?.owner_roster_id || null;
    const itemsToSave = reconciled.items.map((it) => ({
      ...it,
      suggested_assignee_id: it.suggested_assignee_id || defaultAssignee,
      approved_assignee_id: it.approved_assignee_id || defaultAssignee,
    }));

    // 6. Save extraction atomically via RPC
    const aiMetadata = {
      provider: reconciled.provider,
      model: reconciled.model_used,
      prompt_version: reconciled.prompt_version,
      schema_version: reconciled.schema_version,
      confidence: reconciled.overall_confidence,
      declared_post_count: reconciled.declared_post_count,
      detected_post_count: reconciled.detected_post_count,
      token_usage: reconciled.token_usage,
      warnings: reconciled.warnings,
    };

    const { data: saveRes, error: saveErr } = await admin.rpc("save_ai_calendar_extraction", {
      p_workspace_id: params.workspaceId,
      p_campaign_id: campaign.id,
      p_file_sha256: reconciled.file_sha256,
      p_ai_metadata: aiMetadata,
      p_inventory: reconciled.inventory || {},
      p_items: itemsToSave,
    });

    if (saveErr) {
      console.error("RPC save_ai_calendar_extraction error:", saveErr);
      throw new Error(`فشل حفظ استخراج الذكاء الاصطناعي: ${saveErr.message}`);
    }

    // 7. Re-fetch updated campaign and items
    const { data: updatedCampaign } = await admin
      .from("campaigns")
      .select("*")
      .eq("id", campaign.id)
      .single();

    const { data: updatedItems } = await admin
      .from("content_calendar_items")
      .select(`
        *,
        suggested_assignee:roster_people!fk_cci_suggested_assignee(id, display_name),
        approved_assignee:roster_people!fk_cci_approved_assignee(id, display_name)
      `)
      .eq("campaign_id", campaign.id)
      .order("post_order", { ascending: true });

    return {
      campaign: updatedCampaign,
      items: updatedItems || [],
      reconciled,
    };
  } catch (err: any) {
    // Record error on campaign
    await admin
      .from("campaigns")
      .update({
        calendar_status: "failed",
        processing_error: err.message || String(err),
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaign.id);

    throw err;
  }
}

export async function uploadContentCalendar(params: {
  workspaceId: string;
  clientId: string;
  monthKey: string; // 'YYYY-MM'
  fileName: string;
  fileBuffer: Buffer;
  uploaderRosterId: string;
}) {
  // 1. Upload file and create campaign
  const uploadResult = await uploadCalendarFileOnly(params);

  // 2. Process calendar via AI pipeline
  const processResult = await processCalendarCampaign({
    workspaceId: params.workspaceId,
    campaignId: uploadResult.campaign.id,
  });

  return {
    campaign: processResult.campaign,
    items: processResult.items,
    extraction: processResult.reconciled,
    previewUrl: uploadResult.previewUrl,
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
    .select("id, revision_number, calendar_status, original_file_name, created_at, is_current_revision, ai_overall_confidence, detected_post_count")
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
      ai_overall_confidence,
      detected_post_count,
      declared_post_count,
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
      .select("campaign_id, task_id, is_excluded_from_tasks")
      .in("campaign_id", campaignIds);

    (items || []).forEach((it) => {
      const current = itemCountsMap.get(it.campaign_id) || { total: 0, tasks: 0 };
      if (!it.is_excluded_from_tasks) {
        current.total += 1;
      }
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
      aiConfidence: campaign?.ai_overall_confidence || null,
      detectedPostCount: campaign?.detected_post_count || counts.total,
    };
  });
}
