import crypto from "crypto";
import {
  getGeminiClient,
  getGeminiModel,
  isGeminiConfigured,
  classifyGeminiError,
  callGeminiWithRetry,
} from "@/lib/ai/gemini-client";
import {
  DocumentInventory,
  DocumentInventorySchema,
  DetailedPostItem,
  BatchedExtractionSchema,
  ReconciledItem,
  ReconciledCalendar,
  ReconciledCalendarSchema,
} from "@/lib/ai/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractPostsFromPdf } from "./pdf-extractor";

export interface PipelineOptions {
  workspaceId: string;
  clientId: string;
  monthKey: string;
  fileName: string;
  forceRefresh?: boolean;
}

const PARSER_VERSION = "v2.0-adaptive";
const SCHEMA_VERSION = "2026-09-08";

export class AiDocumentPipeline {
  /**
   * Main entry point for the adaptive multi-pass content calendar extraction.
   */
  async processCalendar(
    pdfBuffer: Buffer,
    options: PipelineOptions
  ): Promise<ReconciledCalendar> {
    const fileSha256 = crypto.createHash("sha256").update(pdfBuffer).digest("hex");
    const admin = createAdminClient();

    // 1. Check AI Extraction Cache (Owner / Server-side)
    if (!options.forceRefresh && admin) {
      const cached = await this.getCachedExtraction(admin, options.workspaceId, fileSha256);
      if (cached) {
        return {
          ...cached,
          is_cached: true,
        };
      }
    }

    // 2. Pre-inspection: Check page count & text availability
    const preInspection = await this.preInspectPdf(pdfBuffer);

    // 3. Strict Check: If Gemini is not configured, throw GEMINI_NOT_CONFIGURED (never fake success)
    if (!isGeminiConfigured()) {
      const err: any = new Error("تحليل Gemini غير مهيأ — لم يتم تحليل الملف");
      err.code = "GEMINI_NOT_CONFIGURED";
      err.status = 503;
      throw err;
    }

    const gemini = getGeminiClient();
    const model = getGeminiModel();

    if (!gemini) {
      const err: any = new Error("تحليل Gemini غير مهيأ — لم يتم تحليل الملف");
      err.code = "GEMINI_NOT_CONFIGURED";
      err.status = 503;
      throw err;
    }

    try {
      // 4. Pass A: Document Inventory
      const passARes = await this.runPassAInventory(gemini, model, pdfBuffer, preInspection);

      // 5. Pass B: Detailed Extraction (Adaptive Batched or Single Pass)
      const passBRes = await this.runPassBExtraction(
        gemini,
        passARes.usedModel || model,
        pdfBuffer,
        passARes.inventory,
        options.monthKey
      );

      const totalTokens = {
        prompt_tokens: passARes.tokenUsage.prompt_tokens + passBRes.tokenUsage.prompt_tokens,
        completion_tokens: passARes.tokenUsage.completion_tokens + passBRes.tokenUsage.completion_tokens,
        total_tokens: passARes.tokenUsage.total_tokens + passBRes.tokenUsage.total_tokens,
      };

      const resolvedModel = passBRes.usedModel || passARes.usedModel || model;

      // 6. Pass C: Reconciliation & Post-processing
      const reconciled = this.runPassCReconciliation({
        inventory: passARes.inventory,
        items: passBRes.items,
        tokenUsage: totalTokens,
        fileSha256,
        model: resolvedModel,
        options,
      });

      // 7. Store in Cache (only if operational items extracted or confirmed by model)
      if (admin && reconciled.items.length > 0) {
        await this.cacheExtraction(admin, options.workspaceId, fileSha256, reconciled);
      }

      return reconciled;
    } catch (err: any) {
      console.error("[AiDocumentPipeline] Gemini pipeline failed:", err);
      if (err.code === "GEMINI_NOT_CONFIGURED") {
        throw err;
      }
      const classification = classifyGeminiError(err.message || String(err), err.status);
      const customErr: any = new Error(classification.safeMessageAr);
      customErr.code = classification.category;
      customErr.status = err.status || 502;
      customErr.originalError = err.message || String(err);
      throw customErr;
    }
  }

