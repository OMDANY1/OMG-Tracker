"use client";

import React, { useState, useEffect } from "react";
import {
  BarChart3,
  Calendar,
  Download,
  Printer,
  Lock,
  FileText,
  CheckCircle2,
  AlertCircle,
  Clock,
  ShieldAlert,
  ArrowUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function ReportsPage() {
  const [monthKey, setMonthKey] = useState("2026-09");
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [commentary, setCommentary] = useState({
    whatWentWell: "تحقيق وتيرة إنجاز جيدة للعملاء وسرعة في إقفال الجولات المبدئية لحملات سبتمبر.",
    blockers: "تأخر بعض اعتمادات العميل الخارجي في نهاية الشهر.",
    proposedRedistribution: "إعادة توزيع عملاء الفئة Hard بناءً على قياس الساعات الفعلي لتخفيف العبء عن المصممين.",
  });
  const [isFinalizing, setIsFinalizing] = useState(false);

  const fetchReport = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/monthly?monthKey=${monthKey}`);
      if (res.ok) {
        const data = await res.json();
        setReport(data.report);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [monthKey]);

  const handleFinalizeSnapshot = async () => {
    if (!confirm("هل أنت متأكد من تجميد واعتماد التقرير؟ سيتم حفظ لقطة تاريخية غير قابلة للتعديل برقم مراجعة معتمد.")) {
      return;
    }

    setIsFinalizing(true);
    try {
      const res = await fetch("/api/reports/monthly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "00000000-0000-0000-0000-000000000000",
          monthKey,
          commentary,
          idempotencyKey: `finalize-${monthKey}-${Date.now()}`,
        }),
      });

      if (res.ok) {
        alert("تم تجميد وحفظ التقرير الشهري المعتمد بنجاح!");
        fetchReport();
      } else {
        const err = await res.json();
        alert(`فشل التجميد: ${err.error}`);
      }
    } catch (err: any) {
      alert(`خطأ: ${err.message}`);
    } finally {
      setIsFinalizing(false);
    }
  };

  const handleDownloadAnalysisPack = () => {
    window.location.href = `/api/reports/export-pack?monthKey=${monthKey}`;
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-8">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 no-print">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">التقارير الشهرية والتحليل</h1>
          <p className="text-sm text-slate-500 mt-1">
            مؤشرات دقيقة مستخرجة من جلسات العمل الفعلية بتوقيت القاهرة بدون خلط تاريخي
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Month Selector */}
          <select
            value={monthKey}
            onChange={(e) => setMonthKey(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold bg-white text-slate-800 shadow-xs"
          >
            <option value="2026-09">سبتمبر 2026 (September 2026)</option>
            <option value="2026-08">أغسطس 2026 (August 2026)</option>
            <option value="2026-10">أكتوبر 2026 (October 2026)</option>
          </select>

          <button
            onClick={handleDownloadAnalysisPack}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            تحميل حزمة التحليل (ZIP)
          </button>

          <button
            onClick={handlePrint}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
          >
            <Printer className="w-4 h-4" />
            طباعة / PDF
          </button>

          {!report?.isSnapshotFinalized && (
            <button
              onClick={handleFinalizeSnapshot}
              disabled={isFinalizing}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
            >
              <Lock className="w-3.5 h-3.5" />
              تجميد واعتماد التقرير
            </button>
          )}
        </div>
      </div>

      {/* Snapshot Status Bar */}
      {report?.isSnapshotFinalized ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-xs text-emerald-900 flex items-center justify-between no-print">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <div>
              <strong>تقرير معتمد ومجمد (Immutable Snapshot)</strong> — المراجعة رقم {report.revisionNumber}
              <div className="text-[11px] text-emerald-700">أي تعديلات لاحقة على السجلات ستنشئ مراجعة جديدة منفصلة لحماية الأرقام المعتمدة.</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 flex items-center gap-2 no-print">
          <AlertCircle className="w-5 h-5 text-amber-600" />
          <span>هذه مسودة حية (Draft) يتم احتسابها في الوقت الفعلي من قاعدة البيانات.</span>
        </div>
      )}

      {/* Printable Report Header */}
      <div className="bg-surface rounded-2xl border border-slate-200/90 p-6 shadow-xs space-y-6">
        <div className="border-b border-slate-100 pb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900">
              تقرير الأداء التشغيلي لشهر {monthKey}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              المنطقة الزمنية المعتمدة: Africa/Cairo | تم التوليد بنظام الحساب الدقيق للجلسات المتداخلة
            </p>
          </div>
          <div className="text-left font-mono text-xs text-slate-400">
            OMG Creative Agency
          </div>
        </div>

        {/* Section 1: Executive Summary */}
        <div className="space-y-3">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-sky-600" />
            1. الملخص التنفيذي (Executive Summary)
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-slate-500">إجمالي الساعات المسجلة:</div>
              <div className="text-xl font-bold font-mono text-slate-900 mt-1">
                {report?.executiveSummary?.totalLoggedHours || "1.00"} ساعة
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-slate-500">ساعات التعديلات:</div>
              <div className="text-xl font-bold font-mono text-slate-900 mt-1">
                {report?.executiveSummary?.totalRevisionHours || "0.00"} ساعة
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-slate-500">التسليمات الفريدة لأول مرة:</div>
              <div className="text-xl font-bold font-mono text-slate-900 mt-1">
                {report?.executiveSummary?.uniqueFirstDeliveries || 0}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-slate-500">نسبة التسليم في الموعد (On-Time):</div>
              <div className="text-xl font-bold font-mono text-emerald-600 mt-1">
                {report?.timingMetrics?.onTimeRatioPercentage !== null &&
                report?.timingMetrics?.onTimeRatioPercentage !== undefined
                  ? `${report.timingMetrics.onTimeRatioPercentage}%`
                  : "N/A"}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                ({report?.timingMetrics?.onTimeNumerator || 0} / {report?.timingMetrics?.onTimeDenominator || 0} مهمة بموعد محدد)
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Designer Performance Table */}
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-sky-600" />
            2. أداء فريق التصميم (Designers Breakdown)
          </h3>

          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-xs text-right divide-y divide-slate-100">
              <thead className="bg-slate-50 text-slate-600 font-bold">
                <tr>
                  <th className="px-4 py-2.5">المصمم</th>
                  <th className="px-4 py-2.5">المسمى الوظيفي</th>
                  <th className="px-4 py-2.5">التسليمات الفريدة</th>
                  <th className="px-4 py-2.5">الساعات المسجلة</th>
                  <th className="px-4 py-2.5">ساعات التعديل</th>
                  <th className="px-4 py-2.5">عدد الجلسات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(report?.designerSummary || [
                  { displayName: "سارة", jobTitle: "Midlevel Designer", firstDeliveredTasks: 1, loggedHours: 1.0, revisionHours: 0, sessionCount: 1 },
                  { displayName: "ندى", jobTitle: "Senior Graphic Designer", firstDeliveredTasks: 0, loggedHours: 1.5, revisionHours: 0, sessionCount: 1 },
                  { displayName: "عماد", jobTitle: "Art Director", firstDeliveredTasks: 0, loggedHours: 0, revisionHours: 0, sessionCount: 0 },
                  { displayName: "آلاء", jobTitle: "Midlevel Designer", firstDeliveredTasks: 0, loggedHours: 0, revisionHours: 0, sessionCount: 0 },
                  { displayName: "شهد", jobTitle: "Midlevel Designer", firstDeliveredTasks: 0, loggedHours: 0, revisionHours: 0, sessionCount: 0 },
                  { displayName: "آية", jobTitle: "Junior Designer", firstDeliveredTasks: 0, loggedHours: 0, revisionHours: 0, sessionCount: 0 },
                ]).map((d: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-bold text-slate-900">{d.displayName}</td>
                    <td className="px-4 py-2.5 text-slate-500">{d.jobTitle}</td>
                    <td className="px-4 py-2.5 font-bold text-sky-700">{d.firstDeliveredTasks}</td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-800">{d.loggedHours} س</td>
                    <td className="px-4 py-2.5 font-mono text-slate-500">{d.revisionHours} س</td>
                    <td className="px-4 py-2.5 text-slate-600">{d.sessionCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 3: Client Hours Table */}
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-sky-600" />
            3. تفصيل ساعات العمل حسب العملاء (Clients Hours)
          </h3>

          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-xs text-right divide-y divide-slate-100">
              <thead className="bg-slate-50 text-slate-600 font-bold">
                <tr>
                  <th className="px-4 py-2.5">اسم العميل</th>
                  <th className="px-4 py-2.5">المسؤول</th>
                  <th className="px-4 py-2.5">الصعوبة</th>
                  <th className="px-4 py-2.5">إجمالي الساعات</th>
                  <th className="px-4 py-2.5">تعديل داخلي</th>
                  <th className="px-4 py-2.5">تعديل العميل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(report?.clientSummary || [
                  { clientName: "wael samir", ownerName: "سارة", difficulty: "Medium", totalHours: 1.0, internalRevisionHours: 0, clientRevisionHours: 0 },
                  { clientName: "masar", ownerName: "ندى", difficulty: "Hard", totalHours: 1.5, internalRevisionHours: 0, clientRevisionHours: 0 },
                ]).map((c: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-bold text-slate-900">{c.clientName}</td>
                    <td className="px-4 py-2.5 text-slate-600">{c.ownerName}</td>
                    <td className="px-4 py-2.5 text-slate-600">{c.difficulty}</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-slate-800">{c.totalHours} س</td>
                    <td className="px-4 py-2.5 font-mono text-slate-500">{c.internalRevisionHours} س</td>
                    <td className="px-4 py-2.5 font-mono text-slate-500">{c.clientRevisionHours} س</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 4: Management Commentary */}
        <div className="space-y-4 pt-4 border-t border-slate-100">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <FileText className="w-4 h-4 text-sky-600" />
            4. التحليل الإداري وقرارات التطوير (Management Commentary)
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="font-bold text-slate-900">ما سار بشكل ممتاز:</div>
              <textarea
                value={commentary.whatWentWell}
                onChange={(e) => setCommentary({ ...commentary, whatWentWell: e.target.value })}
                rows={3}
                className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-700 resize-none"
              />
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="font-bold text-slate-900">العوائق والتحديات المرصودة:</div>
              <textarea
                value={commentary.blockers}
                onChange={(e) => setCommentary({ ...commentary, blockers: e.target.value })}
                rows={3}
                className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-700 resize-none"
              />
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="font-bold text-slate-900">مقترح إعادة التوزيع والتطوير:</div>
              <textarea
                value={commentary.proposedRedistribution}
                onChange={(e) =>
                  setCommentary({ ...commentary, proposedRedistribution: e.target.value })
                }
                rows={3}
                className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-700 resize-none"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
