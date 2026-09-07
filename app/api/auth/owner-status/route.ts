import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasExistingOwner, getOrCreateSetupToken } from "@/lib/auth/owner-setup-token";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "غير متاح خارج بيئة التطوير" }, { status: 404 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ hasOwner: false, error: "Database not configured" });
  }

  const hasOwner = await hasExistingOwner(admin);
  if (!hasOwner) {
    // Ensure token is generated on disk
    getOrCreateSetupToken();
  } else {
    // If owner already exists, ensure token file is deleted
    const tokenPath = path.join(process.cwd(), ".owner-setup-token");
    if (fs.existsSync(tokenPath)) {
      try { fs.unlinkSync(tokenPath); } catch {}
    }
  }

  return NextResponse.json({
    hasOwner,
    tokenRequired: !hasOwner,
  });
}
