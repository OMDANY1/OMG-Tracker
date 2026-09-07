import { NextResponse } from "next/server";
import { checkDatabaseConnection } from "@/lib/supabase/diagnostics";

export async function GET() {
  const result = await checkDatabaseConnection();
  return NextResponse.json(result);
}
