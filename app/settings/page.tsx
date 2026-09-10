"use client";

import React, { useState, useEffect } from "react";
import {
  Settings,
  Clock,
  Database,
  Shield,
  Key,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Mail,
  PauseCircle,
  PlayCircle,
  Sparkles,
  Cpu,
  Zap,
  Activity,
  FileText,
  XCircle,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { DeadlineSettingsCard } from "@/components/settings/DeadlineSettingsCard";

export default function SettingsPage() {
  const [timezone, setTimezone] = useState("Africa/Cairo");
  const [workweek, setWorkweek] = useState("الأحد - الخميس (Sun - Thu)");
  const [threshold, setThreshold] = useState("240");
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [invitationsPaused, setInvitationsPaused] = useState<boolean>(true);
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [updatingPause, setUpdatingPause] = useState<boolean>(false);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [aiMetrics, setAiMetrics] = useState<any>(null);
  const [loadingAi, setLoadingAi] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const fetchAiMetrics = async () => {
    setLoadingAi(true);
    setAiError(null);
    try {
      const res = await fetch("/api/ai/jobs");
      const data = await res.json();
      if (res.ok && data.success) {
        setAiMetrics(data.metrics);
      } else {
        setAiError(data.error || "لوحة الاستهلاك متاحة للمدير العام فقط.");
      }
    } catch (e: any) {
      setAiError(e.message || "فشل الاتصال بخدمة مراقبة الذكاء الاصطناعي.");
    } finally {
      setLoadingAi(false);
    }
  };

  const fetchInvitationStatus = async () => {
    try {
      const res = await fetch("/api/workspace/invitations-status");
      if (res.ok) {
        const data = await res.json();
        setInvitationsPaused(data.invitationsPaused ?? true);
        setWorkspaceId(data.workspaceId || "");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const toggleInvitationsPause = async () => {
    if (!workspaceId) return;
    const targetState = !invitationsPaused;
    if (!targetState && !confirm("هل أنت متأكد من رغبتك في إعادة فتح الدعوات الآن؟")) {
      return;
    }

    setUpdatingPause(true);
    setPauseError(null);
    try {
      const res = await fetch("/api/workspace/invitations-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          paused: targetState,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "فشل تحديث حالة الدعوات.");
      }

      setInvitationsPaused(data.invitationsPaused);
    } catch (err: any) {
      setPauseError(err.message || "حدث خطأ أثناء تعديل الإعداد.");
    } finally {
      setUpdatingPause(false);
    }
  };

  const runDiagnostics = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/diagnostics");
      const data = await res.json();
      setDiagnostics(data);
    } catch (e: any) {
      setDiagnostics({ status: "error", message: e.message });
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    runDiagnostics();
    fetchInvitationStatus();
    fetchAiMetrics();
  }, []);

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">إعدادات مساحة العمل</h1>
        <p className="text-sm text-slate-500 mt-1">
          تهيئة المنطقة الزمنية المعتمدة، أسبوع العمل، وقواعد حماية وأمان البيانات
        </p>
      </div>

      {/* Deadline Engine Settings (Configurable Lead Days & Timezone) */}
      <DeadlineSettingsCard />

      {/* Section 1: General Workspace Settings */}
      <div className="bg-surface rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5">
        <h2 className="font-bold text-base text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3">
          <Clock className="w-4 h-4 text-sky-600" />
          إعدادات الوقت وساعات العمل
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="font-bold text-slate-700 block mb-1.5">
              المنطقة الزمنية الرسمية (IANA Timezone):
            </label>
            <input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-mono bg-slate-50"
              readOnly
            />
            <p className="text-[11px] text-slate-400 mt-1">
              المنطقة المعتمدة لحساب بدايات ونهايات الأشهر وتوافق الجلسات هي Africa/Cairo.
            </p>
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1.5">
              أسبوع العمل الرسمي (Workweek):
            </label>
            <input
              type="text"
              value={workweek}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-slate-50"
              readOnly
            />
            <p className="text-[11px] text-slate-400 mt-1">
              من الأحد إلى الخميس بمعدل 40 ساعة أسبوعياً.
            </p>
          </div>

          <div className="sm:col-span-2">
            <label className="font-bold text-slate-700 block mb-1.5">
              حد التنبيه للجلسات الطويلة غير الاعتيادية (بالدقائق):
            </label>
            <input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="w-48 px-3 py-2 border border-slate-200 rounded-xl text-xs"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              يظهر تنبيهاً مرئياً عند استمرار العداد لأكثر من 240 دقيقة (4 ساعات) دون خصم آلي تعسفي.
            </p>
          </div>
        </div>
      </div>

      {/* Section 2: Supabase Diagnostics & Connection */}
      <div className="bg-surface rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="font-bold text-base text-slate-900 flex items-center gap-2">
            <Database className="w-4 h-4 text-sky-600" />
            حالة الاتصال بقاعدة بيانات Supabase المخصصة
          </h2>
          <button
            onClick={runDiagnostics}
            disabled={testing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", testing && "animate-spin")} />
            إعادة الفحص
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div
            className={cn(
              "p-4 rounded-xl border flex items-start gap-3",
              diagnostics?.status === "connected"
                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : "bg-amber-50 border-amber-200 text-amber-900"
            )}
          >
            {diagnostics?.status === "connected" ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            )}
            <div>
              <div className="font-bold text-sm">
                {diagnostics?.message || "جاري فحص الاتصال بقاعدة البيانات..."}
              </div>
              {diagnostics?.status === "connected" && (
                <div className="mt-1 text-emerald-800">
                  قاعدة البيانات جاهزة وموثقة: تم التحقق من الجداول وقواعد الأمان (RLS) ومحددات عدم التكرار.
                </div>
              )}
            </div>
          </div>

          {diagnostics?.status !== "connected" && (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-slate-700">
              <div className="font-bold text-slate-900">تعليمات تهيئة مشروع Supabase الخاص بك:</div>
              <p className="leading-relaxed">
                التطبيق مهيأ مع ملفات الـ SQL كاملة في مجلد{" "}
                <code className="bg-slate-200 px-1 py-0.5 rounded font-mono">supabase/migrations</code>.
                لتفعيل الاتصال الحقيقي بالسيرفر:
              </p>
              <ol className="list-decimal list-inside space-y-1 font-mono text-[11px] text-slate-800" dir="ltr">
                <li>Create dedicated Supabase project</li>
                <li>Run migrations 20260906000001 to 20260906000005 in Supabase SQL Editor</li>
                <li>Add NEXT_PUBLIC_SUPABASE_URL and KEYS in .env.local</li>
              </ol>
            </div>
          )}
        </div>
      </div>

      {/* Section: AI Operations & Gemini Usage (Owner Only) */}
      <div className="bg-surface rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="font-bold text-base text-slate-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-600" />
              عمليات واستهلاك الذكاء الاصطناعي (Gemini AI Operations & Usage)
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              مراقبة مباشرة للحصة المجانية (Free Tier)، واستهلاك التوكنز، وحماية التزامن، ونسبة التوفير عبر الكاش
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/settings/system-health"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-semibold transition-colors"
            >
              <Activity className="w-3.5 h-3.5" />
              صحة النظام
              <ExternalLink className="w-3 h-3" />
            </Link>
            <button
              onClick={fetchAiMetrics}
              disabled={loadingAi}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", loadingAi && "animate-spin")} />
              تحديث
            </button>
          </div>
        </div>

        {loadingAi && !aiMetrics ? (
          <div className="text-center py-8 text-xs text-slate-400">جاري تحميل إحصائيات الذكاء الاصطناعي...</div>
        ) : aiError ? (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
            {aiError}
          </div>
        ) : aiMetrics ? (
          <div className="space-y-4 text-xs">
            {/* Model & Config Badges */}
            <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
              <span className="text-slate-500 font-medium">النموذج المعتمد:</span>
              <span className="px-2.5 py-1 bg-indigo-100 text-indigo-800 rounded-lg font-mono font-bold text-[11px] flex items-center gap-1">
                <Cpu className="w-3.5 h-3.5" />
                {aiMetrics.activeModel || "gemini-2.5-flash"}
              </span>
              <span className="text-slate-500 font-medium mr-2">الاحتياطي التلقائي:</span>
              <span className="px-2.5 py-1 bg-slate-200 text-slate-700 rounded-lg font-mono text-[11px]">
                {aiMetrics.fallbackModel || "gemini-2.0-flash / gemini-1.5-flash"}
              </span>
              <span className="text-slate-500 font-medium mr-2">حصة التزامن:</span>
              <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-lg font-medium text-[11px]">
                أقصى عمليتين متوازيتين
              </span>
            </div>

            {/* KPI Cards Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-slate-500 text-[11px] font-medium">إجمالي الطلبات</div>
                <div className="text-lg font-bold text-slate-900 mt-0.5">{aiMetrics.totalGeminiRequests || 0}</div>
                <div className="text-[10px] text-slate-400 mt-1">
                  {aiMetrics.completedRequests || 0} مكتمل | {aiMetrics.failedRequests || 0} فشل
                </div>
              </div>

              <div className="p-3.5 bg-emerald-50/60 rounded-xl border border-emerald-200">
                <div className="text-emerald-800 text-[11px] font-medium">نسبة توفير الكاش</div>
                <div className="text-lg font-bold text-emerald-700 mt-0.5">
                  {aiMetrics.totalGeminiRequests
                    ? `${Math.round((aiMetrics.cacheHits / aiMetrics.totalGeminiRequests) * 100)}%`
                    : "0%"}
                </div>
                <div className="text-[10px] text-emerald-600 mt-1">
                  {aiMetrics.cacheHits || 0} استرجاع كاش فوري
                </div>
              </div>

              <div className="p-3.5 bg-indigo-50/60 rounded-xl border border-indigo-200">
                <div className="text-indigo-800 text-[11px] font-medium">إجمالي التوكنز</div>
                <div className="text-lg font-bold text-indigo-700 mt-0.5">
                  {(aiMetrics.totalTokens || 0).toLocaleString()}
                </div>
                <div className="text-[10px] text-indigo-600 mt-1 font-mono">
                  {(aiMetrics.inputTokens || 0).toLocaleString()} in / {(aiMetrics.outputTokens || 0).toLocaleString()} out
                </div>
              </div>

              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-slate-500 text-[11px] font-medium">متوسط المعالجة</div>
                <div className="text-lg font-bold text-slate-900 mt-0.5">{aiMetrics.avgDurationSeconds || 0} ثانية</div>
                <div className="text-[10px] text-slate-400 mt-1">لكل تقويم كامل</div>
              </div>
            </div>

            {/* Free Tier Protection Notice */}
            <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded-xl text-amber-900 text-[11px] leading-relaxed">
              <strong className="font-bold block mb-0.5">ضوابط الحصة المجانية (Google Gemini Free Tier Rules):</strong>
              الحصة الرسمية محددة بـ 15 طلب في الدقيقة (RPM) و 1,000,000 توكن في الدقيقة (TPM).
              يحمي النظام مساحة العمل عبر جدول الطوابير الدائم <code className="font-mono bg-amber-100 px-1 py-0.5 rounded">ai_processing_jobs</code> مع منع تشغيل أكثر من عمليتين في اللحظة ذاتها وتفعيل الانتظار التدريجي (Exponential Backoff).
            </div>

            {/* Recent Jobs Table */}
            {aiMetrics.recentJobs && aiMetrics.recentJobs.length > 0 && (
              <div className="space-y-2 pt-2">
                <div className="font-bold text-slate-800 text-xs">سجل أحدث عمليات التحليل:</div>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-right text-[11px]">
                    <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="p-2.5">الوقت</th>
                        <th className="p-2.5">النموذج</th>
                        <th className="p-2.5">الحالة</th>
                        <th className="p-2.5">التوكنز</th>
                        <th className="p-2.5">المدة</th>
                        <th className="p-2.5">الكاش</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {aiMetrics.recentJobs.slice(0, 8).map((job: any) => (
                        <tr key={job.id} className="hover:bg-slate-50/80">
                          <td className="p-2.5 text-slate-600 font-mono text-[10px]">
                            {new Date(job.createdAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td className="p-2.5 font-mono text-slate-700">{job.model || "gemini-2.5-flash"}</td>
                          <td className="p-2.5">
                            <span
                              className={cn(
                                "px-2 py-0.5 rounded-full text-[10px] font-bold",
                                job.status === "completed"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : job.status === "failed"
                                  ? "bg-rose-100 text-rose-800"
                                  : job.status === "rate_limited"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-sky-100 text-sky-800"
                              )}
                            >
                              {job.status === "completed"
                                ? "ناجح"
                                : job.status === "failed"
                                ? "فشل"
                                : job.status === "rate_limited"
                                ? "حد الحصة"
                                : "قيد المعالجة"}
                            </span>
                          </td>
                          <td className="p-2.5 font-mono text-slate-700">{(job.tokens || 0).toLocaleString()}</td>
                          <td className="p-2.5 text-slate-600">{job.durationSeconds || 0} ثانية</td>
                          <td className="p-2.5">
                            {job.cacheHit ? (
                              <span className="text-emerald-700 font-bold text-[10px] bg-emerald-50 px-2 py-0.5 rounded">كاش</span>
                            ) : (
                              <span className="text-slate-400 text-[10px]">جديد</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Section: Invitations Control (Owner Only) */}
      <div className="bg-surface rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4 text-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="font-bold text-base text-slate-900 flex items-center gap-2">
            <Mail className="w-4 h-4 text-sky-600" />
            حالة قبول الدعوات (إدارة المدير العام)
          </h2>
          <span
            className={cn(
              "px-3 py-1 rounded-full text-xs font-bold border",
              invitationsPaused
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : "bg-emerald-50 text-emerald-700 border-emerald-200"
            )}
          >
            {invitationsPaused ? "متوقفة مؤقتًا" : "مفتوحة ومفعلة"}
          </span>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <div className="font-bold text-slate-800">إيقاف استقبال وقبول الدعوات لجميع الأعضاء:</div>
              <p className="text-slate-500 text-[11px] mt-0.5">
                عند التفعيل، يتم حظر قبول أي رابط دعوة قديم أو إرسال دعوات جديدة في مساحة العمل وتظهر رسالة التوقف المؤقت.
              </p>
            </div>
            <button
              onClick={toggleInvitationsPause}
              disabled={updatingPause}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold text-white transition-colors flex items-center gap-1.5 shadow-xs shrink-0",
                invitationsPaused
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-rose-600 hover:bg-rose-700"
              )}
            >
              {updatingPause ? (
                <span>جاري الحفظ...</span>
              ) : invitationsPaused ? (
                <>
                  <PlayCircle className="w-4 h-4" />
                  <span>إعادة فتح الدعوات</span>
                </>
              ) : (
                <>
                  <PauseCircle className="w-4 h-4" />
                  <span>إيقاف الدعوات مؤقتًا</span>
                </>
              )}
            </button>
          </div>

          {pauseError && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-[11px] font-semibold">
              {pauseError}
            </div>
          )}

          <div className="p-3 bg-amber-50/80 border border-amber-200/80 rounded-lg text-amber-900 text-[11px] leading-relaxed">
            <strong>نص الرسالة التي تظهر للمستخدم عند فتح رابط قديم أثناء التوقف:</strong>
            <p className="mt-1 font-semibold text-amber-800">
              «الدعوات متوقفة مؤقتًا لحين الانتهاء من تحديث مساحة العمل. سيصلك رابط جديد عند إعادة فتح الدعوات.»
            </p>
          </div>
        </div>
      </div>

      {/* Section 3: Owner Bootstrap & Roster Linking Guide */}
      <div className="bg-surface rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4 text-xs">
        <h2 className="font-bold text-base text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3">
          <Shield className="w-4 h-4 text-sky-600" />
          تهيئة المدير العام وربط الحسابات الحقيقية (Owner Bootstrap & Roster Linking)
        </h2>

        <p className="text-slate-600 leading-relaxed">
          وفقاً للمعايير الأمنية، تم فصل سجلات أعضاء الفريق الستة (ندى، عماد، سارة، آلاء، شهد، آية) عن حسابات الدخول الموثقة (Auth Users).
          يمكن للمصممين امتلاك المهام وتسجيل الساعات فور ربط حساباتهم عبر دعوة آمنة يرسلها المدير العام دون إنشاء حسابات وهمية مسبقة.
        </p>

        <div className="p-3.5 bg-sky-50 border border-sky-100 rounded-xl text-sky-900">
          <div className="font-bold mb-1">خطوات دعوة عضو حقيقي وربط حسابه:</div>
          <ol className="list-decimal list-inside space-y-1 text-[11px] leading-relaxed">
            <li>يقوم المدير العام بالدخول لقسم "التيم" والضغط على "إرسال رابط دعوة".</li>
            <li>يقوم العضو بفتح الرابط وتأكيد بريده الإلكتروني الحقيقي.</li>
            <li>يقوم النظام بإنشاء عضوية موثقة في <code className="font-mono">workspace_memberships</code> تلقائياً وربطها بسجل العضو والعملاء المسندين له دون إعادة كتابة التاريخ.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
