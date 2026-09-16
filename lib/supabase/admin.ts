import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Security guard: Block Vercel Preview from connecting to Production Supabase project
  const isVercelPreview =
    process.env.NEXT_PUBLIC_VERCEL_ENV === "preview" ||
    process.env.VERCEL_ENV === "preview";
  if (isVercelPreview && supabaseUrl?.includes("whzkpuovqllybxlyoikk")) {
    console.warn("[Security] Admin: Preview deployment blocked from connecting to Production Supabase.");
    return null;
  }

  if (!supabaseUrl || !serviceRoleKey || supabaseUrl.includes("your-project-ref")) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
