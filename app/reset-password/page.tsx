"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getSiteUrl } from "@/lib/siteUrl";
import { Lock, Mail, CheckCircle2, AlertTriangle, KeyRound } from "lucide-react";
import Link from "next/link";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isResetMode, setIsResetMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) {
      setLoading(false);
      return;
    }

    // Check if arrived from recovery link (user session exists)
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        setIsResetMode(true);
        setEmail(data.user.email || "");
      }
      setLoading(false);
    });

    supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session?.user) {
        setIsResetMode(true);
        if (session?.user?.email) setEmail(session.user.email);
      }
    });
  }, []);

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setSubmitting(true);

    try {
      const supabase = createClient();
      if (!supabase) throw new Error("تعذر الاتصال بخدمة المصادقة.");

      const siteUrl = getSiteUrl();
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
      });

      if (error) throw error;

      setSuccessMsg("تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني بنجاح.");
    } catch (err: any) {
      setErrorMsg(err.message || "فشل إرسال رابط الاستعادة.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (password.length < 8) {
      setErrorMsg("كلمة المرور يجب أن لا تقل عن 8 أحرف.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg("كلمة المرور وتأكيدها غير متطابقين.");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      if (!supabase) throw new Error("تعذر الاتصال بخدمة المصادقة.");

      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      setSuccessMsg("تم تحديث كلمة المرور بنجاح! جاري التوجيه لتسجيل الدخول...");
      setTimeout(() => {
        router.push("/login");
      }, 2000);
    } catch (err: any) {
      setErrorMsg(err.message || "فشل تحديث كلمة المرور.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="w-8 h-8 border-4 border-sky-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 text-right">
      <div className="bg-surface rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 sm:p-8 space-y-6 animate-in fade-in zoom-in-95 duration-150">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-sky-100 text-sky-600 flex items-center justify-center mx-auto shadow-xs">
            <KeyRound className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">
            {isResetMode ? "تعيين كلمة المرور الجديدة" : "استعادة كلمة المرور"}
          </h1>
          <p className="text-xs text-slate-500">
            {isResetMode
              ? "أدخل كلمة المرور الجديدة لحسابك في مساحة عمل الايجنسي"
              : "أدخل بريدك الإلكتروني المسجل لإرسال رابط إعادة التعيين"}
          </p>
        </div>

        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </div>
        )}

        {isResetMode ? (
          <form onSubmit={handleUpdatePassword} className="space-y-4 text-xs">
            {email && (
              <div>
                <label className="font-bold text-slate-700 block mb-1">البريد الإلكتروني:</label>
                <input
                  type="email"
                  value={email}
                  disabled
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl bg-slate-100 text-slate-500 font-semibold cursor-not-allowed"
                />
              </div>
            )}

            <div>
              <label className="font-bold text-slate-700 block mb-1">كلمة المرور الجديدة:</label>
              <div className="relative">
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-900 font-medium focus:outline-sky-500"
                />
                <Lock className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block">8 أحرف على الأقل</span>
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">تأكيد كلمة المرور:</label>
              <div className="relative">
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-900 font-medium focus:outline-sky-500"
                />
                <Lock className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || !!successMsg}
              className="w-full py-3 bg-sky-600 hover:bg-sky-700 disabled:bg-sky-400 text-white rounded-xl font-bold transition-colors shadow-xs"
            >
              {submitting ? "جاري الحفظ..." : "حفظ كلمة المرور الجديدة"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRequestReset} className="space-y-4 text-xs">
            <div>
              <label className="font-bold text-slate-700 block mb-1">البريد الإلكتروني:</label>
              <div className="relative">
                <input
                  type="email"
                  required
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-900 font-medium focus:outline-sky-500"
                />
                <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || !!successMsg}
              className="w-full py-3 bg-sky-600 hover:bg-sky-700 disabled:bg-sky-400 text-white rounded-xl font-bold transition-colors shadow-xs"
            >
              {submitting ? "جاري الإرسال..." : "إرسال رابط الاستعادة"}
            </button>
          </form>
        )}

        <div className="text-center pt-2">
          <Link href="/login" className="text-xs text-slate-500 hover:text-sky-600 font-medium">
            الرجوع إلى تسجيل الدخول
          </Link>
        </div>
      </div>
    </div>
  );
}
