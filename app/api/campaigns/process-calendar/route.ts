import { NextRequest, NextResponse } from "next/server";
import { processCalendarCampaign } from "@/lib/services/content-calendars";
import { isGeminiConfigured, classifyGeminiError, getGeminiModel } from "@/lib/ai/gemini-client";
import {
  requireWorkspaceMembership,
  validateSameOrigin,
  isFullAdminRole,
  hasGranularPermission,
} from "@/lib/auth/server-auth";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const authRes = await requireWorkspaceMembership(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership } = authRes.data;

    if (
      !isFullAdminRole(membership.role) &&
      membership.role !== "manager" &&
      !hasGranularPermission(membership, "create_campaigns")
    ) {
      return NextResponse.json(
        { error: "صلاحية غير كافية: الفحص التشخيصي مسموح فقط للمدير العام أو الشريك." },
        { status: 403 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
    const model = getGeminiModel();

    return NextResponse.json({
      geminiKeyConfigured: Boolean(apiKey),
      resolvedModel: model,
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

export async function POST(req: NextRequest) {
  try {
    if (!validateSameOrigin(req)) {
      return NextResponse.json(
        { error: "طلب غير مصرح به (Same-Origin check failed)." },
        { status: 403 }
      );
    }

    const authRes = await requireWorkspaceMembership(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership } = authRes.data;

    if (
      !isFullAdminRole(membership.role) &&
      membership.role !== "manager" &&
      !hasGranularPermission(membership, "create_campaigns")
    ) {
      return NextResponse.json(
        { error: "صلاحية غير كافية: معالجة تقويم المحتوى مسموح فقط للمدير العام أو الشريك." },
        { status: 403 }
      );
    }

    // Dynamic execution-time check
    const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
    if (!apiKey || !isGeminiConfigured()) {
      return NextResponse.json(
        {
          error: "تحليل Gemini غير مهيأ — لم يتم تحليل الملف",
          code: "GEMINI_NOT_CONFIGURED",
          safeMessageAr: "تحليل Gemini غير مهيأ — لم يتم تحليل الملف",
        },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { campaignId, forceRefresh, forceNewAnalysis } = body;

    if (!campaignId) {
      return NextResponse.json(
        { error: "معرف الكامبين (campaignId) مطلوب لبدء المعالجة." },
        { status: 400 }
      );
    }

    const result = await processCalendarCampaign({
      workspaceId: membership.workspaceId,
      campaignId,
      forceRefresh: Boolean(forceRefresh || forceNewAnalysis),
    });

    return NextResponse.json({
      success: true,
      campaignId: result.campaign.id,
      campaign: result.campaign,
      itemsCount: result.items.length,
      detectedPostCount: result.reconciled.detected_post_count,
      declaredPostCount: result.reconciled.declared_post_count,
      confidence: result.reconciled.overall_confidence,
      items: result.items,
      warnings: result.reconciled.warnings,
      message: `تمت معالجة التقويم بنجاح واستخراج ${result.reconciled.detected_post_count} بوست بدقة ${(Number(result.reconciled.overall_confidence || 0.95) * 100).toFixed(0)}%!`,
    });
  } catch (err: any) {
    const status = err.status || 500;
    const code = err.code || "INTERNAL_ERROR";
    const classification = classifyGeminiError(err.message || String(err), status);

    return NextResponse.json(
      {
        error: err.message || classification.safeMessageAr,
        code: code !== "INTERNAL_ERROR" ? code : classification.category,
        safeMessageAr: classification.safeMessageAr,
      },
      { status: status >= 400 && status < 600 ? status : 500 }
    );
  }
}
