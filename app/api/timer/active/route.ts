import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const supabase = createAdminClient();
  if (!supabase) {
    return NextResponse.json({ timer: null, message: "Database unconfigured" });
  }

  const { searchParams } = new URL(req.url);
  let personId = searchParams.get("personId");

  // If no personId provided, fetch the first roster member (e.g. Sarah or Emad) for demonstration
  if (!personId) {
    const { data: sarah } = await supabase
      .from("roster_people")
      .select("id")
      .eq("display_name", "سارة")
      .maybeSingle();

    personId = sarah?.id || null;
  }

  if (!personId) {
    return NextResponse.json({ timer: null });
  }

  const { data: timer, error } = await supabase
    .from("time_entries")
    .select(`
      *,
      task:tasks(
        id,
        title,
        deliverable_number,
        campaign:campaigns(
          title,
          client:clients(name)
        )
      )
    `)
    .eq("roster_person_id", personId)
    .is("ended_at", null)
    .eq("is_voided", false)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ timer });
}
