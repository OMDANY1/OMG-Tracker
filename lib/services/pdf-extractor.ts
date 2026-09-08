// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdf = require("pdf-parse");

export interface ExtractedPostItem {
  post_order: number;
  post_number: string;
  title: string;
  caption: string;
  brief: string;
  platform: string;
  content_format: string;
  publish_date: string | null;
  design_due_date: string | null;
  notes: string;
  reference_urls: string[];
  raw_text: string;
  source_page: number;
  confidence: number;
  needs_manual_review: boolean;
  warning?: string | null;
}

export interface PdfExtractionResult {
  success: boolean;
  totalPages: number;
  extractedTextLength: number;
  isScannedOrNoText: boolean;
  items: ExtractedPostItem[];
  error?: string | null;
  rawText: string;
}

const PLATFORM_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "Instagram", regex: /(?:instagram|إنستغرام|انستغرام|انستقرام|ig)\b/i },
  { name: "Facebook", regex: /(?:facebook|فيسبوك|فيس بوك|fb)\b/i },
  { name: "LinkedIn", regex: /(?:linkedin|لينكد\s*إن|لينكدين)\b/i },
  { name: "TikTok", regex: /(?:tiktok|تيك\s*توك)\b/i },
  { name: "X (Twitter)", regex: /(?:twitter|تويتر|\bx\b)\b/i },
  { name: "Snapchat", regex: /(?:snapchat|سناب\s*شات)\b/i },
];

const FORMAT_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "Carousel", regex: /(?:carousel|كاروسيل|شرائح|سلايدز|slides)\b/i },
  { name: "Reel", regex: /(?:reel|ريل|فيديو\s*قصير|short\s*video)\b/i },
  { name: "Video", regex: /(?:video|فيديو|موشن|motion)\b/i },
  { name: "Story", regex: /(?:story|ستوري|قصة)\b/i },
  { name: "Static", regex: /(?:static|ثابت|بوست\s*ثابت|single\s*post|image)\b/i },
];

/**
 * Validates PDF buffer magic bytes and size
 */
export function validatePdfBuffer(buffer: Buffer, maxSizeBytes: number = 15728640): { valid: boolean; error?: string } {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: "الملف فارغ أو غير متوفر." };
  }

  if (buffer.length > maxSizeBytes) {
    return {
      valid: false,
      error: `حجم الملف (${(buffer.length / (1024 * 1024)).toFixed(1)} ميجابايت) يتجاوز الحد الأقصى المسموح به (15 ميجابايت).`,
    };
  }

  // Check PDF signature '%PDF-' (0x25 0x50 0x44 0x46 0x2D)
  const header = buffer.slice(0, 5).toString("ascii");
  if (!header.startsWith("%PDF-")) {
    return { valid: false, error: "نوع الملف غير صالح. يجب أن يكون الملف بصيغة PDF حقيقية." };
  }

  return { valid: true };
}

/**
 * Parses and segments a text-based PDF buffer into structured Content Calendar post items.
 */
