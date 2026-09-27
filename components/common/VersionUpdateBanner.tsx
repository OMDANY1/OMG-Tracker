"use client";

import React, { useEffect, useState } from "react";
import { RefreshCw, X, Sparkles } from "lucide-react";

export function VersionUpdateBanner() {
  const [initialVersion, setInitialVersion] = useState<string | null>(null);
  const [hasNewVersion, setHasNewVersion] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    let mounted = true;

    const checkVersion = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const currentVer = data.version;

        if (!currentVer) return;

        if (!initialVersion) {
          if (mounted) setInitialVersion(currentVer);
        } else if (initialVersion !== currentVer) {
          if (mounted) setHasNewVersion(true);
        }
      } catch {
        // Silently ignore network check errors
      }
    };

    // Initial check
    checkVersion();

    // Check periodically every 2.5 minutes
    const interval = setInterval(checkVersion, 150000);

    // Also check on window focus
    const handleFocus = () => {
      checkVersion();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      mounted = false;
      clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [initialVersion]);

  const handleApplyUpdate = () => {
    setIsUpdating(true);
    // Reload safely
    window.location.reload();
  };

  if (!hasNewVersion || isDismissed) return null;

  return (
    <aside 
      aria-label="تنبيه تحديث المنظومة"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-md z-50 bg-slate-900/95 backdrop-blur-md text-white px-4 py-3.5 rounded-2xl shadow-2xl border border-slate-700/80 flex items-center justify-between gap-3 animate-in slide-in-from-bottom-4 duration-200 text-xs font-sans"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="text-right min-w-0">
          <div className="font-bold text-slate-100 leading-tight">تحديث جديد متوفر للمنظومة</div>
          <div className="text-[11px] text-slate-400 truncate">تم نشر تحسينات جديدة ومطلوب التحديث لتطبيقها</div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleApplyUpdate}
          disabled={isUpdating}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs shadow-xs transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isUpdating ? "animate-spin" : ""}`} />
          <span>{isUpdating ? "جاري التحديث..." : "تحديث الآن"}</span>
        </button>
        <button
          onClick={() => setIsDismissed(true)}
          className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors"
          title="إغلاق التنبيه"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
}
