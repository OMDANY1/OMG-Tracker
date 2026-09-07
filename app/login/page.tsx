"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Shield, Mail, Lock, LogIn, AlertCircle, CheckCircle2, KeyRound } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  
  // Login form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [needsOwnerSetup, setNeedsOwnerSetup] = useState(false);

  // In development mode only, check if the agency owner has been initialized
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      fetch("/api/auth/owner-status")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && data.hasOwner === false) {
            setNeedsOwnerSetup(true);
          }
        })
        .catch(() => {});
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const supabase = createClient();
      if (!supabase) {
        throw new Error("إعدادات الاتصال بقاعدة البيانات غير مهيأة.");
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        throw new Error(
          error.message === "Invalid login credentials"
            ? "بيانات الدخول غير صحيحة. يرجى التأكد من البريد الإلكتروني وكلمة المرور."
            : error.message
        );
      }

      setSuccessMsg("تم تسجيل الدخول بنجاح! جاري تحويلك إلى مساحة العمل...");
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 600);
    } catch (err: any) {
      setErrorMsg(err.message || "حدث خطأ غير متوقع أثناء تسجيل الدخول.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 bg-surface p-8 sm:p-10 rounded-2xl border border-slate-200/80 shadow-xl">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 rounded-2xl bg-gradient-to-tr from-sky-500 to-indigo-600 text-white shadow-lg shadow-sky-500/20 mb-2">
            <Shield className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            OMG Creative Workspace
          </h1>
          <p className="text-sm text-slate-500">
            بوابة تسجيل الدخول الآمنة لمساحة عمل الوكالة
          </p>
        </div>

        {/* Development Notification if Owner Needs Setup */}
        {needsOwnerSetup && (
          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-800 text-xs flex items-start gap-2.5">
            <KeyRound className="w-4 h-4 flex-shrink-0 text-amber-600 mt-0.5" />
            <div className="space-y-1">
              <span className="font-semibold block">ملاحظة بيئة التطوير:</span>
              <span>لم يتم تفعيل حساب المدير العام بعد. يمكنك </span>
              <Link href="/setup-owner" className="underline font-bold hover:text-amber-900">
                تهيئة حساب المالك باستخدام رمز الإعداد المحلي
              </Link>
              <span>.</span>
            </div>
          </div>
        )}

        {/* Error Notification */}
        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-red-50 border border-red-200/70 text-red-700 text-sm flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-500 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Success Notification */}
        {successMsg && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200/70 text-emerald-700 text-sm flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-500 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Standard Login Form */}
        <form onSubmit={handleLogin} className="space-y-5">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                البريد الإلكتروني
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@omgcreative.com"
                  autoComplete="email"
                  className="w-full pr-10 pl-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all placeholder:text-slate-400 text-slate-800"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                كلمة المرور
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  className="w-full pr-10 pl-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all placeholder:text-slate-400 text-slate-800"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-medium text-sm transition-all shadow-md shadow-sky-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                <span>تسجيل الدخول</span>
              </>
            )}
          </button>
        </form>

        <div className="pt-4 border-t border-slate-100 text-center">
          <p className="text-xs text-slate-400">
            النظام محمي ومربوط مباشرة مع قاعدة بيانات Supabase المشفرة
          </p>
        </div>
      </div>
    </div>
  );
}
