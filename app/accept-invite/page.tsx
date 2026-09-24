"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Lock,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  KeyRound,
  LogIn,
  LogOut,
  UserCheck,
} from "lucide-react";
import Link from "next/link";

interface InviteInfo {
  valid: boolean;
  invitationId: string;
  email: string;
  maskedEmail: string;
  role: string;
  roleLabel: string;
  displayName: string;
  jobTitle: string;
  sessionMismatch?: boolean;
  sessionMatches?: boolean;
  loggedInEmail?: string | null;
}

function AcceptInviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("token");
  const inviteId = searchParams.get("id");

  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [terminalError, setTerminalError] = useState<{
    title: string;
    description: string;
    isAccepted?: boolean;
    loginEmail?: string;
  } | null>(null);

  useEffect(() => {
    async function init() {
      setLoading(true);
      setErrorMsg(null);

      // Case 1: Secret token is present in URL (token alone or id + token)
      if (inviteToken) {
        try {
          const url = `/api/auth/accept-invite?token=${encodeURIComponent(inviteToken)}${
            inviteId ? `&id=${encodeURIComponent(inviteId)}` : ""
          }`;
          const res = await fetch(url);
          const data = await res.json();

          if (!res.ok || data.error) {
            if (data.isAccepted) {
              setTerminalError({
                title: "تم تفعيل هذه الدعوة مسبقاً",
                description: data.error || "تم قبول هذه الدعوة بالفعل مسبقاً. يمكنك تسجيل الدخول إلى حسابك مباشرة.",
                isAccepted: true,
                loginEmail: data.email,
              });
            } else if (data.isExpired) {
              setTerminalError({
                title: "انتهت صلاحية رابط الدعوة (This invitation has expired)",
                description: data.error || "انتهت مهلة هذا الرابط (7 أيام). يرجى طلب رابط دعوة جديد من إدارة الايجنسي.",
              });
            } else if (data.isRevoked) {
              setTerminalError({
                title: "تم إلغاء الدعوة (This invitation has been revoked)",
                description: data.error || "تم إلغاء رابط الدعوة هذا من قِبل إدارة الايجنسي.",
              });
            } else if (data.isPaused) {
              setTerminalError({
                title: "قبول الدعوات متوقف مؤقتًا",
                description: data.error || "الدعوات متوقفة مؤقتًا لحين الانتهاء من تحديث مساحة العمل. سيصلك رابط جديد عند إعادة فتح الدعوات.",
              });
            } else {
              setTerminalError({
                title: "رابط غير صالح (Invalid invitation)",
                description: data.error || "تعذر التحقق من رابط الدعوة. يرجى التأكد من نسخه بالكامل بشكل صحيح.",
              });
            }
            setLoading(false);
            return;
          }

          if (data.valid) {
            setInviteInfo(data);
            setEmail(data.email);
            setLoading(false);
            return;
          }
        } catch (err: any) {
          setTerminalError({
            title: "خطأ في الاتصال",
            description: "تعذر الاتصال بالخادم للتحقق من رابط الدعوة. يرجى إعادة المحاولة.",
          });
          setLoading(false);
          return;
        }
      }

      // Case 2: Only ID is present without token
      if (inviteId && !inviteToken) {
        setTerminalError({
          title: "رابط الدعوة غير مكتمل",
          description: "الرمز السري (token) مفقود من الرابط لأسباب أمنية. يرجى طلب الرابط الكامل والمباشر من المدير العام (عماد).",
        });
        setLoading(false);
        return;
      }

      // Case 3: No token or ID, check if user is already logged in
      const supabase = createClient();
      if (supabase) {
        const { data: authData } = await supabase.auth.getUser();
        if (authData?.user) {
          setEmail(authData.user.email || "");
          setLoading(false);
          return;
        }
      }

      setTerminalError({
        title: "رابط دعوة مطلوب",
        description: "يرجى فتح رابط الدعوة الخاص بك المرسل إليك من إدارة OMG Creative للانضمام.",
      });
      setLoading(false);
    }

    init();
  }, [inviteToken, inviteId]);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      const supabase = createClient();
      if (supabase) {
        await supabase.auth.signOut();
      }
      window.location.reload();
    } catch {
      window.location.reload();
    }
  };

  const handleQuickAccept = async () => {
    if (!inviteToken) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: inviteToken,
          invitationId: inviteId || inviteInfo?.invitationId,
          autoAcceptIfSessionMatches: true,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "فشل تفعيل العضوية.");
      }

      setSuccessMsg(data.message || "تم تفعيل حسابك بنجاح! جاري توجيهك إلى مساحة العمل...");
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 1200);
    } catch (err: any) {
      setErrorMsg(err.message || "حدث خطأ أثناء تفعيل الحساب.");
    } finally {
      setSubmitting(false);
    }
  };

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
      if (inviteToken) {
        const res = await fetch("/api/auth/accept-invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: inviteToken,
            invitationId: inviteId || inviteInfo?.invitationId,
            password: password,
          }),
        });

        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || "فشل تفعيل الدعوة.");
        }

        // Automatic authentication to establish session
        const supabase = createClient();
        if (supabase) {
          await supabase.auth.signInWithPassword({
            email: data.email || email,
            password: password,
          });
        }

        setSuccessMsg(data.message || "تم تفعيل حسابك بنجاح! جاري تحويلك إلى مساحة العمل...");
        setTimeout(() => {
          router.push("/");
          router.refresh();
        }, 1200);
      } else {
        // Fallback for pre-authenticated session without token
        const supabase = createClient();
        if (!supabase) throw new Error("تعذر الاتصال بخدمة المصادقة.");

        const { error: pwdErr } = await supabase.auth.updateUser({ password });
        if (pwdErr) throw new Error(pwdErr.message);

        const res = await fetch("/api/auth/accept-invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || "فشل تفعيل العضوية في مساحة العمل.");
        }

        setSuccessMsg(data.message || "تم تفعيل حسابك بنجاح! جاري نقلك إلى مساحة العمل...");
        setTimeout(() => {
          router.push("/");
          router.refresh();
        }, 1200);
      }
    } catch (err: any) {
      setErrorMsg(err.message || "حدث خطأ أثناء تفعيل الحساب.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
      {/* Background glow decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-100 p-6 sm:p-8 space-y-6 text-right">
        {/* Header Logo */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 bg-sky-600 rounded-2xl mx-auto flex items-center justify-center shadow-lg shadow-sky-600/30 text-white font-bold text-xl tracking-wider">
            OMG
          </div>
          <h1 className="text-xl font-bold text-slate-900">مساحة عمل OMG الإبداعية</h1>
          <p className="text-xs text-slate-500">تفعيل حسابك والانضمام إلى فريق العمل</p>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="py-12 text-center space-y-3">
            <div className="w-8 h-8 border-3 border-sky-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-500 font-medium">جاري التحقق من صلاحية وأمان رابط الدعوة...</p>
          </div>
        )}

        {/* Terminal Error States */}
        {!loading && terminalError && (
          <div className="space-y-4">
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>{terminalError.title}</span>
              </div>
              <p className="text-slate-600 leading-relaxed">{terminalError.description}</p>
            </div>

            <div className="pt-2">
              <Link
                href={`/login${terminalError.loginEmail ? `?email=${encodeURIComponent(terminalError.loginEmail)}` : ""}`}
                className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-xs"
              >
                <LogIn className="w-4 h-4" />
                <span>الانتقال إلى صفحة تسجيل الدخول</span>
              </Link>
            </div>
          </div>
        )}

        {/* Success State */}
        {!loading && successMsg && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs space-y-2 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
            <h3 className="font-bold text-sm">تم التفعيل بنجاح!</h3>
            <p className="text-emerald-700">{successMsg}</p>
          </div>
        )}

        {/* Acceptance Form & Session Handling */}
        {!loading && !terminalError && !successMsg && inviteInfo && (
          <div className="space-y-4">
            {/* Invited Member Summary Card */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">عضو الفريق المدعو:</span>
                <span className="font-bold text-slate-900 text-sm">{inviteInfo.displayName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">الدور المخصص:</span>
                <span className="px-2 py-0.5 rounded font-bold text-[11px] bg-sky-100 text-sky-800">
                  {inviteInfo.roleLabel}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500">البريد الإلكتروني المعتمد:</span>
                <span className="font-mono text-slate-700">{inviteInfo.email}</span>
              </div>
            </div>

            {/* Session Mismatch Warning Card */}
            {inviteInfo.sessionMismatch && (
              <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-900 rounded-xl text-xs space-y-2">
                <div className="flex items-center gap-2 font-bold text-rose-800">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>تنبيه: عدم تطابق جلسة المستخدم (Session Mismatch)</span>
                </div>
                <p className="text-[11px] leading-relaxed text-rose-800">
                  أنت مسجل حالياً بالبريد الإلكتروني:{" "}
                  <strong className="font-mono">{inviteInfo.loggedInEmail}</strong>، بينما الدعوة مخصصة للبريد:{" "}
                  <strong className="font-mono">{inviteInfo.email}</strong>.
                </p>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="w-full mt-2 py-2 px-3 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{loggingOut ? "جاري تسجيل الخروج..." : "تسجيل الخروج والتبديل للحساب المطلوب"}</span>
                </button>
              </div>
            )}

            {/* Session Matches Card - Quick 1-Click Accept */}
            {inviteInfo.sessionMatches && (
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs space-y-3">
                <div className="flex items-center gap-2 font-bold text-emerald-800">
                  <UserCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>أنت مسجل الدخول بالفعل بالحساب المعتمد</span>
                </div>
                <p className="text-[11px] text-emerald-800 leading-relaxed">
                  تم التحقق من مطابقة حسابك المسجل (<span className="font-mono font-bold">{inviteInfo.loggedInEmail}</span>) مع البريد المخصص للدعوة. يمكنك تفعيل العضوية مباشرة دون الحاجة لإعادة كتابة كلمة المرور.
                </p>
                <button
                  type="button"
                  onClick={handleQuickAccept}
                  disabled={submitting}
                  className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <span>جاري تفعيل العضوية...</span>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>تفعيل العضوية والانضمام فوراً لمساحة العمل</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Standard New Account Form (Only when NOT session-matched and NOT mismatched) */}
            {!inviteInfo.sessionMatches && !inviteInfo.sessionMismatch && (
              <form onSubmit={handleSubmit} className="space-y-4">
                {errorMsg && (
                  <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      كلمة المرور الجديدة <span className="text-rose-500">*</span>:
                    </label>
                    <div className="relative">
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="8 أحرف على الأقل"
                        className="w-full px-3 py-2 pr-9 border border-slate-200 rounded-xl text-xs bg-white text-slate-800 focus:outline-sky-500"
                      />
                      <Lock className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      تأكيد كلمة المرور <span className="text-rose-500">*</span>:
                    </label>
                    <div className="relative">
                      <input
                        type="password"
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="أعد كتابة كلمة المرور"
                        className="w-full px-3 py-2 pr-9 border border-slate-200 rounded-xl text-xs bg-white text-slate-800 focus:outline-sky-500"
                      />
                      <KeyRound className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2 mt-4"
                >
                  {submitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>جاري تفعيل الحساب...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>تعيين كلمة المرور وتفعيل الحساب</span>
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-900 flex items-center justify-center">
          <div className="w-8 h-8 border-3 border-sky-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <AcceptInviteContent />
    </Suspense>
  );
}
