"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  ShieldAlert,
  ArrowRight,
  Download,
  Filter,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Clock,
  User,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AuditEvent {
  id: string;
  actorId: string | null;
  actorName: string;
  actorTitle: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: any;
  createdAt: string;
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  transition_task_status: { label: "تغيير حالة تاسك", color: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  import_content_calendar_tasks: { label: "اعتماد واستيراد مهام", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  save_ai_calendar_extraction: { label: "حفظ فحص الذكاء الاصطناعي", color: "bg-purple-500/10 text-purple-400 border-purple-500/30" },
  archive_task: { label: "أرشفة مهمة (Soft Delete)", color: "bg-rose-500/10 text-rose-400 border-rose-500/30" },
  restore_task: { label: "استعادة مهمة من الأرشيف", color: "bg-teal-500/10 text-teal-400 border-teal-500/30" },
  update_client_assignment: { label: "تعديل مسؤول الحساب", color: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  send_invitation: { label: "إنشاء مسودة دعوة", color: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30" },
  owner_bootstrap: { label: "تهيئة المالك للمنظومة", color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30" },
  resolve_comment: { label: "إغلاق ملاحظة مراجعة", color: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30" },
  apply_calendar_revision: { label: "تطبيق إصدار تقويم (Safe Apply)", color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30" },
};

export default function AuditLogsPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const fetchEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "20",
      });
      if (actionFilter !== "all") params.append("action", actionFilter);
      if (entityFilter !== "all") params.append("entityType", entityFilter);

      const res = await fetch(`/api/audit-events?${params.toString()}`);
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error("عفواً، هذه الصفحة مخصصة لمالك مساحة العمل فقط (Owner Access).");
        }
        throw new Error("فشل تحميل سجلات التدقيق.");
      }

      const data = await res.json();
      setEvents(data.events || []);
      setTotalPages(data.pagination?.totalPages || 1);
      setTotalCount(data.pagination?.total || 0);
    } catch (err: any) {
      setError(err.message || "حدث خطأ أثناء تحميل السجلات.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [page, actionFilter, entityFilter]);

  const handleExportCsv = () => {
    const params = new URLSearchParams({ format: "csv" });
    if (actionFilter !== "all") params.append("action", actionFilter);
    if (entityFilter !== "all") params.append("entityType", entityFilter);
    window.open(`/api/audit-events?${params.toString()}`, "_blank");
  };

  return (
    <div className="space-y-6 text-right max-w-7xl mx-auto pb-16" dir="rtl">
      {/* Header & Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-zinc-400 mb-1">
            <Link href="/operations" className="hover:text-white transition-colors">
              مركز العمليات (Operations)
            </Link>
            <span>/</span>
            <span className="text-zinc-200">سجل التدقيق والأمان (Audit Log)</span>
          </div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-sky-400" />
            سجل التدقيق والأمان الشامل
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            توثيق تاريخي آمن لكل العمليات الحساسة وتغييرات الحالة والتعديلات في مساحة العمل.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchEvents()}
            disabled={loading}
            className="p-2.5 rounded-xl border border-zinc-700 bg-zinc-800/80 text-zinc-300 hover:text-white hover:bg-zinc-700 transition-all text-xs flex items-center gap-1.5"
            title="تحديث السجل"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            <span className="hidden sm:inline">تحديث</span>
          </button>

          <button
            onClick={handleExportCsv}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-all shadow-lg shadow-emerald-600/20 flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            <span>تصدير CSV (UTF-8)</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800">
        <div>
          <label className="text-xs font-semibold text-zinc-400 block mb-1.5">نوع العملية (Action):</label>
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
            className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
          >
            <option value="all">جميع العمليات ({totalCount})</option>
            <option value="transition_task_status">تغيير حالة تاسك</option>
            <option value="import_content_calendar_tasks">اعتماد واستيراد مهام التقويم</option>
            <option value="save_ai_calendar_extraction">حفظ فحص الذكاء الاصطناعي</option>
            <option value="archive_task">أرشفة مهمة (Soft Delete)</option>
            <option value="restore_task">استعادة مهمة من الأرشيف</option>
            <option value="update_client_assignment">تعديل مسؤول الحساب</option>
            <option value="send_invitation">دعوات الفريق</option>
            <option value="apply_calendar_revision">تطبيق إصدار تقويم (Safe Apply)</option>
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold text-zinc-400 block mb-1.5">نوع الكيان (Entity Type):</label>
          <select
            value={entityFilter}
            onChange={(e) => {
              setEntityFilter(e.target.value);
              setPage(1);
            }}
            className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
          >
            <option value="all">جميع الكيانات</option>
            <option value="tasks">المهام (tasks)</option>
            <option value="campaigns">التقويمات والحملات (campaigns)</option>
            <option value="clients">العملاء (clients)</option>
            <option value="workspace_invitations">الدعوات (workspace_invitations)</option>
            <option value="comments">الملاحظات (comments)</option>
          </select>
        </div>

        <div className="flex items-end">
          <div className="text-xs text-zinc-400 pb-2">
            إجمالي السجلات المطابقة: <strong className="text-white">{totalCount}</strong> عملية
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Audit Log Table */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-zinc-400 text-xs flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-sky-400" />
            <span>جاري تحميل سجلات التدقيق...</span>
          </div>
        ) : events.length === 0 ? (
          <div className="py-20 text-center text-zinc-500 text-xs">
            لا توجد سجلات تطابق الفلتر المحدد حالياً.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/80">
            {events.map((ev) => {
              const actInfo = ACTION_LABELS[ev.action] || {
                label: ev.action,
                color: "bg-zinc-700/40 text-zinc-300 border-zinc-700",
              };
              const isExpanded = expandedRowId === ev.id;

              return (
                <div key={ev.id} className="p-4 hover:bg-zinc-800/30 transition-colors">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="flex items-start md:items-center gap-3">
                      <span className={cn("px-2.5 py-1 rounded-lg border text-xs font-semibold shrink-0", actInfo.color)}>
                        {actInfo.label}
                      </span>

                      <div>
                        <div className="flex items-center gap-2 text-xs font-medium text-white">
                          <span>{ev.actorName}</span>
                          {ev.actorTitle && <span className="text-[11px] text-zinc-400">({ev.actorTitle})</span>}
                          <span className="text-zinc-500">•</span>
                          <span className="text-zinc-400 font-mono text-[11px]">{ev.entityType}</span>
                        </div>
                        <p className="text-[11px] text-zinc-500 mt-0.5 font-mono">
                          ID: {ev.entityId || "N/A"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-zinc-400">
                      <div className="flex items-center gap-1 font-mono text-[11px]">
                        <Clock className="w-3.5 h-3.5 text-zinc-500" />
                        <span>{new Date(ev.createdAt).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })}</span>
                      </div>

                      <button
                        onClick={() => setExpandedRowId(isExpanded ? null : ev.id)}
                        className="px-2.5 py-1 rounded-lg border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-700 text-zinc-300 text-[11px] flex items-center gap-1 transition-all"
                      >
                        <Eye className="w-3 h-3" />
                        <span>{isExpanded ? "إخفاء التفاصيل" : "التفاصيل"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Expanded Metadata JSON Inspector */}
                  {isExpanded && (
                    <div className="mt-3 p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-left font-mono text-[11px] text-zinc-300 overflow-x-auto" dir="ltr">
                      <pre className="whitespace-pre-wrap">
                        {JSON.stringify(ev.metadata, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/60 flex items-center justify-between text-xs text-zinc-400">
          <div>
            الصفحة <strong className="text-white">{page}</strong> من <strong className="text-white">{totalPages}</strong>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 flex items-center gap-1"
            >
              <ChevronRight className="w-3.5 h-3.5" />
              <span>السابق</span>
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 flex items-center gap-1"
            >
              <span>التالي</span>
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
