"use client";

import React, { useState, useEffect } from "react";
import {
  Kanban,
  Table as TableIcon,
  Filter,
  Plus,
  Search,
  CheckCircle2,
  Clock,
  Play,
  CheckSquare,
  AlertCircle,
  MoreHorizontal,
  X,
  ExternalLink,
  ChevronDown,
} from "lucide-react";
import {
  TASK_STATUS_LABELS,
  TASK_STATUS_COLORS,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_COLORS,
  cn,
} from "@/lib/utils";
import type { TaskStatus, TaskPriority } from "@/types/database";

const STATUS_COLUMNS: TaskStatus[] = [
  "backlog",
  "ready",
  "in_progress",
  "internal_review",
  "changes_requested",
  "client_review",
  "approved",
  "delivered",
  "blocked",
];

export default function TasksPage() {
  const [viewMode, setViewMode] = useState<"kanban" | "table">("kanban");
  const [tasks, setTasks] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedClient, setSelectedClient] = useState<string>("");
  const [selectedAssignee, setSelectedAssignee] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Create Task Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createClientId, setCreateClientId] = useState("");
  const [createDeliverableType, setCreateDeliverableType] = useState("Post");
  const [createDeliverableNumber, setCreateDeliverableNumber] = useState("01");
  const [createPriority, setCreatePriority] = useState<TaskPriority>("Normal");
  const [createBrief, setCreateBrief] = useState("");
  const [createDueAt, setCreateDueAt] = useState("");

  // Task Details Drawer
  const [selectedTask, setSelectedTask] = useState<any>(null);

  // Status transition reason modal
  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<TaskStatus | null>(null);
  const [transitionReason, setTransitionReason] = useState("");
  const [deliverableUrl, setDeliverableUrl] = useState("");

  const fetchData = async () => {
    setLoading(true);
    try {
      const [tasksRes, clientsRes] = await Promise.all([
        fetch("/api/tasks"),
        fetch("/api/clients"),
      ]);

      if (tasksRes.ok) {
        const data = await tasksRes.json();
        setTasks(data.tasks || []);
      }
      if (clientsRes.ok) {
        const cData = await clientsRes.json();
        setClients(cData.clients || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredTasks = tasks.filter((t) => {
    if (selectedClient && t.client_id !== selectedClient) return false;
    if (selectedAssignee && t.primary_assignee_id !== selectedAssignee) return false;
    if (selectedStatus && t.status !== selectedStatus) return false;
    if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createTitle || !createClientId) {
      alert("يرجى إدخال عنوان المهمة واختيار العميل.");
      return;
    }

    try {
      // Find default campaign for this client
      const clientObj = clients.find((c) => c.id === createClientId);
      const campaignId = clientObj?.campaigns?.[0]?.id || "00000000-0000-0000-0000-000000000000";

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: clientObj?.workspace_id,
          campaignId,
          clientId: createClientId,
          title: createTitle,
          deliverableType: createDeliverableType,
          deliverableNumber: createDeliverableNumber,
          priority: createPriority,
          brief: createBrief,
          dueAt: createDueAt ? new Date(createDueAt).toISOString() : null,
        }),
      });

      if (res.ok) {
        alert("تم إنشاء المهمة وتعيين المراجع الافتراضي بنجاح!");
        setShowCreateModal(false);
        setCreateTitle("");
        setCreateBrief("");
        fetchData();
      } else {
        const err = await res.json();
        alert(`فشل إنشاء المهمة: ${err.error}`);
      }
    } catch (err: any) {
      alert(`خطأ: ${err.message}`);
    }
  };

  const handleStatusChangeRequest = (task: any, newStatus: TaskStatus) => {
    setSelectedTask(task);
    setPendingStatus(newStatus);

    // If reason or deliverable URL is required
    const requiresReason = ["blocked", "cancelled", "changes_requested"].includes(newStatus) ||
      (task.status === "delivered" && newStatus !== "delivered");
    const requiresDeliverable = newStatus === "delivered";

    if (requiresReason || requiresDeliverable) {
      setShowTransitionModal(true);
    } else {
      executeStatusTransition(task.id, newStatus, "");
    }
  };

  const executeStatusTransition = async (taskId: string, newStatus: TaskStatus, reason: string, url?: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toStatus: newStatus,
          actorId: "owner-id",
          reason: reason || null,
          deliverableUrl: url || null,
        }),
      });

      if (res.ok) {
        setShowTransitionModal(false);
        setTransitionReason("");
        setDeliverableUrl("");
        fetchData();
      } else {
        const err = await res.json();
        alert(`فشل تغيير الحالة: ${err.error}`);
      }
    } catch (err: any) {
      alert(`خطأ: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">إدارة التاسكات</h1>
          <p className="text-sm text-slate-500 mt-1">
            لوحة كانبان تفاعلية وجدول تفصيلي مع تدفق اعتمادات صارم ومسار تدقيق للأحداث
          </p>
        </div>

        <div className="flex items-center gap-2 self-stretch sm:self-auto">
          {/* View Toggle */}
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
            <button
              onClick={() => setViewMode("kanban")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all",
                viewMode === "kanban" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
              )}
            >
              <Kanban className="w-3.5 h-3.5" />
              كانبان
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all",
                viewMode === "table" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
              )}
            >
              <TableIcon className="w-3.5 h-3.5" />
              جدول
            </button>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            مهمة جديدة
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-surface p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-2 text-slate-400">
          <Filter className="w-4 h-4" />
          <span className="font-semibold text-slate-700">تصفية:</span>
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 absolute right-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="بحث بعنوان المهمة..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pr-8 pl-3 py-1.5 border border-slate-200 rounded-xl text-xs focus:outline-sky-500"
          />
        </div>

        {/* Client Filter */}
        <select
          value={selectedClient}
          onChange={(e) => setSelectedClient(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs bg-white text-slate-700"
        >
          <option value="">جميع العملاء ({clients.length})</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        {/* Status Filter */}
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs bg-white text-slate-700"
        >
          <option value="">جميع الحالات</option>
          {STATUS_COLUMNS.map((st) => (
            <option key={st} value={st}>
              {TASK_STATUS_LABELS[st]}
            </option>
          ))}
        </select>

        {(selectedClient || selectedStatus || searchQuery) && (
          <button
            onClick={() => {
              setSelectedClient("");
              setSelectedStatus("");
              setSearchQuery("");
            }}
            className="text-sky-600 hover:text-sky-700 font-semibold"
          >
            إعادة الضبط
          </button>
        )}
      </div>

      {/* Kanban Board View */}
      {viewMode === "kanban" ? (
        <div className="flex gap-4 overflow-x-auto pb-6 pt-1">
          {STATUS_COLUMNS.map((col) => {
            const colTasks = filteredTasks.filter((t) => t.status === col);
            const statusConfig = TASK_STATUS_COLORS[col];

            return (
              <div
                key={col}
                className="w-72 shrink-0 bg-slate-50/80 rounded-2xl border border-slate-200/80 p-3 flex flex-col max-h-[calc(100vh-250px)]"
              >
                {/* Column Header */}
                <div className="flex items-center justify-between pb-3 px-1 border-b border-slate-200/60 mb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-md font-bold text-xs border ${statusConfig.bg} ${statusConfig.text} ${statusConfig.border}`}
                    >
                      {TASK_STATUS_LABELS[col]}
                    </span>
                    <span className="text-xs font-bold text-slate-400">({colTasks.length})</span>
                  </div>
                </div>

                {/* Cards List */}
                <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                  {colTasks.map((task) => (
                    <div
                      key={task.id}
                      onClick={() => setSelectedTask(task)}
                      className="bg-surface p-3.5 rounded-xl border border-slate-200/90 shadow-xs hover:border-sky-300 hover:shadow-sm transition-all cursor-pointer text-xs space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-bold text-slate-900 leading-snug">{task.title}</div>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                            TASK_PRIORITY_COLORS[task.priority as TaskPriority]?.bg || "bg-slate-100"
                          }`}
                        >
                          {TASK_PRIORITY_LABELS[task.priority as TaskPriority] || "عادية"}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                        <span className="font-semibold text-slate-700">{task.client?.name}</span>
                        <span>رقم: {task.deliverable_number}</span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>المصمم: {task.assignee?.display_name || "غير محدد"}</span>
                        {task.reviewer && <span>المراجع: {task.reviewer.display_name}</span>}
                      </div>

                      {/* Quick Status Shift */}
                      <div
                        className="pt-2 border-t border-slate-100 flex items-center justify-between"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <select
                          value={task.status}
                          onChange={(e) => handleStatusChangeRequest(task, e.target.value as TaskStatus)}
                          className="bg-slate-50 border border-slate-200 rounded-lg text-[10px] px-2 py-1 text-slate-700 font-semibold"
                        >
                          {STATUS_COLUMNS.map((st) => (
                            <option key={st} value={st}>
                              نقل إلى: {TASK_STATUS_LABELS[st]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Data Table View */
        <div className="bg-surface rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right divide-y divide-slate-100">
              <thead className="bg-slate-50 text-slate-600 font-bold">
                <tr>
                  <th className="px-4 py-3">المهمة</th>
                  <th className="px-4 py-3">العميل</th>
                  <th className="px-4 py-3">نوع ورقم التسليم</th>
                  <th className="px-4 py-3">المصمم</th>
                  <th className="px-4 py-3">المراجع</th>
                  <th className="px-4 py-3">الأولوية</th>
                  <th className="px-4 py-3">الحالة</th>
                  <th className="px-4 py-3">الموعد النهائي</th>
                  <th className="px-4 py-3 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTasks.map((t) => {
                  const statusConfig = TASK_STATUS_COLORS[t.status as TaskStatus];
                  return (
                    <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3 font-bold text-slate-900">{t.title}</td>
                      <td className="px-4 py-3 text-slate-700">{t.client?.name}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {t.deliverable_type} #{t.deliverable_number}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {t.assignee?.display_name || "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {t.reviewer?.display_name || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-md font-semibold text-[10px] ${
                            TASK_PRIORITY_COLORS[t.priority as TaskPriority]?.bg || "bg-slate-100"
                          }`}
                        >
                          {TASK_PRIORITY_LABELS[t.priority as TaskPriority]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-md font-semibold text-[10px] border ${statusConfig.bg} ${statusConfig.text} ${statusConfig.border}`}
                        >
                          {TASK_STATUS_LABELS[t.status as TaskStatus]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {t.due_at ? new Date(t.due_at).toLocaleDateString("ar-EG") : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setSelectedTask(t)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 font-semibold"
                        >
                          تفاصيل
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Task Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <form
            onSubmit={handleCreateTask}
            className="bg-surface rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <Plus className="w-4 h-4 text-sky-600" />
                إنشاء مهمة تصميم جديدة
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">العميل (Client):</label>
                <select
                  value={createClientId}
                  onChange={(e) => setCreateClientId(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white"
                >
                  <option value="">-- اختر العميل --</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.owner?.display_name || "غير مسند"}) - {c.difficulty}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">عنوان المهمة:</label>
                <input
                  type="text"
                  placeholder="مثال: Post 01 - بوست إطلاق المنتج الجديد"
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">نوع التسليمة:</label>
                  <input
                    type="text"
                    value={createDeliverableType}
                    onChange={(e) => setCreateDeliverableType(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">رقم التسليمة:</label>
                  <input
                    type="text"
                    value={createDeliverableNumber}
                    onChange={(e) => setCreateDeliverableNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">الأولوية:</label>
                  <select
                    value={createPriority}
                    onChange={(e) => setCreatePriority(e.target.value as TaskPriority)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                  >
                    <option value="Low">منخفضة</option>
                    <option value="Normal">عادية</option>
                    <option value="High">عالية</option>
                    <option value="Urgent">عاجلة</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">الموعد النهائي:</label>
                  <input
                    type="date"
                    value={createDueAt}
                    onChange={(e) => setCreateDueAt(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">وصف البريف وملاحظات التنفيذ:</label>
                <textarea
                  value={createBrief}
                  onChange={(e) => setCreateBrief(e.target.value)}
                  rows={2}
                  placeholder="المقاسات، الألوان، النصوص المطلوبة..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs resize-none"
                />
              </div>

              <div className="p-3 bg-sky-50 border border-sky-100 rounded-xl text-[11px] text-sky-800">
                💡 <strong>التوجيه التلقائي للمراجعة:</strong> إذا كان العميل صعباً (Hard) فستوجه المراجعة لعماد، وإذا كانت المصممة آية فستوجه لندى.
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs"
              >
                إنشاء المهمة
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Status Transition Guard Modal (Reason / Deliverable URL) */}
      {showTransitionModal && selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-surface rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                تأكيد تغيير حالة المهمة
              </h3>
              <button
                type="button"
                onClick={() => setShowTransitionModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="font-semibold text-slate-800">
                المهمة: {selectedTask.title}
              </div>

              {pendingStatus === "delivered" ? (
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    رابط ملف التسليم النهائي المعتمد (إلزامي):
                  </label>
                  <input
                    type="url"
                    placeholder="https://drive.google.com/..."
                    value={deliverableUrl}
                    onChange={(e) => setDeliverableUrl(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    لا يمكن وضع المهمة في حالة تم التسليم بدون رابط ملف تسليم صحيح.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    سبب تغيير الحالة إلى ({pendingStatus && TASK_STATUS_LABELS[pendingStatus]}) (إلزامي):
                  </label>
                  <textarea
                    placeholder="اكتب سبب الإيقاف أو الإلغاء أو إعادة الفتح لتسجيله في مسار التدقيق..."
                    value={transitionReason}
                    onChange={(e) => setTransitionReason(e.target.value)}
                    required
                    rows={3}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs resize-none"
                  />
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowTransitionModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => {
                  if (pendingStatus === "delivered" && !deliverableUrl) {
                    alert("يرجى إدخال رابط التسليم النهائي.");
                    return;
                  }
                  if (pendingStatus !== "delivered" && !transitionReason.trim()) {
                    alert("يرجى كتابة سبب التغيير.");
                    return;
                  }
                  executeStatusTransition(
                    selectedTask.id,
                    pendingStatus!,
                    transitionReason,
                    deliverableUrl
                  );
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs"
              >
                تأكيد التغيير
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
