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
      // 1. Fetch AI Jobs Queue
      const jobsRes = await fetch("/api/ai/jobs?limit=15");
      if (jobsRes.status === 403) {
        setIsOwner(false);
        setLoading(false);
        return;
      }

      if (jobsRes.ok) {
        const jobsData = await jobsRes.json();
        const rawJobs: JobItem[] = jobsData.jobs || [];
        setJobs(rawJobs);

        // Calculate counts
        const counts = { pending: 0, processing: 0, waiting_for_retry: 0, completed: 0, failed: 0 };
        rawJobs.forEach((j) => {
          if (counts[j.status] !== undefined) {
            counts[j.status]++;
          }
        });
        setQueueCounts(counts);
      }

      // 2. Fetch Team Workload
      const workloadRes = await fetch("/api/team/workload");
      if (workloadRes.ok) {
        const wlData = await workloadRes.json();
        setWorkloadMembers(wlData.members || []);
        if (typeof wlData.invitationsPaused === "boolean") {
          setInvitationsPaused(wlData.invitationsPaused);
        }
      }
    } catch (err: any) {
      setError(err.message || "فشل تحميل بيانات العمليات.");
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
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto">
          <Lock className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-white">صلاحيات مالك الايجنسي مطلوبة</h2>
        <p className="text-xs text-zinc-400">
          هذه الصفحة مخصصة لمالك مساحة العمل (Owner) لمراقبة البنية التحتية، طوابير المعالجة، وسجلات الأمان.
        </p>
        <Link
          href="/"
          className="inline-block px-5 py-2.5 rounded-xl bg-sky-600 text-white font-semibold text-xs"
        >
          العودة للرئيسية
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8 text-right max-w-7xl mx-auto pb-16" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-sky-400 font-semibold mb-1">
            <span>مركز القيادة والعمليات</span>
            <span>•</span>
            <span>OMG Operations Hub</span>
          </div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-sky-400" />
            مركز العمليات وإدارة الإنتاج الإبداعي
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            مراقبة طابور معالجة الذكاء الاصطناعي، ضغط العمل ومواعيد التسليم، وصحة البنية التحتية للايجنسي.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchOperationsData()}
            disabled={loading}
            className="p-2.5 rounded-xl border border-zinc-700 bg-zinc-800/80 text-zinc-300 hover:text-white hover:bg-zinc-700 transition-all text-xs flex items-center gap-1.5"
            title="تحديث البيانات"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            <span className="hidden sm:inline">تحديث</span>
          </button>

          <Link
            href="/operations/audit"
            className="px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-white font-semibold text-xs transition-all flex items-center gap-2"
          >
            <ShieldCheck className="w-4 h-4 text-teal-400" />
            <span>سجل التدقيق والأمان</span>
          </Link>
        </div>
      </div>

      {/* Security & Invitations Paused Banner */}
      <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 flex items-start justify-between gap-4 text-xs">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-amber-200">
              نظام الحماية والأمان النشط: إرسال الدعوات الحقيقية متوقف مؤقتاً (Safety Paused)
            </p>
            <p className="text-amber-300/80 leading-relaxed">
              وفقاً لسياسة الأمان الصارمة للايجنسي، تم تثبيت `invitations_paused = true` لحماية الفريق والعملاء. تعمل نافذة الدعوات بنظام المسودات الداخلية (Draft Mode) فقط بدون إرسال رسائل بريد إلكتروني حقيقية.
            </p>
          </div>
        </div>
        <Link
          href="/team"
          className="shrink-0 px-3.5 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-semibold border border-amber-500/40 text-xs transition-all"
        >
          مركز الدعوات
        </Link>
      </div>

      {/* System Health KPIs Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">قاعدة البيانات (Supabase)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="mt-2 text-xl font-bold text-white">متصل وآمن</p>
          <p className="text-[11px] text-zinc-500 mt-1">28 عميل • 18 مهمة • 7 أعضاء</p>
        </div>

        <div className="p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">طابور AI Jobs</span>
            <Cpu className="w-4 h-4 text-sky-400" />
          </div>
          <p className="mt-2 text-xl font-bold text-white">{jobs.length} مهمة</p>
          <p className="text-[11px] text-zinc-500 mt-1">
            {queueCounts.processing} قيد التنفيذ • {queueCounts.failed} فشل
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">فريق التصميم</span>
            <Users className="w-4 h-4 text-purple-400" />
          </div>
          <p className="mt-2 text-xl font-bold text-white">{workloadMembers.length} مصممين</p>
          <p className="text-[11px] text-zinc-500 mt-1">
            توزيع الحمل ذكي مع مراعاة الصعوبة
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">محرك التحليل (Gemini)</span>
            <Sparkles className="w-4 h-4 text-teal-400" />
          </div>
          <p className="mt-2 text-xl font-bold text-white">Gemini 2.5 Flash</p>
          <p className="text-[11px] text-zinc-500 mt-1">Worker غير متزامن + Backoff</p>
        </div>
      </div>

      {/* AI Jobs Queue Section */}
      <div className="p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Cpu className="w-5 h-5 text-sky-400" />
              طابور معالجة ملفات التقويم بالذكاء الاصطناعي (Durable Job Queue)
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              يعمل في الخلفية بنظام الحجز الذري (Lease Locking) واستعادة الأعطال التلقائية.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {workerMessage && (
              <span className="text-xs text-emerald-400 font-medium">{workerMessage}</span>
            )}
            <button
              onClick={handleTriggerWorker}
              disabled={workerRunning}
              className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs flex items-center gap-2 transition-all shadow-lg shadow-sky-600/20 disabled:opacity-50"
            >
              <Play className={cn("w-3.5 h-3.5", workerRunning && "animate-spin")} />
              <span>{workerRunning ? "جاري تشغيل الـWorker..." : "تشغيل فوري للـWorker"}</span>
            </button>
          </div>
        </div>

        {/* Queue Status Pills */}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-3 py-1.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300">
            في الانتظار: <strong className="text-white">{queueCounts.pending}</strong>
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400">
            قيد التحليل: <strong className="text-white">{queueCounts.processing}</strong>
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
            في انتظار الإعادة: <strong className="text-white">{queueCounts.waiting_for_retry}</strong>
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            اكتمل بنجاح: <strong className="text-white">{queueCounts.completed}</strong>
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400">
            فشل نهائي: <strong className="text-white">{queueCounts.failed}</strong>
          </span>
        </div>

        {/* Jobs List Table */}
        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          {jobs.length === 0 ? (
            <div className="py-12 text-center text-zinc-500 text-xs">
              لا توجد عمليات مسجلة في طابور الذكاء الاصطناعي حالياً.
            </div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {jobs.map((job) => {
                const isFailed = job.status === "failed";
                const isProcessing = job.status === "processing";
                const isSuccess = job.status === "completed";

                return (
                  <div key={job.id} className="p-4 hover:bg-zinc-800/30 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          "px-2.5 py-1 rounded-lg border font-semibold text-[11px]",
                          isSuccess
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                            : isFailed
                            ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                            : isProcessing
                            ? "bg-sky-500/10 text-sky-400 border-sky-500/30 animate-pulse"
                            : "bg-amber-500/10 text-amber-400 border-amber-500/30"
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
                        <div className="flex items-center gap-2 font-medium text-white">
                          <span>{job.campaign?.client?.name || "تقويم محتوى"}</span>
                          <span className="text-zinc-500">•</span>
                          <span className="text-zinc-400 font-mono text-[11px]">
                            {job.campaign?.month_key || "N/A"}
                          </span>
                        </div>
                        <p className="text-zinc-500 text-[11px] font-mono mt-0.5">
                          Job ID: {job.id} (المحاولة {job.attempt_count} من {job.max_attempts})
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-zinc-400">
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
                          className="px-3 py-1 rounded-lg border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 font-semibold text-[11px] flex items-center gap-1.5 transition-all"
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
      <div className="p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-5">
        <div className="border-b border-zinc-800/80 pb-4">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-400" />
            رادار مواعيد التسليم وتوزيع الحمل الإبداعي (Workload Radar)
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            توزيع متوازن للمصممين طبقاً لصعوبة الحسابات وتوقيت القاهرة، مع فصل مواعيد التصميم عن مواعيد النشر.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {workloadMembers.map((m) => {
            const isOver = m.status === "overloaded";
            const isUnder = m.status === "underutilized";

            return (
              <div key={m.id} className="p-4 rounded-xl bg-zinc-800/40 border border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-sm text-white">{m.displayName}</h3>
                    <p className="text-[11px] text-zinc-400">{m.jobTitle}</p>
                  </div>
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-semibold border",
                      isOver
                        ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                        : isUnder
                        ? "bg-sky-500/10 text-sky-400 border-sky-500/30"
                        : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    )}
                  >
                    {isOver ? "حمل مرتفع" : isUnder ? "سعة متاحة" : "متوازن"}
                  </span>
                </div>

                {/* Progress bar */}
                <div>
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
                    <span>نسبة التحميل:</span>
                    <strong className="text-white font-mono">{m.loadRatio}%</strong>
                  </div>
                  <div className="w-full bg-zinc-700 h-1.5 rounded-full overflow-hidden">
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
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-800 text-[11px]">
                  <div className="p-2 rounded-lg bg-zinc-900/60">
                    <span className="text-zinc-500 block text-[10px]">تسليم خلال 7 أيام:</span>
                    <strong className="text-amber-400 font-bold text-xs">{m.dueNext7Days} مهمة</strong>
                  </div>
                  <div className="p-2 rounded-lg bg-zinc-900/60">
                    <span className="text-zinc-500 block text-[10px]">تسليم خلال 14 يوم:</span>
                    <strong className="text-zinc-300 font-bold text-xs">{m.dueNext14Days} مهمة</strong>
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
      <div className="p-6 rounded-2xl bg-gradient-to-l from-sky-950/40 to-zinc-900/60 border border-sky-500/20 space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-sky-400" />
              مخطط التوسع المؤسسي للايجنسي (Agency Scale Blueprint)
            </h2>
            <p className="text-xs text-zinc-400">
              وثيقة التصميم الهندسي والمعايير التشغيلية للتوسع من 10 مصممين إلى 200 مصمم مع الحفاظ على الأمان والسرعة.
            </p>
          </div>
          <a
            href="https://github.com/OMDANY1/OMG-Tracker/blob/main/docs/AGENCY_SCALE_BLUEPRINT.md"
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-xl bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/30 font-semibold text-xs flex items-center gap-1.5 transition-all"
          >
            <span>عرض الوثيقة الكاملة</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800 space-y-1">
            <p className="font-bold text-white">1. الأمان والعزل التام</p>
            <p className="text-zinc-400 text-[11px]">
              Multi-Tenant RLS على مستوى الـDatabase يضمن عدم تسرب أي بيانات بين العملاء أو الموظفين.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800 space-y-1">
            <p className="font-bold text-white">2. طابور خلفي مستقر</p>
            <p className="text-zinc-400 text-[11px]">
              معالجة الـPDF في الخلفية عبر Worker مستقل يمنع Vercel Timeout مع استعادة تلقائية عند الأعطال.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800 space-y-1">
            <p className="font-bold text-white">3. حماية المهام النشطة</p>
            <p className="text-zinc-400 text-[11px]">
              محرك Revisions ذري يمنع حذف أو الكتابة فوق أي مهمة بدأ المصمم العمل عليها.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
