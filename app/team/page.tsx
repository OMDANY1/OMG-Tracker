"use client";

import React, { useState, useEffect, useMemo } from "react";
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
  Copy,
  Send,
  UserX,
  Edit2,
  ShieldAlert,
  Sparkles,
  Check,
  ArrowRightLeft,
  FileText,
} from "lucide-react";
import { ROSTER_ROLE_LABELS, cn } from "@/lib/utils";

export interface WorkloadMember {
  id: string;
  displayName: string;
  jobTitle: string;
  role: string;
  specialties?: string[];
  hasJoined?: boolean;
  isActive?: boolean;
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

export interface InvitationRecord {
  id: string;
  invited_email: string;
  role: string;
  status: string;
  expires_at: string;
  created_at: string;
  last_sent_at?: string | null;
  notes?: string | null;
  isDraft?: boolean;
  canCopyLink?: boolean;
  roster_person?: {
    id: string;
    display_name: string;
    job_title: string;
    is_active?: boolean;
  };
}

const AVAILABLE_SPECIALTIES = [
  { key: "design", label: "تصميم جرافيك" },
  { key: "copywriting", label: "كتابة محتوى" },
  { key: "strategy", label: "استراتيجية" },
  { key: "video_editing", label: "مونتاج فيديو" },
  { key: "management", label: "إدارة ومتابعة" },
];

const AVAILABLE_ROLES = [
  { value: "designer", label: "مصمم (Designer)" },
  { value: "senior_reviewer", label: "مراجع أول (Senior Reviewer)" },
  { value: "marketing_director", label: "مدير تسويق (Marketing Director)" },
  { value: "strategy_lead", label: "قائد فريق استراتيجية (Strategy Lead)" },
  { value: "strategist", label: "استراتيجي (Strategist)" },
  { value: "content_writer", label: "كاتب محتوى (Content Writer)" },
  { value: "video_editor", label: "مونتير (Video Editor)" },
  { value: "business_owner_viewer", label: "مالك الشركة (مشاهد فقط)" },
];

function getMemberStatus(member: WorkloadMember, invitations: InvitationRecord[]) {
  if (member.isActive === false) {
    return {
      key: "deactivated" as const,
      label: "معطل مؤقتاً",
      badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
    };
  }
  if (member.hasJoined) {
    return {
      key: "joined" as const,
      label: "انضم للعمل",
      badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  }
  const hasPendingInvite = invitations.some(
    (inv) => inv.roster_person?.id === member.id && ["pending", "draft"].includes(inv.status)
  );
  if (hasPendingInvite) {
    return {
      key: "pending_invite" as const,
      label: "دعوة معلقة",
      badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
    };
  }
  return {
    key: "not_invited" as const,
    label: "لم تتم دعوته",
    badgeClass: "bg-slate-100 text-slate-600 border-slate-200",
  };
}

export default function TeamPage() {
  const [teamMembers, setTeamMembers] = useState<WorkloadMember[]>([]);
  const [invitations, setInvitations] = useState<InvitationRecord[]>([]);
  const [invitationsPaused, setInvitationsPaused] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isViewer, setIsViewer] = useState<boolean>(false);
  const [copySuccessId, setCopySuccessId] = useState<string | null>(null);

  // Add Member Modal State
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberJobTitle, setNewMemberJobTitle] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("designer");
  const [newMemberSpecialties, setNewMemberSpecialties] = useState<string[]>(["design"]);
  const [newMemberWeeklyHours, setNewMemberWeeklyHours] = useState(40);
  const [newMemberMaxLoad, setNewMemberMaxLoad] = useState(15);
  const [submittingMember, setSubmittingMember] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  // Edit Member Modal State
  const [editingMember, setEditingMember] = useState<WorkloadMember | null>(null);
  const [editName, setEditName] = useState("");
  const [editJobTitle, setEditJobTitle] = useState("");
  const [editRole, setEditRole] = useState("designer");
  const [editSpecialties, setEditSpecialties] = useState<string[]>([]);
  const [editWeeklyHours, setEditWeeklyHours] = useState(40);
  const [editMaxLoad, setEditMaxLoad] = useState(15);
  const [savingMember, setSavingMember] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Deactivation Impact Modal State
  const [deactivatingMember, setDeactivatingMember] = useState<WorkloadMember | null>(null);
  const [deactivationImpact, setDeactivationImpact] = useState<any | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [deactivationError, setDeactivationError] = useState<string | null>(null);

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
        if (typeof data.isViewer === "boolean") {
          setIsViewer(data.isViewer);
        }
      }

      if (invitesRes.ok) {
        const iData = await invitesRes.json();
        setInvitations(iData.invitations || []);
        if (typeof iData.invitationsPaused === "boolean") {
          setInvitationsPaused(iData.invitationsPaused);
        }
        if (typeof iData.isViewer === "boolean") {
          setIsViewer(iData.isViewer);
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

  // Listen for persona changes
  useEffect(() => {
    const handlePersonaChange = (e: any) => {
      if (e.detail?.role === "business_owner_viewer") {
        setIsViewer(true);
      } else if (e.detail) {
        setIsViewer(false);
      }
    };
    window.addEventListener("persona_changed", handlePersonaChange);
    return () => window.removeEventListener("persona_changed", handlePersonaChange);
  }, []);

  // Handler for adding a new member
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberName.trim() || !newMemberJobTitle.trim()) {
      setMemberError("يرجى كتابة الاسم والمسمى الوظيفي.");
      return;
    }

    setSubmittingMember(true);
    setMemberError(null);

    try {
      const res = await fetch("/api/team/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: newMemberName.trim(),
          jobTitle: newMemberJobTitle.trim(),
          role: newMemberRole,
          specialties: newMemberSpecialties,
          weeklyHours: Number(newMemberWeeklyHours) || 40,
          maxWeightedLoad: Number(newMemberMaxLoad) || 15,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "فشل إضافة العضو.");
      }

      setShowAddMemberModal(false);
      setNewMemberName("");
      setNewMemberJobTitle("");
      setNewMemberRole("designer");
      setNewMemberSpecialties(["design"]);
      fetchTeamData();
    } catch (err: any) {
      setMemberError(err.message || "حدث خطأ أثناء إضافة العضو.");
    } finally {
      setSubmittingMember(false);
    }
  };

  // Handler for editing an existing member
  const handleOpenEditMember = (member: WorkloadMember) => {
    setEditingMember(member);
    setEditName(member.displayName);
    setEditJobTitle(member.jobTitle);
    setEditRole(member.role);
    setEditSpecialties(member.specialties || []);
    setEditWeeklyHours(member.weeklyHours || 40);
    setEditMaxLoad(member.maxWeightedLoad || 15);
    setEditError(null);
  };

  const handleSaveEditMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;

    if (!editName.trim() || !editJobTitle.trim()) {
      setEditError("يرجى كتابة الاسم والمسمى الوظيفي.");
      return;
    }

    setSavingMember(true);
    setEditError(null);

    try {
      const res = await fetch(`/api/team/members/${editingMember.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: editName.trim(),
          jobTitle: editJobTitle.trim(),
          role: editRole,
          specialties: editSpecialties,
          weeklyHours: Number(editWeeklyHours) || 40,
          maxWeightedLoad: Number(editMaxLoad) || 15,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "فشل حفظ التعديلات.");
      }

      setEditingMember(null);
      fetchTeamData();
    } catch (err: any) {
      setEditError(err.message || "حدث خطأ أثناء حفظ التعديلات.");
    } finally {
      setSavingMember(false);
    }
  };

  // Handler for opening safe deactivation impact check
  const handleOpenDeactivation = async (member: WorkloadMember) => {
    if (member.role === "owner") {
      alert("لا يمكن تعطيل حساب المدير العام (المالك) حفاظاً على استقرار مساحة العمل.");
      return;
    }

    // If currently inactive, allow direct reactivation
    if (member.isActive === false) {
      if (confirm(`هل ترغب في إعادة تفعيل حساب "${member.displayName}"؟`)) {
        try {
          const res = await fetch(`/api/team/members/${member.id}/toggle-active`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isActive: true }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "فشل إعادة التفعيل.");
          fetchTeamData();
        } catch (e: any) {
          alert(e.message);
        }
      }
      return;
    }

    // Active member: fetch deactivation impact
    setDeactivatingMember(member);
    setLoadingImpact(true);
    setDeactivationImpact(null);
    setDeactivationError(null);

    try {
      const res = await fetch(`/api/team/members/${member.id}/impact`);
      const data = await res.json();
      if (res.ok && data.impact) {
        setDeactivationImpact(data.impact);
      } else {
        setDeactivationError(data.error || "تعذر قراءة أثر التعطيل.");
      }
    } catch (err: any) {
      setDeactivationError(err.message || "حدث خطأ أثناء الاتصال.");
    } finally {
      setLoadingImpact(false);
    }
  };

  const handleConfirmDeactivation = async () => {
    if (!deactivatingMember) return;

    setConfirmingDeactivate(true);
    setDeactivationError(null);

    try {
      const res = await fetch(`/api/team/members/${deactivatingMember.id}/toggle-active`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "فشل تعطيل حساب العضو.");
      }

      setDeactivatingMember(null);
      fetchTeamData();
    } catch (err: any) {
      setDeactivationError(err.message || "حدث خطأ أثناء تعطيل العضو.");
    } finally {
      setConfirmingDeactivate(false);
    }
  };

  const handleSelectRosterPerson = (personId: string) => {
    setSelectedRosterId(personId);
    const person = teamMembers.find((m) => m.id === personId);
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

  const handleCopyLink = (inv: InvitationRecord) => {
    const host = window.location.host;
    const baseOrigin =
      host.includes("localhost") || host.includes("127.0.0.1")
        ? window.location.origin
        : "https://omg-creative-workspace.vercel.app";
    const inviteUrl = `${baseOrigin}/accept-invite?id=${inv.id}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopySuccessId(inv.id);
    setTimeout(() => setCopySuccessId(null), 2500);
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">إدارة الفريق والطاقة الاستيعابية</h1>
          <p className="text-sm text-slate-500 mt-1">
            إضافة أعضاء الفريق، توزيع التخصصات، تتبع حالات الانضمام، وإدارة الدعوات بأمان
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {isViewer && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-xs font-semibold">
              <ShieldAlert className="w-4 h-4 text-amber-600" />
              <span>مالك الشركة (مشاهد فقط)</span>
            </div>
          )}
          <button
            onClick={fetchTeamData}
            disabled={loading}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
            title="تحديث البيانات"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
          {!isViewer && (
            <>
              <button
                onClick={() => {
                  setMemberError(null);
                  setShowAddMemberModal(true);
                }}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة عضو جديد</span>
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
                <span>تجهيز مسودة دعوة</span>
              </button>
            </>
          )}
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
                <span>حالة إرسال الإيميلات التلقائية: متوقفة مؤقتًا</span>
                <span className="px-2 py-0.5 bg-amber-200/80 text-amber-900 font-bold rounded-md text-[10px]">
                  وضع الحماية نشط
                </span>
              </div>
              <p className="text-slate-600 text-[11px] mt-0.5 leading-relaxed">
                لمنع إرسال إيميلات عشوائية، يتم إنشاء الدعوات كمسودات، ويمكنك نسخ رابط الدعوة يدويًا وإرساله مباشرة لعضو الفريق عبر واتساب أو تليجرام.
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
        ) : teamMembers.length === 0 ? (
          <div className="p-12 text-center bg-surface rounded-2xl border-2 border-dashed border-slate-200 space-y-3 max-w-md mx-auto my-4">
            <Users className="w-10 h-10 text-slate-300 mx-auto" />
            <h3 className="font-bold text-slate-700">لا يوجد أعضاء في الفريق حالياً</h3>
            <p className="text-xs text-slate-400">
              ابدأ بإضافة أول عضو في الفريق وتحديد اختصاصاته وساعات العمل.
            </p>
            {!isViewer && (
              <button
                onClick={() => setShowAddMemberModal(true)}
                className="mt-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة عضو جديد</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {teamMembers.map((member) => {
              const isHighLoad = member.status === "overloaded";
              const isBalanced = member.status === "balanced";
              const memberStatus = getMemberStatus(member, invitations);

              return (
                <div
                  key={member.id}
                  className="bg-surface rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-sky-300 hover:shadow-sm transition-all flex flex-col justify-between text-xs space-y-4"
                >
                  <div className="space-y-3">
                    {/* Header: Avatar, Name, Status Badge & Role */}
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

                      <div className="flex flex-col items-end gap-1">
                        <span className={cn("px-2 py-0.5 rounded-md font-bold text-[10px] border", memberStatus.badgeClass)}>
                          {memberStatus.label}
                        </span>
                        <span className="px-2 py-0.5 rounded-md font-semibold text-[10px] bg-slate-100 text-slate-700">
                          {ROSTER_ROLE_LABELS[member.role as keyof typeof ROSTER_ROLE_LABELS] || member.role}
                        </span>
                      </div>
                    </div>

                    {/* Specialties Tags */}
                    {member.specialties && member.specialties.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {member.specialties.map((spec) => {
                          const specObj = AVAILABLE_SPECIALTIES.find((s) => s.key === spec);
                          return (
                            <span
                              key={spec}
                              className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-100 text-[9px] font-medium"
                            >
                              {specObj?.label || spec}
                            </span>
                          );
                        })}
                      </div>
                    )}

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

                      {/* Member Actions */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                        {!isViewer ? (
                          <button
                            type="button"
                            onClick={() => handleOpenEditMember(member)}
                            className="px-2.5 py-1 rounded-lg text-[10px] font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 transition-colors flex items-center gap-1"
                          >
                            <Edit2 className="w-3 h-3" />
                            <span>تعديل</span>
                          </button>
                        ) : <div />}

                        {member.role === "owner" ? (
                          <span className="text-[10px] text-slate-400 flex items-center gap-1">
                            <Lock className="w-3 h-3 text-slate-400" />
                            <span>حساب المالك محمي</span>
                          </span>
                        ) : !isViewer ? (
                          <button
                            type="button"
                            onClick={() => handleOpenDeactivation(member)}
                            className={cn(
                              "px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-colors flex items-center gap-1",
                              member.isActive !== false
                                ? "bg-rose-50 text-rose-700 hover:bg-rose-100"
                                : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            )}
                          >
                            {member.isActive !== false ? (
                              <>
                                <UserX className="w-3 h-3" />
                                <span>تعطيل</span>
                              </>
                            ) : (
                              <>
                                <UserCheck className="w-3 h-3" />
                                <span>إعادة تفعيل</span>
                              </>
                            )}
                          </button>
                        ) : null}
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
              مركز دعوات الفريق والربط الأمني (Team Invitations Center)
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              إدارة مسودات الدعوات ونسخ روابط الانضمام للمشاركين المعتمدين دون إرسال إيميلات عشوائية
            </p>
          </div>

          {!isViewer && (
            <button
              type="button"
              onClick={() => setShowInviteModal(true)}
              className="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl font-bold flex items-center gap-1.5 transition-colors self-start sm:self-auto"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>إنشاء مسودة دعوة</span>
            </button>
          )}
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
                <th className="p-3">الإجراءات</th>
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
                          inv.status === "draft"
                            ? "bg-amber-100 text-amber-900"
                            : inv.status === "pending"
                            ? "bg-sky-100 text-sky-800"
                            : inv.status === "accepted"
                            ? "bg-emerald-100 text-emerald-800"
                            : inv.status === "revoked"
                            ? "bg-rose-100 text-rose-800"
                            : "bg-slate-100 text-slate-600"
                        )}
                      >
                        {inv.status === "draft"
                          ? "مسودة (غير مرسلة)"
                          : inv.status === "pending"
                          ? "معلقة"
                          : inv.status === "accepted"
                          ? "تم القبول"
                          : inv.status === "revoked"
                          ? "ملغاة"
                          : inv.status}
                      </span>
                    </td>
                    <td className="p-3 text-slate-500 font-mono text-[11px]">
                      {new Date(inv.created_at).toLocaleDateString("ar-EG")}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5">
                        {/* Copy Link button */}
                        <button
                          type="button"
                          onClick={() => handleCopyLink(inv)}
                          className={cn(
                            "p-1.5 rounded text-[11px] font-semibold flex items-center gap-1 transition-colors",
                            copySuccessId === inv.id
                              ? "bg-emerald-50 text-emerald-700 font-bold"
                              : "text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50"
                          )}
                          title="نسخ رابط الانضمام المباشر"
                        >
                          {copySuccessId === inv.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              <span>تم النسخ!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">نسخ الرابط</span>
                            </>
                          )}
                        </button>

                        {/* Revoke button */}
                        {!isViewer && inv.status !== "revoked" && inv.status !== "accepted" && (
                          <button
                            type="button"
                            onClick={() => handleRevokeInvite(inv.id)}
                            className="text-rose-600 hover:text-rose-700 p-1.5 hover:bg-rose-50 rounded text-[11px] font-semibold flex items-center gap-1 transition-colors"
                            title="إلغاء الدعوة"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">إلغاء</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal 1: Add Team Member Modal */}
      {showAddMemberModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleAddMember}
            className="bg-surface rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150 text-xs"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <Plus className="w-5 h-5 text-sky-600" />
                إضافة عضو جديد للفريق
              </h3>
              <button
                type="button"
                onClick={() => setShowAddMemberModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  الاسم بالعربية <span className="text-rose-500">*</span>:
                </label>
                <input
                  type="text"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  placeholder="مثال: أحمد محمود"
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-semibold focus:outline-sky-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  المسمى الوظيفي <span className="text-rose-500">*</span>:
                </label>
                <input
                  type="text"
                  value={newMemberJobTitle}
                  onChange={(e) => setNewMemberJobTitle(e.target.value)}
                  placeholder="مثال: Senior Graphic Designer / كاتب محتوى إبداعي"
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs focus:outline-sky-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">الدور والصلاحيات في النظام:</label>
                <select
                  value={newMemberRole}
                  onChange={(e) => setNewMemberRole(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-semibold"
                >
                  {AVAILABLE_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">التخصصات المعتمدة:</label>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {AVAILABLE_SPECIALTIES.map((spec) => {
                    const isChecked = newMemberSpecialties.includes(spec.key);
                    return (
                      <label
                        key={spec.key}
                        className={cn(
                          "flex items-center gap-2 p-2 rounded-xl border cursor-pointer text-[11px] transition-colors",
                          isChecked
                            ? "bg-sky-50 border-sky-300 text-sky-900 font-bold"
                            : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewMemberSpecialties([...newMemberSpecialties, spec.key]);
                            } else {
                              setNewMemberSpecialties(newMemberSpecialties.filter((k) => k !== spec.key));
                            }
                          }}
                          className="rounded text-sky-600"
                        />
                        <span>{spec.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">الساعات الأسبوعية:</label>
                  <input
                    type="number"
                    min={1}
                    max={80}
                    value={newMemberWeeklyHours}
                    onChange={(e) => setNewMemberWeeklyHours(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">أقصى حمل موزون:</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={newMemberMaxLoad}
                    onChange={(e) => setNewMemberMaxLoad(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs"
                  />
                </div>
              </div>
            </div>

            {memberError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-[11px]">
                {memberError}
              </div>
            )}

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowAddMemberModal(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold"
              >
                إلغاء
              </button>

              <button
                type="submit"
                disabled={submittingMember}
                className="px-5 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white rounded-xl font-bold shadow-xs transition-colors flex items-center gap-1.5"
              >
                {submittingMember ? "جاري الإضافة..." : "حفظ وإضافة العضو"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal 2: Edit Team Member Modal */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleSaveEditMember}
            className="bg-surface rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150 text-xs"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-indigo-600" />
                تعديل بيانات العضو: {editingMember.displayName}
              </h3>
              <button
                type="button"
                onClick={() => setEditingMember(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  الاسم بالعربية <span className="text-rose-500">*</span>:
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-semibold focus:outline-sky-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  المسمى الوظيفي <span className="text-rose-500">*</span>:
                </label>
                <input
                  type="text"
                  value={editJobTitle}
                  onChange={(e) => setEditJobTitle(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs focus:outline-sky-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">الدور والصلاحيات:</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  disabled={editingMember.role === "owner"}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-semibold disabled:bg-slate-100"
                >
                  {editingMember.role === "owner" ? (
                    <option value="owner">المدير العام المالك (Owner - محمي)</option>
                  ) : (
                    AVAILABLE_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">التخصصات المعتمدة:</label>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {AVAILABLE_SPECIALTIES.map((spec) => {
                    const isChecked = editSpecialties.includes(spec.key);
                    return (
                      <label
                        key={spec.key}
                        className={cn(
                          "flex items-center gap-2 p-2 rounded-xl border cursor-pointer text-[11px] transition-colors",
                          isChecked
                            ? "bg-sky-50 border-sky-300 text-sky-900 font-bold"
                            : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setEditSpecialties([...editSpecialties, spec.key]);
                            } else {
                              setEditSpecialties(editSpecialties.filter((k) => k !== spec.key));
                            }
                          }}
                          className="rounded text-sky-600"
                        />
                        <span>{spec.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">الساعات الأسبوعية:</label>
                  <input
                    type="number"
                    min={1}
                    max={80}
                    value={editWeeklyHours}
                    onChange={(e) => setEditWeeklyHours(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">أقصى حمل موزون:</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={editMaxLoad}
                    onChange={(e) => setEditMaxLoad(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs"
                  />
                </div>
              </div>
            </div>

            {editError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-[11px]">
                {editError}
              </div>
            )}

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setEditingMember(null)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold"
              >
                إلغاء
              </button>

              <button
                type="submit"
                disabled={savingMember}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-xl font-bold shadow-xs transition-colors"
              >
                {savingMember ? "جاري الحفظ..." : "حفظ التعديلات"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal 3: Safe Deactivation Impact Modal */}
      {deactivatingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-surface rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150 text-xs">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100 text-rose-700">
              <div className="p-2 rounded-xl bg-rose-100 text-rose-700">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  فحص أثر تعطيل الحساب: {deactivatingMember.displayName}
                </h3>
                <p className="text-[11px] text-slate-500">مراجعة المهام المفتوحة والحسابات المسندة قبل التعطيل</p>
              </div>
            </div>

            {loadingImpact ? (
              <div className="py-8 text-center text-slate-400 space-y-2">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto text-sky-600" />
                <p>جاري احتساب أثر التعطيل وفحص المهام المرتبطة...</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">المهام المفتوحة المسندة:</span>
                    <span className={cn("font-bold font-mono text-sm", (deactivationImpact?.open_tasks_count || 0) > 0 ? "text-rose-600" : "text-emerald-700")}>
                      {deactivationImpact?.open_tasks_count || 0} مهام
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">العملاء المسندون:</span>
                    <span className={cn("font-bold font-mono text-sm", (deactivationImpact?.assigned_clients_count || 0) > 0 ? "text-amber-700" : "text-emerald-700")}>
                      {deactivationImpact?.assigned_clients_count || 0} عملاء
                    </span>
                  </div>
                </div>

                {(deactivationImpact?.open_tasks_count > 0 || deactivationImpact?.assigned_clients_count > 0) && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 space-y-1 text-[11px] leading-relaxed">
                    <strong>تنبيه للحفاظ على سير العمل:</strong> هذا العضو لديه مهام مفتوحة أو عملاء مسندين. لن يتم حذف هذه المهام بل ستبقى مرتبطة بالعضو، ولكن يوصى بإعادة إسنادها من صفحة العملاء والمهام لتفادي تأخر التسليمات.
                  </div>
                )}

                {deactivationError && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-[11px]">
                    {deactivationError}
                  </div>
                )}
              </div>
            )}

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={confirmingDeactivate}
                onClick={() => setDeactivatingMember(null)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold"
              >
                إلغاء
              </button>

              <button
                type="button"
                disabled={loadingImpact || confirmingDeactivate}
                onClick={handleConfirmDeactivation}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white rounded-xl font-bold shadow-xs transition-colors"
              >
                {confirmingDeactivate ? "جاري التعطيل..." : "تأكيد التعطيل المؤقت"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 4: Draft Invitation Modal */}
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

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-[11px] leading-relaxed">
              <strong>تنبيه أمان للمدير العام:</strong> إرسال الإيميلات التلقائي متوقف. سيتم حفظ هذا السجل كمسودة معتمدة، ويمكنك نسخ الرابط مباشرة ومشاركته مع العضو.
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
                  placeholder="name@company.com"
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
                  {AVAILABLE_ROLES.filter((r) => r.value !== "owner").map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
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

              <button
                type="submit"
                disabled={submittingInvite || !selectedRosterId || !inviteEmail.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-xl font-bold shadow-xs transition-colors"
              >
                {submittingInvite ? "جاري الحفظ..." : "حفظ كمسودة دعوة"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
