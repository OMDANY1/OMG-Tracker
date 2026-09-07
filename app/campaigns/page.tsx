"use client";

import React, { useState, useEffect } from "react";
import {
  Layers,
  Plus,
  Calendar,
  Building2,
  CheckCircle2,
  ExternalLink,
  Wand2,
  X,
} from "lucide-react";
import type { TaskPriority } from "@/types/database";

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // New Campaign Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newClientId, setNewClientId] = useState("");
  const [newObjective, setNewObjective] = useState("");
  const [newBrief, setNewBrief] = useState("");
  const [newStartDate, setNewStartDate] = useState("");
  const [newDueDate, setNewDueDate] = useState("");

  // Batch Generator Modal
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchCampaign, setBatchCampaign] = useState<any>(null);
  const [batchCount, setBatchCount] = useState<number>(12);
  const [batchPrefix, setBatchPrefix] = useState<string>("Post");
  const [batchDeliverableType, setBatchDeliverableType] = useState<string>("Post");
  const [batchAssignee, setBatchAssignee] = useState<string>("سارة");
  const [batchReviewer, setBatchReviewer] = useState<string>("عماد");
  const [batchPriority, setBatchPriority] = useState<TaskPriority>("Normal");
  const [batchDrafts, setBatchDrafts] = useState<any[]>([]);
  const [isDraftGenerated, setIsDraftGenerated] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [campRes, clientsRes] = await Promise.all([
        fetch("/api/campaigns"),
        fetch("/api/clients"),
      ]);
      if (campRes.ok) {
        const cData = await campRes.json();
        setCampaigns(cData.campaigns || []);
      }
      if (clientsRes.ok) {
        const clData = await clientsRes.json();
        setClients(clData.clients || []);
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

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle || !newClientId) return;

    try {
      const clientObj = clients.find((c) => c.id === newClientId);
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: clientObj?.workspace_id,
          clientId: newClientId,
          title: newTitle,
          objective: newObjective,
          brief: newBrief,
          startDate: newStartDate || null,
          dueDate: newDueDate || null,
        }),
      });

      if (res.ok) {
        alert("تم إنشاء الكامبين بنجاح!");
        setShowCreateModal(false);
        setNewTitle("");
        fetchData();
      } else {
        const err = await res.json();
        alert(`فشل الإنشاء: ${err.error}`);
      }
    } catch (err: any) {
      alert(`خطأ: ${err.message}`);
    }
  };

  const handleGenerateBatchPreview = () => {
    const drafts = [];
    for (let i = 1; i <= batchCount; i++) {
      const numStr = String(i).padStart(2, "0");
      drafts.push({
        title: `${batchPrefix} ${numStr}`,
        deliverableType: batchDeliverableType,
        deliverableNumber: numStr,
        priority: batchPriority,
      });
    }
    setBatchDrafts(drafts);
    setIsDraftGenerated(true);
  };

  const handleSaveBatchTasks = async () => {
    if (!batchCampaign || batchDrafts.length === 0) return;

    try {
      const res = await fetch("/api/tasks/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: batchCampaign.workspace_id,
          campaignId: batchCampaign.id,
          clientId: batchCampaign.client_id,
          createdById: "owner-id",
          tasks: batchDrafts,
        }),
      });

      if (res.ok) {
        alert(`تم إنشاء وتوليد ${batchDrafts.length} مهمة بنجاح في الكامبين!`);
        setShowBatchModal(false);
        setIsDraftGenerated(false);
        fetchData();
      } else {
        const err = await res.json();
        alert(`فشل حفظ المهام: ${err.error}`);
      }
    } catch (err: any) {
      alert(`خطأ: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">الكامبينز والحملات الإعلانية</h1>
          <p className="text-sm text-slate-500 mt-1">
            إدارة نطاق الحملات، متابعة مخرجات التصميم، والتوليد المجمّع للمهام (Post 01 ... Post 12)
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          كامبين جديد
        </button>
      </div>

      {/* Campaigns List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {campaigns.map((camp) => {
          const totalTasks = camp.tasks?.length || 0;
          const deliveredTasks =
            camp.tasks?.filter((t: any) => t.status === "delivered").length || 0;
          const progressPercent = totalTasks > 0 ? Math.round((deliveredTasks / totalTasks) * 100) : 0;

          return (
            <div
              key={camp.id}
              className="bg-surface rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-sky-300 hover:shadow-sm transition-all flex flex-col justify-between text-xs space-y-4"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-bold text-base text-slate-900 leading-snug">
                    {camp.title}
                  </h3>
                  <span className="px-2 py-0.5 rounded-md font-semibold text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200">
                    {camp.status}
                  </span>
                </div>

                <div className="mt-2 text-slate-500 flex items-center gap-1.5 text-[11px]">
                  <Building2 className="w-3.5 h-3.5 text-slate-400" />
                  <span>العميل: <strong className="text-slate-800">{camp.client?.name}</strong></span>
                </div>

                {camp.objective && (
                  <p className="text-slate-600 mt-2 text-[11px] line-clamp-2">
                    {camp.objective}
                  </p>
                )}

                {/* Progress bar */}
                <div className="mt-4 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">معدل الإنجاز:</span>
                    <span className="font-bold text-slate-800">
                      {deliveredTasks} من {totalTasks} مخرج ({progressPercent}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-sky-600 h-2 rounded-full transition-all"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <button
                  onClick={() => {
                    setBatchCampaign(camp);
                    setShowBatchModal(true);
                  }}
                  className="px-3 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-xl font-bold flex items-center gap-1.5 transition-colors text-[11px]"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  توليد باقة مهام (Post 01 ... 12)
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* New Campaign Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <form
            onSubmit={handleCreateCampaign}
            className="bg-surface rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-sky-600" />
                إنشاء كامبين جديد
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
                <label className="font-semibold text-slate-700 block mb-1">العميل:</label>
                <select
                  value={newClientId}
                  onChange={(e) => setNewClientId(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white"
                >
                  <option value="">-- اختر العميل --</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.owner?.display_name || "غير مسند"})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">عنوان الكامبين:</label>
                <input
                  type="text"
                  placeholder="مثال: حملة سبتمبر الترويجية 2026"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">الهدف التسويقي:</label>
                <input
                  type="text"
                  placeholder="زيادة الوعي بالمنتج وإطلاق العروض..."
                  value={newObjective}
                  onChange={(e) => setNewObjective(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">تاريخ البدء:</label>
                  <input
                    type="date"
                    value={newStartDate}
                    onChange={(e) => setNewStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">تاريخ الانتهاء:</label>
                  <input
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
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
                حفظ الكامبين
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Batch Generator Modal */}
      {showBatchModal && batchCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-surface rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full p-6 text-right space-y-4 max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-sky-600" />
                توليد باقة مهام مجدولة — {batchCampaign.title}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowBatchModal(false);
                  setIsDraftGenerated(false);
                }}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!isDraftGenerated ? (
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">بادئة التسمية (Prefix):</label>
                    <input
                      type="text"
                      value={batchPrefix}
                      onChange={(e) => setBatchPrefix(e.target.value)}
                      placeholder="Post"
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">عدد المهام المطلوب:</label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={batchCount}
                      onChange={(e) => setBatchCount(parseInt(e.target.value, 10) || 1)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">نوع المخرج:</label>
                    <input
                      type="text"
                      value={batchDeliverableType}
                      onChange={(e) => setBatchDeliverableType(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">الأولوية الافتراضية:</label>
                    <select
                      value={batchPriority}
                      onChange={(e) => setBatchPriority(e.target.value as TaskPriority)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white"
                    >
                      <option value="Normal">عادية</option>
                      <option value="High">عالية</option>
                      <option value="Urgent">عاجلة</option>
                    </select>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-600">
                  سيتم إنشاء مسودة قابلة للمراجعة والتعديل قبل حفظها نهائياً بقاعدة البيانات.
                </div>

                <div className="pt-3 border-t border-slate-100 flex justify-end">
                  <button
                    onClick={handleGenerateBatchPreview}
                    className="px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs"
                  >
                    معاينة المسودة
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 flex-1 flex flex-col overflow-hidden text-xs">
                <div className="font-bold text-slate-800">
                  معاينة المهام المراد إنشاؤها ({batchDrafts.length} مهمة):
                </div>

                <div className="flex-1 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                  {batchDrafts.map((draft, idx) => (
                    <div key={idx} className="p-2.5 flex items-center justify-between gap-3">
                      <input
                        type="text"
                        value={draft.title}
                        onChange={(e) => {
                          const updated = [...batchDrafts];
                          updated[idx].title = e.target.value;
                          setBatchDrafts(updated);
                        }}
                        className="px-2 py-1 border border-slate-200 rounded-lg text-xs font-bold text-slate-800 flex-1"
                      />
                      <span className="text-slate-500 font-mono text-[11px]">
                        #{draft.deliverableNumber}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <button
                    onClick={() => setIsDraftGenerated(false)}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                  >
                    رجوع للتعديل
                  </button>
                  <button
                    onClick={handleSaveBatchTasks}
                    className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs"
                  >
                    تأكيد وحفظ المهام ({batchDrafts.length})
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
