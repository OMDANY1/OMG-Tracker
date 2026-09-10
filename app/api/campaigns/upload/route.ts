import { NextRequest, NextResponse } from "next/server";
import { requireOwner, validateSameOrigin } from "@/lib/auth/server-auth";
import { uploadCalendarFileOnly as uploadContentCalendar } from "@/lib/services/content-calendars";
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

    const authRes = await requireOwner(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership } = authRes.data;

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const clientId = formData.get("clientId") as string | null;
    const monthKey = formData.get("monthKey") as string | null;

    if (!file || !clientId || !monthKey) {
      return NextResponse.json(
        { error: "الملف والعميل والشهر مطلوبون لإتمام عملية الرفع." },
        { status: 400 }
      );
    }

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

    // 3. Return HTTP 202 Accepted immediately - processing is handled durably by Supabase Cron Worker
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

