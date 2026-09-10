"use client";

import React, { useState, useEffect, useMemo } from "react";
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
  Layers,
  Sparkles,
  ChevronRight,
  RotateCcw,
  Check,
  Eye,
  Video,
  Image as ImageIcon,
} from "lucide-react";
import {
  TASK_STATUS_LABELS,
  TASK_STATUS_COLORS,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_COLORS,
  CLIENT_DIFFICULTY_LABELS,
  TIME_CATEGORY_LABELS,
  formatDurationSeconds,
  cn,
} from "@/lib/utils";
import { ActiveTimerBar } from "@/components/timer/ActiveTimerBar";
import TaskDetailsDrawer from "@/components/tasks/TaskDetailsDrawer";
import type { TimeCategory, TaskStatus, TaskPriority } from "@/types/database";

export default function MyWorkPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<{
    rosterPersonId: string;
    role: string;
    displayName: string;
    email: string;
  } | null>(null);

  // Drawer state
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Manual Session Modal State
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualTask, setManualTask] = useState<any>(null);
  const [manualStart, setManualStart] = useState("2026-09-10T10:00");
  const [manualEnd, setManualEnd] = useState("2026-09-10T11:00");
  const [manualCategory, setManualCategory] = useState<TimeCategory>("initial_design");
  const [manualNote, setManualNote] = useState("");

  const fetchUserAndTasks = async () => {
    setLoading(true);
    try {
      // 1. Fetch current user
      const meRes = await fetch("/api/auth/me");
      if (meRes.ok) {
        const meData = await meRes.json();
        setCurrentUser({
          rosterPersonId: meData.membership.rosterPersonId,
          role: meData.membership.role,
          displayName: meData.membership.displayName || meData.user.email,
          email: meData.user.email,
        });
      }

      // 2. Fetch tasks scoped to user
      const res = await fetch("/api/tasks?myWork=true");
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } catch (e) {
      console.error("Failed to load My Work data:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUserAndTasks();
    const handleTimerChange = () => fetchUserAndTasks();
    window.addEventListener("timer_state_changed", handleTimerChange);
    return () => window.removeEventListener("timer_state_changed", handleTimerChange);
  }, []);

  // Sort helper: design_due_date (or due_date) ASC -> Difficulty (Hard > Medium > Easy) -> created_at ASC
  const sortTasks = (list: any[]) => {
    const diffWeight: Record<string, number> = { Hard: 3, Medium: 2, Easy: 1 };
    return [...list].sort((a, b) => {
      // 1. Designer production deadline: design_due_date || due_date
      const effectiveA = a.design_due_date || a.due_date;
      const effectiveB = b.design_due_date || b.due_date;
      const dateA = effectiveA ? new Date(effectiveA).getTime() : Infinity;
      const dateB = effectiveB ? new Date(effectiveB).getTime() : Infinity;
      if (dateA !== dateB) return dateA - dateB;

      // 2. Client Difficulty
      const weightA = diffWeight[a.client?.difficulty] || 0;
      const weightB = diffWeight[b.client?.difficulty] || 0;
      if (weightA !== weightB) return weightB - weightA;

      // 3. Created At
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  };

  // Canonical Cairo Overdue check (prioritizing design_due_date for designer production deadlines)
  const nowCairoStr = new Date().toISOString().slice(0, 10);

  const {
    overdueTasks,
    changesRequestedTasks,
    inProgressTasks,
    inReviewTasks,
    backlogTasks,
    approvedTasks,
    deliveredTasks,
  } = useMemo(() => {
    const overdue: any[] = [];
    const changes: any[] = [];
    const inProgress: any[] = [];
    const inReview: any[] = [];
    const backlog: any[] = [];
    const approved: any[] = [];
    const delivered: any[] = [];

    for (const t of tasks) {
      const effectiveDueDate = t.design_due_date || t.due_date;
      const isOverdue =
        effectiveDueDate &&
        effectiveDueDate.slice(0, 10) < nowCairoStr &&
        !["approved", "delivered", "archived", "cancelled"].includes(t.status);

      if (isOverdue) {
        overdue.push(t);
      }

      if (t.status === "changes_requested") {
        changes.push(t);
      } else if (t.status === "in_progress") {
        inProgress.push(t);
      } else if (t.status === "internal_review" || t.status === "client_review") {
        inReview.push(t);
      } else if (t.status === "backlog" || t.status === "ready") {
        backlog.push(t);
      } else if (t.status === "approved") {
        approved.push(t);
      } else if (t.status === "delivered") {
        delivered.push(t);
      }
    }

    return {
      overdueTasks: sortTasks(overdue),
      changesRequestedTasks: sortTasks(changes),
      inProgressTasks: sortTasks(inProgress),
      inReviewTasks: sortTasks(inReview),
      backlogTasks: sortTasks(backlog),
      approvedTasks: sortTasks(approved),
      deliveredTasks: sortTasks(delivered),
    };
  }, [tasks, nowCairoStr]);

  const handleStartWork = async (task: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const res = await fetch(`/api/tasks/${task.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStatus: "in_progress" }),
      });

      if (res.ok) {
        await fetch("/api/timer/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: task.id,
            category: "initial_design",
          }),
        });
        window.dispatchEvent(new CustomEvent("timer_state_changed"));
        fetchUserAndTasks();
      } else {
        const err = await res.json();
        alert(`تعذر بدء العمل: ${err.error || "خطأ غير متوقع"}`);
      }
    } catch (err: any) {
      alert(`خطأ: ${err.message}`);
    }
  };

  const handleOpenDrawer = (task: any) => {
    setSelectedTask(task);
    setIsDrawerOpen(true);
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
          personId: currentUser?.rosterPersonId || manualTask.primary_assignee_id,
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
        fetchUserAndTasks();
      } else {
        const err = await res.json();
        alert(`فشل تسجيل الجلسة: ${err.error}`);
      }
    } catch (err: any) {
      alert(`خطأ: ${err.message}`);
    }
  };

  // Render a task card
  const renderTaskCard = (task: any, accentColor: string = "border-slate-200") => {
    const statusConfig = TASK_STATUS_COLORS[task.status as TaskStatus] || {
      bg: "bg-slate-100",
      text: "text-slate-800",
      border: "border-slate-200",
    };

    return (
      <div
        key={task.id}
        onClick={() => handleOpenDrawer(task)}
        className={cn(
          "bg-white rounded-2xl border p-4 shadow-2xs hover:shadow-md transition-all cursor-pointer space-y-3",
          accentColor
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="px-2 py-0.5 rounded-md font-mono font-bold text-[10px] bg-slate-100 text-slate-700">
                {task.deliverable_number || "Post"}
              </span>
              <span
                className={cn(
                  "px-2 py-0.5 rounded-md font-semibold text-[10px] border",
                  statusConfig.bg,
                  statusConfig.text,
                  statusConfig.border
                )}
              >
                {TASK_STATUS_LABELS[task.status as TaskStatus] || task.status}
              </span>
              {task.client?.difficulty && (
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-800 border border-amber-200">
                  {(CLIENT_DIFFICULTY_LABELS as Record<string, string>)[task.client.difficulty] || task.client.difficulty}
                </span>
              )}
            </div>
            <h4 className="font-bold text-slate-900 text-xs line-clamp-2 leading-relaxed">
              {task.title}
            </h4>
          </div>

          <span
            className={cn(
              "px-2 py-0.5 rounded text-[10px] font-semibold shrink-0",
              TASK_PRIORITY_COLORS[task.priority as TaskPriority]?.bg || "bg-slate-100"
            )}
          >
            {TASK_PRIORITY_LABELS[task.priority as TaskPriority] || task.priority}
          </span>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
          <div>
            العميل: <strong className="text-slate-700">{task.client?.name || "عام"}</strong>
          </div>
          {(task.design_due_date || task.due_date) && (
            <div className="flex items-center gap-1 text-slate-600 font-mono text-[10px]">
              <Calendar className="w-3 h-3 text-slate-400" />
              <span>
                {task.design_due_date ? "موعد التصميم: " : "الموعد: "}
                {new Date(task.design_due_date || task.due_date).toLocaleDateString("ar-EG")}
              </span>
            </div>
          )}
        </div>

        {/* Quick actions per card */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
          {(task.status === "backlog" || task.status === "ready") && (
            <button
              type="button"
              onClick={(e) => handleStartWork(task, e)}
              className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors shadow-2xs"
            >
              <Play className="w-3 h-3 fill-white" />
              <span>بدء العمل</span>
            </button>
          )}

          {task.status === "changes_requested" && (
            <button
              type="button"
              onClick={(e) => handleStartWork(task, e)}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors shadow-2xs"
            >
              <RotateCcw className="w-3 h-3" />
              <span>بدء العمل على التعديلات</span>
            </button>
          )}

          {task.status === "in_progress" && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenDrawer(task);
              }}
              className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors shadow-2xs"
            >
              <Send className="w-3 h-3" />
              <span>تسليم للمراجعة</span>
            </button>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleOpenDrawer(task);
            }}
            className="text-xs text-sky-600 hover:text-sky-800 font-bold mr-auto flex items-center gap-1"
          >
            <span>التفاصيل</span>
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Active Timer Bar */}
      <ActiveTimerBar />

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
            شغلي {currentUser ? `— ${currentUser.displayName}` : ""}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            مساحة عمل المصمم: المهام المسندة، أولويات التسليم، والتسليم للمراجعة الداخلية
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (tasks.length > 0) {
                setManualTask(tasks[0]);
                setShowManualModal(true);
              } else {
                alert("لا توجد مهام مسندة لتسجيل جلسة عليها.");
              }
            }}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة جلسة عمل يدوية</span>
          </button>
        </div>
      </div>

      {/* Section 1: Overdue Warning (متأخرة) */}
      {overdueTasks.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-xs text-rose-900 space-y-3">
          <div className="flex items-center gap-2 font-bold text-sm text-rose-800">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            <span>مهام متأخرة ({overdueTasks.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {overdueTasks.map((t) => renderTaskCard(t, "border-rose-300 bg-rose-50/40"))}
          </div>
        </div>
      )}

      {/* Section 2: Changes Requested (مطلوب تعديلات) */}
      {changesRequestedTasks.length > 0 && (
        <div className="bg-amber-50/80 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 space-y-3">
          <div className="flex items-center gap-2 font-bold text-sm text-amber-800">
            <RotateCcw className="w-4 h-4 text-amber-600" />
            <span>مطلوب تعديلات ({changesRequestedTasks.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {changesRequestedTasks.map((t) => renderTaskCard(t, "border-amber-300 bg-amber-50/30"))}
          </div>
        </div>
      )}

      {/* Section 3: In Progress (قيد التنفيذ) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
          <h2 className="font-bold text-base text-slate-950 flex items-center gap-2">
            <Clock className="w-4 h-4 text-sky-600" />
            <span>قيد التنفيذ ({inProgressTasks.length})</span>
          </h2>
        </div>
        {inProgressTasks.length === 0 ? (
          <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 text-slate-400 text-xs">
            لا توجد مهام قيد التنفيذ حالياً. اضغط "بدء العمل" على أي مهمة في قائمة الانتظار.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {inProgressTasks.map((t) => renderTaskCard(t, "border-sky-300"))}
          </div>
        )}
      </div>

      {/* Section 4: In Review (بانتظار المراجعة) */}
      {inReviewTasks.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h2 className="font-bold text-base text-slate-950 flex items-center gap-2">
              <Send className="w-4 h-4 text-purple-600" />
              <span>بانتظار المراجعة الداخلية ({inReviewTasks.length})</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {inReviewTasks.map((t) => renderTaskCard(t, "border-purple-200 bg-purple-50/30"))}
          </div>
        </div>
      )}

      {/* Section 5: Backlog & Ready (انتظار) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
          <h2 className="font-bold text-base text-slate-950 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-600" />
            <span>انتظار ({backlogTasks.length})</span>
          </h2>
        </div>
        {backlogTasks.length === 0 ? (
          <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 text-slate-400 text-xs">
            لا توجد مهام في قائمة الانتظار.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {backlogTasks.map((t) => renderTaskCard(t))}
          </div>
        )}
      </div>

      {/* Section 6 & 7: Approved & Delivered (معتمد وتم التسليم) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
        {/* Approved */}
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h2 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>معتمد ({approvedTasks.length})</span>
            </h2>
          </div>
          {approvedTasks.length === 0 ? (
            <div className="p-4 text-center bg-white rounded-xl border border-slate-200 text-slate-400 text-xs">
              لا توجد مهام معتمدة حالياً.
            </div>
          ) : (
            <div className="space-y-2">
              {approvedTasks.map((t) => renderTaskCard(t, "border-emerald-200"))}
            </div>
          )}
        </div>

        {/* Delivered */}
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h2 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-700" />
              <span>تم التسليم ({deliveredTasks.length})</span>
            </h2>
          </div>
          {deliveredTasks.length === 0 ? (
            <div className="p-4 text-center bg-white rounded-xl border border-slate-200 text-slate-400 text-xs">
              لا توجد مهام تم تسليمها نهائياً بعد.
            </div>
          ) : (
            <div className="space-y-2">
              {deliveredTasks.map((t) => renderTaskCard(t, "border-slate-200 opacity-80"))}
            </div>
          )}
        </div>
      </div>

      {/* Task Details Drawer */}
      <TaskDetailsDrawer
        task={selectedTask}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onStatusTransition={() => fetchUserAndTasks()}
        onTaskUpdated={() => fetchUserAndTasks()}
      />

      {/* Manual Time Session Modal */}
      {showManualModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl text-right animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-sky-600" />
                <span>إضافة جلسة عمل يدوية</span>
              </h3>
              <button onClick={() => setShowManualModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveManualSession} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">المهمة *</label>
                <select
                  value={manualTask?.id || ""}
                  onChange={(e) => {
                    const found = tasks.find((t) => t.id === e.target.value);
                    if (found) setManualTask(found);
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white"
                >
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title} ({t.client?.name})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">بداية الجلسة *</label>
                  <input
                    type="datetime-local"
                    value={manualStart}
                    onChange={(e) => setManualStart(e.target.value)}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-xl font-mono text-[11px]"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">نهاية الجلسة *</label>
                  <input
                    type="datetime-local"
                    value={manualEnd}
                    onChange={(e) => setManualEnd(e.target.value)}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-xl font-mono text-[11px]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">تصنيف العمل *</label>
                <select
                  value={manualCategory}
                  onChange={(e) => setManualCategory(e.target.value as TimeCategory)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-slate-50 focus:bg-white"
                >
                  {Object.entries(TIME_CATEGORY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">ملاحظات (اختياري)</label>
                <input
                  type="text"
                  value={manualNote}
                  onChange={(e) => setManualNote(e.target.value)}
                  placeholder="سبب التسجيل اليدوي..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold"
                >
                  تسجيل الجلسة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
