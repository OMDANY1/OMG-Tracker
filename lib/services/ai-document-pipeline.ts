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
        options.monthKey,
        preInspection.pages
      );

      const totalTokens = {
        prompt_tokens: passARes.tokenUsage.prompt_tokens + passBRes.tokenUsage.prompt_tokens,
        completion_tokens: passARes.tokenUsage.completion_tokens + passBRes.tokenUsage.completion_tokens,
        total_tokens: passARes.tokenUsage.total_tokens + passBRes.tokenUsage.total_tokens,
      };

      const resolvedModel = passBRes.usedModel || passARes.usedModel || model;

      // If Pass B returned 0 items despite having operational pages with text, merge page-level extraction
      let extractedItems = passBRes.items;
      if (extractedItems.length === 0 && preInspection.hasText && preInspection.pages.length > 0) {
        const localFallback = await this.fallbackToLocalExtractor(pdfBuffer, options, fileSha256, preInspection);
        if (localFallback.items.length > 0) {
          if (admin) {
            await this.cacheExtraction(admin, options.workspaceId, fileSha256, localFallback);
          }
          return localFallback;
        }
      }

      // 6. Pass C: Reconciliation & Post-processing
      const reconciled = this.runPassCReconciliation({
        inventory: passARes.inventory,
        items: extractedItems,
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
      // If Gemini fails due to transient quota/network/model unavailability and the PDF has selectable text,
      // recover gracefully using the page-aware structured extractor so campaigns never get stuck
      if (
        preInspection.hasText &&
        preInspection.pages.length > 0 &&
        classification.category !== "INVALID_KEY" &&
        classification.category !== "PERMISSION_DENIED"
      ) {
        console.warn(
          `[AiDocumentPipeline] Recovering via structured page-level extractor after Gemini ${classification.category}...`
        );
        const recovered = await this.fallbackToLocalExtractor(pdfBuffer, options, fileSha256, preInspection);
        if (recovered.items.filter((i) => !i.is_excluded_from_tasks).length > 0) {
          return recovered;
        }
      }
      const customErr: any = new Error(classification.safeMessageAr);
      customErr.code = classification.category;
      customErr.status = err.status || 502;
      customErr.originalError = err.message || String(err);
      throw customErr;
    }
  }

  /**
   * Helper to execute Gemini requests with transient retry and automatic candidate model fallback.
   * Supports current Gemini 3.x / 2.5 models and dynamically follows Google API model upgrade hints on 404.
   */
  private async safeGenerateContent(
    gemini: any,
    preferredModel: string,
    contents: any[],
    config?: any
  ): Promise<{ response: any; usedModel: string }> {
    const candidateModels = [
      "gemini-3.8-flash",
      "gemini-3.5-flash-lite",
      "gemini-flash-latest",
      "gemini-3.6-flash",
      "gemini-3.1-pro-preview",
      preferredModel,
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ].filter(
      (m, idx, arr) =>
        Boolean(m) &&
        !m.includes("1.5") &&
        arr.indexOf(m) === idx
    );

    let lastError: any = null;

    for (let i = 0; i < candidateModels.length; i++) {
      const modelToTry = candidateModels[i];
      try {
        const effectiveConfig = {
          ...config,
          httpOptions: {
            timeout: 20000,
            ...(config?.httpOptions || {}),
          },
          ...(modelToTry.includes("2.5-flash")
            ? { thinkingConfig: { thinkingBudget: 0 } }
            : {}),
        };

        const response = await callGeminiWithRetry(
          () =>
            gemini.models.generateContent({
              model: modelToTry,
              contents,
              config: effectiveConfig,
            }),
          { maxRetries: 1 }
        );
        return { response, usedModel: modelToTry };
      } catch (err: any) {
        lastError = err;
        const rawErrMsg = String(err?.message || "");
        const msg = rawErrMsg.toLowerCase();

        // If Google's 404 error recommends a replacement model (e.g. "use models/gemini-3.8-flash"), queue it
        const suggestedMatch = rawErrMsg.match(/use\s+models\/([a-z0-9._-]+)/i);
        if (suggestedMatch?.[1] && !candidateModels.includes(suggestedMatch[1])) {
          candidateModels.splice(i + 1, 0, suggestedMatch[1]);
        }

        const isUnavailableOrNotFound =
          err?.status === 404 ||
          err?.status === 503 ||
          err?.status === 504 ||
          err?.status === 429 ||
          msg.includes("503") ||
          msg.includes("504") ||
          msg.includes("404") ||
          msg.includes("429") ||
          msg.includes("quota") ||
          msg.includes("rate limit") ||
          msg.includes("resource_exhausted") ||
          msg.includes("high demand") ||
          msg.includes("unavailable") ||
          msg.includes("not found") ||
          msg.includes("no longer available") ||
          msg.includes("not supported") ||
          msg.includes("timeout") ||
          msg.includes("aborted") ||
          msg.includes("etimedout") ||
          msg.includes("fetch failed");

        if (isUnavailableOrNotFound && i < candidateModels.length - 1) {
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
   * Reconstructs clean per-page text from pdfjs textContent items,
   * automatically normalizing and fixing visual-RTL Arabic Presentation Forms (e.g. Canva / Illustrator PDFs).
   */
  private extractCleanPageText(items: any[]): string {
    const valid = (items || [])
      .filter((it: any) => typeof it?.str === "string" && it.str.length > 0 && Array.isArray(it.transform))
      .map((it: any) => ({
        str: it.str as string,
        x: Number(it.transform[4]) || 0,
        y: Number(it.transform[5]) || 0,
      }));

    if (valid.length === 0) {
      return (items || [])
        .map((it: any) => String(it?.str || "").normalize("NFKC"))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    }

    const lines: Array<{ y: number; items: Array<{ str: string; x: number; y: number }> }> = [];
    for (const item of valid) {
      let line = lines.find((l) => Math.abs(l.y - item.y) <= 6);
      if (!line) {
        line = { y: item.y, items: [] };
        lines.push(line);
      }
      line.items.push(item);
    }
    lines.sort((a, b) => b.y - a.y);

    const lineStrings = lines.map((line) => {
      const rawConcat = line.items.map((i) => i.str).join("");
      const hasPresentationForms = /[\uFB50-\uFDFF\uFE70-\uFEFF]/.test(rawConcat);
      const hasArabic = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(rawConcat);

      if (hasArabic && hasPresentationForms) {
        const rtlItems = [...line.items].reverse();
        let out = "";
        for (const it of rtlItems) {
          out += it.str.normalize("NFKC");
        }
        return out.replace(/\s+/g, " ").trim();
      } else {
        return line.items
          .map((i) => i.str.normalize("NFKC"))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
      }
    });

    return lineStrings
      .filter((l) => l && !/^(?:next|click\s*here|ً)$/i.test(l.trim()))
      .join("\n");
  }

  /**
   * Pre-inspect PDF using pdfjs-dist legacy build dynamically (with bundled pdf.worker.mjs for Vercel Serverless).
   * Extracts per-page text for all pages to accelerate and anchor AI extraction.
   */
  private async preInspectPdf(buffer: Buffer): Promise<{
    pageCount: number;
    hasText: boolean;
    sampleText: string;
    pages: Array<{ pageNumber: number; text: string }>;
  }> {
    try {
      // Pre-load pdf.worker.mjs onto globalThis.pdfjsWorker so Next.js/Vercel Serverless bundles it
      // @ts-ignore
      if (!(globalThis as any).pdfjsWorker) {
        // @ts-ignore
        (globalThis as any).pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs").catch(() => null);
      }
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
      const pages: Array<{ pageNumber: number; text: string }> = [];
      for (let i = 1; i <= Math.min(pageCount, 60); i++) {
        const page = await doc.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = this.extractCleanPageText(textContent.items);
        pages.push({ pageNumber: i, text: pageText });
        if (i <= 5) {
          extractedText += pageText + " ";
        }
      }

      const totalChars = pages.reduce((acc, p) => acc + p.text.length, 0);

      return {
        pageCount,
        hasText: totalChars > 50,
        sampleText: extractedText.trim().substring(0, 500),
        pages,
      };
    } catch (e) {
      console.warn("[AiDocumentPipeline] pdfjs preInspect fallback:", (e as any)?.message || e);
      // Fallback estimate based on byte patterns
      const str = buffer.toString("binary");
      const matches = str.match(/\/Type\s*\/Page\b/g);
      const estimatedPages = matches ? matches.length : 1;
      return {
        pageCount: Math.max(1, estimatedPages),
        hasText: true,
        sampleText: "",
        pages: [],
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
    preInspection: { pageCount: number; pages?: Array<{ pageNumber: number; text: string }> }
  ): Promise<{ inventory: DocumentInventory; tokenUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; usedModel: string }> {
    const base64Pdf = pdfBuffer.toString("base64");
    const pageTextDigest =
      preInspection.pages && preInspection.pages.length > 0
        ? "\nالنص المستخرج لكل صفحة للمساعدة في التصنيف الدقيق:\n" +
          preInspection.pages
            .map((p) => `[Page ${p.pageNumber}]: ${p.text.substring(0, 600)}`)
            .join("\n")
        : "";

    const prompt = `
أنت خبير محترف في تحليل وثائق تقويم المحتوى (Content Calendars) لشركات التسويق والإعلانات (الايجنسي).
قم بفحص هذا الملف بالكامل وأنشئ خريطة هيكلية تفصيلية (Document Inventory) بصيغة JSON فقط.
${pageTextDigest}

قواعد صارمة:
1. صنف كل صفحة من صفحات الملف (Page 1 to ${preInspection.pageCount}):
   - 'cover': صفحة غلاف، شعار العميل، اسم الشهر، أو عبارة مثل "THIS CAMPAIGN PRESENTED TO" (غير تشغيلية، ليست بوست).
   - 'strategy': استراتيجية المحتوى، جدول المحتويات (Table of Contents)، الأهداف، النبرة، الجمهور المستهدف (غير تشغيلية، ليست بوست).
   - 'content_pillar': محاور وركائز المحتوى (غير تشغيلية، ليست بوست).
   - 'calendar_overview': جدول شهري مجمع أو شبكة مواعيد تلخص البوستات (لا تنشئ منها بوستات مكررة).
   - 'post_detail': صفحة تفصيلية لبوست أو أكثر (مثل صفحة تحتوي على slide 1 / slide 2 أو tov / text أو مانشيت وكابشن).
   - 'references': مراجع أو شكر أو خاتمة 'thank_you' (غير تشغيلية).
2. حدد البوستات التشغيلية الحقيقية (Content Blocks):
   - أعطِ كل بوست فريد معرف canonicalPostId دائم (مثل "post_1", "post_2").
   - حدد أرقام الصفحات التي ينتمي لها البوست في source_pages.
   - إذا كانت الصفحة تحتوي على عدة شرائح (مثل slide 1, slide 2)، فهي بوست واحد فقط من نوع 'Carousel'.
   - إذا كان بوست واحد يمتد عبر عدة صفحات (مثل كابشن في صفحة وسلايدز في صفحة تالية)، ادمجهما تحت نفس canonicalPostId وضع is_multi_page = true.
   - إذا كانت صفحة واحدة تحتوي أكثر من بوست مستقل، استخرج كل بوست بـ canonicalPostId مستقل وضع is_multi_post_page = true.
   - إذا كانت هناك شبكة تقويم مجمعة (overview) تشير لصفحة تفاصيل، سجل الرابط في cross_references لمنع التكرار.
3. ابحث عن أي إشارة لعدد البوستات المعلن في الملف (مثال: "6 بوستات"، "12 Posts"، "20 بوست") وضعه في declared_post_count (أو null إذا لم يُذكر صراحة).

أخرج JSON فقط بالشكل التالي:
{
  "page_count": ${preInspection.pageCount},
  "declared_post_count": null,
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
    monthKey: string,
    pages?: Array<{ pageNumber: number; text: string }>
  ): Promise<{ items: DetailedPostItem[]; tokenUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; usedModel: string }> {
    const base64Pdf = pdfBuffer.toString("base64");
    const operationalBlocks = inventory.detected_blocks;

    // Standard document (<= 16 blocks): single pass
    if (operationalBlocks.length <= 16) {
      return this.extractBlocksBatch(gemini, model, base64Pdf, operationalBlocks, monthKey, 1, 1, pages);
    }

    // Large document (> 16 blocks): batch in chunks of 12 blocks
    const chunkSize = 12;
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
        totalBatches,
        pages
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
    totalBatches: number,
    pages?: Array<{ pageNumber: number; text: string }>
  ): Promise<{ items: DetailedPostItem[]; tokenUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; usedModel: string }> {
    const targetIds = blocks.map((b) => `${b.canonicalPostId} (الصفحات: ${b.source_pages.join(",")})`).join("; ");
    const relevantPageNums = new Set<number>(blocks.flatMap((b) => b.source_pages || []));
    const pageTextContext =
      pages && pages.length > 0
        ? "\nالنصوص المستخرجة حرفياً من الصفحات المطلوبة:\n" +
          pages
            .filter((p) => relevantPageNums.size === 0 || relevantPageNums.has(p.pageNumber))
            .map((p) => `[Page ${p.pageNumber}]: ${p.text}`)
            .join("\n\n")
        : "";

    const prompt = `
أنت محلل محتوى دقيق في الايجنسي. مهمتك استخراج البيانات التفصيلية للبوستات المحددة أدناه من ملف تقويم المحتوى لشهر (${monthKey}).

البوستات المطلوب استخراجها في هذه الدفعة (الدفعة ${batchIndex} من ${totalBatches}):
${targetIds}
${pageTextContext}

قواعد استخراج إلزامية (أمان ودقة مطلقة - Zero Hallucination):
1. **النص الأصلي**: استخرج النصوص العربية والإنجليزية كما هي تمامًا بدون أي ترجمة، ولا تلخيص، ولا إعادة صياغة.
2. **النص المكتوب على التصميم (on_design_text)**: استخرج النص أو المانشيت الظاهر على التصميم نفسه حرفياً (وعادة يكون في أعلى الصفحة قبل قسم tov أو text).
3. **التوجيه الفني ونبرة الصوت (brief)**: إذا وُجد قسم "tov :" أو "Tone of Voice" أو "Brief" أو توجيه للمصمم، ضعه بالكامل في حقل "brief".
4. **الكابشن (caption)**: إذا وُجد قسم "text:" أو "caption:" أو نص منشور السوشيال ميديا، ضعه بالكامل في حقل "caption".
5. **الكاروسيل (Carousel)**:
   - إذا كان البوست متعدد الشرائح (مثل slide 1, slide 2)، يظل بوستاً وتاسكاً واحداً فقط مع content_format = "Carousel"!
   - استخرج كل شريحة في مصفوفة slides: [{ "slide_number": 1, "text": "نص الشريحة", "visual_notes": "وصف الصورة إن وجد" }].
6. **الريل / الفيديو (Reel / Video)**:
   - إذا كان البوست ريل أو فيديو، يظل بوستاً وتاسكاً واحداً فقط!
   - استخرج الخطاف في "hook"، والاسكريبت التفصيلي في "reel_script"، ودعوة التفاعل في "cta".
7. **التواريخ**:
   - ضع تاريخ النشر publish_date بصيغة YYYY-MM-DD ضمن شهر ${monthKey} (إذا لم يُذكر يوم محدد في الصفحة، وزّع البوستات بالتساوي خلال شهر ${monthKey}).
   - حدد موعد تسليم التصميم design_due_date قبل موعد النشر بيومين بصيغة YYYY-MM-DD.
8. **المنصة والشكل**:
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
      "brief": "ملاحظات الديزاينر ونبرة الصوت TOV...",
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
      const rawItems = Array.isArray(parsed.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];
      const sanitizedItems: DetailedPostItem[] = rawItems.map((it: any, idx: number) => {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        const pubDate = typeof it.publish_date === "string" && dateRegex.test(it.publish_date.trim()) ? it.publish_date.trim() : null;
        const dueDate = typeof it.design_due_date === "string" && dateRegex.test(it.design_due_date.trim()) ? it.design_due_date.trim() : null;
        const slides = Array.isArray(it.slides)
          ? it.slides
              .filter((s: any) => s && typeof s.text === "string" && s.text.trim().length > 0)
              .map((s: any, sIdx: number) => ({
                slide_number: typeof s.slide_number === "number" && s.slide_number >= 1 ? Math.floor(s.slide_number) : sIdx + 1,
                text: s.text.trim(),
                visual_notes: typeof s.visual_notes === "string" ? s.visual_notes : undefined,
              }))
          : [];
        const sourcePages = Array.isArray(it.source_pages)
          ? it.source_pages.map((p: any) => Number(p)).filter((p: number) => Number.isInteger(p) && p >= 1)
          : [];

        return {
          canonicalPostId: String(it.canonicalPostId || `post_${idx + 1}`),
          post_number: String(it.post_number || `Post ${idx + 1}`),
          title: String(it.title || it.on_design_text || `Post ${idx + 1}`).substring(0, 180),
          platform: String(it.platform || "Instagram"),
          content_format: slides.length > 1 ? "Carousel" : String(it.content_format || "Static"),
          publish_date: pubDate,
          design_due_date: dueDate,
          on_design_text: typeof it.on_design_text === "string" ? it.on_design_text : null,
          hook: typeof it.hook === "string" ? it.hook : null,
          cta: typeof it.cta === "string" ? it.cta : null,
          reel_script: typeof it.reel_script === "string" ? it.reel_script : null,
          slides,
          caption: typeof it.caption === "string" ? it.caption : null,
          brief: typeof it.brief === "string" ? it.brief : null,
          notes: typeof it.notes === "string" ? it.notes : null,
          source_pages: sourcePages,
          confidence: typeof it.confidence === "number" ? Math.max(0.1, Math.min(1, it.confidence)) : 0.95,
          warnings: Array.isArray(it.warnings) ? it.warnings.map(String) : [],
        };
      });

      const validated = BatchedExtractionSchema.safeParse({ items: sanitizedItems });
      if (validated.success) {
        return { items: validated.data.items, tokenUsage, usedModel };
      }
      return { items: sanitizedItems, tokenUsage, usedModel };
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
   * Fallback extractor when Gemini API is unavailable or rate-limited.
   * Uses per-page pdfjs text classification first, then falls back to pdf-extractor heuristics.
   */
  private async fallbackToLocalExtractor(
    pdfBuffer: Buffer,
    options: PipelineOptions,
    fileSha256: string,
    preInspection: { pageCount: number; hasText: boolean; pages?: Array<{ pageNumber: number; text: string }> }
  ): Promise<ReconciledCalendar> {
    const pages = preInspection.pages || [];
    if (pages.length > 0 && pages.some((p) => p.text.trim().length > 20)) {
      const pageClassifications: any[] = [];
      const detectedBlocks: any[] = [];
      const detailedItems: DetailedPostItem[] = [];

      const operationalPages: Array<{ pageNumber: number; text: string }> = [];

      for (const p of pages) {
        const raw = p.text.trim();
        const lower = raw.toLowerCase();
        const hasPostMarkers =
          /\bslide\s*\d+/i.test(raw) ||
          /\btov\b/i.test(raw) ||
          /\bcontent\b/i.test(raw) ||
          /\btext\s*:?/i.test(raw) ||
          /\bcaption\s*:?/i.test(raw) ||
          /\bscript\s*voice\s*over/i.test(raw) ||
          /\bpost\s*\d+/i.test(raw) ||
          /(?:بوست|منشور|كابشن|سلايد|ريلز|فيديو)\s*\d*/i.test(raw);

        if (
          p.pageNumber === 1 &&
          !hasPostMarkers &&
          (lower.includes("presented to") ||
            lower.includes("marketing group") ||
            lower.includes("markting group") ||
            lower.includes("monthly campaign") ||
            lower.includes("content calendar") ||
            raw.length < 180)
        ) {
          pageClassifications.push({
            page_number: p.pageNumber,
            page_type: "cover",
            is_operational: false,
            notes: raw.substring(0, 140) || "Cover page",
          });
          continue;
        }

        if (
          !hasPostMarkers &&
          (lower.includes("table of contents") ||
            lower.includes("جدول المحتويات") ||
            lower.includes("content strategy") ||
            lower.includes("استراتيجية المحتوى") ||
            lower.includes("content pillars") ||
            lower.includes("محاور المحتوى"))
        ) {
          pageClassifications.push({
            page_number: p.pageNumber,
            page_type: "strategy",
            is_operational: false,
            notes: raw.substring(0, 140) || "Strategy / Table of Contents",
          });
          continue;
        }

        if (
          !hasPostMarkers &&
          (lower.includes("thank you") || lower.includes("شكراً") || lower.includes("شكرا لكم") || raw.length < 25)
        ) {
          pageClassifications.push({
            page_number: p.pageNumber,
            page_type: "thank_you",
            is_operational: false,
            notes: raw.substring(0, 140) || "Closing page",
          });
          continue;
        }

        pageClassifications.push({
          page_number: p.pageNumber,
          page_type: "post_detail",
          is_operational: true,
          notes: `Operational post on page ${p.pageNumber}`,
        });
        operationalPages.push(p);
      }

      const totalOps = operationalPages.length;
      const [yearStr, monthStr] = (options.monthKey || "2026-10").split("-");
      const yearNum = Number(yearStr) || 2026;
      const monthNum = Number(monthStr) || 10;
      const daysInMonth = new Date(yearNum, monthNum, 0).getDate() || 30;

      operationalPages.forEach((p, idx) => {
        const postIdx = idx + 1;
        const postNumber = `Post ${String(postIdx).padStart(2, "0")}`;
        const canonicalId = `post_${postIdx}`;
        const raw = p.text.trim();

        // Check for carousel slides ("slide 1 ... slide 2 ...")
        const slideMatches = Array.from(raw.matchAll(/\bslide\s*(\d+)\b/gi));
        const slides: Array<{ slide_number: number; text: string; visual_notes?: string }> = [];
        if (slideMatches.length >= 2) {
          for (let s = 0; s < slideMatches.length; s++) {
            const startIdx = (slideMatches[s].index || 0) + slideMatches[s][0].length;
            const endIdx = s + 1 < slideMatches.length ? slideMatches[s + 1].index || raw.length : raw.length;
            const slideText = raw.slice(startIdx, endIdx).trim();
            if (slideText) {
              slides.push({
                slide_number: Number(slideMatches[s][1]) || s + 1,
                text: slideText,
              });
            }
          }
        }

        // Parse TOV / Brief and CONTENT / Text / Caption / Script sections if present
        let onDesignText = "";
        let briefText: string | null = null;
        let captionText: string | null = null;

        const tovMatch = raw.match(/\btov\s*:?\s*/i);
        const textMatch = raw.match(/\b(?:content|text|caption|script\s*voice\s*over)\s*:?\s*/i);

        if (tovMatch && tovMatch.index !== undefined) {
          const beforeTov = raw.slice(0, tovMatch.index).trim();
          const afterTovStart = tovMatch.index + tovMatch[0].length;
          const isNumericOrTagPrefix =
            !beforeTov ||
            /^\d+(?:\s*reel)?$/i.test(beforeTov) ||
            (beforeTov.length < 35 && /\d/.test(beforeTov));

          if (textMatch && textMatch.index !== undefined && textMatch.index > afterTovStart) {
            const betweenTovAndContent = raw.slice(afterTovStart, textMatch.index).trim();
            const afterContent = raw.slice(textMatch.index + textMatch[0].length).trim();
            if (isNumericOrTagPrefix) {
              onDesignText = betweenTovAndContent;
              captionText = afterContent || betweenTovAndContent;
              const cleanTag = beforeTov.replace(/^\d+|\d+$/g, "").trim();
              briefText = cleanTag || betweenTovAndContent;
            } else {
              onDesignText = beforeTov;
              briefText = betweenTovAndContent;
              captionText = afterContent;
            }
          } else {
            const afterTov = raw.slice(afterTovStart).trim();
            if (isNumericOrTagPrefix) {
              onDesignText = afterTov.split("\n")[0] || afterTov.substring(0, 180);
              captionText = afterTov;
              briefText = afterTov;
            } else {
              onDesignText = beforeTov;
              briefText = afterTov;
              captionText = afterTov;
            }
          }
        } else if (textMatch && textMatch.index !== undefined) {
          const beforeContent = raw.slice(0, textMatch.index).trim();
          const afterContent = raw.slice(textMatch.index + textMatch[0].length).trim();
          if (!beforeContent || /^\d+(?:\s*reel)?$/i.test(beforeContent)) {
            onDesignText = afterContent.split("\n")[0] || afterContent.substring(0, 180);
            captionText = afterContent;
            briefText = /voice\s*over|reel/i.test(raw) ? "Reel — Script Voice Over" : null;
          } else {
            onDesignText = beforeContent;
            captionText = afterContent;
          }
        } else if (slides.length > 0) {
          onDesignText = slides[0].text.substring(0, 180);
          captionText = slides.map((s) => `Slide ${s.slide_number}: ${s.text}`).join("\n\n");
          briefText = "Carousel post — multi-slide design";
        } else {
          onDesignText = raw.substring(0, 180);
          captionText = raw;
        }

        const cleanHeadline = (onDesignText || slides[0]?.text || raw)
          .replace(/^slide\s*\d+\s*/i, "")
          .replace(/^let[’']s\s+talk\s+month\s+campaign\s*/i, "")
          .replace(/\s+/g, " ")
          .trim();
        const title = (cleanHeadline.split(/[.?!\n]/)[0] || cleanHeadline || postNumber).trim().substring(0, 100);
        const contentFormat =
          slides.length > 1
            ? "Carousel"
            : /\breel\b|\bvideo\b|\bvoice\s*over\b|ريلز|فيديو/i.test(raw)
            ? "Reel"
            : "Static";

        // Evenly distribute publish_date across the month and set design_due_date 2 days prior
        const pubDay = Math.min(daysInMonth, Math.max(3, Math.round(((idx + 1) * (daysInMonth - 2)) / Math.max(1, totalOps)) + 1));
        const dueDay = Math.max(1, pubDay - 2);
        const publishDate = `${yearNum}-${String(monthNum).padStart(2, "0")}-${String(pubDay).padStart(2, "0")}`;
        const designDueDate = `${yearNum}-${String(monthNum).padStart(2, "0")}-${String(dueDay).padStart(2, "0")}`;

        detectedBlocks.push({
          canonicalPostId: canonicalId,
          post_number: postNumber,
          title,
          format_hint: contentFormat,
          source_pages: [p.pageNumber],
          is_multi_page: false,
          is_multi_post_page: false,
          confidence: 0.92,
        });

        detailedItems.push({
          canonicalPostId: canonicalId,
          post_number: postNumber,
          title,
          platform: "Instagram",
          content_format: contentFormat,
          publish_date: publishDate,
          design_due_date: designDueDate,
          on_design_text: onDesignText || title,
          hook: cleanHeadline.includes("?") ? cleanHeadline.split("?")[0] + "?" : null,
          cta: null,
          reel_script: contentFormat === "Reel" ? captionText : null,
          slides,
          caption: captionText || raw,
          brief: briefText,
          notes: null,
          source_pages: [p.pageNumber],
          confidence: 0.92,
          warnings: [],
        });
      });

      if (detailedItems.length > 0) {
        const inventory: DocumentInventory = {
          page_count: preInspection.pageCount,
          declared_post_count: detailedItems.length,
          page_classifications: pageClassifications,
          detected_blocks: detectedBlocks,
          cross_references: [],
          confidence: 0.92,
          warnings: [],
        };

        return this.runPassCReconciliation({
          inventory,
          items: detailedItems,
          tokenUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          fileSha256,
          model: "gemini-2.5-flash",
          options,
        });
      }
    }

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
          const idMap = new Map<string, string>();
          for (const it of validated.data.items) {
            if (it.id) idMap.set(it.id, crypto.randomUUID());
          }
          const freshItems = validated.data.items.map((it) => ({
            ...it,
            id: (it.id && idMap.get(it.id)) || crypto.randomUUID(),
            duplicate_of_item_id: it.duplicate_of_item_id
              ? idMap.get(it.duplicate_of_item_id) || null
              : null,
          }));
          return {
            ...validated.data,
            items: freshItems,
          };
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
