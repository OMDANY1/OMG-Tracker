import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Client, ClientDifficulty, ClientExtraWorkload, ClientState } from "@/types/database";

async function getClient(providedClient?: SupabaseClient | null) {
  if (providedClient) return providedClient;
  const serverClient = await createServerSupabaseClient().catch(() => null);
  return serverClient || createAdminClient();
}

export async function getClients(workspaceId: string): Promise<Client[]> {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data: clients, error } = await supabase
    .from("clients")
    .select(`
      *,
      owner:roster_people!fk_client_owner(id, display_name, job_title),
      campaigns(id, title, status),
      tasks(id, status, primary_assignee_id, work_stage),
      team_assignment:client_team_assignments(*),
      brief_data:client_briefs(*)
    `)
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });

  if (error) {
    console.error("Error fetching clients:", error.message);
    throw new Error(`فشل تحميل قائمة العملاء: ${error.message}`);
  }

  return (clients as any[]) || [];
}

export function normalizeAndValidateOptionalUrl(
  rawUrl: unknown,
  fieldLabel = "الرابط"
): string | null {
  if (rawUrl === null || rawUrl === undefined) return null;
  if (typeof rawUrl !== "string") {
    throw new Error(`${fieldLabel} غير صالح.`);
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Invalid protocol");
    }
    if (!parsed.hostname || !parsed.hostname.includes(".")) {
      throw new Error("Invalid hostname");
    }
    return trimmed;
  } catch {
    throw new Error(
      `${fieldLabel} غير صالح. يرجى إدخال رابط كامل يبدأ بـ https:// أو http:// أو ترك الحقل فارغاً.`
    );
  }
}

export function sanitizeClientDbError(
  err: any,
  fallbackArabicMsg = "تعذر حفظ بيانات العميل حالياً بسبب خطأ تقني في الخادم. لم يتم فقدان البيانات المدخلة؛ يرجى إعادة المحاولة."
): string {
  const rawMessage = typeof err === "string" ? err : err?.message || "";
  const code = err?.code || "";

  // Log technical details server-side without secrets
  console.error("[clients-service] Database/RPC error:", {
    code: code || undefined,
    message: rawMessage,
    details: err?.details || undefined,
    hint: err?.hint || undefined,
  });

  if (!rawMessage) return fallbackArabicMsg;

  // Never expose function names, schema cache errors, parameter lists, or SQL constraint identifiers
  const isTechnicalLeak =
    code === "PGRST202" ||
    code === "42883" ||
    /schema cache/i.test(rawMessage) ||
    /Could not find the function/i.test(rawMessage) ||
    /public\.[a-z0-9_]+/i.test(rawMessage) ||
    /private\.[a-z0-9_]+/i.test(rawMessage) ||
    /\bp_[a-z0-9_]+\b/i.test(rawMessage) ||
    /foreign key constraint/i.test(rawMessage) ||
    /violates check constraint/i.test(rawMessage);

  if (isTechnicalLeak) {
    return fallbackArabicMsg;
  }

  // If the message is already in Arabic (from our domain validations), preserve it cleanly
  if (/[\u0600-\u06FF]/.test(rawMessage)) {
    return rawMessage.replace(/^Error:\s*/i, "").trim();
  }

  // Map common English domain messages to clear Arabic
  if (/already exists|duplicate key|uq_client_name_workspace/i.test(rawMessage)) {
    return "اسم العميل مسجل بالفعل في مساحة العمل.";
  }
  if (/Permission denied|Access denied/i.test(rawMessage)) {
    return "غير مصرح لك بتنفيذ هذا الإجراء.";
  }
  if (/Client name cannot be empty/i.test(rawMessage)) {
    return "اسم العميل مطلوب ولا يمكن أن يكون فارغاً.";
  }
  if (/Client not found/i.test(rawMessage)) {
    return "العميل غير موجود في مساحة العمل الحالية.";
  }
  if (/Idempotency key reuse/i.test(rawMessage)) {
    return "تم إرسال طلب مطابق قيد المعالجة؛ يرجى المحاولة مرة أخرى.";
  }

  return fallbackArabicMsg;
}

