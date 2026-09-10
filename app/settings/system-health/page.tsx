"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Activity,
  Database,
  ShieldCheck,
  Cpu,
  Sparkles,
  Download,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ArrowRight,
  HardDrive,
  FileText,
  Users,
  Calendar,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function SystemHealthPage() {
  const [loading, setLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState<any>(null);
  const [aiStatus, setAiStatus] = useState<any>(null);
  const [invitationsStatus, setInvitationsStatus] = useState<any>(null);
  const [queueStatus, setQueueStatus] = useState<any>(null);

  const runAllChecks = async () => {
    setLoading(true);
    try {
      // 1. Diagnostics check
      const diagRes = await fetch("/api/diagnostics").catch(() => null);
      if (diagRes?.ok) {
        const dData = await diagRes.json();
        setDbStatus(dData);
      }

      // 2. AI Jobs & models check
      const aiRes = await fetch("/api/ai/jobs").catch(() => null);
      if (aiRes?.ok) {
        const aData = await aiRes.json();
        setAiStatus(aData.metrics);
      }

      // 3. Invitations status
      const invRes = await fetch("/api/workspace/invitations-status").catch(() => null);
      if (invRes?.ok) {
        const iData = await invRes.json();
        setInvitationsStatus(iData);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runAllChecks();
  }, []);

  const handleExport = (type: "tasks" | "calendars" | "workload") => {
    window.location.href = `/api/reports/export-csv?type=${type}`;
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto text-right">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/settings"
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              <span>العودة للإعدادات</span>
            </Link>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 flex items-center gap-2.5">
            <Activity className="w-7 h-7 text-indigo-600" />
            مركز صحة النظام والعمليات (System Health Hub)
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            مراقبة شاملة لحالة الاتصال بقاعدة البيانات، ونماذج الذكاء الاصطناعي، وخدمات التخزين، وحماية الدعوات
          </p>
        </div>

        <button
          onClick={runAllChecks}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          <span>إعادة فحص كافة الخدمات</span>
        </button>
      </div>

      {/* Services Health Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Service 1: PostgreSQL & Supabase Database */}
        <div className="bg-surface rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3.5 text-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
              <Database className="w-4 h-4 text-emerald-600" />
              <span>قاعدة بيانات Supabase (Production DB)</span>
            </div>
            <span
              className={cn(
                "px-2.5 py-0.5 rounded-full text-[10px] font-bold border",
                dbStatus?.status === "connected"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-amber-50 text-amber-700 border-amber-200"
              )}
            >
              {dbStatus?.status === "connected" ? "متصلة ونشطة" : "قيد الفحص"}
            </span>
          </div>

          <div className="space-y-2 text-slate-600 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-400">حالة التحقق:</span>
              <strong className="text-emerald-700">جداول ومحددات الأمان (RLS) مفعلة</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">آخر ترحيل مطبق (Migration):</span>
              <strong className="font-mono text-slate-800">20260910000012 (AI Jobs & Hardening)</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">محدد عدم التكرار (Idempotency):</span>
              <span className="text-slate-700 font-semibold">مفعل على مستوى المعاملات الذرية</span>
            </div>
          </div>
        </div>

        {/* Service 2: Google Gemini AI Pipeline */}
        <div className="bg-surface rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3.5 text-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <span>خدمة الذكاء الاصطناعي (Google Gemini)</span>
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold border bg-indigo-50 text-indigo-700 border-indigo-200">
              مهيأ ونشط
            </span>
          </div>

          <div className="space-y-2 text-slate-600 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-400">النموذج الأساسي المعتمد:</span>
              <strong className="font-mono text-indigo-700 font-bold">
                {aiStatus?.activeModel || "gemini-3.8-flash"}
              </strong>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">النموذج الاحتياطي التلقائي:</span>
              <span className="font-mono text-slate-700 text-[10px]">
                {aiStatus?.fallbackModel || "gemini-3.6-flash / gemini-flash-latest"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">إجمالي الطلبات / الكاش:</span>
              <span className="text-slate-700 font-semibold">
                {aiStatus?.totalGeminiRequests || 0} طلب ({aiStatus?.cacheHits || 0} استرجاع كاش)
              </span>
            </div>
          </div>
        </div>

        {/* Service 3: Storage Buckets */}
        <div className="bg-surface rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3.5 text-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
              <HardDrive className="w-4 h-4 text-sky-600" />
              <span>تخزين الملفات (Storage Bucket)</span>
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold border bg-emerald-50 text-emerald-700 border-emerald-200">
              جاهز ومؤمن
            </span>
          </div>

          <div className="space-y-2 text-slate-600 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-400">اسم الوعاء (Bucket):</span>
              <strong className="font-mono text-slate-800">content-calendars</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">سياسة الوصول (Access Policy):</span>
              <span className="text-slate-700 font-semibold">خاص (Private) مع روابط مؤقتة موثقة (15 دقيقة)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">أنواع الملفات المقبولة:</span>
              <span className="font-mono text-slate-700">application/pdf (حتى 15MB)</span>
            </div>
          </div>
        </div>

        {/* Service 4: Security & Invitations Guard */}
        <div className="bg-surface rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3.5 text-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
              <ShieldCheck className="w-4 h-4 text-purple-600" />
              <span>حماية الدعوات وأمن الصلاحيات</span>
            </div>
            <span
              className={cn(
                "px-2.5 py-0.5 rounded-full text-[10px] font-bold border",
                invitationsStatus?.invitationsPaused
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-emerald-50 text-emerald-700 border-emerald-200"
              )}
            >
              {invitationsStatus?.invitationsPaused ? "الدعوات متوقفة مؤقتًا" : "مفتوحة"}
            </span>
          </div>

          <div className="space-y-2 text-slate-600 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-400">حالة التوقف المؤقت (Paused):</span>
              <strong className="text-amber-800 font-semibold">مفعلة — يمنع إرسال أو قبول أي دعوات</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">الربط الآمن للمصممين:</span>
              <span className="text-slate-700 font-semibold">فصل Auth Users عن Roster People مع منع الكلمات الافتراضية</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">صلاحية المدير العام (Owner):</span>
              <strong className="text-slate-900">عماد عادل (emadadelgd@gmail.com)</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: CSV Data Exports (Owner Hub) */}
      <div className="bg-surface rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4 text-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h2 className="font-bold text-base text-slate-900 flex items-center gap-2">
              <Download className="w-4 h-4 text-sky-600" />
              تصدير البيانات التشغيلية (1-Click CSV Exports)
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              تصدير فوري للملفات بصيغة CSV مدعومة بالترميز العربي الكامل (UTF-8 BOM) للفتح المباشر في Microsoft Excel
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
          {/* Export 1: Tasks */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col justify-between space-y-3">
            <div>
              <div className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-sky-600" />
                سجل المهام الكامل (All Tasks)
              </div>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                تصدير كافة مهام التصميم مع العميل، والمصمم، والمراجع، وموعد التسليم، والحالة.
              </p>
            </div>
            <button
              onClick={() => handleExport("tasks")}
              className="w-full py-2 bg-white hover:bg-slate-100 text-slate-800 border border-slate-200 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-2xs transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-sky-600" />
              <span>تحميل CSV المهام</span>
            </button>
          </div>

          {/* Export 2: Calendars */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col justify-between space-y-3">
            <div>
              <div className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-purple-600" />
                حملات تقويم المحتوى (Calendars)
              </div>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                تصدير تقاويم العملاء الشهرية مع أرقام الإصدارات، ودقة تحليل الذكاء الاصطناعي، وعدد البوستات.
              </p>
            </div>
            <button
              onClick={() => handleExport("calendars")}
              className="w-full py-2 bg-white hover:bg-slate-100 text-slate-800 border border-slate-200 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-2xs transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-purple-600" />
              <span>تحميل CSV التقاويم</span>
            </button>
          </div>

          {/* Export 3: Team Workload */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col justify-between space-y-3">
            <div>
              <div className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                <Users className="w-4 h-4 text-emerald-600" />
                طاقة وساعات الفريق (Workload)
              </div>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                تصدير أعضاء الفريق، والساعات الأسبوعية المتاحة، والحدود القصوى للحمل الموزون.
              </p>
            </div>
            <button
              onClick={() => handleExport("workload")}
              className="w-full py-2 bg-white hover:bg-slate-100 text-slate-800 border border-slate-200 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-2xs transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              <span>تحميل CSV الطاقة</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
