"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  UserCheck,
  CheckSquare,
  Building2,
  Layers,
  Clock,
  Users,
  BarChart3,
  Settings,
  Activity,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "نظرة عامة", icon: LayoutDashboard },
  { href: "/my-work", label: "شغلي", icon: UserCheck },
  { href: "/tasks", label: "التاسكات", icon: CheckSquare },
  { href: "/clients", label: "العملاء", icon: Building2 },
  { href: "/campaigns", label: "الكامبينز", icon: Layers },
  { href: "/time-ledger", label: "سجل الشغل", icon: Clock },
  { href: "/team", label: "التيم", icon: Users },
  { href: "/operations", label: "مركز العمليات", icon: Activity },
  { href: "/reports", label: "التقارير الشهرية", icon: BarChart3 },
  { href: "/settings", label: "الإعدادات", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile Toggle Button */}
      <div className="lg:hidden fixed top-3 right-3 z-50">
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 rounded-lg bg-surface border border-slate-200 shadow-sm text-slate-700 hover:bg-slate-50 transition-colors"
          aria-label="القائمة الرئيسية"
        >
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Backdrop for Mobile */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 z-40 lg:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={cn(
          "fixed top-0 bottom-0 right-0 z-40 w-64 bg-surface border-l border-slate-200/80 flex flex-col transition-transform duration-300 ease-in-out lg:translate-x-0 no-print",
          mobileOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Brand Header */}
        <div className="h-16 flex items-center px-6 border-b border-slate-100 gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-600 to-teal-500 flex items-center justify-center text-white font-bold text-lg shadow-sm">
            O
          </div>
          <div>
            <h1 className="font-bold text-base text-slate-900 leading-tight">OMG Creative</h1>
            <p className="text-xs text-slate-500">مساحة عمل الايجنسي</p>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium text-sm transition-all duration-150",
                  isActive
                    ? "bg-sky-50 text-sky-700 font-semibold shadow-xs"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                )}
              >
                <Icon
                  className={cn(
                    "w-5 h-5 transition-colors",
                    isActive ? "text-sky-600" : "text-slate-400 group-hover:text-slate-600"
                  )}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Agency Info Footer */}
        <div className="p-4 border-t border-slate-100 text-xs text-slate-400 bg-slate-50/50">
          <div className="flex items-center justify-between">
            <span>توقيت الايجنسي:</span>
            <span className="font-semibold text-slate-600">Africa/Cairo</span>
          </div>
        </div>
      </aside>
    </>
  );
}
