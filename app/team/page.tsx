"use client";

import React, { useState, useEffect } from "react";
import {
  Users,
  Briefcase,
  Shield,
  Clock,
  TrendingUp,
  Mail,
  UserCheck,
  CheckCircle2,
  Sliders,
  AlertCircle,
  AlertTriangle,
  Lock,
  Plus,
  RefreshCw,
  X,
  Trash2,
  Calendar,
  Layers,
} from "lucide-react";
import { ROSTER_ROLE_LABELS, cn } from "@/lib/utils";

interface WorkloadMember {
  id: string;
  displayName: string;
  jobTitle: string;
  role: string;
  weeklyHours: number;
  reservedHours: number;
  activeClientsCount: number;
  activeTasksCount: number;
  weightedLoadScore: number;
  maxWeightedLoad: number;
  loadRatio: number;
  status: "underutilized" | "balanced" | "overloaded";
  dueNext7Days: number;
  dueNext14Days: number;
  clients: { id: string; name: string; difficulty: string }[];
  notes?: string | null;
}

interface InvitationRecord {
  id: string;
  invited_email: string;
  role: string;
  status: string;
  expires_at: string;
  created_at: string;
  roster_person?: {
    id: string;
    display_name: string;
    job_title: string;
  };
}

const DEFAULT_EMAILS: Record<string, string> = {
  "عماد عادل": "emadadelgd@gmail.com",
  "ندى عبد النبي": "nadaabdulnabi513@gmail.com",
  "سارة": "sara95gd@gmail.com",
  "آلاء حسام": "alaa.hossam16814@gmail.com",
  "شهد لاشين": "lasheeen178@gmail.com",
  "آية حمزة": "ayahamza318@gmail.com",
};

