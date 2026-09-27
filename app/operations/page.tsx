"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Activity,
  ShieldCheck,
  Cpu,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Users,
  Layers,
  ArrowRight,
  ExternalLink,
  Clock,
  Play,
  RotateCcw,
  Sparkles,
  FileText,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DeadlineSettingsCard } from "@/components/settings/DeadlineSettingsCard";

interface JobItem {
  id: string;
  campaign_id: string;
  status: "pending" | "processing" | "waiting_for_retry" | "completed" | "failed";
  attempt_count: number;
  max_attempts: number;
  error_code?: string | null;
  error_message?: string | null;
  processing_duration_ms?: number | null;
  created_at: string;
  campaign?: {
    client_id: string;
    month_key: string;
    client?: { name: string };
  };
}

interface WorkloadMember {
  id: string;
  displayName: string;
  jobTitle: string;
  role: string;
  activeClientsCount: number;
  activeTasksCount: number;
  weightedLoadScore: number;
  maxWeightedLoad: number;
  loadRatio: number;
  status: "underutilized" | "balanced" | "overloaded";
  dueNext7Days: number;
  dueNext14Days: number;
}

export default function OperationsHubPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(true);

  // Dynamic system counts
  const [clientsCount, setClientsCount] = useState<number>(0);
  const [tasksCount, setTasksCount] = useState<number>(0);
  const [dbConnected, setDbConnected] = useState<boolean>(true);

  // Queue state
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [queueCounts, setQueueCounts] = useState({
    pending: 0,
    processing: 0,
    waiting_for_retry: 0,
    completed: 0,
    failed: 0,
  });
  const [workerRunning, setWorkerRunning] = useState(false);
  const [workerMessage, setWorkerMessage] = useState<string | null>(null);

  // Workload state
  const [workloadMembers, setWorkloadMembers] = useState<WorkloadMember[]>([]);
  const [invitationsPaused, setInvitationsPaused] = useState(true);

  // Retrying job
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);

  const fetchOperationsData = async () => {
    setLoading(true);
    setError(null);

    try {
      const [jobsRes, workloadRes, clientsRes, tasksRes] = await Promise.all([
        fetch("/api/ai/jobs?limit=15"),
        fetch("/api/team/workload"),
        fetch("/api/clients"),
        fetch("/api/tasks"),
      ]);

      if (jobsRes.status === 403) {
        setIsOwner(false);
        setLoading(false);
        return;
      }

      if (jobsRes.ok) {
        const jobsData = await jobsRes.json();
        const rawJobs: JobItem[] = jobsData.jobs || [];
        setJobs(rawJobs);

        const counts = { pending: 0, processing: 0, waiting_for_retry: 0, completed: 0, failed: 0 };
        rawJobs.forEach((j) => {
          if (counts[j.status] !== undefined) {
            counts[j.status]++;
          }
        });
        setQueueCounts(counts);
      }

      if (workloadRes.ok) {
        const wlData = await workloadRes.json();
        setWorkloadMembers(wlData.members || []);
        if (typeof wlData.invitationsPaused === "boolean") {
          setInvitationsPaused(wlData.invitationsPaused);
        }
      }

      if (clientsRes.ok) {
        const cData = await clientsRes.json();
        setClientsCount(cData.clients?.length || 0);
      }

      if (tasksRes.ok) {
        const tData = await tasksRes.json();
        setTasksCount(tData.tasks?.length || 0);
      }

      setDbConnected(jobsRes.ok && clientsRes.ok);
    } catch (err: any) {
      setError(err.message || "فشل تحميل بيانات العمليات.");
      setDbConnected(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOperationsData();
  }, []);

  const handleTriggerWorker = async () => {
    setWorkerRunning(true);
    setWorkerMessage(null);
    try {
      const res = await fetch("/api/ai/worker", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "فشل تشغيل الـWorker");
      }
      setWorkerMessage(data.message || "تم فحص وتنفيذ المهام الجاهزة في الطابور بنجاح.");
      await fetchOperationsData();
    } catch (err: any) {
      setWorkerMessage("خطأ: " + err.message);
    } finally {
      setWorkerRunning(false);
    }
  };

  const handleRetryJob = async (jobId: string) => {
    setRetryingJobId(jobId);
    try {
      const res = await fetch("/api/ai/jobs/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "فشل طلب إعادة المحاولة.");
      }
      await fetchOperationsData();
    } catch (err: any) {
      alert("خطأ أثناء إعادة المحاولة: " + err.message);
    } finally {
      setRetryingJobId(null);
    }
  };

  if (!isOwner) {
    return (
      <div className="py-24 text-center space-y-4 text-right max-w-md mx-auto" dir="rtl">
        <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 mx-auto">
          <Lock className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">صلاحيات إدارة مساحة العمل مطلوبة</h2>
        <p className="text-xs text-slate-500">
          هذه الصفحة مخصصة لمالك الشركة والمدير العام لمراقبة البنية التحتية، طوابير المعالجة، وسجلات الأمان.
        </p>
        <Link
          href="/"
          className="inline-block px-5 py-2.5 rounded-xl bg-sky-600 text-white font-semibold text-xs hover:bg-sky-700 transition-all shadow-xs"
        >
          العودة للرئيسية
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8 text-right max-w-7xl mx-auto pb-16" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-sky-600 font-semibold mb-1">
            <span>مركز القيادة والعمليات</span>
            <span>•</span>
            <span>OMG Operations Hub</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Activity className="w-6 h-6 text-sky-600" />
            مركز العمليات وإدارة الإنتاج الإبداعي
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            مراقبة طابور معالجة الذكاء الاصطناعي، ضغط العمل ومواعيد التسليم، وصحة البنية التحتية للايجنسي.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchOperationsData()}
            disabled={loading}
            className="p-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-all text-xs flex items-center gap-1.5 shadow-xs"
            title="تحديث البيانات"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            <span className="hidden sm:inline">تحديث</span>
          </button>

          <Link
            href="/operations/audit"
            className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs transition-all flex items-center gap-2 shadow-xs"
          >
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>سجل التدقيق والأمان</span>
          </Link>
        </div>
      </div>

      {/* Security & Invitations Paused Banner */}
      <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 flex items-start justify-between gap-4 text-xs">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-amber-900">
              نظام الحماية والأمان النشط: إرسال الدعوات الحقيقية متوقف مؤقتاً (Safety Paused)
            </p>
            <p className="text-amber-700/90 leading-relaxed">
              وفقاً لسياسة الأمان الصارمة للايجنسي، تم تثبيت `invitations_paused = true` لحماية الفريق والعملاء. تعمل نافذة الدعوات بنظام المسودات الداخلية (Draft Mode) فقط بدون إرسال رسائل بريد إلكتروني حقيقية.
            </p>
          </div>
        </div>
        <Link
          href="/team"
          className="shrink-0 px-3.5 py-1.5 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 font-semibold border border-amber-300 text-xs transition-all shadow-xs"
        >
          مركز الدعوات
        </Link>
      </div>

      {/* System Health KPIs Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-surface border border-slate-200/90 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">قاعدة البيانات (Supabase)</span>
            {dbConnected ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-500" />
            )}
          </div>
          <p className="mt-2 text-xl font-bold text-slate-900">
            {dbConnected ? "متصل وآمن" : "فحص الاتصال"}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 font-medium">
            {clientsCount} عميل • {tasksCount} مهمة • {workloadMembers.length} أعضاء
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-surface border border-slate-200/90 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">طابور AI Jobs</span>
            <Cpu className="w-4 h-4 text-sky-600" />
          </div>
          <p className="mt-2 text-xl font-bold text-slate-900">{jobs.length} مهمة</p>
          <p className="text-[11px] text-slate-500 mt-1">
            {queueCounts.processing} قيد التنفيذ • {queueCounts.failed} فشل
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-surface border border-slate-200/90 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">فريق العمل</span>
            <Users className="w-4 h-4 text-purple-600" />
          </div>
          <p className="mt-2 text-xl font-bold text-slate-900">{workloadMembers.length} أعضاء</p>
          <p className="text-[11px] text-slate-500 mt-1">
            توزيع الحمل ذكي مع مراعاة الصعوبة
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-surface border border-slate-200/90 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">محرك التحليل (Gemini)</span>
            <Sparkles className="w-4 h-4 text-teal-600" />
          </div>
          <p className="mt-2 text-xl font-bold text-slate-900">Gemini 2.5 Flash</p>
          <p className="text-[11px] text-slate-500 mt-1">Worker غير متزامن + Backoff</p>
        </div>
      </div>

      {/* AI Jobs Queue Section */}
      <div className="p-6 rounded-2xl bg-surface border border-slate-200/90 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Cpu className="w-5 h-5 text-sky-600" />
              طابور معالجة ملفات التقويم بالذكاء الاصطناعي (Durable Job Queue)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              يعمل في الخلفية بنظام الحجز الذري (Lease Locking) واستعادة الأعطال التلقائية.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {workerMessage && (
              <span className="text-xs text-emerald-700 font-medium">{workerMessage}</span>
            )}
            <button
              onClick={handleTriggerWorker}
              disabled={workerRunning}
              className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs flex items-center gap-2 transition-all shadow-xs disabled:opacity-50"
            >
              <Play className={cn("w-3.5 h-3.5", workerRunning && "animate-spin")} />
              <span>{workerRunning ? "جاري تشغيل الـWorker..." : "تشغيل فوري للـWorker"}</span>
            </button>
          </div>
        </div>

        {/* Queue Status Pills */}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-700">
            في الانتظار: <strong className="text-slate-900">{queueCounts.pending}</strong>
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-sky-50 border border-sky-200 text-sky-700">
            قيد التحليل: <strong className="text-sky-900">{queueCounts.processing}</strong>
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-700">
            في انتظار الإعادة: <strong className="text-amber-900">{queueCounts.waiting_for_retry}</strong>
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700">
            اكتمل بنجاح: <strong className="text-emerald-900">{queueCounts.completed}</strong>
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700">
            فشل نهائي: <strong className="text-rose-900">{queueCounts.failed}</strong>
          </span>
        </div>

        {/* Jobs List Table */}
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          {jobs.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              لا توجد عمليات مسجلة في طابور الذكاء الاصطناعي حالياً.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {jobs.map((job) => {
                const isFailed = job.status === "failed";
                const isProcessing = job.status === "processing";
                const isSuccess = job.status === "completed";

                return (
                  <div key={job.id} className="p-4 hover:bg-slate-50/60 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          "px-2.5 py-1 rounded-lg border font-semibold text-[11px]",
                          isSuccess
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : isFailed
                            ? "bg-rose-50 text-rose-700 border-rose-200"
                            : isProcessing
                            ? "bg-sky-50 text-sky-700 border-sky-200 animate-pulse"
                            : "bg-amber-50 text-amber-700 border-amber-200"
                        )}
                      >
                        {isSuccess
                          ? "اكتمل بنجاح"
                          : isFailed
                          ? "فشل نهائي"
                          : isProcessing
                          ? "جاري التحليل"
                          : "في الانتظار"}
                      </span>

                      <div>
                        <div className="flex items-center gap-2 font-medium text-slate-900">
                          <span>{job.campaign?.client?.name || "تقويم محتوى"}</span>
                          <span className="text-slate-400">•</span>
                          <span className="text-slate-500 font-mono text-[11px]">
                            {job.campaign?.month_key || "N/A"}
                          </span>
                        </div>
                        <p className="text-slate-400 text-[11px] font-mono mt-0.5">
                          Job ID: {job.id} (المحاولة {job.attempt_count} من {job.max_attempts})
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-slate-500">
                      {job.processing_duration_ms && (
                        <span className="font-mono text-[11px]">
                          {(job.processing_duration_ms / 1000).toFixed(1)} ثانية
                        </span>
                      )}

                      <span className="font-mono text-[11px]">
                        {new Date(job.created_at).toLocaleTimeString("ar-EG", { timeZone: "Africa/Cairo" })}
                      </span>

                      {isFailed && (
                        <button
                          onClick={() => handleRetryJob(job.id)}
                          disabled={retryingJobId === job.id}
                          className="px-3 py-1 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800 font-semibold text-[11px] flex items-center gap-1.5 transition-all"
                        >
                          <RotateCcw className={cn("w-3 h-3", retryingJobId === job.id && "animate-spin")} />
                          <span>إعادة المحاولة</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Designer Workload & Deadlines Radar Section */}
      <div className="p-6 rounded-2xl bg-surface border border-slate-200/90 shadow-xs space-y-5">
        <div className="border-b border-slate-100 pb-4">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-600" />
            رادار مواعيد التسليم وتوزيع الحمل الإبداعي (Workload Radar)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            توزيع متوازن للمصممين طبقاً لصعوبة الحسابات وتوقيت القاهرة، مع فصل مواعيد التصميم عن مواعيد النشر.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {workloadMembers.map((m) => {
            const isOver = m.status === "overloaded";
            const isUnder = m.status === "underutilized";

            return (
              <div key={m.id} className="p-4 rounded-xl bg-slate-50/50 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900">{m.displayName}</h3>
                    <p className="text-[11px] text-slate-500">{m.jobTitle}</p>
                  </div>
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-semibold border",
                      isOver
                        ? "bg-rose-50 text-rose-700 border-rose-200"
                        : isUnder
                        ? "bg-sky-50 text-sky-700 border-sky-200"
                        : "bg-emerald-50 text-emerald-700 border-emerald-200"
                    )}
                  >
                    {isOver ? "حمل مرتفع" : isUnder ? "سعة متاحة" : "متوازن"}
                  </span>
                </div>

                {/* Progress bar */}
                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                    <span>نسبة التحميل:</span>
                    <strong className="text-slate-800 font-mono">{m.loadRatio}%</strong>
                  </div>
                  <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full transition-all",
                        isOver ? "bg-rose-500" : isUnder ? "bg-sky-500" : "bg-emerald-500"
                      )}
                      style={{ width: `${Math.min(100, m.loadRatio)}%` }}
                    />
                  </div>
                </div>

                {/* Deadlines radar */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-[11px]">
                  <div className="p-2 rounded-lg bg-white border border-slate-100">
                    <span className="text-slate-500 block text-[10px]">تسليم خلال 7 أيام:</span>
                    <strong className="text-amber-700 font-bold text-xs">{m.dueNext7Days} مهمة</strong>
                  </div>
                  <div className="p-2 rounded-lg bg-white border border-slate-100">
                    <span className="text-slate-500 block text-[10px]">تسليم خلال 14 يوم:</span>
                    <strong className="text-slate-700 font-bold text-xs">{m.dueNext14Days} مهمة</strong>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Deadline Engine Settings & Safe Recalculation Card */}
      <DeadlineSettingsCard />

      {/* Agency Scale Blueprint Card */}
      <div className="p-6 rounded-2xl bg-sky-50/50 border border-sky-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-sky-600" />
              مخطط التوسع المؤسسي للايجنسي (Agency Scale Blueprint)
            </h2>
            <p className="text-xs text-slate-600">
              وثيقة التصميم الهندسي والمعايير التشغيلية للتوسع من 10 مصممين إلى 200 مصمم مع الحفاظ على الأمان والسرعة.
            </p>
          </div>
          <a
            href="https://github.com/OMDANY1/OMG-Tracker/blob/main/docs/AGENCY_SCALE_BLUEPRINT.md"
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-xl bg-white hover:bg-sky-50 text-sky-700 border border-sky-300 font-semibold text-xs flex items-center gap-1.5 transition-all shadow-xs"
          >
            <span>عرض الوثيقة الكاملة</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1 shadow-2xs">
            <p className="font-bold text-slate-900">1. الأمان والعزل التام</p>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              Multi-Tenant RLS على مستوى الـDatabase يضمن عدم تسرب أي بيانات بين العملاء أو الموظفين.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1 shadow-2xs">
            <p className="font-bold text-slate-900">2. طابور خلفي مستقر</p>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              معالجة الـPDF في الخلفية عبر Worker مستقل يمنع Vercel Timeout مع استعادة تلقائية عند الأعطال.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1 shadow-2xs">
            <p className="font-bold text-slate-900">3. حماية المهام النشطة</p>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              محرك Revisions ذري يمنع حذف أو الكتابة فوق أي مهمة بدأ المصمم العمل عليها.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
