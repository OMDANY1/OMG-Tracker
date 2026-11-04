import { NextRequest, NextResponse } from "next/server";
import {
  requireOwner,
  requireCampaignAccess,
  validateSameOrigin,
} from "@/lib/auth/server-auth";
import {
  uploadCalendarFileOnly as uploadContentCalendar,
  createCalendarSignedUploadUrl,
  finalizeCalendarSignedUpload,
} from "@/lib/services/content-calendars";
import { MAX_CALENDAR_PDF_BYTES } from "@/lib/services/pdf-extractor";
import { AiJobQueue } from "@/lib/services/ai-job-queue";
import { getGeminiModel } from "@/lib/ai/gemini-client";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (!validateSameOrigin(req)) {
      return NextResponse.json(
        { error: "طلب غير مصرح به (Same-Origin check failed)." },
        { status: 403 }
      );
    }

    const contentType = (req.headers.get("content-type") || "").toLowerCase();

    // Direct-to-Storage Signed Upload Flow (bypasses Vercel 4.5MB serverless body limit for PDFs up to 250MB)
    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => ({}));
      const {
        action,
        clientId,
        monthKey,
        fileName,
        fileSize,
        campaignId,
        storagePath,
        clientExtractedPages,
        clientFileSha256,
      } = body;

      if (!clientId || !monthKey) {
        const preAuth = await requireCampaignAccess(req);
        if (!preAuth.success) return preAuth.errorResponse;
        return NextResponse.json(
          { error: "العميل والشهر مطلوبون لإتمام عملية الرفع." },
          { status: 400 }
        );
      }

      const authRes = await requireCampaignAccess(req, clientId);
      if (!authRes.success) {
        return authRes.errorResponse;
      }
      const { membership } = authRes.data;

      if (!/^\d{4}-\d{2}$/.test(monthKey)) {
        return NextResponse.json(
          { error: "تنسيق الشهر غير صالح. يرجى استخدام تنسيق YYYY-MM." },
          { status: 400 }
        );
      }

      if (action === "create_upload_url") {
        if (fileSize && Number(fileSize) > MAX_CALENDAR_PDF_BYTES) {
          return NextResponse.json(
            { error: "حجم الملف يتجاوز الحد الأقصى المسموح به (250 ميجابايت)." },
            { status: 400 }
          );
        }
        const signed = await createCalendarSignedUploadUrl({
          workspaceId: membership.workspaceId,
          clientId,
          monthKey,
          fileName: fileName || "calendar.pdf",
        });
        return NextResponse.json({
          success: true,
          ...signed,
        });
      }

      if (action === "finalize_upload") {
        if (!campaignId || !storagePath) {
          return NextResponse.json(
            { error: "معرف الكامبين ومسار الملف مطلوبان لإتمام التسجيل." },
            { status: 400 }
          );
        }

        const result = await finalizeCalendarSignedUpload({
          workspaceId: membership.workspaceId,
          campaignId,
          clientId,
          monthKey,
          fileName: fileName || "calendar.pdf",
          storagePath,
          uploaderRosterId: membership.rosterPersonId,
          clientExtractedPages: Array.isArray(clientExtractedPages) ? clientExtractedPages : undefined,
          clientFileSha256: typeof clientFileSha256 === "string" ? clientFileSha256 : undefined,
        });

        const job = await AiJobQueue.enqueueJob({
          workspaceId: membership.workspaceId,
          campaignId: result.campaign.id,
          clientId,
          fileSha256: result.fileHash,
          model: getGeminiModel(),
          createdById: membership.rosterPersonId,
        });

        return NextResponse.json(
          {
            success: true,
            status: "queued",
            campaignId: result.campaign.id,
            jobId: job.id,
            campaign: result.campaign,
            previewUrl: result.previewUrl,
            storagePath: result.storagePath,
            message: "تم استلام ملف التقويم بنجاح، وجاري تحليله في الخلفية بواسطة معالج الذكاء الاصطناعي.",
          },
          { status: 202 }
        );
      }

      return NextResponse.json(
        { error: "إجراء رفع غير معروف (Unknown upload action)." },
        { status: 400 }
      );
    }

    // Legacy / Small File Multipart FormData Flow
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const clientId = formData.get("clientId") as string | null;
    const monthKey = formData.get("monthKey") as string | null;

    if (!file || !clientId || !monthKey) {
      // First verify authentication/permission even if form fields are incomplete
      const preAuth = await requireCampaignAccess(req);
      if (!preAuth.success) return preAuth.errorResponse;
      return NextResponse.json(
        { error: "الملف والعميل والشهر مطلوبون لإتمام عملية الرفع." },
        { status: 400 }
      );
    }

    // Verify caller has `create_campaigns` AND `clientId` is within caller's scope (e.g. Strategy Team scope for Arwa)
    const authRes = await requireCampaignAccess(req, clientId);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership } = authRes.data;

    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      return NextResponse.json(
        { error: "تنسيق الشهر غير صالح. يرجى استخدام تنسيق YYYY-MM." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // 1. Fast Storage Upload & Campaign Row Creation (< 1.5s)
    const result = await uploadContentCalendar({
      workspaceId: membership.workspaceId,
      clientId,
      monthKey,
      fileName: file.name,
      fileBuffer: buffer,
      uploaderRosterId: membership.rosterPersonId,
    });

    // 2. Enqueue background AI job in durable queue table
    const job = await AiJobQueue.enqueueJob({
      workspaceId: membership.workspaceId,
      campaignId: result.campaign.id,
      clientId,
      fileSha256: result.fileHash,
      model: getGeminiModel(),
      createdById: membership.rosterPersonId,
    });

    // 3. Return HTTP 202 Accepted immediately - processing is handled durably by Supabase Cron Worker / client trigger
    return NextResponse.json(
      {
        success: true,
        status: "queued",
        campaignId: result.campaign.id,
        jobId: job.id,
        campaign: result.campaign,
        previewUrl: result.previewUrl,
        storagePath: result.storagePath,
        message: "تم استلام ملف التقويم بنجاح، وجاري تحليله في الخلفية بواسطة معالج الذكاء الاصطناعي.",
      },
      { status: 202 }
    );
  } catch (err: any) {
    console.error("Error in /api/campaigns/upload:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