export default function TeamPage() {
  const [teamMembers, setTeamMembers] = useState<WorkloadMember[]>([]);
  const [invitations, setInvitations] = useState<InvitationRecord[]>([]);
  const [invitationsPaused, setInvitationsPaused] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Invite Modal State
  const [showInviteModal, setShowInviteModal] = useState<boolean>(false);
  const [selectedRosterId, setSelectedRosterId] = useState<string>("");
  const [inviteEmail, setInviteEmail] = useState<string>("");
  const [inviteRole, setInviteRole] = useState<string>("designer");
  const [submittingInvite, setSubmittingInvite] = useState<boolean>(false);
  const [inviteModalError, setInviteModalError] = useState<string | null>(null);
  const [inviteModalSuccess, setInviteModalSuccess] = useState<string | null>(null);

  const fetchTeamData = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [workloadRes, invitesRes] = await Promise.all([
        fetch("/api/team/workload"),
        fetch("/api/team/invitations"),
      ]);

      if (workloadRes.ok) {
        const data = await workloadRes.json();
        setTeamMembers(data.members || []);
        if (typeof data.invitationsPaused === "boolean") {
          setInvitationsPaused(data.invitationsPaused);
        }
      }

      if (invitesRes.ok) {
        const iData = await invitesRes.json();
        setInvitations(iData.invitations || []);
        if (typeof iData.invitationsPaused === "boolean") {
          setInvitationsPaused(iData.invitationsPaused);
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || "فشل تحميل بيانات الفريق");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeamData();
  }, []);

  const handleSelectRosterPerson = (personId: string) => {
    setSelectedRosterId(personId);
    const person = teamMembers.find((m) => m.id === personId);
    if (person && DEFAULT_EMAILS[person.displayName]) {
      setInviteEmail(DEFAULT_EMAILS[person.displayName]);
    }
    if (person?.role) {
      setInviteRole(person.role);
    }
  };

  const handleSaveDraftInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRosterId || !inviteEmail.trim()) {
      setInviteModalError("يرجى اختيار العضو وإدخال البريد الإلكتروني.");
      return;
    }

    setSubmittingInvite(true);
    setInviteModalError(null);
    setInviteModalSuccess(null);

    try {
      const res = await fetch("/api/team/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rosterPersonId: selectedRosterId,
          email: inviteEmail.trim(),
          role: inviteRole,
          isDraftOnly: true,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "فشل حفظ مسودة الدعوة.");
      }

      setInviteModalSuccess(data.message || "تم حفظ مسودة الدعوة بنجاح.");
      setTimeout(() => {
        setShowInviteModal(false);
        setInviteModalSuccess(null);
        setSelectedRosterId("");
        setInviteEmail("");
        fetchTeamData();
      }, 1200);
    } catch (err: any) {
      setInviteModalError(err.message || "حدث خطأ أثناء حفظ الدعوة.");
    } finally {
      setSubmittingInvite(false);
    }
  };

  const handleRevokeInvite = async (invitationId: string) => {
    if (!confirm("هل أنت متأكد من رغبتك في إلغاء هذه الدعوة؟")) return;
    try {
      const res = await fetch(`/api/team/invitations?id=${invitationId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchTeamData();
      } else {
        const err = await res.json();
        alert(err.error || "فشل إلغاء الدعوة");
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">فريق العمل والطاقة الاستيعابية</h1>
          <p className="text-sm text-slate-500 mt-1">
            إدارة أعضاء الفريق، الساعات المتاحة، معدل الحمل الموزون (Weighted Load)، ومتابعة تسليمات 7 و 14 يوم
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchTeamData}
            disabled={loading}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
            title="تحديث البيانات"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
          <button
            onClick={() => {
              setInviteModalError(null);
              setInviteModalSuccess(null);
              setShowInviteModal(true);
            }}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
          >
            <Mail className="w-4 h-4" />
            <span>دعوة عضو جديد (مسودة)</span>
          </button>
        </div>
      </div>

      {/* Invitations Status Notice Banner */}
      {invitationsPaused && (
        <div className="p-4 bg-amber-50/90 border border-amber-300 rounded-2xl text-amber-950 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-2xs text-xs">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <div className="font-bold text-slate-900 flex items-center gap-2">
                <span>حالة قبول الدعوات: متوقفة مؤقتًا (بقرار المدير العام)</span>
                <span className="px-2 py-0.5 bg-amber-200/80 text-amber-900 font-bold rounded-md text-[10px]">
                  وضع الحماية نشط
                </span>
              </div>
              <p className="text-slate-600 text-[11px] mt-0.5 leading-relaxed">
                إرسال الدعوات معطل ومقفل حالياً للحفاظ على استقرار النظام وعدم إزعاج الفريق. يمكنك تجهيز مسودات الدعوات دون إرسال أي إيميلات فعلية.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Section 1: Workload & Capacity Cards Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-base text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-sky-600" />
            أعضاء الفريق ومعدلات الحمل الحالية ({teamMembers.length})
          </h2>
        </div>

        {loading && teamMembers.length === 0 ? (
          <div className="text-center py-16 text-slate-400 text-xs">جاري تحميل بيانات الفريق والطاقة الاستيعابية...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {teamMembers.map((member) => {
              const isHighLoad = member.status === "overloaded";
              const isBalanced = member.status === "balanced";

              return (
                <div
                  key={member.id}
                  className="bg-surface rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-sky-300 hover:shadow-sm transition-all flex flex-col justify-between text-xs space-y-4"
                >
                  <div className="space-y-3">
                    {/* Header: Avatar, Name & Role */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-slate-900 text-white font-bold flex items-center justify-center text-sm shadow-xs">
                          {member.displayName.charAt(0)}
                        </div>
                        <div>
                          <h3 className="font-bold text-base text-slate-900 leading-tight">
                            {member.displayName}
                          </h3>
                          <p className="text-slate-500 text-[11px] mt-0.5">{member.jobTitle}</p>
                        </div>
                      </div>

                      <span className="px-2 py-0.5 rounded-md font-semibold text-[10px] bg-slate-100 text-slate-700">
                        {ROSTER_ROLE_LABELS[member.role as keyof typeof ROSTER_ROLE_LABELS] || member.role}
                      </span>
                    </div>

                    {/* Operational Metrics */}
                    <div className="space-y-2 text-slate-600 text-[11px] pt-3 border-t border-slate-100">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">ساعات العمل الأسبوعية:</span>
                        <span className="font-bold text-slate-800">{member.weeklyHours} ساعة / أسبوع</span>
                      </div>

                      {member.reservedHours > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">ساعات محجوزة للإدارة والمراجعة:</span>
                          <span className="font-semibold text-purple-700">{member.reservedHours} ساعة</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">الحسابات المسندة (Clients):</span>
                        <span className="font-bold text-sky-700">{member.activeClientsCount} عملاء</span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">المهام المفتوحة:</span>
                        <span className="font-bold text-slate-800">{member.activeTasksCount} مهام</span>
                      </div>

                      {/* Weighted Load Score */}
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">الحمل الموزون (Weighted Score):</span>
                        <span className="font-bold font-mono text-slate-900">
                          {member.weightedLoadScore} / {member.maxWeightedLoad}
                        </span>
                      </div>

                      {/* Deadlines Radar */}
                      <div className="flex items-center justify-between pt-1 text-[10px]">
                        <span className="text-slate-400">مواعيد التسليم القادمة:</span>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "px-1.5 py-0.5 rounded font-bold font-mono",
                              member.dueNext7Days > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500"
                            )}
                          >
                            7 أيام: {member.dueNext7Days}
                          </span>
                          <span className="px-1.5 py-0.5 rounded font-bold font-mono bg-slate-100 text-slate-600">
                            14 يوم: {member.dueNext14Days}
                          </span>
                        </div>
                      </div>

                      {/* Planned Load Ratio Progress Bar */}
                      <div className="pt-2 border-t border-slate-100 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500 font-semibold text-[11px]">
                            معدل الحمل المخطط:
                          </span>
                          <span
                            className={cn(
                              "font-bold font-mono text-xs",
                              isHighLoad
                                ? "text-rose-600"
                                : isBalanced
                                ? "text-emerald-700"
                                : "text-sky-700"
                            )}
                          >
                            {member.loadRatio}% ({isHighLoad ? "فائض" : isBalanced ? "متوازن" : "متاح"})
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                          <div
                            className={cn(
                              "h-2 rounded-full transition-all duration-300",
                              isHighLoad ? "bg-rose-500" : isBalanced ? "bg-emerald-500" : "bg-sky-500"
                            )}
                            style={{ width: `${Math.min(100, member.loadRatio)}%` }}
                          />
                        </div>
                      </div>

                      {member.notes && (
                        <div className="text-[10px] text-slate-400 italic pt-1">
                          {member.notes}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 2: Owner Invitations Center */}
      <div className="bg-surface rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4 text-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h2 className="font-bold text-base text-slate-900 flex items-center gap-2">
              <Mail className="w-4 h-4 text-indigo-600" />
              مركز دعوات الفريق والربط الأمني (Owner Team Invitations Center)
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              إعداد مسودات الدعوات للأعضاء الستة المعتمدين دون إنشاء حسابات وهمية أو إرسال إيميلات عشوائية
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowInviteModal(true)}
            className="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl font-bold flex items-center gap-1.5 transition-colors self-start sm:self-auto"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>إنشاء مسودة دعوة</span>
          </button>
        </div>

        {/* Invitations Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
              <tr>
                <th className="p-3">عضو الفريق</th>
                <th className="p-3">البريد الإلكتروني</th>
                <th className="p-3">الدور المخصص</th>
                <th className="p-3">الحالة</th>
                <th className="p-3">تاريخ الإنشاء</th>
                <th className="p-3">الإجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invitations.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-6 text-slate-400">
                    لا توجد دعوات مسجلة حالياً في مساحة العمل.
                  </td>
                </tr>
              ) : (
                invitations.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50/60">
                    <td className="p-3 font-bold text-slate-900">
                      {inv.roster_person?.display_name || "عضو فريق"}
                    </td>
                    <td className="p-3 font-mono text-slate-700">{inv.invited_email}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                        {ROSTER_ROLE_LABELS[inv.role as keyof typeof ROSTER_ROLE_LABELS] || inv.role}
                      </span>
                    </td>
                    <td className="p-3">
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-bold",
                          inv.status === "pending"
                            ? "bg-amber-100 text-amber-800"
                            : inv.status === "accepted"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-600"
                        )}
                      >
                        {inv.status === "pending"
                          ? "معلقة (مسودة)"
                          : inv.status === "accepted"
                          ? "تم القبول"
                          : inv.status}
                      </span>
                    </td>
                    <td className="p-3 text-slate-500 font-mono text-[11px]">
                      {new Date(inv.created_at).toLocaleDateString("ar-EG")}
                    </td>
                    <td className="p-3">
                      {inv.status === "pending" && (
                        <button
                          type="button"
                          onClick={() => handleRevokeInvite(inv.id)}
                          className="text-rose-600 hover:text-rose-700 p-1 hover:bg-rose-50 rounded text-[11px] font-semibold"
                          title="إلغاء الدعوة"
                        >
                          إلغاء
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Draft Invitation Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleSaveDraftInvite}
            className="bg-surface rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150 text-xs"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <Mail className="w-4 h-4 text-indigo-600" />
                تجهيز مسودة دعوة لعضو الفريق
              </h3>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Paused Alert Inside Modal */}
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-[11px] leading-relaxed">
              <strong>تنبيه أمان للمدير العام:</strong> الدعوات متوقفة مؤقتًا في مساحة العمل. سيتم حفظ هذا السجل كمسودة معتمدة دون إرسال أي إيميل للمستخدم أو إنشاء حساب وهمي.
            </div>

            <div className="space-y-3">
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  اختر العضو من الفريق <span className="text-rose-500">*</span>:
                </label>
                <select
                  value={selectedRosterId}
                  onChange={(e) => handleSelectRosterPerson(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-semibold focus:outline-sky-500"
                >
                  <option value="">-- اختر عضو الفريق --</option>
                  {teamMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName} ({m.jobTitle})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  البريد الإلكتروني المعتمد <span className="text-rose-500">*</span>:
                </label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="name@gmail.com"
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-mono focus:outline-sky-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">الدور الوظيفي والصلاحيات:</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs"
                >
                  <option value="designer">مصمم (Designer)</option>
                  <option value="senior_reviewer">مراجع أول (Senior Reviewer)</option>
                </select>
              </div>
            </div>

            {inviteModalError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-[11px]">
                {inviteModalError}
              </div>
            )}

            {inviteModalSuccess && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-[11px] font-bold">
                {inviteModalSuccess}
              </div>
            )}

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold"
              >
                إلغاء
              </button>

              <div className="flex items-center gap-2">
                {/* Live send button is intentionally disabled while paused */}
                <button
                  type="button"
                  disabled
                  className="px-3 py-2 bg-slate-100 text-slate-400 rounded-xl font-bold text-[11px] flex items-center gap-1 cursor-not-allowed border border-slate-200"
                  title="الإرسال المباشر متوقف بأمر المدير العام"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>إرسال فوري (معطل)</span>
                </button>

                <button
                  type="submit"
                  disabled={submittingInvite || !selectedRosterId || !inviteEmail.trim()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-xl font-bold shadow-xs transition-colors"
                >
                  {submittingInvite ? "جاري الحفظ..." : "حفظ كمسودة دعوة"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
