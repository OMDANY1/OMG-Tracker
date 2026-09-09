import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGeminiClient } from "@/lib/ai/gemini-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const serverClient = await createServerSupabaseClient().catch(() => null);
    if (!serverClient) {
      return NextResponse.json({ error: "جلسة المستخدم غير متوفرة." }, { status: 401 });
    }

    const { data: authData, error: authErr } = await serverClient.auth.getUser();
    if (authErr || !authData?.user) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أولاً." }, { status: 401 });
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "تعذر الاتصال بقاعدة البيانات." }, { status: 500 });
    }

    const { data: membership } = await admin
      .from("workspace_memberships")
      .select("role")
      .eq("user_id", authData.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!membership || membership.role !== "owner") {
      return NextResponse.json(
        { error: "صلاحية غير كافية: الفحص التشخيصي مسموح فقط للمدير العام (Owner)." },
        { status: 403 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
    const model = process.env.GEMINI_DOCUMENT_MODEL?.trim() || "gemini-3.8-flash";

    const testResults: Record<string, any> = {};

    if (apiKey) {
      const gemini = getGeminiClient();
      if (gemini) {
        // Find which models support generateContent
        try {
          const listRes = await gemini.models.list();
          const supportedForGenContent: string[] = [];
          for await (const m of listRes) {
            if (m.supportedGenerationMethods?.includes("generateContent")) {
              supportedForGenContent.push(m.name);
            }
          }
          testResults.supportedForGenContent = supportedForGenContent.slice(0, 15);
        } catch (e: any) {
          testResults.listError = e.message;
        }

        // Test with PDF
        const testPdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");
        const candidateModels = [
          "gemini-flash-latest",
          "models/gemini-flash-latest",
          "models/gemini-3.6-flash",
          "gemini-2.5-flash",
          "models/gemini-2.5-pro",
          model
        ];

        for (const m of candidateModels) {
          try {
            const res = await gemini.models.generateContent({
              model: m,
              contents: [
                {
                  inlineData: {
                    data: testPdf.toString("base64"),
                    mimeType: "application/pdf",
                  },
                },
                { text: "Test prompt: reply with OK" },
              ],
            });
            testResults[`pdf_${m}`] = { success: true, text: res.text };
          } catch (e: any) {
            testResults[`pdf_${m}`] = { success: false, status: e.status, message: e.message };
          }
        }
      }
    }

    return NextResponse.json({
      geminiKeyConfigured: Boolean(apiKey),
      resolvedModel: model,
      runtime: "nodejs",
      vercelEnvironment: process.env.VERCEL_ENV || "production",
      testResults,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Diagnostic check failed", message: err.message },
      { status: 500 }
    );
  }
}
