import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Security guard: Block Vercel Preview from connecting to Production Supabase project
  const isVercelPreview =
    process.env.NEXT_PUBLIC_VERCEL_ENV === "preview" ||
    process.env.VERCEL_ENV === "preview";
  if (isVercelPreview && supabaseUrl?.includes("whzkpuovqllybxlyoikk")) {
    console.warn("[Security] Client: Preview deployment blocked from connecting to Production Supabase.");
    return null;
  }

  if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes("your-project-ref")) {
    return null;
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
