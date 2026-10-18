import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMembership } from "@/lib/auth/server-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const authRes = await requireWorkspaceMembership(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, admin } = authRes.data;
    const { searchParams } = new URL(req.url);
    const storagePath = searchParams.get("storagePath");

    if (!storagePath) {
      return NextResponse.json({ error: "مسار التخزين (storagePath) مطلوب." }, { status: 400 });
    }

    if (!storagePath.startsWith(`${membership.workspaceId}/`)) {
      return NextResponse.json({ error: "غير مصرح بالوصول إلى هذا الملف." }, { status: 403 });
    }

    const { data, error } = await admin.storage
      .from("content-calendars")
      .createSignedUrl(storagePath, 900); // 15 mins

    if (error || !data?.signedUrl) {
      return NextResponse.json({ error: error?.message || "فشل توليد رابط المعاينة" }, { status: 500 });
    }

    return NextResponse.json({ success: true, url: data.signedUrl });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
