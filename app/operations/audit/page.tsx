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
  transition_task_status: { label: "تغيير حالة تاسك", color: "bg-sky-50 text-sky-700 border-sky-200" },
  import_content_calendar_tasks: { label: "اعتماد واستيراد مهام", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  save_ai_calendar_extraction: { label: "حفظ فحص الذكاء الاصطناعي", color: "bg-purple-50 text-purple-700 border-purple-200" },
  archive_task: { label: "أرشفة مهمة (Soft Delete)", color: "bg-rose-50 text-rose-700 border-rose-200" },
  restore_task: { label: "استعادة مهمة من الأرشيف", color: "bg-teal-50 text-teal-700 border-teal-200" },
  update_client_assignment: { label: "تعديل مسؤول الحساب", color: "bg-amber-50 text-amber-800 border-amber-200" },
  send_invitation: { label: "إنشاء مسودة دعوة", color: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  owner_bootstrap: { label: "تهيئة المالك للمنظومة", color: "bg-yellow-50 text-yellow-800 border-yellow-200" },
  resolve_comment: { label: "إغلاق ملاحظة مراجعة", color: "bg-slate-100 text-slate-700 border-slate-200" },
  apply_calendar_revision: { label: "تطبيق إصدار تقويم (Safe Apply)", color: "bg-cyan-50 text-cyan-700 border-cyan-200" },
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
          throw new Error("عفواً، هذه الصفحة مخصصة لمالك الشركة ومدير النظام فقط (Owner / Company Owner Access).");
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <Link href="/operations" className="hover:text-sky-600 transition-colors">
              مركز العمليات (Operations)
            </Link>
            <span>/</span>
            <span className="text-slate-800 font-semibold">سجل التدقيق والأمان (Audit Log)</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-sky-600" />
            سجل التدقيق والأمان الشامل
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            توثيق تاريخي آمن لكل العمليات الحساسة وتغييرات الحالة والتعديلات في مساحة العمل.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchEvents()}
            disabled={loading}
            className="p-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-all text-xs flex items-center gap-1.5 shadow-2xs"
            title="تحديث السجل"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            <span className="hidden sm:inline">تحديث</span>
          </button>

          <button
            onClick={handleExportCsv}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition-all shadow-xs flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            <span>تصدير CSV (UTF-8)</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 p-4 rounded-2xl bg-surface border border-slate-200 shadow-xs">
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1.5">نوع العملية (Action):</label>
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
            className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-800 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
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
          <label className="text-xs font-semibold text-slate-700 block mb-1.5">نوع الكيان (Entity Type):</label>
          <select
            value={entityFilter}
            onChange={(e) => {
              setEntityFilter(e.target.value);
              setPage(1);
            }}
            className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-800 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
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
          <div className="text-xs text-slate-500 pb-2">
            إجمالي السجلات المطابقة: <strong className="text-slate-900">{totalCount}</strong> عملية
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {/* Audit Log Table */}
      <div className="rounded-2xl border border-slate-200 bg-surface shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-slate-500 text-xs flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-sky-600" />
            <span>جاري تحميل سجلات التدقيق...</span>
          </div>
        ) : events.length === 0 ? (
          <div className="py-20 text-center text-slate-400 text-xs">
            لا توجد سجلات تطابق الفلتر المحدد حالياً.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {events.map((ev) => {
              const actInfo = ACTION_LABELS[ev.action] || {
                label: ev.action,
                color: "bg-slate-100 text-slate-700 border-slate-200",
              };
              const isExpanded = expandedRowId === ev.id;

              return (
                <div key={ev.id} className="p-4 hover:bg-slate-50/70 transition-colors">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="flex items-start md:items-center gap-3">
                      <span className={cn("px-2.5 py-1 rounded-lg border text-xs font-semibold shrink-0", actInfo.color)}>
                        {actInfo.label}
                      </span>

                      <div>
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                          <span>{ev.actorName}</span>
                          {ev.actorTitle && <span className="text-[11px] font-normal text-slate-500">({ev.actorTitle})</span>}
                          <span className="text-slate-300">•</span>
                          <span className="text-slate-600 font-mono text-[11px]">{ev.entityType}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                          ID: {ev.entityId || "N/A"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <div className="flex items-center gap-1 font-mono text-[11px]">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>{new Date(ev.createdAt).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })}</span>
                      </div>

                      <button
                        onClick={() => setExpandedRowId(isExpanded ? null : ev.id)}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-[11px] flex items-center gap-1 transition-all"
                      >
                        <Eye className="w-3 h-3" />
                        <span>{isExpanded ? "إخفاء التفاصيل" : "التفاصيل"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Expanded Metadata JSON Inspector */}
                  {isExpanded && (
                    <div className="mt-3 p-3 rounded-xl bg-slate-900 border border-slate-800 text-left font-mono text-[11px] text-slate-200 overflow-x-auto" dir="ltr">
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
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
          <div>
            الصفحة <strong className="text-slate-900">{page}</strong> من <strong className="text-slate-900">{totalPages}</strong>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 flex items-center gap-1 font-semibold"
            >
              <ChevronRight className="w-3.5 h-3.5" />
              <span>السابق</span>
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 flex items-center gap-1 font-semibold"
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
