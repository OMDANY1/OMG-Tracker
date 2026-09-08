/**
 * Helper to determine the canonical site URL for production and development.
 * Strictly avoids localhost in production.
 */
export function getSiteUrl(): string {
  // 1. Explicit environment variable
  if (process.env.NEXT_PUBLIC_SITE_URL && !process.env.NEXT_PUBLIC_SITE_URL.includes("localhost")) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }

  // 2. Vercel deployment URL
  if (process.env.NEXT_PUBLIC_VERCEL_URL) {
    return `https://${process.env.NEXT_PUBLIC_VERCEL_URL.replace(/\/$/, "")}`;
  }

  // 3. Browser origin (client-side)
  if (typeof window !== "undefined" && window.location.origin) {
    if (!window.location.origin.includes("localhost") && !window.location.origin.includes("127.0.0.1")) {
      return window.location.origin;
    }
  }

  // 4. Production fallback
  if (process.env.NODE_ENV === "production") {
    return "https://omg-creative-workspace.vercel.app";
  }

  // 5. Localhost development
  return "http://localhost:3000";
}
