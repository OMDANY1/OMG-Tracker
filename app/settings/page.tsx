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
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
  const [timezone, setTimezone] = useState("Africa/Cairo");
  const [workweek, setWorkweek] = useState("الأحد - الخميس (Sun - Thu)");
  const [threshold, setThreshold] = useState("240");
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [testing, setTesting] = useState(false);

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
