"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/navigation/Sidebar";
import { Navbar } from "@/components/navigation/Navbar";
import { ActiveTimerBar } from "@/components/timer/ActiveTimerBar";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";

  if (isLoginPage) {
    return (
      <main className="min-h-screen w-full flex items-center justify-center bg-slate-50">
        {children}
      </main>
    );
  }

  return (
    <>
      <Sidebar />
      <div className="flex-1 flex flex-col lg:mr-64 transition-all">
        <Navbar />
        <ActiveTimerBar />
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </>
  );
}
