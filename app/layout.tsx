import type { Metadata } from "next";
import "./globals.css";
import { LayoutShell } from "@/components/navigation/LayoutShell";

export const metadata: Metadata = {
  title: "OMG Creative Workspace | مساحة عمل الوكالة",
  description: "نظام إدارة التصاميم والعملاء وتتبع الوقت لفرق العمل الإبداعية",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen bg-background text-slate-900 flex flex-col font-cairo antialiased selection:bg-sky-100 selection:text-sky-900">
        <LayoutShell>{children}</LayoutShell>
      </body>
    </html>
  );
}
