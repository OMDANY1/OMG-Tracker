"use client";

import React, { useState, useEffect } from "react";
import {
  Play,
  Square,
  Clock,
  AlertCircle,
  FileCheck,
  CheckCircle2,
  Calendar,
  Send,
  Plus,
  X,
} from "lucide-react";
import {
  TASK_STATUS_LABELS,
  TASK_STATUS_COLORS,
  TIME_CATEGORY_LABELS,
  formatDurationSeconds,
} from "@/lib/utils";
import type { TimeCategory } from "@/types/database";

export default function MyWorkPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePersona, setActivePersona] = useState<any>({ displayName: "سارة" });
  const [selectedTaskForTimer, setSelectedTaskForTimer] = useState<any>(null);
  const [timerCategory, setTimerCategory] = useState<TimeCategory>("initial_design");
  const [timerNote, setTimerNote] = useState("");

  // Manual Session Modal State
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualTask, setManualTask] = useState<any>(null);
  const [manualStart, setManualStart] = useState("2026-09-06T11:00");
  const [manualEnd, setManualEnd] = useState("2026-09-06T12:00");
  const [manualCategory, setManualCategory] = useState<TimeCategory>("initial_design");
  const [manualNote, setManualNote] = useState("");

  // Review Submission Modal State
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewTask, setReviewTask] = useState<any>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewerId, setReviewerId] = useState("");

  const REVIEWERS_OPTIONS = [
    { id: "8ade760c-c482-4cfb-91e6-dbd8da040c4c", name: "ندى عبد النبي (Senior Graphic Designer & Reviewer)" },
    { id: "bcfa3baa-7045-4262-abd6-bdb0be8210fd", name: "عماد عادل (Owner & Art Director)" },
    { id: "00a38eae-a90e-4796-89e4-56394e987666", name: "سارة (Midlevel Graphic Designer)" },
    { id: "32d835ec-1456-4d76-8c6e-32f2933a3627", name: "آلاء حسام (Midlevel Graphic Designer)" },
    { id: "c3c45e0c-adc5-4e28-89f8-ec9757ae4376", name: "شهد لاشين (Midlevel Graphic Designer)" },
    { id: "aeac45ca-3e5a-493a-8a19-238d892317ab", name: "آية حمزة (Junior Graphic Designer)" },
  ];

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tasks");
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const handlePersonaChange = (e: any) => {
      setActivePersona(e.detail);
      fetchData();
    };
    window.addEventListener("persona_changed", handlePersonaChange);
    return () => window.removeEventListener("persona_changed", handlePersonaChange);
  }, []);

  const myTasks = tasks.filter(
    (t) => t.assignee?.display_name === activePersona.displayName || !t.assignee
  );

  const priorityTasks = myTasks.filter((t) => ["in_progress", "ready", "backlog"].includes(t.status));
  const changeRequestedTasks = myTasks.filter((t) => t.status === "changes_requested");
  const inReviewTasks = myTasks.filter((t) => ["internal_review", "client_review"].includes(t.status));

  const handleStartTimer = async (task: any) => {
    try {
      const res = await fetch("/api/timer/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          personId: task.primary_assignee_id || "sarah-id",
          category: timerCategory,
          note: timerNote,
        }),
      });

      if (res.ok) {
        window.dispatchEvent(new CustomEvent("timer_state_changed"));
        fetchData();
      } else {
        const err = await res.json();
        alert(`تعذر بدء العداد: ${err.error || "خطأ غير متوقع"}`);
      }
    } catch (err: any) {
      alert(`خطأ: ${err.message}`);
    }
  };

  const handleSaveManualSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTask) return;

    try {
      const res = await fetch("/api/timer/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: manualTask.workspace_id,
          taskId: manualTask.id,
          personId: manualTask.primary_assignee_id || "sarah-id",
          startedAtLocal: manualStart,
          endedAtLocal: manualEnd,
          category: manualCategory,
          note: manualNote,
        }),
      });

      if (res.ok) {
        alert("تم تسجيل جلسة العمل اليدوية بنجاح!");
        setShowManualModal(false);
        setManualNote("");
        fetchData();
      } else {
        const err = await res.json();
        alert(`فشل تسجيل الجلسة: ${err.error}`);
      }
    } catch (err: any) {
      alert(`خطأ: ${err.message}`);
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewTask) return;

    try {
      const res = await fetch("/api/reviews/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: reviewTask.id,
          submittedById: reviewTask.primary_assignee_id || "sarah-id",
          previewUrl: previewUrl,
          note: reviewNote,
          reviewerId: reviewerId || undefined,
        }),
      });

      if (res.ok) {
        alert("تم إرسال المهمة للمراجعة بنجاح!");
        setShowReviewModal(false);
        setPreviewUrl("");
        setReviewNote("");
        setReviewerId("");
        fetchData();
      } else {
        const err = await res.json();
        alert(`فشل الإرسال للمراجعة: ${err.error}`);
      }
    } catch (err: any) {
      alert(`خطأ: ${err.message}`);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
            شغلي — {activePersona.displayName}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            المهام المسندة إليك، المواعيد النهائية، والتحكم السريع في عداد الوقت
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (myTasks.length > 0) {
                setManualTask(myTasks[0]);
                setShowManualModal(true);
              } else {
                alert("لا توجد مهام مسندة لتسجيل جلسة عليها.");
              }
            }}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            إضافة جلسة عمل يدوية
          </button>
        </div>
      </div>

      {/* Changes Requested Banner (High Priority) */}
      {changeRequestedTasks.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 text-xs text-rose-900 space-y-3">
          <div className="flex items-center gap-2 font-bold text-sm text-rose-800">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            مهام مطلوب عليها تعديلات ({changeRequestedTasks.length})
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {changeRequestedTasks.map((t) => (
              <div
                key={t.id}
                className="bg-white p-3.5 rounded-xl border border-rose-200/80 shadow-xs flex items-center justify-between"
              >
                <div>
                  <div className="font-bold text-slate-900">{t.title}</div>
                  <div className="text-slate-500 text-[11px] mt-0.5">
                    {t.client?.name} | تسليمة: {t.deliverable_number}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleStartTimer(t)}
                    className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-bold flex items-center gap-1"
                  >
                    <Play className="w-3 h-3 fill-white" />
                    بدء العداد
                  </button>
                  <button
                    onClick={() => {
                      setReviewTask(t);
                      setShowReviewModal(true);
                    }}
                    className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-bold flex items-center gap-1"
                  >
                    <Send className="w-3 h-3" />
                    إعادة التقديم
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Worklist */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Priority Tasks for Today (2 cols) */}
        <div className="lg:col-span-2 bg-surface rounded-2xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <h2 className="font-bold text-base text-slate-900 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-sky-600" />
              أولويات اليوم والمهام الجاهزة للتنفيذ
            </h2>
            <span className="text-xs font-semibold text-slate-500">
              {priorityTasks.length} مهام
            </span>
          </div>

          <div className="py-4 space-y-3">
            {priorityTasks.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">
                لا توجد مهام قيد التنفيذ حالياً.
              </div>
            ) : (
              priorityTasks.map((task) => {
                const statusColor = TASK_STATUS_COLORS[task.status as keyof typeof TASK_STATUS_COLORS] || {
                  bg: "bg-slate-100",
                  text: "text-slate-700",
                  border: "border-slate-200",
                };

                return (
                  <div
                    key={task.id}
                    className="p-4 rounded-xl border border-slate-200 hover:border-sky-300 transition-all bg-surface hover:shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900">{task.title}</span>
                        <span
                          className={`px-2 py-0.5 rounded-md font-semibold border ${statusColor.bg} ${statusColor.text} ${statusColor.border}`}
                        >
                          {TASK_STATUS_LABELS[task.status as keyof typeof TASK_STATUS_LABELS]}
                        </span>
                      </div>
                      <div className="text-slate-500 mt-1 flex items-center gap-3 text-[11px]">
                        <span>العميل: <strong className="text-slate-700">{task.client?.name || "عام"}</strong></span>
                        <span>رقم التسليم: {task.deliverable_number}</span>
                        {task.due_at && (
                          <span className="text-amber-700 font-medium">
                            الموعد: {new Date(task.due_at).toLocaleDateString("ar-EG")}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <button
                        onClick={() => handleStartTimer(task)}
                        className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-bold flex items-center gap-1.5 transition-colors shadow-xs"
                      >
                        <Play className="w-3.5 h-3.5 fill-white" />
                        تشغيل العداد
                      </button>
                      <button
                        onClick={() => {
                          setReviewTask(task);
                          setShowReviewModal(true);
                        }}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold flex items-center gap-1.5 transition-colors"
                      >
                        <Send className="w-3.5 h-3.5" />
                        طلب مراجعة
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Weekly Stats Summary (1 col) */}
        <div className="bg-surface rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
          <h2 className="font-bold text-base text-slate-900 flex items-center gap-2 pb-3 border-b border-slate-100">
            <Clock className="w-4 h-4 text-sky-600" />
            ملخص ساعات العمل هذا الأسبوع
          </h2>

          <div className="space-y-3 text-xs">
            <div className="p-3.5 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-between">
              <span className="font-semibold text-sky-900">إجمالي ساعات العمل المسجلة:</span>
              <span className="font-bold text-base text-sky-700">18.5 س</span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
              <span className="text-slate-600">ساعات التعديل والمراجعة:</span>
              <span className="font-bold text-slate-800">4.0 س</span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
              <span className="text-slate-600">التسليمات المعتمدة:</span>
              <span className="font-bold text-emerald-600">5 تسليمات</span>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 pt-2 border-t border-slate-100">
            يتم تسجيل الجلسات بدقة عبر السيرفر بتوقيت القاهرة بدون احتساب فترات التوقف والانتظار.
          </div>
        </div>
      </div>

      {/* Manual Work Session Modal */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <form
            onSubmit={handleSaveManualSession}
            className="bg-surface rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-sky-600" />
                تسجيل جلسة عمل يدوية
              </h3>
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">المهمة:</label>
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800">
                  {manualTask?.title} ({manualTask?.client?.name})
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">بداية الجلسة (القاهرة):</label>
                  <input
                    type="datetime-local"
                    value={manualStart}
                    onChange={(e) => setManualStart(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">نهاية الجلسة (القاهرة):</label>
                  <input
                    type="datetime-local"
                    value={manualEnd}
                    onChange={(e) => setManualEnd(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">تصنيف العمل:</label>
                <select
                  value={manualCategory}
                  onChange={(e) => setManualCategory(e.target.value as TimeCategory)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                >
                  {(Object.keys(TIME_CATEGORY_LABELS) as TimeCategory[]).map((cat) => (
                    <option key={cat} value={cat}>
                      {TIME_CATEGORY_LABELS[cat]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">ملاحظات الجلسة:</label>
                <textarea
                  value={manualNote}
                  onChange={(e) => setManualNote(e.target.value)}
                  placeholder="وصف مختصر للعمل المنجز..."
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs resize-none"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs"
              >
                حفظ الجلسة
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Submit Review Modal */}
      {showReviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <form
            onSubmit={handleSubmitReview}
            className="bg-surface rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-purple-600" />
                إرسال المهمة للمراجعة الداخلية
              </h3>
              <button
                type="button"
                onClick={() => setShowReviewModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">المهمة:</label>
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800">
                  {reviewTask?.title}
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  رابط المعاينة أو ملف التصميم (إلزامي):
                </label>
                <input
                  type="url"
                  value={previewUrl}
                  onChange={(e) => setPreviewUrl(e.target.value)}
                  placeholder="https://drive.google.com/..."
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">ملاحظات للمراجع:</label>
                <textarea
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="توضيح الفكرة أو التعديلات المنفذة..."
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs resize-none"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  المراجع المحدد{" "}
                  {reviewTask?.primary_assignee_id === "bcfa3baa-7045-4262-abd6-bdb0be8210fd" ||
                  reviewTask?.assignee?.display_name?.includes("عماد") ||
                  activePersona?.displayName?.includes("عماد") ? (
                    <span className="text-rose-600 font-bold">(إلزامي لمهام المدير الفني)</span>
                  ) : (
                    <span className="text-slate-400 font-normal">(اختياري - افتراضي حسب قواعد التوجيه)</span>
                  )}
                </label>
                <select
                  value={reviewerId}
                  onChange={(e) => setReviewerId(e.target.value)}
                  required={
                    reviewTask?.primary_assignee_id === "bcfa3baa-7045-4262-abd6-bdb0be8210fd" ||
                    reviewTask?.assignee?.display_name?.includes("عماد") ||
                    activePersona?.displayName?.includes("عماد")
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white text-slate-700 focus:outline-sky-500"
                >
                  <option value="">
                    {reviewTask?.primary_assignee_id === "bcfa3baa-7045-4262-abd6-bdb0be8210fd" ||
                    reviewTask?.assignee?.display_name?.includes("عماد") ||
                    activePersona?.displayName?.includes("عماد")
                      ? "-- اختر مراجعًا من الفريق (لا يمكن الموافقة الذاتية) --"
                      : "-- التوجيه التلقائي للمراجع الافتراضي --"}
                  </option>
                  {REVIEWERS_OPTIONS.filter((r) => r.id !== reviewTask?.primary_assignee_id).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowReviewModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-xs flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                إرسال للمراجعة
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
