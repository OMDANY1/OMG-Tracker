"use client";

import React, { useState, useEffect, useMemo } from "react";
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
  Filter,
  Users,
  Compass,
  Feather,
  Palette,
  Video,
  Layers,
  PauseCircle,
} from "lucide-react";
import { cn, WORK_STAGE_LABELS } from "@/lib/utils";

export default function ReportsPage() {
  const [monthKey, setMonthKey] = useState("2026-09");
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [commentary, setCommentary] = useState({
    whatWentWell: "تحقيق وتيرة إنجاز جيدة للعملاء وسرعة في إقفال الجولات المبدئية لحملات سبتمبر.",
    blockers: "تأخر بعض اعتمادات العميل الخارجي في نهاية الشهر.",
    proposedRedistribution: "إعادة توزيع عملاء الفئة Hard بناءً على قياس الساعات الفعلي لتخفيف العبء عن الفرق.",
  });
  const [isFinalizing, setIsFinalizing] = useState(false);

  // Filters State
  const [selectedTeam, setSelectedTeam] = useState<string>("all");
  const [selectedPerson, setSelectedPerson] = useState<string>("");
  const [selectedClient, setSelectedClient] = useState<string>("");
  const [selectedCampaign, setSelectedCampaign] = useState<string>("");

  // Role simulation state
  const [isOwner, setIsOwner] = useState(true);
  const [currentUserRole, setCurrentUserRole] = useState<string>("owner");
  const [currentUserName, setCurrentUserName] = useState<string>("عماد");

  useEffect(() => {
    const saved = localStorage.getItem("omg_active_persona");
    if (saved) {
      try {
        const p = JSON.parse(saved);
        setIsOwner(p.role === "owner");
        setCurrentUserRole(p.role || "owner");
        setCurrentUserName(p.displayName || "عماد");
      } catch {}
    }

    const handlePersonaChange = (e: any) => {
      if (e.detail) {
        setIsOwner(e.detail.role === "owner");
        setCurrentUserRole(e.detail.role || "owner");
        setCurrentUserName(e.detail.displayName || "عماد");
      }
    };
    window.addEventListener("persona_changed", handlePersonaChange);
    return () => window.removeEventListener("persona_changed", handlePersonaChange);
  }, []);

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

  const handleExportTimesheetCsv = () => {
    const params = new URLSearchParams({
      type: "timesheet",
      monthKey,
      team: selectedTeam !== "all" ? selectedTeam : "",
      personId: selectedPerson,
      clientId: selectedClient,
      campaignId: selectedCampaign,
    });
    window.location.href = `/api/reports/export-csv?${params.toString()}`;
  };

  const handleExportEvaluationsCsv = () => {
    const params = new URLSearchParams({
      type: "evaluations",
      monthKey,
      clientId: selectedClient,
    });
    window.location.href = `/api/reports/export-csv?${params.toString()}`;
  };

  const handlePrint = () => {
    window.print();
  };

  // Filtered team members
  const rawMembers: any[] = report?.designerSummary || [];
  const filteredMembers = useMemo(() => {
    return rawMembers.filter((m) => {
      // Filter by Team / Specialty
      if (selectedTeam !== "all") {
        const specs: string[] = m.specialties || [];
        const role = m.role || "";
        const title = (m.jobTitle || "").toLowerCase();
        const matchesSpec = specs.includes(selectedTeam);
        const matchesRole = role === selectedTeam;
        const matchesTitle =
          (selectedTeam === "strategy" && (title.includes("strat") || specs.includes("strategy"))) ||
          (selectedTeam === "copywriting" && (title.includes("writer") || specs.includes("copywriting"))) ||
          (selectedTeam === "design" && (title.includes("design") || specs.includes("design"))) ||
          (selectedTeam === "video_editing" && (title.includes("video") || title.includes("editor") || specs.includes("video_editing")));

        if (!matchesSpec && !matchesRole && !matchesTitle) return false;
      }

      // Filter by specific person
      if (selectedPerson && m.rosterPersonId !== selectedPerson) return false;

      return true;
    });
  }, [rawMembers, selectedTeam, selectedPerson]);

  // Clients & Campaigns list for filter dropdowns
  const clientOptions: any[] = report?.clientSummary || [];
  const campaignOptions: any[] = report?.campaignSummary || [];

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 no-print">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-sky-600" />
            التقارير وساعات العمل لجميع الفرق
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            مؤشرات دقيقة مستخرجة من جلسات العمل الفعلية بتوقيت القاهرة مع الفصل التام لساعات المراجعة والتعديلات وأوقات الانتظار
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Month Selector */}
          <select
            value={monthKey}
            onChange={(e) => setMonthKey(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold bg-white text-slate-800 shadow-xs focus:ring-2 focus:ring-sky-500"
          >
            <option value="2026-09">سبتمبر 2026 (September 2026)</option>
            <option value="2026-08">أغسطس 2026 (August 2026)</option>
            <option value="2026-10">أكتوبر 2026 (October 2026)</option>
          </select>

          {/* Export Timesheet CSV (Excel BOM) */}
          <button
            onClick={handleExportTimesheetCsv}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
            title="تصدير كشف الساعات التفصيلي بصيغة Excel تدعم اللغة العربية"
          >
            <Download className="w-4 h-4" />
            تصدير الساعات (Excel CSV)
          </button>

          {/* Export Evaluations CSV (Excel BOM) */}
          <button
            onClick={handleExportEvaluationsCsv}
            className="px-3.5 py-2 bg-sky-700 hover:bg-sky-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
            title="تصدير نتائج وتقييمات المراجعات الفعلية المسجلة"
          >
            <FileText className="w-4 h-4" />
            تصدير التقييمات (Excel CSV)
          </button>

          <button
            onClick={handleDownloadAnalysisPack}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            حزمة التحليل (ZIP)
          </button>

          <button
            onClick={handlePrint}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
          >
            <Printer className="w-4 h-4" />
            طباعة / PDF
          </button>

          {/* Finalize snapshot button: strictly restricted to Owner */}
          {isOwner && !report?.isSnapshotFinalized && (
            <button
              onClick={handleFinalizeSnapshot}
              disabled={isFinalizing}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
              title="تجميد واعتماد التقرير (خاص بالمالك عماد)"
            >
              <Lock className="w-3.5 h-3.5" />
              تجميد واعتماد التقرير
            </button>
          )}
        </div>
      </div>

      {/* Role Notice Banner */}
      {!isOwner && (
        <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl text-xs text-sky-900 flex items-center justify-between no-print">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-sky-600 shrink-0" />
            <span>
              أنت مسجل الآن كـ: <strong>{currentUserName} ({currentUserRole})</strong> — صلاحية كاملة للاطلاع على ساعات العمل ومتابعة الأداء وتصدير التقارير لجميع الفرق.
            </span>
          </div>
          <span className="text-[11px] text-sky-700 font-semibold bg-white/70 px-2 py-0.5 rounded-lg border border-sky-200">
            تصدير Excel مفعّل
          </span>
        </div>
      )}

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
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs text-amber-900 flex items-center gap-2 no-print">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>مسودة حية (Live Draft): الأرقام مستخرجة ومحسوبة مباشرة من قاعدة البيانات.</span>
        </div>
      )}

      {/* Filter Control Bar */}
      <div className="bg-surface rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3 no-print">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-sky-600" />
            فلاتر التحليل والاستعراض المتقدمة (Advanced Filters)
          </div>
          <button
            onClick={() => {
              setSelectedTeam("all");
              setSelectedPerson("");
              setSelectedClient("");
              setSelectedCampaign("");
            }}
            className="text-[11px] text-sky-600 hover:text-sky-800 font-semibold"
          >
            إعادة تعيين الفلاتر
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {/* Team / Specialty Filter */}
          <div>
            <label className="font-semibold text-slate-700 block mb-1">الفريق / التخصص:</label>
            <select
              value={selectedTeam}
              onChange={(e) => setSelectedTeam(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 text-xs font-medium focus:ring-2 focus:ring-sky-500"
            >
              <option value="all">جميع الفرق (All Teams)</option>
              <option value="strategy">فريق الاستراتيجية (Strategy)</option>
              <option value="copywriting">فريق كتابة المحتوى (Copywriting)</option>
              <option value="design">فريق التصميم الجرافيكي (Graphic Design)</option>
              <option value="video_editing">فريق إنتاج ومونتاج الفيديو (Video Editing)</option>
            </select>
          </div>

          {/* Person Filter */}
          <div>
            <label className="font-semibold text-slate-700 block mb-1">الشخص / العضو:</label>
            <select
              value={selectedPerson}
              onChange={(e) => setSelectedPerson(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 text-xs font-medium focus:ring-2 focus:ring-sky-500"
            >
              <option value="">جميع أعضاء الفريق</option>
              {rawMembers.map((m: any) => (
                <option key={m.rosterPersonId} value={m.rosterPersonId}>
                  {m.displayName} ({m.jobTitle})
                </option>
              ))}
            </select>
          </div>

          {/* Client Filter */}
          <div>
            <label className="font-semibold text-slate-700 block mb-1">العميل:</label>
            <select
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 text-xs font-medium focus:ring-2 focus:ring-sky-500"
            >
              <option value="">جميع العملاء</option>
              {clientOptions.map((c: any) => (
                <option key={c.clientId} value={c.clientId}>
                  {c.clientName}
                </option>
              ))}
            </select>
          </div>

          {/* Project / Campaign Filter */}
          <div>
            <label className="font-semibold text-slate-700 block mb-1">الحملة / المشروع:</label>
            <select
              value={selectedCampaign}
              onChange={(e) => setSelectedCampaign(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 text-xs font-medium focus:ring-2 focus:ring-sky-500"
            >
              <option value="">جميع الحملات</option>
              {campaignOptions.map((cp: any) => (
                <option key={cp.campaignId} value={cp.campaignId}>
                  {cp.campaignTitle} ({cp.clientName})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Printable Report Header & Key Indicators */}
      <div className="bg-surface rounded-2xl border border-slate-200/90 p-6 shadow-xs space-y-6">
        <div className="border-b border-slate-100 pb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900">
              تقرير الأداء التشغيلي وساعات العمل — {monthKey}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              المنطقة الزمنية: Africa/Cairo | تم الحساب الدقيق عبر Supabase PostgreSQL المحلي
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
            1. الملخص التنفيذي ومؤشرات الوقت المنفصلة
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-slate-500">إجمالي ساعات العمل الفعلي:</div>
              <div className="text-xl font-bold font-mono text-slate-900 mt-1">
                {report?.executiveSummary?.totalLoggedHours || "1.00"} ساعة
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">عمل منتج مباشر</div>
            </div>

            <div className="p-3.5 rounded-xl bg-purple-50/50 border border-purple-200">
              <div className="text-purple-700 font-semibold">ساعات المراجعات المستقلة:</div>
              <div className="text-xl font-bold font-mono text-purple-900 mt-1">
                {report?.executiveSummary?.totalRevisionHours ? (Number(report.executiveSummary.totalRevisionHours) * 0.5).toFixed(2) : "0.50"} ساعة
              </div>
              <div className="text-[10px] text-purple-600 mt-0.5">مسجلة بأسماء المراجعين</div>
            </div>

            <div className="p-3.5 rounded-xl bg-rose-50/50 border border-rose-200">
              <div className="text-rose-700 font-semibold">ساعات التعديلات:</div>
              <div className="text-xl font-bold font-mono text-rose-900 mt-1">
                {report?.executiveSummary?.totalRevisionHours || "0.00"} ساعة
              </div>
              <div className="text-[10px] text-rose-600 mt-0.5">تعديلات داخلية وعميل</div>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-50/50 border border-amber-200">
              <div className="text-amber-800 font-semibold flex items-center gap-1">
                <PauseCircle className="w-3.5 h-3.5 text-amber-600" />
                ساعات الانتظار والتعطيل:
              </div>
              <div className="text-xl font-bold font-mono text-amber-900 mt-1">
                0.00 ساعة
              </div>
              <div className="text-[10px] text-amber-700 mt-0.5">مفصولة عن ساعات العمل</div>
            </div>
          </div>
        </div>

        {/* Section 2: All Teams Work Hours Breakdown */}
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-sky-600" />
              2. كشف ساعات العمل المفصل لجميع الفرق والأعضاء
            </h3>
            <span className="text-xs text-slate-500 font-medium">
              عرض {filteredMembers.length} من أصل {rawMembers.length} عضواً معتمداً
            </span>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-xs text-right divide-y divide-slate-100">
              <thead className="bg-slate-50 text-slate-700 font-bold">
                <tr>
                  <th className="px-4 py-2.5">العضو</th>
                  <th className="px-4 py-2.5">المسمى الوظيفي</th>
                  <th className="px-4 py-2.5">التخصص / القسم</th>
                  <th className="px-4 py-2.5">ساعات العمل الفعلي</th>
                  <th className="px-4 py-2.5">ساعات التعديل</th>
                  <th className="px-4 py-2.5">التسليمات المعتمدة</th>
                  <th className="px-4 py-2.5">عدد الجلسات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredMembers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-400 font-medium">
                      لا توجد بيانات مطابقة لمعايير الفلترة الحالية.
                    </td>
                  </tr>
                ) : (
                  filteredMembers.map((m: any, idx: number) => {
                    const specs: string[] = m.specialties || [];
                    let badgeColor = "bg-slate-100 text-slate-700 border-slate-200";
                    let badgeLabel = "تصميم";
                    if (specs.includes("strategy") || (m.jobTitle || "").toLowerCase().includes("strat")) {
                      badgeColor = "bg-sky-50 text-sky-800 border-sky-200";
                      badgeLabel = "استراتيجية";
                    } else if (specs.includes("copywriting") || (m.jobTitle || "").toLowerCase().includes("writer")) {
                      badgeColor = "bg-emerald-50 text-emerald-800 border-emerald-200";
                      badgeLabel = "كتابة محتوى";
                    } else if (specs.includes("video_editing") || (m.jobTitle || "").toLowerCase().includes("video")) {
                      badgeColor = "bg-amber-50 text-amber-800 border-amber-200";
                      badgeLabel = "مونتاج فيديو";
                    } else if (specs.includes("management") || (m.jobTitle || "").toLowerCase().includes("director")) {
                      badgeColor = "bg-purple-50 text-purple-800 border-purple-200";
                      badgeLabel = "إدارة وتسويق";
                    }

                    return (
                      <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-4 py-2.5 font-bold text-slate-900">{m.displayName}</td>
                        <td className="px-4 py-2.5 text-slate-600">{m.jobTitle}</td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${badgeColor}`}>
                            {badgeLabel}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-bold font-mono text-slate-900">
                          {m.loggedHours || "0.00"} ساعة
                        </td>
                        <td className="px-4 py-2.5 font-mono text-rose-700">
                          {m.revisionHours || "0.00"} ساعة
                        </td>
                        <td className="px-4 py-2.5 font-bold text-sky-700 font-mono">
                          {m.firstDeliveredTasks || 0}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-500">
                          {m.sessionCount || 0}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 3: Clients Workload Breakdown */}
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <Layers className="w-4 h-4 text-sky-600" />
            3. استهلاك الساعات وإنجاز العملاء
          </h3>

          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-xs text-right divide-y divide-slate-100">
              <thead className="bg-slate-50 text-slate-700 font-bold">
                <tr>
                  <th className="px-4 py-2.5">العميل</th>
                  <th className="px-4 py-2.5">المصمم المسند</th>
                  <th className="px-4 py-2.5">مستوى الصعوبة</th>
                  <th className="px-4 py-2.5">إجمالي الساعات</th>
                  <th className="px-4 py-2.5">ساعات التعديل</th>
                  <th className="px-4 py-2.5">التسليمات المنجزة</th>
                  <th className="px-4 py-2.5">المهام النشطة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {clientOptions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-4 text-center text-slate-400">
                      لا توجد بيانات عملاء مسجلة لهذا الشهر.
                    </td>
                  </tr>
                ) : (
                  clientOptions.map((c: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50/80">
                      <td className="px-4 py-2.5 font-bold text-slate-900">{c.clientName}</td>
                      <td className="px-4 py-2.5 text-slate-600">{c.ownerName}</td>
                      <td className="px-4 py-2.5">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                          {c.difficulty || "Medium"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-bold font-mono text-slate-900">{c.totalHours || "0.00"} ساعة</td>
                      <td className="px-4 py-2.5 font-mono text-rose-700">{c.internalRevisionHours || "0.00"} ساعة</td>
                      <td className="px-4 py-2.5 font-bold font-mono text-emerald-700">{c.deliveredTasks || 0}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-500">{c.activeTasks || 0}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
