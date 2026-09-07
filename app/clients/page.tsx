"use client";

import React, { useState, useEffect } from "react";
import {
  Building2,
  Users,
  AlertTriangle,
  ArrowRightLeft,
  ExternalLink,
  Edit2,
  Search,
  Filter,
  CheckCircle2,
  X,
} from "lucide-react";
import {
  CLIENT_DIFFICULTY_LABELS,
  CLIENT_EXTRA_WORKLOAD_LABELS,
  cn,
} from "@/lib/utils";

export default function ClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDifficulty, setSelectedDifficulty] = useState("");
  const [selectedOwner, setSelectedOwner] = useState("");

  // Edit / Reassignment Modal
  const [editingClient, setEditingClient] = useState<any>(null);
  const [newOwnerId, setNewOwnerId] = useState<string>("");
  const [reassignOpenTasks, setReassignOpenTasks] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const fetchClients = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/clients");
      if (res.ok) {
        const data = await res.json();
        setClients(data.clients || []);
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

  const filteredClients = clients.filter((c) => {
    if (searchQuery && !c.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (selectedDifficulty && c.difficulty !== selectedDifficulty) return false;
    if (selectedOwner && c.owner?.display_name !== selectedOwner) return false;
    return true;
  });

  const handleUpdateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClient) return;

    setIsSaving(true);
    try {
      const res = await fetch("/api/clients", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: editingClient.id,
          ownerRosterId: newOwnerId || null,
          reassignOpenTasksToNewOwner: reassignOpenTasks,
          actorId: "owner-id",
        }),
      });

      if (res.ok) {
        alert(
          reassignOpenTasks
            ? "تم تغيير مسؤول العميل وإعادة إسناد المهام المفتوحة للمسؤول الجديد بدون المساس بسجلات العمل السابقة."
            : "تم تحديث بيانات العميل بنجاح."
        );
        setEditingClient(null);
        fetchClients();
      } else {
        const err = await res.json();
        alert(`فشل التحديث: ${err.error}`);
      }
    } catch (err: any) {
      alert(`خطأ: ${err.message}`);
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
            28 حساب عميل مع تتبع المسؤول، درجة الصعوبة، وأداة إعادة الإسناد الآمنة
          </p>
        </div>
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
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <button
                  onClick={() => {
                    setEditingClient(client);
                    setNewOwnerId(client.owner_roster_id || "");
                    setReassignOpenTasks(false);
                  }}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold flex items-center gap-1.5 transition-colors text-[11px]"
                >
                  <ArrowRightLeft className="w-3 h-3 text-slate-500" />
                  إعادة إسناد
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Reassign / Edit Client Modal */}
      {editingClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <form
            onSubmit={handleUpdateClient}
            className="bg-surface rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-sky-600" />
                تغيير مسؤول العميل ({editingClient.name})
              </h3>
              <button
                type="button"
                onClick={() => setEditingClient(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">المسؤول الجديد:</label>
                <select
                  value={newOwnerId}
                  onChange={(e) => setNewOwnerId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white"
                >
                  <option value="">-- غير مسند --</option>
                  {["ندى", "عماد", "سارة", "آلاء", "شهد", "آية"].map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 space-y-2">
                <div className="flex items-center gap-2 font-bold">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  خيارات إعادة إسناد المهام المفتوحة
                </div>
                <p className="text-[11px] leading-relaxed">
                  تغيير مسؤول الحساب لا يُعيد تلقائياً إسناد المهام الجارية لتفادي مسح أو خلط سجلات المصممين.
                </p>

                <label className="flex items-center gap-2 font-bold text-[11px] cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={reassignOpenTasks}
                    onChange={(e) => setReassignOpenTasks(e.target.checked)}
                    className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <span>نقل المهام المفتوحة لهذا العميل للمسؤول الجديد (مع الحفاظ الكامل على ساعات الجلسات المسجلة)</span>
                </label>
              </div>
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
                disabled={isSaving}
                className="px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs"
              >
                {isSaving ? "جاري الحفظ..." : "تأكيد التغيير"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
