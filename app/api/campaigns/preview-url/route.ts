import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const storagePath = searchParams.get("storagePath");

    if (!storagePath) {
      return NextResponse.json({ error: "مسار التخزين (storagePath) مطلوب." }, { status: 400 });
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "تعذر الاتصال بقاعدة البيانات." }, { status: 500 });
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
