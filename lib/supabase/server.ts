import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Security guard: Block Vercel Preview from connecting to Production Supabase project
  const isVercelPreview =
    process.env.NEXT_PUBLIC_VERCEL_ENV === "preview" ||
    process.env.VERCEL_ENV === "preview";
  if (isVercelPreview && supabaseUrl?.includes("whzkpuovqllybxlyoikk")) {
    console.warn("[Security] Server: Preview deployment blocked from connecting to Production Supabase.");
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
