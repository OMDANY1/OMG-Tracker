import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Security guard: Strictly block any non-production environment (Preview, Local, Test)
  // from connecting to Production Supabase project (whzkpuovqllybxlyoikk).
  const isProdEnv = process.env.VERCEL_ENV === "production" && process.env.NEXT_PUBLIC_SITE_URL?.includes("omg-creative-workspace.vercel.app");
  if (supabaseUrl?.includes("whzkpuovqllybxlyoikk") && !isProdEnv) {
    console.warn("[Security] Admin: Non-production environment blocked from connecting to Production Supabase.");
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
