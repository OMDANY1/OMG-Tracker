import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Security guard: Strictly block any non-production environment (Preview, Local, Test)
  // from connecting to Production Supabase project (whzkpuovqllybxlyoikk).
  const isVercelPreview =
    process.env.VERCEL_ENV === "preview" ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";

  const isProdEnv =
    (process.env.VERCEL_ENV === "production" ||
      process.env.NEXT_PUBLIC_VERCEL_ENV === "production" ||
      process.env.VERCEL_PROJECT_PRODUCTION_URL === "omg-creative-workspace.vercel.app" ||
      process.env.NEXT_PUBLIC_SITE_URL?.includes("omg-creative-workspace.vercel.app")) &&
    !isVercelPreview;

  if (supabaseUrl?.includes("whzkpuovqllybxlyoikk") && !isProdEnv) {
    console.warn("[Security] Server: Non-production environment blocked from connecting to Production Supabase.");
    return null;
  }

  if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes("your-project-ref")) {
    return null;
  }

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Handled for server components
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...options, maxAge: 0 });
        } catch {
          // Handled for server components
        }
      },
    },
  });
}
