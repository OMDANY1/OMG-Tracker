"use client";

import React, { useState, useEffect } from "react";
import {
  Building2,
  Users,
  AlertTriangle,
  ArrowRightLeft,
  Search,
  Filter,
  CheckCircle2,
  X,
  ShieldAlert,
  ShieldCheck,
  Briefcase,
  Layers,
} from "lucide-react";
import {
  CLIENT_DIFFICULTY_LABELS,
  CLIENT_EXTRA_WORKLOAD_LABELS,
  cn,
} from "@/lib/utils";

interface Designer {
  id: string;
  displayName: string;
  jobTitle: string;
  clientCount: number;
  openTasksCount: number;
}

export default function ClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [designers, setDesigners] = useState<Designer[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDifficulty, setSelectedDifficulty] = useState("");
  const [selectedOwner, setSelectedOwner] = useState("");

  // Edit / Reassignment Modal
  const [editingClient, setEditingClient] = useState<any>(null);
  const [newOwnerId, setNewOwnerId] = useState<string>("");
  const [reassignOpenTasks, setReassignOpenTasks] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const fetchClients = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/clients");
      if (res.ok) {
        const data = await res.json();
        setClients(data.clients || []);
        if (data.designers) setDesigners(data.designers);
        if (typeof data.isOwner === "boolean") setIsOwner(data.isOwner);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  // Listen for persona changes from RoleSwitcher if testing different personas locally
  useEffect(() => {
    const handlePersonaChange = (e: any) => {
      if (e.detail?.role === "owner") {
        setIsOwner(true);
      } else if (e.detail) {
        setIsOwner(false);
      }
    };
    window.addEventListener("persona_changed", handlePersonaChange);
    return () => window.removeEventListener("persona_changed", handlePersonaChange);
  }, []);

  const filteredClients = clients.filter((c) => {
    if (searchQuery && !c.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (selectedDifficulty && c.difficulty !== selectedDifficulty) return false;
    if (selectedOwner && c.owner?.display_name !== selectedOwner) return false;
    return true;
  });

  // Calculate open tasks on the currently editing client
  const clientOpenTasksCount = editingClient
    ? (editingClient.tasks || []).filter((t: any) => !["delivered", "cancelled"].includes(t.status)).length
    : 0;

  const targetDesigner = designers.find((d) => d.id === newOwnerId);
  const currentDesignerName = editingClient?.owner?.display_name || "غير مسند";
  const newDesignerName = targetDesigner?.displayName || (newOwnerId ? "مصمم محدد" : "إزالة الإسناد (غير مسند)");

  const handleOpenReassignModal = (client: any) => {
    setEditingClient(client);
    setNewOwnerId(client.owner_roster_id || "");
    setReassignOpenTasks(false);
    setShowConfirmation(false);
    setStatusMessage(null);
  };

  const handleProceedToConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setShowConfirmation(true);
  };

  const handleExecuteAssignment = async () => {
    if (!editingClient) return;

    setIsSaving(true);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/clients", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reassign",
          clientId: editingClient.id,
          newOwnerRosterId: newOwnerId ? newOwnerId : null,
          reassignOpenTasksToNewOwner: reassignOpenTasks,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const reassignedCount = data.result?.reassigned_tasks_count || 0;
        setStatusMessage({
          type: "success",
          text: reassignOpenTasks
            ? `تم نقل مسؤولية العميل (${editingClient.name}) بنجاح ونقل ${reassignedCount} مهمة مفتوحة للمسؤول الجديد.`
            : `تم تحديث مسؤولية العميل (${editingClient.name}) للمهام المستقبلية بنجاح.`,
        });
        setTimeout(() => {
          setEditingClient(null);
          setShowConfirmation(false);
          setStatusMessage(null);
          fetchClients();
        }, 1500);
      } else {
        const err = await res.json();
        setStatusMessage({
          type: "error",
          text: `فشل نقل المسؤولية: ${err.error || "حدث خطأ غير متوقع"}`,
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: `خطأ أثناء الاتصال: ${err.message}`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Ownership count calculation
  const countsByOwner: Record<string, number> = {};
  clients.forEach((c) => {
    const name = c.owner?.display_name || "غير مسند";
    countsByOwner[name] = (countsByOwner[name] || 0) + 1;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">إدارة حسابات العملاء</h1>
          <p className="text-sm text-slate-500 mt-1">
            28 حساب عميل مع تتبع المسؤول، درجة الصعوبة، وأداة إعادة الإسناد الآمنة للمدير العام (Owner)
          </p>
        </div>
        {isOwner && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-semibold">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>صلاحية إدارة وتوزيع العملاء نشطة (Owner)</span>
          </div>
        )}
      </div>

      {/* Roster Allocation Tracker Banner */}
      <div className="bg-surface rounded-2xl border border-slate-200 p-4 shadow-xs">
        <div className="text-xs font-bold text-slate-500 mb-2">توزيع الحسابات الفعلي بين المصممين:</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
          {[
            { name: "ندى", expected: 5 },
            { name: "عماد", expected: 3 },
            { name: "سارة", expected: 5 },
            { name: "آلاء", expected: 5 },
            { name: "شهد", expected: 5 },
            { name: "آية", expected: 4 },
            { name: "غير مسند", expected: 1 },
          ].map((item) => {
            const actual = countsByOwner[item.name] || 0;
            const match = actual === item.expected;
            return (
              <div
                key={item.name}
                className={cn(
                  "p-2.5 rounded-xl border flex flex-col items-center justify-center text-center",
                  match ? "bg-slate-50 border-slate-200" : "bg-amber-50 border-amber-300"
                )}
              >
                <span className="font-bold text-slate-800">{item.name}</span>
                <span className="text-sm font-extrabold text-sky-700 mt-0.5">
                  {actual} <span className="text-[10px] text-slate-400 font-normal">/ {item.expected}</span>
                </span>
              </div>
            );
          })}
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
            placeholder="بحث باسم العميل..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pr-8 pl-3 py-1.5 border border-slate-200 rounded-xl text-xs focus:outline-sky-500"
          />
        </div>

        {/* Difficulty Filter */}
        <select
          value={selectedDifficulty}
          onChange={(e) => setSelectedDifficulty(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs bg-white text-slate-700"
        >
          <option value="">جميع درجات الصعوبة</option>
          <option value="Hard">صعب (Hard)</option>
          <option value="Medium">متوسط (Medium)</option>
          <option value="Easy">سهل (Easy)</option>
          <option value="Unknown">غير محدد</option>
        </select>

        {/* Owner Filter */}
        <select
          value={selectedOwner}
          onChange={(e) => setSelectedOwner(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs bg-white text-slate-700"
        >
          <option value="">جميع المصممين</option>
          {["ندى", "عماد", "سارة", "آلاء", "شهد", "آية", "غير مسند"].map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>

      {/* Clients Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredClients.map((client) => {
          const diffColor =
            client.difficulty === "Hard"
              ? "bg-rose-50 text-rose-700 border-rose-200"
              : client.difficulty === "Medium"
              ? "bg-blue-50 text-blue-700 border-blue-200"
              : client.difficulty === "Easy"
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : "bg-slate-100 text-slate-600 border-slate-200";

          const openTasks = (client.tasks || []).filter(
            (t: any) => !["delivered", "cancelled"].includes(t.status)
          ).length;

          return (
            <div
              key={client.id}
              className="bg-surface rounded-2xl border border-slate-200/90 p-4 shadow-xs hover:border-sky-300 hover:shadow-sm transition-all flex flex-col justify-between text-xs space-y-3"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-bold text-sm text-slate-900 tracking-wide">
                    {client.name}
                  </h3>
                  <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] border ${diffColor}`}>
                    {CLIENT_DIFFICULTY_LABELS[client.difficulty as keyof typeof CLIENT_DIFFICULTY_LABELS] || client.difficulty}
                  </span>
                </div>

                <div className="mt-3 space-y-1.5 text-slate-600 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">المسؤول (Owner):</span>
                    <span className="font-bold text-slate-800">
                      {client.owner?.display_name || "غير مسند (Unassigned)"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">حالة الحساب:</span>
                    <span className="font-semibold text-slate-700">{client.state}</span>
                  </div>

                  {client.extra_workload && client.extra_workload !== "None" && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">عبء إضافي:</span>
                      <span className="text-amber-700 font-semibold">
                        {CLIENT_EXTRA_WORKLOAD_LABELS[client.extra_workload as keyof typeof CLIENT_EXTRA_WORKLOAD_LABELS] || client.extra_workload}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <span className="text-slate-400">الكامبينز:</span>
                    <span className="font-bold text-sky-700">{client.campaigns?.length || 0}</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">مهام مفتوحة:</span>
                    <span className={cn("font-bold", openTasks > 0 ? "text-amber-600" : "text-slate-500")}>
                      {openTasks}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <button
                  onClick={() => handleOpenReassignModal(client)}
                  className="w-full px-3 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 rounded-xl font-semibold flex items-center justify-center gap-1.5 transition-colors text-[11px]"
                  title={isOwner ? "إعادة إسناد العميل" : "صلاحية حصرية للمدير العام"}
                >
                  <ArrowRightLeft className="w-3.5 h-3.5 text-sky-600" />
                  <span>إعادة إسناد العميل</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Step 1: Reassign / Edit Client Modal */}
      {editingClient && !showConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <form
            onSubmit={handleProceedToConfirm}
            className="bg-surface rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-sky-600" />
                إعادة إسناد مسؤول العميل: <span className="text-sky-700 font-extrabold">{editingClient.name}</span>
              </h3>
              <button
                type="button"
                onClick={() => setEditingClient(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Workload Preview Before Transfer */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Briefcase className="w-4 h-4 text-sky-600" />
                الحمل الحالي وتوزيع المصممين (Workload Overview):
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                {designers.map((d) => {
                  const isSelected = d.id === newOwnerId;
                  const isCurrent = d.id === editingClient.owner_roster_id;
                  return (
                    <div
                      key={d.id}
                      onClick={() => setNewOwnerId(d.id)}
                      className={cn(
                        "p-2 rounded-lg border cursor-pointer transition-all",
                        isSelected
                          ? "bg-sky-50 border-sky-400 shadow-xs"
                          : isCurrent
                          ? "bg-amber-50/50 border-amber-300"
                          : "bg-white border-slate-200 hover:border-slate-300"
                      )}
                    >
                      <div className="flex items-center justify-between font-bold text-slate-800">
                        <span>{d.displayName}</span>
                        {isCurrent && <span className="text-[9px] bg-amber-200 text-amber-900 px-1 rounded">الحالي</span>}
                        {isSelected && <span className="text-[9px] bg-sky-200 text-sky-900 px-1 rounded">المختار</span>}
                      </div>
                      <div className="text-slate-500 text-[10px] mt-0.5">
                        {d.clientCount} عملاء | {d.openTasksCount} مهمة نشطة
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Target Designer Dropdown */}
            <div className="space-y-1.5 text-xs">
              <label className="font-bold text-slate-800 block">المصمم المسؤول الجديد:</label>
              <select
                value={newOwnerId}
                onChange={(e) => setNewOwnerId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white text-slate-800 font-medium focus:ring-2 focus:ring-sky-500 focus:outline-none"
              >
                <option value="">-- إزالة الإسناد (غير مسند / Unassigned) --</option>
                {designers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.displayName} — {d.jobTitle} ({d.clientCount} عميل - {d.openTasksCount} مهمة مفتوحة)
                  </option>
                ))}
              </select>
            </div>

            {/* Transfer Mode Radio Options */}
            <div className="space-y-2 pt-2">
              <label className="text-xs font-bold text-slate-800 block">خيار نقل المهام المفتوحة:</label>
              <div className="space-y-2 text-xs">
                <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="transferOption"
                    checked={!reassignOpenTasks}
                    onChange={() => setReassignOpenTasks(false)}
                    className="mt-0.5 text-sky-600 focus:ring-sky-500"
                  />
                  <div>
                    <div className="font-bold text-slate-800">
                      1. تغيير المسؤول الأساسي عن العميل فقط للمهام المستقبلية
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      تبقى المهام الحالية قيد التنفيذ مع المصمم القديم دون تغيير، ويكتفي النظام بتغيير مالك الحساب.
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 p-3 rounded-xl border border-amber-200 bg-amber-50/50 hover:bg-amber-50 cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="transferOption"
                    checked={reassignOpenTasks}
                    onChange={() => setReassignOpenTasks(true)}
                    className="mt-0.5 text-amber-600 focus:ring-amber-500"
                  />
                  <div>
                    <div className="font-bold text-amber-900">
                      2. تغيير المسؤول ونقل المهام المفتوحة الحالية أيضاً ({clientOpenTasksCount} مهمة مفتوحة)
                    </div>
                    <div className="text-[11px] text-amber-700 mt-0.5">
                      يتم فوراً نقل جميع المهام غير المسلمة وغير الملغاة إلى المسؤول الجديد.
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <div className="text-[10px] text-slate-400 bg-slate-50 p-2 rounded-lg border border-slate-100">
              * تنبيه أمني: لا يتم نقل المهام المسلمة أو الملغاة أو السجلات التاريخية للحفاظ على صحة التقارير.
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setEditingClient(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs flex items-center gap-1.5"
              >
                متابعة لتأكيد النقل
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Step 2: Confirmation Modal */}
      {editingClient && showConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-surface rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100 text-sky-700">
              <div className="p-2 rounded-xl bg-sky-100 text-sky-700">
                <AlertTriangle className="w-6 h-6 text-sky-600" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">تأكيد عملية نقل الحساب</h3>
                <p className="text-xs text-slate-500">يرجى مراجعة التفاصيل قبل اعتماد النقل النهائي</p>
              </div>
            </div>

            {statusMessage && (
              <div
                className={cn(
                  "p-3 rounded-xl text-xs font-semibold",
                  statusMessage.type === "success"
                    ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                    : "bg-rose-50 text-rose-800 border border-rose-200"
                )}
              >
                {statusMessage.text}
              </div>
            )}

            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2.5 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500">اسم العميل:</span>
                <span className="font-extrabold text-slate-900">{editingClient.name}</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500">المسؤول القديم:</span>
                <span className="font-bold text-slate-700">{currentDesignerName}</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500">المسؤول الجديد:</span>
                <span className="font-extrabold text-sky-700">{newDesignerName}</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500">المهام المفتوحة التي ستُنقل:</span>
                <span className={cn("font-bold", reassignOpenTasks ? "text-amber-700 font-extrabold" : "text-slate-600")}>
                  {reassignOpenTasks ? `${clientOpenTasksCount} مهمة` : "0 (للمستقبلية فقط)"}
                </span>
              </div>
              {targetDesigner && (
                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-500">الحمل المتوقع للمصمم الجديد:</span>
                  <span className="font-bold text-slate-800">
                    {targetDesigner.clientCount + (editingClient.owner_roster_id !== targetDesigner.id ? 1 : 0)} عملاء
                  </span>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setShowConfirmation(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                رجوع للتعديل
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={handleExecuteAssignment}
                className="px-6 py-2.5 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs flex items-center gap-2"
              >
                {isSaving ? "جاري تنفيذ النقل..." : "تأكيد النقل النهائي"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
