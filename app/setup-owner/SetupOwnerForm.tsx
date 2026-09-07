"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Mail, Lock, Key, User, Sparkles, AlertCircle, CheckCircle2 } from "lucide-react";

export default function SetupOwnerForm({ initialToken = "" }: { initialToken?: string }) {
  const router = useRouter();

  const [token, setToken] = useState(initialToken);
  const [fullName, setFullName] = useState("المدير العام");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    if (password !== confirmPassword) {
      setErrorMsg("كلمتا المرور غير متطابقتين.");
      setIsLoading(false);
      return;
    }

    if (password.length < 8) {
      setErrorMsg("يجب ألا تقل كلمة المرور عن 8 أحرف.");
      setIsLoading(false);
      return;
    }

    if (!token.trim()) {
      setErrorMsg("يرجى إدخال رمز التهيئة (Setup Token).");
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/bootstrap-owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          fullName: fullName.trim(),
          email: email.trim(),
          password,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "فشلت عملية تهيئة حساب المالك.");
      }

      setSuccessMsg(data.message || "تم تفعيل حساب المالك بنجاح! جاري تحويلك إلى صفحة تسجيل الدخول...");
      setTimeout(() => {
        router.push("/login");
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err.message || "حدث خطأ غير متوقع أثناء إرسال البيانات.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-lg w-full space-y-8 bg-surface p-8 sm:p-10 rounded-2xl border border-slate-200/80 shadow-xl">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 rounded-2xl bg-gradient-to-tr from-amber-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/20 mb-2">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            تهيئة حساب مالك الوكالة (Agency Owner)
          </h1>
          <p className="text-sm text-slate-500">
            إعداد أمني محمي لمرة واحدة فقط برمز الإعداد السري المحلي
          </p>
        </div>

        {/* Security Alert */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-xs space-y-1.5 leading-relaxed">
          <div className="font-semibold text-slate-800 flex items-center gap-1.5">
            <Key className="w-4 h-4 text-sky-600" />
            <span>رمز الإعداد لمرة واحدة (One-Time Setup Token):</span>
          </div>
          <p>
            تجد الرمز داخل الملف <code className="bg-slate-200 px-1.5 py-0.5 rounded text-slate-800 font-mono">.owner-setup-token</code> في المجلد الرئيسي للمشروع. سيتم استهلاك وحذف الرمز فور نجاح التفعيل لمنع إعادة استخدامه نهائياً.
          </p>
        </div>

        {/* Notifications */}
        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-red-50 border border-red-200/70 text-red-700 text-sm flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-500 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200/70 text-emerald-700 text-sm flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-500 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                رمز الإعداد الأمني لمرة واحدة (Setup Token)
              </label>
              {token ? (
                <span className="text-[11px] font-medium text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  تم التجهيز والربط محلياً
                </span>
              ) : null}
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
                <Key className="w-4 h-4" />
              </div>
              <input
                type="password"
                required
                readOnly={!!token}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="رمز الإعداد السري المحلي"
                className={`w-full pr-10 pl-3 py-2.5 rounded-xl border text-xs font-mono transition-all text-slate-800 ${
                  token
                    ? "bg-emerald-50/40 border-emerald-300/80 text-emerald-900 cursor-not-allowed select-none"
                    : "bg-white border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
                }`}
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              الرمز مشفر ومحمّل تلقائياً من خادم التطوير المحلي دون كشفه في المتصفح.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              الاسم الكامل للمدير
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
                <User className="w-4 h-4" />
              </div>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="المدير العام"
                className="w-full pr-10 pl-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all placeholder:text-slate-400 text-slate-800"
              />
            </div>
          </div>

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
                placeholder="owner@omgcreative.com"
                className="w-full pr-10 pl-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all placeholder:text-slate-400 text-slate-800"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  className="w-full pr-10 pl-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all placeholder:text-slate-400 text-slate-800"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                تأكيد كلمة المرور
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pr-10 pl-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all placeholder:text-slate-400 text-slate-800"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm transition-all shadow-md shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>تأكيد وتفعيل حساب المالك</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
