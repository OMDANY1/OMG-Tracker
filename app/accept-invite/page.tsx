"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Lock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

export default function AcceptInvitePage() {
  const router = useRouter();
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    // Check if invitations are paused across the workspace
    fetch("/api/auth/accept-invite")
      .then((res) => res.json())
      .then((statusData) => {
        if (statusData.invitationsPaused) {
          setIsPaused(true);
          setLoading(false);
          return;
        }

        const supabase = createClient();
        if (!supabase) {
          setErrorMsg("خدمة المصادقة غير مهيأة.");
          setLoading(false);
          return;
        }

        // Check existing auth session
        supabase.auth.getUser().then(({ data, error }) => {
          if (error || !data?.user) {
            supabase.auth.onAuthStateChange((event, session) => {
              if (session?.user) {
                setEmail(session.user.email || "");
                setLoading(false);
              } else if (event === "SIGNED_OUT" || !session) {
                setIsExpired(true);
                setLoading(false);
              }
            });

            setTimeout(() => {
              setLoading((prev) => {
                if (prev) {
                  setIsExpired(true);
                  return false;
                }
                return prev;
              });
            }, 3000);
          } else {
            setEmail(data.user.email || "");
            setLoading(false);
          }
        });
      })
      .catch(() => {
        setIsPaused(true);
        setLoading(false);
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

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

      // 1. Update user password
      const { error: pwdErr } = await supabase.auth.updateUser({ password });
      if (pwdErr) {
        throw new Error(pwdErr.message);
      }

      // 2. Call server endpoint to activate membership and link roster person
      const res = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "فشل تفعيل العضوية في مساحة العمل.");
      }

      setSuccessMsg(data.message || "تم تفعيل حسابك بنجاح!");
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 2000);
    } catch (err: any) {
      setErrorMsg(err.message || "حدث خطأ أثناء قبول الدعوة.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 text-center">
        <div className="space-y-3">
          <div className="w-10 h-10 border-4 border-sky-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-semibold text-slate-600">جاري التحقق من بيانات الدعوة...</p>
        </div>
      </div>
    );
  }

  if (isPaused) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 text-right">
        <div className="bg-surface rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 sm:p-8 space-y-5 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center mx-auto shadow-xs">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-slate-900">توقف مؤقت للدعوات</h1>
            <p className="text-sm text-slate-600 leading-relaxed font-medium">
              الدعوات متوقفة مؤقتًا لحين الانتهاء من تحديث مساحة العمل. سيصلك رابط جديد عند إعادة فتح الدعوات.
            </p>
          </div>
          <div className="pt-4 border-t border-slate-100 flex justify-center">
            <Link
              href="/login"
              className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
            >
              الذهاب إلى شاشة تسجيل الدخول
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (isExpired && !email) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 text-right">
        <div className="bg-surface rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 sm:p-8 space-y-5">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="text-center space-y-1">
            <h1 className="text-lg font-bold text-slate-900">انتهت صلاحية رابط الدعوة</h1>
            <p className="text-xs text-slate-500 leading-relaxed">
              انتهت صلاحية رابط الدعوة أو تم استخدامه مسبقاً لتفعيل الحساب. يرجى التواصل مع المدير العام (عماد) لإعادة إرسال الدعوة.
            </p>
          </div>
          <div className="pt-3 border-t border-slate-100 flex justify-center">
            <Link
              href="/login"
              className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
            >
              الذهاب إلى شاشة تسجيل الدخول
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 text-right">
      <div className="bg-surface rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 sm:p-8 space-y-6 animate-in fade-in zoom-in-95 duration-150">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-sky-100 text-sky-600 flex items-center justify-center mx-auto shadow-xs">
            <Sparkles className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">مرحباً بك في OMG Creative Workspace</h1>
          <p className="text-xs text-slate-500">
            أنت مدعو للانضمام إلى مساحة عمل الايجنسي. يرجى إعداد كلمة المرور الخاصة بك لتفعيل حسابك.
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

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="font-bold text-slate-700 block mb-1">البريد الإلكتروني المعتمد للدعوة:</label>
            <input
              type="email"
              value={email}
              readOnly
              disabled
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl bg-slate-100 text-slate-500 font-semibold cursor-not-allowed select-none"
            />
            <span className="text-[10px] text-slate-400 mt-1 block">
              * البريد الإلكتروني ثابت ومحدد في سجل الايجنسي ولا يمكن تغييره.
            </span>
          </div>

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
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-900 font-medium focus:outline-sky-500 focus:ring-1 focus:ring-sky-500"
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
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-900 font-medium focus:outline-sky-500 focus:ring-1 focus:ring-sky-500"
              />
              <Lock className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || !!successMsg}
            className="w-full py-3 bg-sky-600 hover:bg-sky-700 disabled:bg-sky-400 text-white rounded-xl font-bold transition-colors shadow-xs flex items-center justify-center gap-2 mt-2"
          >
            {submitting ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>جاري تفعيل الحساب...</span>
              </div>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                <span>تفعيل الحساب والدخول</span>
              </>
            )}
          </button>
        </form>

        <div className="text-center pt-2">
          <Link href="/login" className="text-xs text-slate-500 hover:text-sky-600 font-medium">
            الرجوع إلى تسجيل الدخول
          </Link>
        </div>
      </div>
    </div>
  );
}
