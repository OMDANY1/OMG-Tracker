import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/server-auth";
import { checkDatabaseConnection } from "@/lib/supabase/diagnostics";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authRes = await requireOwner(req);
  if (!authRes.success) {
    return authRes.errorResponse;
  }

  const result = await checkDatabaseConnection();
  return NextResponse.json(result);
}