export async function createClient(params: {
  workspaceId: string;
  name: string;
  ownerRosterId?: string | null;
  difficulty?: ClientDifficulty;
  extraWorkload?: ClientExtraWorkload;
  state?: ClientState;
  notes?: string | null;
  brandGuideUrl?: string | null;
  briefUrl?: string | null;
  idempotencyKey?: string;
  supabaseClient?: SupabaseClient;
}) {
  const supabase = await getClient(params.supabaseClient);
  if (!supabase) throw new Error("تعذر الاتصال بقاعدة البيانات.");

  const cleanBrandGuideUrl = normalizeAndValidateOptionalUrl(
    params.brandGuideUrl,
    "رابط دليل الهوية"
  );
  const cleanBriefUrl = normalizeAndValidateOptionalUrl(
    params.briefUrl,
    "رابط الـ Brief الخارجي"
  );

  const { data, error } = await supabase.rpc("create_client", {
    p_workspace_id: params.workspaceId,
    p_name: params.name.trim(),
    p_owner_roster_id: params.ownerRosterId || null,
    p_difficulty: params.difficulty || "Medium",
    p_extra_workload: params.extraWorkload || "None",
    p_state: params.state || "Active",
    p_notes: params.notes?.trim() || null,
    p_brand_guide_url: cleanBrandGuideUrl,
    p_brief_url: cleanBriefUrl,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) {
    throw new Error(sanitizeClientDbError(error, "فشل إنشاء العميل. يرجى إعادة المحاولة."));
  }
  return data;
}

export interface CreateClientAtomicParams {
  workspaceId: string;
  name: string;
  ownerRosterId?: string | null;
  difficulty?: ClientDifficulty;
  extraWorkload?: ClientExtraWorkload;
  state?: ClientState;
  notes?: string | null;
  brandGuideUrl?: string | null;
  briefUrl?: string | null;
  enableDesign?: boolean;
  enableCopywriting?: boolean;
  enableStrategy?: boolean;
  requiresVideo?: boolean;
  primaryStrategistId?: string | null;
  primaryCopywriterId?: string | null;
  primaryDesignerId?: string | null;
  primaryVideoEditorId?: string | null;
  strategyReviewerId?: string | null;
  copywritingReviewerId?: string | null;
  designReviewerId?: string | null;
  videoReviewerId?: string | null;
  marketingDirectorId?: string | null;
  strategyLeadId?: string | null;
  objectives?: string | null;
  targetAudience?: string | null;
  productsServices?: string | null;
  toneOfVoice?: string | null;
  contentPillars?: string[];
  dosAndDonts?: string | null;
  brandGuidelinesUrl?: string | null;
  assetsDriveUrl?: string | null;
  strategySummary?: string | null;
  idempotencyKey?: string | null;
  supabaseClient?: SupabaseClient;
}

export async function createClientAtomic(params: CreateClientAtomicParams) {
  const supabase = await getClient(params.supabaseClient);
  if (!supabase) throw new Error("تعذر الاتصال بقاعدة البيانات.");

  const cleanName = (params.name || "").trim();
  if (!cleanName) {
    throw new Error("اسم العميل مطلوب ولا يمكن أن يكون فارغاً.");
  }

  // Normalize & validate optional URLs (empty string -> null; invalid non-empty -> Arabic error)
  const rawBrandUrl =
    params.brandGuideUrl !== undefined && params.brandGuideUrl !== null && String(params.brandGuideUrl).trim() !== ""
      ? params.brandGuideUrl
      : params.brandGuidelinesUrl;

  const cleanBrandUrl = normalizeAndValidateOptionalUrl(rawBrandUrl, "رابط دليل الهوية");
  const cleanAssetsUrl = normalizeAndValidateOptionalUrl(params.assetsDriveUrl, "رابط مجلد الأصول");
  const cleanBriefUrl = normalizeAndValidateOptionalUrl(params.briefUrl, "رابط الـ Brief الخارجي");

  const primaryDesignerId = params.primaryDesignerId?.trim() || params.ownerRosterId?.trim() || null;
  const primaryCopywriterId = params.primaryCopywriterId?.trim() || null;
  const primaryStrategistId = params.primaryStrategistId?.trim() || null;
  const primaryVideoEditorId = params.primaryVideoEditorId?.trim() || null;

  const teamAssignmentsPayload = {
    enableDesign: params.enableDesign !== undefined ? Boolean(params.enableDesign) : Boolean(primaryDesignerId),
    enableCopywriting:
      params.enableCopywriting !== undefined ? Boolean(params.enableCopywriting) : Boolean(primaryCopywriterId),
    enableStrategy:
      params.enableStrategy !== undefined ? Boolean(params.enableStrategy) : Boolean(primaryStrategistId),
    requiresVideo: Boolean(params.requiresVideo),
    primaryStrategistId,
    primaryCopywriterId,
    primaryDesignerId,
    primaryVideoEditorId,
    strategyReviewerId: params.strategyReviewerId?.trim() || null,
    copywritingReviewerId: params.copywritingReviewerId?.trim() || null,
    designReviewerId: params.designReviewerId?.trim() || null,
    videoReviewerId: params.videoReviewerId?.trim() || null,
    marketingDirectorId: params.marketingDirectorId?.trim() || null,
    strategyLeadId: params.strategyLeadId?.trim() || null,
  };

  const briefPayload = {
    objectives: params.objectives?.trim() || null,
    targetAudience: params.targetAudience?.trim() || null,
    productsServices: params.productsServices?.trim() || null,
    toneOfVoice: params.toneOfVoice?.trim() || null,
    contentPillars: Array.isArray(params.contentPillars) ? params.contentPillars : [],
    dosAndDonts: params.dosAndDonts?.trim() || null,
    brandGuidelinesUrl: cleanBrandUrl,
    assetsDriveUrl: cleanAssetsUrl,
    strategySummary: params.strategySummary?.trim() || null,
  };

  // Matches the exact 12-parameter signature of public.create_client_atomic in PostgreSQL
  const { data, error } = await supabase.rpc("create_client_atomic", {
    p_workspace_id: params.workspaceId,
    p_name: cleanName,
    p_owner_roster_id: primaryDesignerId,
    p_difficulty: params.difficulty || "Medium",
    p_extra_workload: params.extraWorkload || "None",
    p_state: params.state || "Active",
    p_notes: params.notes?.trim() || null,
    p_brand_guide_url: cleanBrandUrl,
    p_brief_url: cleanBriefUrl,
    p_team_assignments: teamAssignmentsPayload,
    p_brief: briefPayload,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) {
    throw new Error(sanitizeClientDbError(error, "تعذر إنشاء حساب العميل حالياً. يرجى التحقق من البيانات وإعادة المحاولة."));
  }
  return data;
}

export async function updateClient(params: {
  clientId: string;
  workspaceId?: string;
  name?: string;
  ownerRosterId?: string | null;
  difficulty?: ClientDifficulty;
  extraWorkload?: ClientExtraWorkload;
  state?: ClientState;
  notes?: string | null;
  brandGuideUrl?: string | null;
  briefUrl?: string | null;
  reassignOpenTasksToNewOwner?: boolean;
  actorId?: string;
  idempotencyKey?: string;
  supabaseClient?: SupabaseClient;
}) {
  const supabase = await getClient(params.supabaseClient);
  if (!supabase) throw new Error("تعذر الاتصال بقاعدة البيانات.");

  let workspaceId = params.workspaceId;
  if (!workspaceId) {
    const { data: c } = await supabase
      .from("clients")
      .select("workspace_id")
      .eq("id", params.clientId)
      .maybeSingle();
    workspaceId = c?.workspace_id;
  }

  if (!workspaceId) {
    const { data: ws } = await supabase.from("workspaces").select("id").limit(1).maybeSingle();
    workspaceId = ws?.id;
  }

  if (!workspaceId) {
    throw new Error("تعذر تحديد مساحة العمل لتحديث العميل.");
  }

  const normalizedBrandGuideUrl =
    params.brandGuideUrl !== undefined
      ? normalizeAndValidateOptionalUrl(params.brandGuideUrl, "رابط دليل الهوية") ?? ""
      : null;

  const normalizedBriefUrl =
    params.briefUrl !== undefined
      ? normalizeAndValidateOptionalUrl(params.briefUrl, "رابط الـ Brief الخارجي") ?? ""
      : null;

  const { data, error } = await supabase.rpc("update_client", {
    p_workspace_id: workspaceId,
    p_client_id: params.clientId,
    p_name: params.name !== undefined ? params.name : null,
    p_owner_roster_id: params.ownerRosterId !== undefined ? params.ownerRosterId : null,
    p_difficulty: params.difficulty !== undefined ? params.difficulty : null,
    p_extra_workload: params.extraWorkload !== undefined ? params.extraWorkload : null,
    p_state: params.state !== undefined ? params.state : null,
    p_notes: params.notes !== undefined ? params.notes : null,
    p_brand_guide_url: normalizedBrandGuideUrl,
    p_brief_url: normalizedBriefUrl,
    p_reassign_open_tasks: !!params.reassignOpenTasksToNewOwner,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) {
    throw new Error(sanitizeClientDbError(error, "فشل تحديث بيانات العميل. يرجى إعادة المحاولة."));
  }
  return data;
}

export async function updateClientAssignment(params: {
  clientId: string;
  workspaceId?: string;
  newOwnerRosterId?: string | null;
  reassignOpenTasks?: boolean;
  idempotencyKey?: string;
  supabaseClient?: SupabaseClient;
}) {
  const supabase = await getClient(params.supabaseClient);
  if (!supabase) throw new Error("تعذر الاتصال بقاعدة البيانات.");

  let workspaceId = params.workspaceId;
  if (!workspaceId) {
    const { data: c } = await supabase
      .from("clients")
      .select("workspace_id")
      .eq("id", params.clientId)
      .maybeSingle();
    workspaceId = c?.workspace_id;
  }

  if (!workspaceId) {
    const { data: ws } = await supabase.from("workspaces").select("id").limit(1).maybeSingle();
    workspaceId = ws?.id;
  }

  if (!workspaceId) {
    throw new Error("تعذر تحديد مساحة العمل لتحديث إسناد العميل.");
  }

  const { data, error } = await supabase.rpc("update_client_assignment", {
    p_workspace_id: workspaceId,
    p_client_id: params.clientId,
    p_new_owner_roster_id: params.newOwnerRosterId || null,
    p_reassign_open_tasks: !!params.reassignOpenTasks,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) {
    throw new Error(sanitizeClientDbError(error, "فشل تحديث مسؤول العميل."));
  }
  return data;
}

export async function archiveClient(params: {
  workspaceId: string;
  clientId: string;
  idempotencyKey?: string;
  supabaseClient?: SupabaseClient;
}) {
  const supabase = await getClient(params.supabaseClient);
  if (!supabase) throw new Error("تعذر الاتصال بقاعدة البيانات.");

  const { data, error } = await supabase.rpc("archive_client", {
    p_workspace_id: params.workspaceId,
    p_client_id: params.clientId,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) {
    throw new Error(sanitizeClientDbError(error, "فشل أرشفة العميل."));
  }
  return data;
}

export async function upsertClientTeamAssignment(params: {
  workspaceId?: string;
  clientId: string;
  primaryStrategistId?: string | null;
  primaryCopywriterId?: string | null;
  primaryDesignerId?: string | null;
  primaryVideoEditorId?: string | null;
  strategyReviewerId?: string | null;
  copywritingReviewerId?: string | null;
  designReviewerId?: string | null;
  videoReviewerId?: string | null;
  marketingDirectorId?: string | null;
  strategyLeadId?: string | null;
  requiresVideo?: boolean | null;
  idempotencyKey?: string;
  supabaseClient?: SupabaseClient;
}) {
  const supabase = await getClient(params.supabaseClient);
  if (!supabase) throw new Error("تعذر الاتصال بقاعدة البيانات.");

  let workspaceId = params.workspaceId;
  if (!workspaceId || workspaceId === "00000000-0000-0000-0000-000000000000") {
    const { data: c } = await supabase
      .from("clients")
      .select("workspace_id")
      .eq("id", params.clientId)
      .maybeSingle();
    workspaceId = c?.workspace_id;
  }

  if (!workspaceId) {
    const { data: ws } = await supabase.from("workspaces").select("id").limit(1).maybeSingle();
    workspaceId = ws?.id;
  }

  if (!workspaceId) {
    throw new Error("تعذر تحديد مساحة العمل لتحديث فريق العميل.");
  }

  const { data, error } = await supabase.rpc("upsert_client_team_assignment", {
    p_workspace_id: workspaceId,
    p_client_id: params.clientId,
    p_primary_strategist_id: params.primaryStrategistId || null,
    p_primary_copywriter_id: params.primaryCopywriterId || null,
    p_primary_designer_id: params.primaryDesignerId || null,
    p_primary_video_editor_id: params.primaryVideoEditorId || null,
    p_strategy_reviewer_id: params.strategyReviewerId || null,
    p_copywriting_reviewer_id: params.copywritingReviewerId || null,
    p_design_reviewer_id: params.designReviewerId || null,
    p_video_reviewer_id: params.videoReviewerId || null,
    p_marketing_director_id: params.marketingDirectorId || null,
    p_strategy_lead_id: params.strategyLeadId || null,
    p_idempotency_key: params.idempotencyKey || null,
    p_requires_video: params.requiresVideo !== undefined ? params.requiresVideo : null,
  });

  if (error) {
    throw new Error(sanitizeClientDbError(error, "فشل تحديث فريق العمل."));
  }
  return data;
}

export async function upsertClientBrief(params: {
  workspaceId?: string;
  clientId: string;
  objectives?: string | null;
  targetAudience?: string | null;
  productsServices?: string | null;
  toneOfVoice?: string | null;
  contentPillars?: string[];
  dosAndDonts?: string | null;
  brandGuidelinesUrl?: string | null;
  assetsDriveUrl?: string | null;
  briefUrl?: string | null;
  strategySummary?: string | null;
  idempotencyKey?: string;
  supabaseClient?: SupabaseClient;
}) {
  const supabase = await getClient(params.supabaseClient);
  if (!supabase) throw new Error("تعذر الاتصال بقاعدة البيانات.");

  let workspaceId = params.workspaceId;
  if (!workspaceId || workspaceId === "00000000-0000-0000-0000-000000000000") {
    const { data: c } = await supabase
      .from("clients")
      .select("workspace_id")
      .eq("id", params.clientId)
      .maybeSingle();
    workspaceId = c?.workspace_id;
  }

  if (!workspaceId) {
    const { data: ws } = await supabase.from("workspaces").select("id").limit(1).maybeSingle();
    workspaceId = ws?.id;
  }

  if (!workspaceId) {
    throw new Error("تعذر تحديد مساحة العمل لتحديث Brief العميل.");
  }

  const normalizedBrandUrl =
    params.brandGuidelinesUrl !== undefined
      ? normalizeAndValidateOptionalUrl(params.brandGuidelinesUrl, "رابط دليل الهوية") ?? ""
      : null;

  const normalizedAssetsUrl =
    params.assetsDriveUrl !== undefined
      ? normalizeAndValidateOptionalUrl(params.assetsDriveUrl, "رابط مجلد الأصول") ?? ""
      : null;

  if (params.briefUrl !== undefined) {
    const normalizedBriefUrl =
      normalizeAndValidateOptionalUrl(params.briefUrl, "رابط الـ Brief الخارجي") ?? "";
    const { error: updErr } = await supabase.rpc("update_client", {
      p_workspace_id: workspaceId,
      p_client_id: params.clientId,
      p_name: null,
      p_owner_roster_id: null,
      p_difficulty: null,
      p_extra_workload: null,
      p_state: null,
      p_notes: null,
      p_brand_guide_url: normalizedBrandUrl,
      p_brief_url: normalizedBriefUrl,
      p_reassign_open_tasks: false,
      p_idempotency_key: null,
    });
    if (updErr) {
      throw new Error(sanitizeClientDbError(updErr, "فشل تحديث روابط العميل."));
    }
  }

  const { data, error } = await supabase.rpc("upsert_client_brief", {
    p_workspace_id: workspaceId,
    p_client_id: params.clientId,
    p_objectives: params.objectives || null,
    p_target_audience: params.targetAudience || null,
    p_products_services: params.productsServices || null,
    p_tone_of_voice: params.toneOfVoice || null,
    p_content_pillars: params.contentPillars || [],
    p_dos_and_donts: params.dosAndDonts || null,
    p_brand_guidelines_url: normalizedBrandUrl,
    p_assets_drive_url: normalizedAssetsUrl,
    p_strategy_summary: params.strategySummary || null,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) {
    throw new Error(sanitizeClientDbError(error, "فشل تحديث Brief العميل."));
  }
  return data;
}

export async function reviewClientBriefOperational(params: {
  workspaceId?: string;
  clientId: string;
  decision?: "approved" | "changes_requested";
  feedback?: string | null;
  idempotencyKey?: string;
  supabaseClient?: SupabaseClient;
}) {
  const supabase = await getClient(params.supabaseClient);
  if (!supabase) throw new Error("تعذر الاتصال بقاعدة البيانات.");

  let workspaceId = params.workspaceId;
  if (!workspaceId || workspaceId === "00000000-0000-0000-0000-000000000000") {
    const { data: c } = await supabase
      .from("clients")
      .select("workspace_id")
      .eq("id", params.clientId)
      .maybeSingle();
    workspaceId = c?.workspace_id;
  }

  if (!workspaceId) {
    const { data: ws } = await supabase.from("workspaces").select("id").limit(1).maybeSingle();
    workspaceId = ws?.id;
  }

  if (!workspaceId) {
    throw new Error("تعذر تحديد مساحة العمل لمراجعة الاستراتيجية.");
  }

  const { data, error } = await supabase.rpc("review_client_brief_operational", {
    p_workspace_id: workspaceId,
    p_client_id: params.clientId,
    p_decision: params.decision || "approved",
    p_feedback: params.feedback || null,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) {
    throw new Error(sanitizeClientDbError(error, "فشل المراجعة التشغيلية للاستراتيجية."));
  }
  return data;
}

export async function approveClientBriefStrategy(params: {
  workspaceId?: string;
  clientId: string;
  approvedContent: string;
  idempotencyKey?: string;
  supabaseClient?: SupabaseClient;
}) {
  const supabase = await getClient(params.supabaseClient);
  if (!supabase) throw new Error("تعذر الاتصال بقاعدة البيانات.");

  let workspaceId = params.workspaceId;
  if (!workspaceId || workspaceId === "00000000-0000-0000-0000-000000000000") {
    const { data: c } = await supabase
      .from("clients")
      .select("workspace_id")
      .eq("id", params.clientId)
      .maybeSingle();
    workspaceId = c?.workspace_id;
  }

  if (!workspaceId) {
    const { data: ws } = await supabase.from("workspaces").select("id").limit(1).maybeSingle();
    workspaceId = ws?.id;
  }

  if (!workspaceId) {
    throw new Error("تعذر تحديد مساحة العمل لاعتماد الاستراتيجية.");
  }

  const { data, error } = await supabase.rpc("approve_client_brief_strategy", {
    p_workspace_id: workspaceId,
    p_client_id: params.clientId,
    p_approved_content: params.approvedContent,
    p_idempotency_key: params.idempotencyKey || null,
  });

  if (error) {
    throw new Error(sanitizeClientDbError(error, "فشل الاعتماد النهائي للاستراتيجية."));
  }
  return data;
}


