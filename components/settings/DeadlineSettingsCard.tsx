"use client";

import React, { useState, useEffect } from "react";
import {
  Calendar,
  Clock,
  Shield,
  Save,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Sliders,
  Eye,
  X,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

const WEEKDAYS = [
  { id: 0, label: "الأحد (Sun)" },
  { id: 1, label: "الاثنين (Mon)" },
  { id: 2, label: "الثلاثاء (Tue)" },
  { id: 3, label: "الأربعاء (Wed)" },
  { id: 4, label: "الخميس (Thu)" },
  { id: 5, label: "الجمعة (Fri)" },
  { id: 6, label: "السبت (Sat)" },
];

export function DeadlineSettingsCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form State
  const [staticLead, setStaticLead] = useState(2);
  const [carouselLead, setCarouselLead] = useState(3);
  const [videoLead, setVideoLead] = useState(3);
  const [reviewLead, setReviewLead] = useState(1);
  const [hardExtra, setHardExtra] = useState(1);
  const [workingDays, setWorkingDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [publishTime, setPublishTime] = useState("18:00");
  const [timezone, setTimezone] = useState("Africa/Cairo");

  // Recalculate State
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [recalculateSuccess, setRecalculateSuccess] = useState<string | null>(null);

  const fetchSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workspace/deadline-settings");
      if (res.ok) {
        const data = await res.json();
        const s = data.settings;
        if (s) {
          setStaticLead(s.static_lead_days ?? 2);
          setCarouselLead(s.carousel_lead_days ?? 3);
          setVideoLead(s.video_lead_days ?? 3);
          setReviewLead(s.review_lead_days ?? 1);
          setHardExtra(s.hard_client_extra_days ?? 1);
          if (Array.isArray(s.working_days)) {
            setWorkingDays(s.working_days);
          }
          if (s.default_publish_time) {
            setPublishTime(s.default_publish_time.slice(0, 5));
          }
          if (s.timezone) {
            setTimezone(s.timezone);
          }
        }
      } else {
        throw new Error("تعذر تحميل إعدادات المواعيد.");
      }
    } catch (err: any) {
      setError(err.message || "حدث خطأ أثناء تحميل الإعدادات.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch("/api/workspace/deadline-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          static_lead_days: staticLead,
          carousel_lead_days: carouselLead,
          video_lead_days: videoLead,
          review_lead_days: reviewLead,
          hard_client_extra_days: hardExtra,
          working_days: workingDays,
          default_publish_time: publishTime + ":00",
          timezone,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "فشل حفظ الإعدادات.");
      }

      setSuccessMsg("تم حفظ وتحديث قواعد مواعيد التسليم بنجاح (ستطبق تلقائياً على المهام الجديدة).");
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err.message || "حدث خطأ أثناء الحفظ.");
    } finally {
      setSaving(false);
    }
  };

  const handleOpenPreview = async () => {
    setRecalculating(true);
    setError(null);
    setRecalculateSuccess(null);
    try {
      const res = await fetch("/api/workspace/deadline-settings/recalculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: false }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "فشل حساب معاينة التعديلات.");
      }

      setPreviewData(data);
      setShowPreviewModal(true);
    } catch (err: any) {
      setError(err.message || "حدث خطأ أثناء معاينة التعديلات.");
    } finally {
      setRecalculating(false);
    }
  };

  const handleConfirmRecalculate = async () => {
    setRecalculating(true);
    setError(null);
    try {
      const res = await fetch("/api/workspace/deadline-settings/recalculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "فشل تطبيق إعادة الاحتساب.");
      }

      setRecalculateSuccess(data.message);
      setTimeout(() => {
        setShowPreviewModal(false);
        setRecalculateSuccess(null);
        setPreviewData(null);
      }, 2000);
    } catch (err: any) {
      alert("خطأ أثناء التطبيق: " + err.message);
    } finally {
      setRecalculating(false);
    }
  };

  const toggleWorkingDay = (dayId: number) => {
    if (workingDays.includes(dayId)) {
      if (workingDays.length <= 1) return; // Must have at least 1 day
      setWorkingDays(workingDays.filter((d) => d !== dayId));
    } else {
      setWorkingDays([...workingDays, dayId].sort((a, b) => a - b));
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200/90 bg-surface shadow-xs p-6 space-y-6 text-right" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Sliders className="w-5 h-5 text-sky-600" />
            إعدادات وقواعد المواعيد الذكية (Smart Deadlines Engine)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            تحديد مهل التسليم والمراجعة حسب نوع المحتوى وأيام العمل الرسمية (قابلة للتعديل للمالك فقط).
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenPreview}
          disabled={recalculating}
          className="px-4 py-2 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 font-semibold text-xs flex items-center gap-1.5 transition-all self-start sm:self-auto shadow-xs"
        >
          <Eye className="w-4 h-4 text-purple-600" />
          <span>معاينة إعادة الاحتساب للمهام المعلقة</span>
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Lead Days Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div className="space-y-1.5 p-4 rounded-xl bg-slate-50/50 border border-slate-200">
            <label className="text-xs font-semibold text-slate-800 block">مهلة التصميم الثابت (Static):</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={14}
                value={staticLead}
                onChange={(e) => setStaticLead(parseInt(e.target.value, 10) || 1)}
                className="w-20 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-800 font-mono text-xs text-center focus:outline-sky-500"
              />
              <span className="text-xs text-slate-500">أيام عمل قبل النشر</span>
            </div>
            <p className="text-[10px] text-slate-400">الافتراضي: يومان عمل</p>
          </div>

          <div className="space-y-1.5 p-4 rounded-xl bg-slate-50/50 border border-slate-200">
            <label className="text-xs font-semibold text-slate-800 block">مهلة الكاروسيل (Carousel):</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={14}
                value={carouselLead}
                onChange={(e) => setCarouselLead(parseInt(e.target.value, 10) || 1)}
                className="w-20 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-800 font-mono text-xs text-center focus:outline-sky-500"
              />
              <span className="text-xs text-slate-500">أيام عمل قبل النشر</span>
            </div>
            <p className="text-[10px] text-slate-400">الافتراضي: 3 أيام عمل</p>
          </div>

          <div className="space-y-1.5 p-4 rounded-xl bg-slate-50/50 border border-slate-200">
            <label className="text-xs font-semibold text-slate-800 block">مهلة الفيديو والريلز (Reel / Video):</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={14}
                value={videoLead}
                onChange={(e) => setVideoLead(parseInt(e.target.value, 10) || 1)}
                className="w-20 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-800 font-mono text-xs text-center focus:outline-sky-500"
              />
              <span className="text-xs text-slate-500">أيام عمل قبل النشر</span>
            </div>
            <p className="text-[10px] text-slate-400">الافتراضي: 3 أيام عمل</p>
          </div>

          <div className="space-y-1.5 p-4 rounded-xl bg-slate-50/50 border border-slate-200">
            <label className="text-xs font-semibold text-slate-800 block">مهلة المراجعة الفنية (Review):</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={7}
                value={reviewLead}
                onChange={(e) => setReviewLead(parseInt(e.target.value, 10) || 1)}
                className="w-20 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-800 font-mono text-xs text-center focus:outline-sky-500"
              />
              <span className="text-xs text-slate-500">يوم عمل قبل النشر</span>
            </div>
            <p className="text-[10px] text-slate-400">الافتراضي: يوم عمل واحد</p>
          </div>

          <div className="space-y-1.5 p-4 rounded-xl bg-slate-50/50 border border-slate-200">
            <label className="text-xs font-semibold text-slate-800 block">أيام إضافية للعملاء الصعبين (Hard):</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={7}
                value={hardExtra}
                onChange={(e) => setHardExtra(parseInt(e.target.value, 10) || 0)}
                className="w-20 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-800 font-mono text-xs text-center focus:outline-sky-500"
              />
              <span className="text-xs text-slate-500">أيام إضافية</span>
            </div>
            <p className="text-[10px] text-slate-400">تضاف تلقائياً لحسابات Hard Difficulty</p>
          </div>

          <div className="space-y-1.5 p-4 rounded-xl bg-slate-50/50 border border-slate-200">
            <label className="text-xs font-semibold text-slate-800 block">وقت النشر الافتراضي:</label>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={publishTime}
                onChange={(e) => setPublishTime(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-800 font-mono text-xs text-center focus:outline-sky-500"
              />
              <span className="text-xs text-slate-500 font-mono">({timezone})</span>
            </div>
            <p className="text-[10px] text-slate-400">الساعة 18:00 بتوقيت القاهرة</p>
          </div>
        </div>

        {/* Working Days Selector */}
        <div className="space-y-2 p-4 rounded-xl bg-slate-50/50 border border-slate-200">
          <label className="text-xs font-semibold text-slate-800 block">أيام العمل الرسمية المعتمدة في الايجنسي:</label>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((w) => {
              const active = workingDays.includes(w.id);
              return (
                <button
                  type="button"
                  key={w.id}
                  onClick={() => toggleWorkingDay(w.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all",
                    active
                      ? "bg-sky-50 border-sky-300 text-sky-800"
                      : "bg-white border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                  )}
                >
                  {w.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-400">
            الأيام غير المحددة تعامل كعطلات رسمية ويتم تخطيها تلقائياً عند احتساب مواعيد التسليم.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2">
          <div className="text-[11px] text-slate-500">
            * تعديل القواعد يؤثر على المهام الجديدة فقط ولا يغير المهام الحالية تلقائياً.
          </div>

          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs flex items-center gap-2 transition-all shadow-xs disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? "جاري الحفظ..." : "حفظ إعدادات المواعيد"}</span>
          </button>
        </div>
      </form>

      {/* Recalculate Preview Modal */}
      {showPreviewModal && previewData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white border border-slate-200 shadow-2xl flex flex-col text-right" dir="rtl">
            <div className="flex items-center justify-between border-b border-slate-100 p-5 bg-slate-50">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-600" />
                معاينة إعادة احتساب المواعيد للمهام المعلقة
              </h3>
              <button
                onClick={() => setShowPreviewModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {recalculateSuccess && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800">
                  {recalculateSuccess}
                </div>
              )}

              {/* Active Protection Guard Warning */}
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 space-y-1">
                <p className="font-bold flex items-center gap-1.5 text-amber-900">
                  <Shield className="w-4 h-4 text-amber-600" />
                  حماية المهام النشطة (Active Task Protection Guard):
                </p>
                <p className="text-amber-700 leading-relaxed text-[11px]">
                  يوجد <strong>{previewData.summary.activeProtectedCount}</strong> مهمة جارية أو قيد المراجعة. هذه المهام محمية بالكامل ولن يتم المساس بمواعيدها تجنباً لإرباك المصممين.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 text-[11px] block">المهام المعلقة المرشحة للتحديث:</span>
                  <strong className="text-slate-900 text-lg font-bold">{previewData.summary.candidateTasksCount} مهمة</strong>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 text-[11px] block">المهام النشطة المحمية:</span>
                  <strong className="text-amber-700 text-lg font-bold">{previewData.summary.activeProtectedCount} مهمة</strong>
                </div>
              </div>

              {/* Changes Preview Table */}
              <div className="space-y-2">
                <h4 className="font-bold text-slate-900 text-xs">عينة التغييرات المقترحة:</h4>
                <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                  {previewData.previewChanges.map((item: any) => (
                    <div key={item.taskId} className="p-3 flex items-center justify-between text-[11px] hover:bg-slate-50">
                      <div>
                        <span className="font-semibold text-slate-900">{item.title}</span>
                        <span className="text-slate-400 block text-[10px]">تاريخ النشر: {item.publishDate}</span>
                      </div>
                      <div className="text-left font-mono">
                        <span className="text-rose-600 line-through mr-2">{item.oldDesignDate}</span>
                        <span className="text-emerald-700 font-bold">← {item.newDesignDate}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 p-5 bg-slate-50">
              <button
                type="button"
                onClick={() => setShowPreviewModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 text-xs font-semibold"
              >
                إلغاء
              </button>

              <button
                type="button"
                onClick={handleConfirmRecalculate}
                disabled={recalculating || previewData.summary.candidateTasksCount === 0}
                className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs transition-all shadow-xs disabled:opacity-40"
              >
                {recalculating ? "جاري التطبيق..." : "تأكيد وتطبيق إعادة الاحتساب"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
