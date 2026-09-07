"use client";

import React, { useState, useEffect } from "react";
import { Database, AlertTriangle, CheckCircle2, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function DatabaseStatusBadge() {
  const [status, setStatus] = useState<"loading" | "connected" | "unconfigured" | "error">("loading");
  const [details, setDetails] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);

  const checkStatus = async () => {
    setStatus("loading");
    try {
      const res = await fetch("/api/diagnostics");
      const data = await res.json();
      setStatus(data.status);
      setDetails(data);
    } catch {
      setStatus("error");
    }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className={cn(
          "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all shadow-xs",
          status === "connected" && "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100",
          status === "unconfigured" && "bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100",
          status === "error" && "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100",
          status === "loading" && "bg-slate-100 text-slate-600 border-slate-200"
        )}
      >
        <span className="relative flex h-2 w-2">
          {status === "connected" && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          )}
          <span
            className={cn(
              "relative inline-flex rounded-full h-2 w-2",
              status === "connected" && "bg-emerald-500",
              status === "unconfigured" && "bg-amber-500",
              status === "error" && "bg-rose-500",
              status === "loading" && "bg-slate-400"
            )}
          ></span>
        </span>
        <Database className="w-3.5 h-3.5" />
        <span>
          {status === "connected" && "Supabase متصل (حي)"}
          {status === "unconfigured" && "Supabase غير مهيأ"}
          {status === "error" && "خطأ في الاتصال"}
          {status === "loading" && "جاري فحص الاتصال..."}
        </span>
      </button>

      {/* Diagnostics Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-surface rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full p-6 text-right overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                <Database className="w-5 h-5 text-sky-600" />
                تشخيص حالة قاعدة البيانات (Supabase)
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-4 text-sm">
              <div
                className={cn(
                  "p-3.5 rounded-xl border flex items-start gap-3",
                  status === "connected" ? "bg-emerald-50/70 border-emerald-200 text-emerald-900" : "bg-amber-50/70 border-amber-200 text-amber-900"
                )}
              >
                {status === "connected" ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-semibold">{details?.message || "جاري جلب البيانات..."}</div>
                  {status === "connected" && details?.clientCount !== undefined && (
                    <div className="text-xs text-emerald-700 mt-1">
                      تم التحقق من وجود {details.clientCount} عميل و {details.rosterCount} عضو في جدول الفريق.
                    </div>
                  )}
                </div>
              </div>

              {status === "unconfigured" && (
                <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl space-y-2 text-xs text-slate-700">
                  <div className="font-semibold text-slate-900">خطوات الربط بمشروع Supabase المخصص:</div>
                  <ol className="list-decimal list-inside space-y-1.5 leading-relaxed">
                    <li>قم بإنشاء مشروع جديد على Supabase.</li>
                    <li>
                      انسخ المتغيرات إلى ملف <code className="bg-slate-200 px-1 py-0.5 rounded font-mono">.env.local</code>:
                      <div className="font-mono bg-slate-900 text-sky-300 p-2.5 rounded-lg mt-1 text-[11px] overflow-x-auto text-left" dir="ltr">
                        NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co<br />
                        NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-key<br />
                        SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
                      </div>
                    </li>
                    <li>
                      قم بتطبيق ملفات الـ SQL من مجلد <code className="bg-slate-200 px-1 py-0.5 rounded font-mono">supabase/migrations</code> عبر الـ SQL Editor في Supabase.
                    </li>
                  </ol>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <button
                onClick={checkStatus}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", status === "loading" && "animate-spin")} />
                إعادة فحص الاتصال
              </button>
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