export async function extractPostsFromPdf(
  buffer: Buffer,
  options?: { targetYearMonth?: string }
): Promise<PdfExtractionResult> {
  const validation = validatePdfBuffer(buffer);
  if (!validation.valid) {
    return {
      success: false,
      totalPages: 0,
      extractedTextLength: 0,
      isScannedOrNoText: false,
      items: [],
      error: validation.error,
      rawText: "",
    };
  }

  try {
    const pageTexts: string[] = [];

    // Use custom page render to track text per page
    const data = await pdf(buffer, {
      pagerender: (pageData: any) => {
        return pageData.getTextContent().then((textContent: any) => {
          let lastY: number | null = null;
          let text = "";
          for (const item of textContent.items) {
            if (lastY === item.transform[5] || lastY === null) {
              text += item.str + " ";
            } else {
              text += "\n" + item.str + " ";
            }
            lastY = item.transform[5];
          }
          pageTexts.push(text);
          return text;
        });
      },
    });

    const fullText = (data.text || pageTexts.join("\n\n")).trim();
    const cleanText = fullText.replace(/\s+/g, " ");

    // Check for scanned / non-text PDF (< 50 printable characters)
    if (cleanText.length < 50) {
      return {
        success: false,
        totalPages: data.numpages || 1,
        extractedTextLength: cleanText.length,
        isScannedOrNoText: true,
        items: [],
        error:
          "تعذر استخراج نصوص كافية من ملف PDF (الملف ممسوح ضوئيًا أو يحتوي على صور فقط دون طبقة نصية). يرجى إدخال البيانات يدويًا أو رفع ملف PDF بنص قابل للقراءة.",
        rawText: fullText,
      };
    }

    // Heuristic Segmentation:
    // Try page-based segmentation first if pages > 1 and each page looks like a post,
    // OR regex-based post splitting across the full text.
    const items: ExtractedPostItem[] = [];

    // Attempt 1: Pattern match across full text or pages for "Post XX" / "بوست XX"
    const postHeaderRegex = /(?:^|\n|\r)(?:(?:Post|بوست|منشور|تصميم|مخرج|Slide|شريحة)\s*#?\s*0*(\d+)|#\s*0*(\d+))/gi;
    const matches: { index: number; postNum: number; rawMatch: string }[] = [];
    let match: RegExpExecArray | null;

    while ((match = postHeaderRegex.exec(fullText)) !== null) {
      const numStr = match[1] || match[2];
      const postNum = parseInt(numStr, 10);
      if (!isNaN(postNum) && postNum >= 1 && postNum <= 100) {
        matches.push({ index: match.index, postNum, rawMatch: match[0] });
      }
    }

    if (matches.length >= 2) {
      // Split text by detected post markers
      for (let i = 0; i < matches.length; i++) {
        const current = matches[i];
        const nextIndex = i + 1 < matches.length ? matches[i + 1].index : fullText.length;
        const chunk = fullText.substring(current.index, nextIndex).trim();

        const postNumStr = `Post ${String(current.postNum).padStart(2, "0")}`;
        const item = parsePostChunk(chunk, i + 1, postNumStr, 1);
        items.push(item);
      }
    } else if (pageTexts.length > 1) {
      // Attempt 2: Page-by-page extraction (1 page per post is common in decks)
      let postCounter = 1;
      for (let pageIdx = 0; pageIdx < pageTexts.length; pageIdx++) {
        const pageText = pageTexts[pageIdx].trim();
        if (pageText.length < 20) continue; // Skip cover/blank pages

        const postNumStr = `Post ${String(postCounter).padStart(2, "0")}`;
        const item = parsePostChunk(pageText, postCounter, postNumStr, pageIdx + 1);
        items.push(item);
        postCounter++;
      }
    } else {
      // Attempt 3: Single page with multiple lines or paragraphs
      const paragraphs: string[] = fullText
        .split(/\n\s*\n/)
        .map((p: string) => p.trim())
        .filter((p: string) => p.length > 20);

      if (paragraphs.length > 1) {
        paragraphs.forEach((p: string, idx: number) => {
          const postNumStr = `Post ${String(idx + 1).padStart(2, "0")}`;
          items.push(parsePostChunk(p, idx + 1, postNumStr, 1));
        });
      } else {
        // Just 1 post item extracted from the single document
        items.push(parsePostChunk(fullText, 1, "Post 01", 1));
      }
    }

    // Default dates if specified in options
    if (options?.targetYearMonth && /^\d{4}-\d{2}$/.test(options.targetYearMonth)) {
      items.forEach((item, idx) => {
        if (!item.publish_date) {
          const day = Math.min(idx * 2 + 1, 28);
          item.publish_date = `${options.targetYearMonth}-${String(day).padStart(2, "0")}`;
        }
        if (!item.design_due_date && item.publish_date) {
          // Design due date is 2 days before publish date
          const pDate = new Date(item.publish_date);
          pDate.setDate(pDate.getDate() - 2);
          item.design_due_date = pDate.toISOString().split("T")[0];
        }
      });
    }

    return {
      success: true,
      totalPages: data.numpages || 1,
      extractedTextLength: fullText.length,
      isScannedOrNoText: false,
      items,
      rawText: fullText,
    };
  } catch (err: any) {
    return {
      success: false,
      totalPages: 0,
      extractedTextLength: 0,
      isScannedOrNoText: false,
      items: [],
      error: `فشل استخراج محتوى PDF: ${err.message || err}`,
      rawText: "",
    };
  }
}

/**
 * Parses individual chunk text into post fields.
 */
function parsePostChunk(
  chunk: string,
  order: number,
  defaultPostNumber: string,
  sourcePage: number
): ExtractedPostItem {
  const lines = chunk
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let title = "";
  let caption = "";
  let brief = "";
  let platform = "Instagram";
  let contentFormat = "Static";
  let publishDate: string | null = null;
  let designDueDate: string | null = null;
  let confidence = 0.85;
  let warning: string | null = null;

  // Platform detection
  for (const p of PLATFORM_PATTERNS) {
    if (p.regex.test(chunk)) {
      platform = p.name;
      break;
    }
  }

  // Format detection
  for (const f of FORMAT_PATTERNS) {
    if (f.regex.test(chunk)) {
      contentFormat = f.name;
      break;
    }
  }

  // Date detection: Look for YYYY-MM-DD or DD/MM/YYYY
  const dateMatch = chunk.match(/\b(20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]20\d{2})\b/);
  if (dateMatch) {
    const rawDate = dateMatch[1].replace(/[./]/g, "-");
    const parts = rawDate.split("-");
    if (parts[0].length === 4) {
      publishDate = `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
    } else if (parts[2].length === 4) {
      publishDate = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
    }
  }

  // Extract explicit sections if tagged
  const captionMatch = chunk.match(/(?:caption|كابشن|النص|المحتوى|copy)\s*[:：]\s*([\s\S]*?)(?=(?:visual|design brief|التصميم|الفكرة|brief|notes|ملاحظات|$))/i);
  if (captionMatch) {
    caption = captionMatch[1].trim();
  }

  const briefMatch = chunk.match(/(?:visual|design brief|التصميم|الفكرة|brief|التوجيه الفني)\s*[:：]\s*([\s\S]*?)(?=(?:caption|كابشن|النص|notes|ملاحظات|$))/i);
  if (briefMatch) {
    brief = briefMatch[1].trim();
  }

  // Title extraction: first line after header or first non-empty line
  if (lines.length > 0) {
    let candidate = lines[0];
    if (/(?:post|بوست|منشور|slide)\s*#?\d+/i.test(candidate) && lines.length > 1) {
      candidate = lines[1];
    }
    // Clean colon prefixes
    title = candidate.replace(/^(?:title|العنوان|الموضوع)\s*[:：]\s*/i, "").trim();
    if (title.length > 80) {
      title = title.substring(0, 80) + "...";
    }
  }

  if (!title) {
    title = `${defaultPostNumber} — تصميم جديد`;
    confidence -= 0.15;
    warning = "تم وضع عنوان افتراضي لعدم وضوح العنوان في الملف";
  }

  // If caption or brief are still empty, populate from remaining text
  if (!caption && lines.length > 2) {
    caption = lines.slice(2).join("\n").trim();
  }
  if (!brief && lines.length > 1 && lines[1] !== title) {
    brief = lines[1];
  }

  // References
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls: string[] = [];
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = urlRegex.exec(chunk)) !== null) {
    urls.push(urlMatch[1]);
  }

  const needsManualReview = confidence < 0.7 || !title || (!caption && !brief);

  return {
    post_order: order,
    post_number: defaultPostNumber,
    title,
    caption,
    brief,
    platform,
    content_format: contentFormat,
    publish_date: publishDate,
    design_due_date: designDueDate,
    notes: "",
    reference_urls: urls,
    raw_text: chunk.substring(0, 1000),
    source_page: sourcePage,
    confidence: Number(confidence.toFixed(2)),
    needs_manual_review: needsManualReview,
    warning,
  };
}
