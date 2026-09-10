"use client";

import React, { useState } from "react";
import { CalendarDiffReport } from "@/lib/services/calendar-diff";

interface ApplyRevisionModalProps {
  isOpen: boolean;
  onClose: () => void;
  diffReport: CalendarDiffReport | null;
  campaignId: string;
  onSuccess: () => void;
}

export const ApplyRevisionModal: React.FC<ApplyRevisionModalProps> = ({
  isOpen,
  onClose,
  diffReport,
  campaignId,
  onSuccess,
}) => {
  const [applyMode, setApplyMode] = useState<"new_only" | "sync_pending">("sync_pending");
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applySuccessMsg, setApplySuccessMsg] = useState<string | null>(null);

  if (!isOpen || !diffReport) return null;

  const { summary, items } = diffReport;

  const handleApply = async () => {
    setApplying(true);
    setApplyError(null);
    setApplySuccessMsg(null);

    try {
      const res = await fetch("/api/campaigns/apply-revision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          applyMode,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "فشل تطبيق تعديلات التقويم.");
      }

      setApplySuccessMsg(data.message || "تم تطبيق التعديلات بنجاح!");
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err: any) {
      setApplyError(err.message || "حدث خطأ أثناء تطبيق التعديلات.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="relative max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl flex flex-col text-right" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 p-6 bg-zinc-900/50">
          <div>
            <h2 className="text-xl font-bold text-white">اعتماد وتطبيق تعديلات التقويم (Safe Apply)</h2>
            <p className="mt-1 text-sm text-zinc-400">
              مراجعة الفروقات بين النسخ وتطبيق المهام الجديدة والمعدلة بأمان مع حماية المهام النشطة.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {applyError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
              ⚠️ {applyError}
            </div>
          )}

          {applySuccessMsg && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-400">
              ✅ {applySuccessMsg}
            </div>
          )}

          {/* Active Task Protection Alert */}
          {summary.activeTasksAtRiskCount > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-300 flex items-start gap-3">
              <span className="text-xl">🛡️</span>
              <div className="text-sm space-y-1">
                <p className="font-semibold">تنبيه حماية المهام النشطة (Active Task Protection)</p>
                <p className="text-amber-200/80">
                  يوجد {summary.activeTasksAtRiskCount} مهمة بدأ العمل بها بالفعل أو قيد المراجعة. تم تفعيل نظام الحماية ولن يتم استبدالها أو حذفها تلقائيًا لضمان عدم ضياع مجهود المصممين.
                </p>
              </div>
            </div>
          )}

          {/* Summary KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <p className="text-xs text-emerald-400">منشورات جديدة (Added)</p>
              <p className="mt-1 text-2xl font-bold text-emerald-300">{summary.addedCount}</p>
            </div>
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
              <p className="text-xs text-blue-400">منشورات معدلة (Changed)</p>
              <p className="mt-1 text-2xl font-bold text-blue-300">{summary.changedCount}</p>
            </div>
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
              <p className="text-xs text-rose-400">منشورات محذوفة (Removed)</p>
              <p className="mt-1 text-2xl font-bold text-rose-300">{summary.removedCount}</p>
            </div>
            <div className="rounded-xl border border-zinc-700 bg-zinc-800/50 p-4">
              <p className="text-xs text-zinc-400">بدون تغيير (Unchanged)</p>
              <p className="mt-1 text-2xl font-bold text-zinc-300">{summary.unchangedCount}</p>
            </div>
          </div>

          {/* Mode Selector */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-800/30 p-5 space-y-4">
            <h3 className="font-semibold text-white text-sm">حدد طريقة التطبيق المطلوبة:</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label
                className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
                  applyMode === "sync_pending"
                    ? "border-emerald-500/50 bg-emerald-500/10 text-white"
                    : "border-zinc-700 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600"
                }`}
              >
                <input
                  type="radio"
                  name="applyMode"
                  value="sync_pending"
                  checked={applyMode === "sync_pending"}
                  onChange={() => setApplyMode("sync_pending")}
                  className="mt-1 accent-emerald-500"
                />
                <div>
                  <p className="font-medium text-sm text-white">مزامنة المهام المعلقة + إضافة الجديد (مستحسن)</p>
                  <p className="text-xs text-zinc-400 mt-1">
                    ينشئ المهام الجديدة في قائمة الانتظار، ويحدث المهام التي لم يبدأ العمل بها، مع حماية تامة لأي مهمة قيد التنفيذ أو المراجعة.
                  </p>
                </div>
              </label>

              <label
                className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
                  applyMode === "new_only"
                    ? "border-emerald-500/50 bg-emerald-500/10 text-white"
                    : "border-zinc-700 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600"
                }`}
              >
                <input
                  type="radio"
                  name="applyMode"
                  value="new_only"
                  checked={applyMode === "new_only"}
                  onChange={() => setApplyMode("new_only")}
                  className="mt-1 accent-emerald-500"
                />
                <div>
                  <p className="font-medium text-sm text-white">تطبيق العناصر الجديدة فقط (New Only)</p>
                  <p className="text-xs text-zinc-400 mt-1">
                    ينشئ فقط المهام المضافة حديثاً في هذا التقويم، ولا يعدل أي مهمة موجودة مسبقاً سواء كانت معلقة أو نشطة.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Granular Items List */}
          <div className="space-y-3">
            <h3 className="font-semibold text-white text-sm">تفاصيل المنشورات المتأثرة ({items.length}):</h3>
            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-lg border border-zinc-800 bg-zinc-800/40 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        item.status === "added"
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : item.status === "changed"
                          ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                          : item.status === "removed"
                          ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                          : "bg-zinc-700/50 text-zinc-400"
                      }`}
                    >
                      {item.status === "added" ? "جديد" : item.status === "changed" ? "معدل" : item.status === "removed" ? "محذوف" : "ثابت"}
                    </span>
                    <span className="font-medium text-white">{item.postNumber}</span>
                    <span className="text-zinc-400 truncate max-w-xs">{item.title}</span>
                  </div>

                  {item.existingTask && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        item.existingTask.status === "in_progress" || item.existingTask.status === "review"
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                          : "bg-zinc-700 text-zinc-300"
                      }`}
                    >
                      حالة التاسك: {item.existingTask.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-800 p-6 bg-zinc-900/80">
          <button
            onClick={onClose}
            disabled={applying}
            className="px-5 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 text-sm"
          >
            إلغاء العملية
          </button>
          <button
            onClick={handleApply}
            disabled={applying}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 text-sm transition-all shadow-lg shadow-emerald-600/20"
          >
            {applying ? "جاري التطبيق الذري..." : "تأكيد واعتماد التعديلات"}
          </button>
        </div>
      </div>
    </div>
  );
};
