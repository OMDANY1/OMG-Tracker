import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#F8FAFC",
        surface: "#FFFFFF",
        primary: {
          50: "#F0F9FF",
          100: "#E0F2FE",
          500: "#0284C7",
          600: "#0369A1",
          700: "#075985",
          800: "#0C4A6E",
          900: "#0F172A",
        },
        tealAccent: {
          50: "#F0FDFA",
          500: "#0D9488",
          600: "#0F766E",
        },
        status: {
          backlog: "#64748B",
          ready: "#3B82F6",
          in_progress: "#F59E0B",
          internal_review: "#8B5CF6",
          changes_requested: "#EF4444",
          client_review: "#06B6D4",
          approved: "#10B981",
          delivered: "#059669",
          blocked: "#DC2626",
          cancelled: "#94A3B8",
        }
      },
      fontFamily: {
        cairo: ["Cairo", "system-ui", "sans-serif"],
      }
    },
  },
  plugins: [],
};
export default config;