  /**
   * Helper to execute Gemini requests with transient retry and automatic candidate model fallback.
   * Tries preferredModel first, and if 503 (high demand) or 404 (not found) occurs,
   * falls back safely to 'gemini-2.0-flash' and 'gemini-1.5-flash'.
   */
  private async safeGenerateContent(
    gemini: any,
    preferredModel: string,
    contents: any[],
    config?: any
  ): Promise<{ response: any; usedModel: string }> {
    const candidateModels = [
      preferredModel,
      "gemini-3.6-flash",
      "gemini-flash-latest",
      "models/gemini-flash-latest",
    ].filter((m, idx, arr) => m && arr.indexOf(m) === idx);

    let lastError: any = null;

    for (const modelToTry of candidateModels) {
      try {
        const response = await callGeminiWithRetry(
          () =>
            gemini.models.generateContent({
              model: modelToTry,
              contents,
              config,
            }),
          { maxRetries: modelToTry === preferredModel ? 1 : 2 }
        );
        return { response, usedModel: modelToTry };
      } catch (err: any) {
        lastError = err;
        const msg = (err?.message || "").toLowerCase();
        const isUnavailableOrNotFound =
          err?.status === 404 ||
          err?.status === 503 ||
          err?.status === 429 ||
          msg.includes("503") ||
          msg.includes("404") ||
          msg.includes("429") ||
          msg.includes("quota") ||
          msg.includes("rate limit") ||
          msg.includes("resource_exhausted") ||
          msg.includes("high demand") ||
          msg.includes("unavailable") ||
          msg.includes("not found") ||
          msg.includes("not supported");

        if (isUnavailableOrNotFound && modelToTry !== candidateModels[candidateModels.length - 1]) {
          console.warn(
            `[AiDocumentPipeline] Model ${modelToTry} returned ${err?.status || "error"} (${msg}). Falling back to next candidate model...`
          );
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  /**
   * Pre-inspect PDF using pdfjs-dist legacy build dynamically.
   */
  private async preInspectPdf(buffer: Buffer): Promise<{
    pageCount: number;
    hasText: boolean;
    sampleText: string;
  }> {
    try {
      // Dynamically load pdfjs-dist legacy build
      // @ts-ignore
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(buffer),
        disableFontFace: true,
        useSystemFonts: true,
      });
      const doc = await loadingTask.promise;
      const pageCount = doc.numPages;

      let extractedText = "";
      for (let i = 1; i <= Math.min(pageCount, 5); i++) {
        const page = await doc.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((it: any) => it.str).join(" ");
        extractedText += pageText + " ";
      }

      return {
        pageCount,
        hasText: extractedText.trim().length > 50,
        sampleText: extractedText.trim().substring(0, 500),
      };
    } catch (e) {
      // Fallback estimate based on byte patterns
      const str = buffer.toString("binary");
      const matches = str.match(/\/Type\s*\/Page\b/g);
      const estimatedPages = matches ? matches.length : 1;
      return {
        pageCount: Math.max(1, estimatedPages),
        hasText: true,
        sampleText: "",
      };
    }
  }

  /**
   * Pass A: Document Inventory
   * Gemini visually and structurally maps the document into sections, non-operational pages, and posts.
   */
  private async runPassAInventory(
    gemini: any,
    model: string,
    pdfBuffer: Buffer,
    preInspection: { pageCount: number }
  ): Promise<{ inventory: DocumentInventory; tokenUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; usedModel: string }> {
    const base64Pdf = pdfBuffer.toString("base64");

    const prompt = `
أنت خبير محترف في تحليل وثائق تقويم المحتوى (Content Calendars) لشركات التسويق والإعلانات (الايجنسي).
قم بفحص هذا الملف بالكامل وأنشئ خريطة هيكلية تفصيلية (Document Inventory) بصيغة JSON فقط.

قواعد صارمة:
1. صنف كل صفحة من صفحات الملف (Page 1 to ${preInspection.pageCount}):
   - 'cover': صفحة غلاف، شعار العميل، اسم الشهر (غير تشغيلية، ليست بوست).
   - 'strategy': استراتيجية المحتوى، الأهداف، النبرة، الجمهور المستهدف (غير تشغيلية، ليست بوست).
   - 'content_pillar': محاور وركائز المحتوى (غير تشغيلية، ليست بوست).
   - 'calendar_overview': جدول شهري مجمع أو شبكة مواعيد تلخص البوستات (لا تنشئ منها بوستات مكررة).
   - 'post_detail': صفحة تفصيلية لبوست أو أكثر.
   - 'references': مراجع أو شكر أو خاتمة 'thank_you' (غير تشغيلية).
2. حدد البوستات التشغيلية الحقيقية (Content Blocks):
   - أعطِ كل بوست فريد معرف canonicalPostId دائم (مثل "post_1", "post_2").
   - حدد أرقام الصفحات التي ينتمي لها البوست في source_pages.
   - إذا كان بوست واحد يمتد عبر عدة صفحات (مثل كابشن في صفحة وسلايدز في صفحة تالية)، ادمجهما تحت نفس canonicalPostId وضع is_multi_page = true.
   - إذا كانت صفحة واحدة تحتوي أكثر من بوست، استخرج كل بوست بـ canonicalPostId مستقل وضع is_multi_post_page = true.
   - إذا كانت هناك شبكة تقويم مجمعة (overview) تشير لصفحة تفاصيل، سجل الرابط في cross_references لمنع التكرار.
3. ابحث عن أي إشارة لعدد البوستات المعلن في الملف (مثال: "6 بوستات"، "12 Posts"، "20 بوست") وضعه في declared_post_count.

أخرج JSON فقط بالشكل التالي:
{
  "page_count": ${preInspection.pageCount},
  "declared_post_count": 6,
  "page_classifications": [
    { "page_number": 1, "page_type": "cover", "is_operational": false, "notes": "Cover page" },
    { "page_number": 2, "page_type": "post_detail", "is_operational": true, "notes": "Post 1" }
  ],
  "detected_blocks": [
    {
      "canonicalPostId": "post_1",
      "post_number": "Post 1",
      "title": "عنوان البوست الأصلي",
      "format_hint": "Static",
      "source_pages": [2],
      "is_multi_page": false,
      "is_multi_post_page": false,
      "confidence": 0.95
    }
  ],
  "cross_references": [],
  "confidence": 0.95,
  "warnings": []
}
`;

    const { response, usedModel } = await this.safeGenerateContent(
      gemini,
      model,
      [
        {
          inlineData: {
            data: base64Pdf,
            mimeType: "application/pdf",
          },
        },
        { text: prompt },
      ],
      {
        responseMimeType: "application/json",
        temperature: 0.1,
      }
    );

    const tokenUsage = {
      prompt_tokens: response.usageMetadata?.promptTokenCount || 0,
      completion_tokens: response.usageMetadata?.candidatesTokenCount || 0,
      total_tokens: response.usageMetadata?.totalTokenCount || 0,
    };

    const text = response.text || "{}";
    try {
      const parsed = JSON.parse(text);
      return { inventory: DocumentInventorySchema.parse(parsed), tokenUsage, usedModel };
    } catch (err: any) {
      console.warn("[AiDocumentPipeline] Pass A parse warning:", err.message);
      // Fallback inventory
      return {
        inventory: {
          page_count: preInspection.pageCount,
          declared_post_count: null,
          page_classifications: Array.from({ length: preInspection.pageCount }, (_, i) => ({
            page_number: i + 1,
            page_type: (i === 0 ? "cover" : "post_detail") as any,
            is_operational: i !== 0,
          })),
          detected_blocks: Array.from({ length: Math.max(1, preInspection.pageCount - 1) }, (_, i) => ({
            canonicalPostId: `post_${i + 1}`,
            post_number: `Post ${i + 1}`,
            title: `Post ${i + 1}`,
            format_hint: "Static",
            source_pages: [i + 2],
            is_multi_page: false,
            is_multi_post_page: false,
            confidence: 0.85,
          })),
          cross_references: [],
          confidence: 0.85,
          warnings: ["تم إنشاء خريطة الصفحات بصورة تقديرية."],
        },
        tokenUsage,
        usedModel,
      };
    }
  }

  /**
   * Pass B: Detailed Extraction
   * Extracts faithful text verbatim for each operational post block.
   */
  private async runPassBExtraction(
    gemini: any,
    model: string,
    pdfBuffer: Buffer,
    inventory: DocumentInventory,
    monthKey: string
  ): Promise<{ items: DetailedPostItem[]; tokenUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; usedModel: string }> {
    const base64Pdf = pdfBuffer.toString("base64");
    const operationalBlocks = inventory.detected_blocks;

    // Small document (<= 12 blocks): single pass
    if (operationalBlocks.length <= 12) {
      return this.extractBlocksBatch(gemini, model, base64Pdf, operationalBlocks, monthKey, 1, 1);
    }

    // Large document (> 12 blocks): batch in chunks of 8-10 blocks
    const chunkSize = 10;
    const items: DetailedPostItem[] = [];
    const totalBatches = Math.ceil(operationalBlocks.length / chunkSize);
    const totalTokens = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let finalUsedModel = model;

    for (let i = 0; i < operationalBlocks.length; i += chunkSize) {
      const batch = operationalBlocks.slice(i, i + chunkSize);
      const batchIndex = Math.floor(i / chunkSize) + 1;
      const batchResult = await this.extractBlocksBatch(
        gemini,
        model,
        base64Pdf,
        batch,
        monthKey,
        batchIndex,
        totalBatches
      );
      items.push(...batchResult.items);
      totalTokens.prompt_tokens += batchResult.tokenUsage.prompt_tokens;
      totalTokens.completion_tokens += batchResult.tokenUsage.completion_tokens;
      totalTokens.total_tokens += batchResult.tokenUsage.total_tokens;
      finalUsedModel = batchResult.usedModel;
    }

    return { items, tokenUsage: totalTokens, usedModel: finalUsedModel };
  }

  private async extractBlocksBatch(
    gemini: any,
    model: string,
    base64Pdf: string,
    blocks: any[],
    monthKey: string,
    batchIndex: number,
    totalBatches: number
  ): Promise<{ items: DetailedPostItem[]; tokenUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; usedModel: string }> {
    const targetIds = blocks.map((b) => `${b.canonicalPostId} (الصفحات: ${b.source_pages.join(",")})`).join("; ");

    const prompt = `
أنت محلل محتوى دقيق في الايجنسي. مهمتك استخراج البيانات التفصيلية للبوستات المحددة أدناه من ملف تقويم المحتوى لشهر (${monthKey}).

البوستات المطلوب استخراجها في هذه الدفعة (الدفعة ${batchIndex} من ${totalBatches}):
${targetIds}

قواعد استخراج إلزامية (أمان ودقة مطلقة - Zero Hallucination):
1. **النص العربي الأصلي**: استخرج النصوص العربية كما هي تمامًا بدون أي ترجمة، ولا تلخيص، ولا إعادة صياغة، ولا تصحيح إملائي صامت.
2. **النص المكتوب على التصميم (on_design_text)**: استخرج النص أو المانشيت الظاهر في التصميم نفسه حرفياً.
3. **الكاروسيل (Carousel)**:
   - إذا كان البوست متعدد الشرائح (Carousel)، يظل بوستاً وتاسكاً واحداً فقط!
   - استخرج كل شريحة في مصفوفة slides: [{ "slide_number": 1, "text": "نص الشريحة", "visual_notes": "وصف الصورة إن وجد" }].
4. **الريل / الفيديو (Reel / Video)**:
   - إذا كان البوست ريل أو فيديو، يظل بوستاً وتاسكاً واحداً فقط!
   - استخرج الخطاف في "hook"، والاسكريبت التفصيلي في "reel_script"، ودعوة التفاعل في "cta".
5. **التواريخ**:
   - ضع تاريخ النشر publish_date بصيغة YYYY-MM-DD.
   - حدد موعد تسليم التصميم design_due_date قبل موعد النشر بيوم أو يومين بصيغة YYYY-MM-DD.
6. **المنصة والشكل**:
   - platform: Instagram, Facebook, TikTok, LinkedIn, Twitter/X...
   - content_format: Static, Carousel, Reel, Story, Video...

أخرج JSON فقط بالشكل التالي:
{
  "items": [
    {
      "canonicalPostId": "post_1",
      "post_number": "Post 1",
      "title": "عنوان البوست الحقيقي",
      "platform": "Instagram",
      "content_format": "Static",
      "publish_date": "${monthKey}-10",
      "design_due_date": "${monthKey}-08",
      "on_design_text": "النص الظاهر داخل التصميم حرفياً",
      "hook": null,
      "cta": "شاركنا رأيك في التعليقات",
      "reel_script": null,
      "slides": [],
      "caption": "نص الكابشن الكامل...",
      "brief": "ملاحظات الديزاينر والتوجيه الفني...",
      "notes": null,
      "source_pages": [2],
      "confidence": 0.96,
      "warnings": []
    }
  ]
}
`;

    const { response, usedModel } = await this.safeGenerateContent(
      gemini,
      model,
      [
        {
          inlineData: {
            data: base64Pdf,
            mimeType: "application/pdf",
          },
        },
        { text: prompt },
      ],
      {
        responseMimeType: "application/json",
        temperature: 0.1,
      }
    );

    const tokenUsage = {
      prompt_tokens: response.usageMetadata?.promptTokenCount || 0,
      completion_tokens: response.usageMetadata?.candidatesTokenCount || 0,
      total_tokens: response.usageMetadata?.totalTokenCount || 0,
    };

    const text = response.text || "{}";
    try {
      const parsed = JSON.parse(text);
      const validated = BatchedExtractionSchema.safeParse(parsed);
      if (validated.success) {
        return { items: validated.data.items, tokenUsage, usedModel };
      }
      if (Array.isArray(parsed.items)) {
        return { items: parsed.items as DetailedPostItem[], tokenUsage, usedModel };
      }
      return { items: [], tokenUsage, usedModel };
    } catch (err: any) {
      console.warn(`[AiDocumentPipeline] Batch ${batchIndex} extraction parse error:`, err.message);
      return { items: [], tokenUsage, usedModel };
    }
  }

  /**
   * Pass C: Reconciliation & Post-processing
   * Soft deduplication, excludes non-operational items, computes fingerprints and confidence.
   */
  private runPassCReconciliation(params: {
    inventory: DocumentInventory;
    items: DetailedPostItem[];
    tokenUsage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    fileSha256: string;
    model: string;
    options: PipelineOptions;
  }): ReconciledCalendar {
    const { inventory, items, tokenUsage, fileSha256, model, options } = params;

    // Track seen fingerprints to flag duplicates safely without deleting
    const seenNumbers = new Map<string, string>(); // post_number -> id
    const seenFingerprints = new Map<string, string>(); // fingerprint -> id
    const reconciledItems: ReconciledItem[] = [];

    let order = 1;
    let confidenceSum = 0;

    for (const item of items) {
      const cleanPostNumber = (item.post_number || `Post ${order}`).trim();
      const cleanTitle = (item.title || cleanPostNumber).trim();

      // Fingerprint based on text content
      const fpString = `${cleanPostNumber}|${cleanTitle}|${item.on_design_text || ""}|${item.caption || ""}`;
      const fingerprint = crypto.createHash("sha256").update(fpString).digest("hex");

      let possibleDuplicate = false;
      let duplicateOfId: string | null = null;

      // Soft deduplication: flag duplicate only, NEVER delete!
      if (seenNumbers.has(cleanPostNumber)) {
        possibleDuplicate = true;
        duplicateOfId = seenNumbers.get(cleanPostNumber) || null;
      } else if (seenFingerprints.has(fingerprint)) {
        possibleDuplicate = true;
        duplicateOfId = seenFingerprints.get(fingerprint) || null;
      }

      const itemId = crypto.randomUUID();
      if (!possibleDuplicate) {
        seenNumbers.set(cleanPostNumber, itemId);
        seenFingerprints.set(fingerprint, itemId);
      }

      const conf = Math.max(0.1, Math.min(1.0, item.confidence || 0.95));
      confidenceSum += conf;

      reconciledItems.push({
        ...item,
        id: itemId,
        post_order: order++,
        post_number: cleanPostNumber,
        title: cleanTitle,
        content_fingerprint: fingerprint,
        possible_duplicate: possibleDuplicate,
        duplicate_of_item_id: duplicateOfId,
        is_included: !possibleDuplicate,
        is_excluded_from_tasks: false,
        exclusion_reason: null,
        needs_manual_review: possibleDuplicate || conf < 0.85,
        suggested_assignee_id: null,
        approved_assignee_id: null,
        confidence: conf,
      });
    }

    // Add excluded non-operational pages if identified in Pass A
    const nonOpPages = inventory.page_classifications.filter((p) => !p.is_operational);
    for (const page of nonOpPages) {
      const pageTitle =
        page.page_type === "cover"
          ? "صفحة الغلاف"
          : page.page_type === "strategy"
          ? "استراتيجية المحتوى"
          : page.page_type === "content_pillar"
          ? "محاور المحتوى"
          : page.page_type === "references"
          ? "المراجع"
          : page.page_type === "thank_you"
          ? "صفحة الشكر والختام"
          : `صفحة غير تشغيلية (${page.page_type})`;

      reconciledItems.push({
        id: crypto.randomUUID(),
        canonicalPostId: `non_op_p${page.page_number}`,
        post_order: order++,
        post_number: `Section P${page.page_number}`,
        title: pageTitle,
        platform: "Instagram",
        content_format: "Static",
        publish_date: null,
        design_due_date: null,
        on_design_text: null,
        hook: null,
        cta: null,
        reel_script: null,
        slides: [],
        caption: null,
        brief: page.notes || null,
        notes: "مستبعد تلقائيًا من إنشاء التاسكات (قسم غير تشغيلي)",
        source_pages: [page.page_number],
        confidence: 0.98,
        warnings: [],
        is_included: false,
        is_excluded_from_tasks: true,
        exclusion_reason: `قسم ${page.page_type} غير تشغيلي`,
        possible_duplicate: false,
        duplicate_of_item_id: null,
        needs_manual_review: false,
        suggested_assignee_id: null,
        approved_assignee_id: null,
      });
    }

    const operationalCount = reconciledItems.filter((i) => !i.is_excluded_from_tasks && !i.possible_duplicate).length;
    const overallConfidence =
      items.length > 0 ? Number((confidenceSum / items.length).toFixed(2)) : null;

    const warnings = [...inventory.warnings];
    if (
      inventory.declared_post_count &&
      inventory.declared_post_count > 0 &&
      inventory.declared_post_count !== operationalCount
    ) {
      warnings.push(
        `تنبيه: عدد البوستات المكتشفة (${operationalCount}) يختلف عن العدد المعلن في الملف (${inventory.declared_post_count}).`
      );
    }

    return {
      items: reconciledItems,
      declared_post_count: inventory.declared_post_count || null,
      detected_post_count: operationalCount,
      overall_confidence: overallConfidence,
      inventory,
      token_usage: tokenUsage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      warnings,
      file_sha256: fileSha256,
      model_used: model,
      provider: "google",
      prompt_version: PARSER_VERSION,
      schema_version: SCHEMA_VERSION,
    };
  }

  /**
   * Fallback extractor when Gemini API is unavailable or offline.
   */
  private async fallbackToLocalExtractor(
    pdfBuffer: Buffer,
    options: PipelineOptions,
    fileSha256: string,
    preInspection: { pageCount: number; hasText: boolean }
  ): Promise<ReconciledCalendar> {
    const localRes = await extractPostsFromPdf(pdfBuffer, { targetYearMonth: options.monthKey });

    let order = 1;
    const items: ReconciledItem[] = localRes.items.map((it) => ({
      id: crypto.randomUUID(),
      canonicalPostId: `fallback_post_${order}`,
      post_order: order++,
      post_number: it.post_number || `Post ${order}`,
      title: it.title || `Post ${order}`,
      platform: it.platform || "Instagram",
      content_format: it.content_format || "Static",
      publish_date: it.publish_date || null,
      design_due_date: it.design_due_date || null,
      on_design_text: null,
      hook: null,
      cta: null,
      reel_script: null,
      slides: [],
      caption: it.caption || null,
      brief: it.brief || null,
      notes: it.warning || it.notes || null,
      source_pages: it.source_page ? [it.source_page] : [],
      confidence: it.confidence || 0.8,
      warnings: it.warning ? [it.warning] : [],
      is_included: true,
      is_excluded_from_tasks: false,
      exclusion_reason: null,
      possible_duplicate: false,
      duplicate_of_item_id: null,
      needs_manual_review: it.needs_manual_review || false,
      suggested_assignee_id: null,
      approved_assignee_id: null,
    }));

    return {
      items,
      declared_post_count: null,
      detected_post_count: items.length,
      overall_confidence: localRes.items.length > 0 ? 0.8 : 0.4,
      token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      warnings: localRes.error ? [localRes.error] : [],
      file_sha256: fileSha256,
      model_used: "local_heuristic_fallback",
      provider: "local",
      prompt_version: "v1.0",
      schema_version: SCHEMA_VERSION,
    };
  }

  /**
   * Database Cache helpers
   */
  private async getCachedExtraction(
    admin: any,
    workspaceId: string,
    fileSha256: string
  ): Promise<ReconciledCalendar | null> {
    try {
      const { data, error } = await admin
        .from("ai_extraction_cache")
        .select("extracted_payload")
        .eq("workspace_id", workspaceId)
        .eq("file_sha256", fileSha256)
        .eq("parser_version", PARSER_VERSION)
        .eq("schema_version", SCHEMA_VERSION)
        .maybeSingle();

      if (!error && data?.extracted_payload) {
        const validated = ReconciledCalendarSchema.safeParse(data.extracted_payload);
        if (validated.success && validated.data.items && validated.data.items.length > 0) {
          return validated.data;
        }
      }
    } catch (e) {
      console.warn("[AiDocumentPipeline] Cache lookup error:", e);
    }
    return null;
  }

  private async cacheExtraction(
    admin: any,
    workspaceId: string,
    fileSha256: string,
    payload: ReconciledCalendar
  ): Promise<void> {
    try {
      await admin.from("ai_extraction_cache").upsert(
        {
          workspace_id: workspaceId,
          file_sha256: fileSha256,
          parser_version: PARSER_VERSION,
          schema_version: SCHEMA_VERSION,
          provider: payload.provider,
          model: payload.model_used,
          extracted_payload: payload,
          token_usage: payload.token_usage,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,file_sha256,parser_version,schema_version" }
      );
    } catch (e) {
      console.warn("[AiDocumentPipeline] Failed to save extraction cache:", e);
    }
  }
}

export const aiDocumentPipeline = new AiDocumentPipeline();
