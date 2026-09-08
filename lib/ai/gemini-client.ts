import { GoogleGenAI } from "@google/genai";

let clientInstance: GoogleGenAI | null = null;
let cachedKey: string | null = null;

/**
 * Returns the Gemini API Key from environment.
 * Strictly prioritizes GEMINI_API_KEY over GOOGLE_API_KEY.
 */
export function getGeminiApiKey(): string | null {
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey && geminiKey.length > 0) {
    return geminiKey;
  }
  // Secondary fallback only if explicitly set and GEMINI_API_KEY is absent
  const googleKey = process.env.GOOGLE_API_KEY?.trim();
  if (googleKey && googleKey.length > 0) {
    return googleKey;
  }
  return null;
}

export function isGeminiConfigured(): boolean {
  return Boolean(getGeminiApiKey());
}

/**
 * Returns the Gemini document analysis model.
 * Defaults to 'gemini-2.0-flash' (verified stable multimodal Flash model).
 */
export function getGeminiModel(): string {
  const envModel = process.env.GEMINI_DOCUMENT_MODEL?.trim();
  if (envModel && envModel.length > 0) {
    return envModel;
  }
  return "gemini-2.0-flash";
}

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return null;
  }

  if (!clientInstance || cachedKey !== apiKey) {
    clientInstance = new GoogleGenAI({ apiKey });
    cachedKey = apiKey;
  }

  return clientInstance;
}

export type GeminiErrorCategory =
  | "INVALID_KEY"
  | "PERMISSION_DENIED"
  | "QUOTA_EXCEEDED"
  | "BILLING_REQUIRED"
  | "MODEL_NOT_FOUND"
  | "NETWORK_ERROR"
  | "UNKNOWN_ERROR";

export function classifyGeminiError(errMsg: string, status?: number): {
  category: GeminiErrorCategory;
  safeMessageAr: string;
} {
  const msg = (errMsg || "").toLowerCase();

  if (status === 401 || msg.includes("api key not valid") || msg.includes("invalid api key") || msg.includes("api_key_invalid")) {
    return {
      category: "INVALID_KEY",
      safeMessageAr: "مفتاح Gemini API غير صالح (Invalid API Key). يُرجى التحقق من صحة المفتاح في Vercel.",
    };
  }

  if (status === 403 || msg.includes("permission denied") || msg.includes("access not configured")) {
    return {
      category: "PERMISSION_DENIED",
      safeMessageAr: "تم رفض الصلاحية من Google (Permission Denied). تأكد من تفعيل Generative Language API للمشروع.",
    };
  }

  if (status === 429 || msg.includes("quota") || msg.includes("resource_exhausted") || msg.includes("rate limit")) {
    return {
      category: "QUOTA_EXCEEDED",
      safeMessageAr: "تم تجاوز حد الاستخدام المسموح (Quota Exceeded). يُرجى الانتظار قليلاً أو زيادة سعة الحساب.",
    };
  }

  if (msg.includes("billing") || msg.includes("billable")) {
    return {
      category: "BILLING_REQUIRED",
      safeMessageAr: "يتطلب حساب Google تفعيل الفوترة (Billing Required) لاستخدام هذا النموذج.",
    };
  }

  if (status === 404 || msg.includes("not found") || msg.includes("is not supported") || msg.includes("unknown model")) {
    return {
      category: "MODEL_NOT_FOUND",
      safeMessageAr: "النموذج المحدد غير موجود أو غير مدعوم (Model Not Found).",
    };
  }

  return {
    category: "UNKNOWN_ERROR",
    safeMessageAr: `خطأ في معالجة الذكاء الاصطناعي: ${errMsg}`,
  };
}

export async function testGeminiConnection(): Promise<{
  ok: boolean;
  model: string;
  category?: GeminiErrorCategory;
  error?: string;
  safeMessageAr?: string;
}> {
  const client = getGeminiClient();
  const model = getGeminiModel();

  if (!client) {
    return {
      ok: false,
      model,
      category: "INVALID_KEY",
      error: "GEMINI_API_KEY is not configured.",
      safeMessageAr: "تحليل Gemini غير مهيأ — لم يتم العثور على GEMINI_API_KEY.",
    };
  }

  try {
    const response = await client.models.generateContent({
      model,
      contents: "ping",
    });
    return {
      ok: true,
      model,
    };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    const classification = classifyGeminiError(errMsg, err?.status);
    return {
      ok: false,
      model,
      category: classification.category,
      error: errMsg,
      safeMessageAr: classification.safeMessageAr,
    };
  }
}
