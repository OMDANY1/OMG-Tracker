"use client";

import React, { useState, useEffect } from "react";
import { DatabaseStatusBadge } from "@/components/common/DatabaseStatusBadge";
import { RoleSwitcher } from "@/components/common/RoleSwitcher";
import { Clock } from "lucide-react";
import { formatCairoTime } from "@/lib/timezone";
import { UserMenu } from "@/components/navigation/UserMenu";
import { NotificationBell } from "@/components/navigation/NotificationBell";

export function Navbar() {
  const [cairoTime, setCairoTime] = useState<string>("");

  useEffect(() => {
    const update = () => {
      setCairoTime(formatCairoTime(new Date()));
    };
    update();
    const interval = setInterval(update, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="h-16 bg-surface/80 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-30 px-4 lg:px-8 flex items-center justify-between no-print">
      {/* Left items: Diagnostics & Role */}
      <div className="flex items-center gap-3">
        <DatabaseStatusBadge />
        <RoleSwitcher />
      </div>

      {/* Right items: Timezone, Clock & User */}
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <div className="hidden sm:flex items-center gap-1.5 bg-slate-100/80 px-2.5 py-1 rounded-lg border border-slate-200/60 font-medium">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span>توقيت القاهرة:</span>
          <span className="font-bold text-slate-700">{cairoTime || "11:00"}</span>
        </div>
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}
