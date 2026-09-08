import { GoogleGenAI } from "@google/genai";

let clientInstance: GoogleGenAI | null = null;
let cachedKey: string | null = null;

export function getGeminiApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

export function isGeminiConfigured(): boolean {
  return Boolean(getGeminiApiKey());
}

export function getGeminiModel(): string {
  return process.env.GEMINI_DOCUMENT_MODEL?.trim() || "gemini-2.5-flash";
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

export async function testGeminiConnection(): Promise<{ ok: boolean; model: string; error?: string }> {
  const client = getGeminiClient();
  const model = getGeminiModel();

  if (!client) {
    return {
      ok: false,
      model,
      error: "GEMINI_API_KEY is not configured in environment.",
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
    return {
      ok: false,
      model,
      error: err?.message || String(err),
    };
  }
}
