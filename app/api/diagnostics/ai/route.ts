import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGeminiModel, testGeminiConnection, getGeminiClient } from "@/lib/ai/gemini-client";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    let isAuthorized = false;

    // Check worker secret header
    const providedSecret = req.headers.get("x-worker-secret");
    const workerSecret = (process.env.AI_WORKER_SECRET || "").trim();
    const admin = createAdminClient();

    if (providedSecret) {
      if (workerSecret && providedSecret === workerSecret) {
        isAuthorized = true;
      } else if (admin) {
        const { data: isValid } = await admin.rpc("verify_ai_worker_secret", {
          p_secret: providedSecret,
        });
        if (isValid === true) {
          isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      const serverClient = await createServerSupabaseClient().catch(() => null);
      if (serverClient) {
        const { data: authData } = await serverClient.auth.getUser();
        if (authData?.user && admin) {
          const { data: membership } = await admin
            .from("workspace_memberships")
            .select("role")
            .eq("user_id", authData.user.id)
            .eq("is_active", true)
            .maybeSingle();

          if (membership?.role === "owner") {
            isAuthorized = true;
          }
        }
      }
    }

    if (!isAuthorized) {
      return NextResponse.json(
        { error: "صلاحية غير كافية: الفحص التشخيصي مسموح فقط للمدير العام أو هيدر الـ Worker." },
        { status: 403 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
    const model = getGeminiModel();
    let testResults: any[] = [];
    if (admin || isAuthorized) {
      const client = getGeminiClient();
      if (client) {
        const testCandidates = [
          "gemini-2.5-flash",
          "models/gemini-2.5-flash",
        ];
        for (const m of testCandidates) {
          try {
            const res = await client.models.generateContent({
              model: m,
              contents: "Hello",
            });
            testResults.push({ model: m, ok: true, text: res.text?.substring(0, 50) });
          } catch (err: any) {
            testResults.push({ model: m, ok: false, status: err?.status, message: err?.message });
          }
        }
      }
    }

    return NextResponse.json({
      geminiKeyConfigured: Boolean(apiKey),
      resolvedModel: model,
      testResults,
      runtime: "nodejs",
      vercelEnvironment: process.env.VERCEL_ENV || "production",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Diagnostic check failed", message: err.message },
      { status: 500 }
    );
  }
}
