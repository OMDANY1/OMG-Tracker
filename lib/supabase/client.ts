import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Security guard: Strictly block any non-production environment (Preview, Local, Test)
  // from connecting to Production Supabase project (whzkpuovqllybxlyoikk).
  const isVercelPreview =
    process.env.NEXT_PUBLIC_VERCEL_ENV === "preview" ||
    process.env.VERCEL_ENV === "preview";
  const isProdHost = typeof window !== "undefined" && window.location.hostname === "omg-creative-workspace.vercel.app";
  const isProdEnv =
    (process.env.NEXT_PUBLIC_VERCEL_ENV === "production" ||
      process.env.VERCEL_ENV === "production" ||
      process.env.VERCEL_PROJECT_PRODUCTION_URL === "omg-creative-workspace.vercel.app" ||
      isProdHost) &&
    !isVercelPreview;

  if (supabaseUrl?.includes("whzkpuovqllybxlyoikk") && !isProdEnv) {
    console.warn("[Security] Client: Non-production environment blocked from connecting to Production Supabase.");
    return null;
  }

  if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes("your-project-ref")) {
    return null;
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
