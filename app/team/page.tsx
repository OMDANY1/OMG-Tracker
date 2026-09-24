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
import { PermissionsMatrixModal } from "@/components/team/PermissionsMatrixModal";
import {
  ROLE_PERMISSIONS_MATRIX,
  AccessScope,
  CustomPermissions,
  GranularPermissionKey,
  GRANULAR_PERMISSIONS_LIST,
  ACCESS_SCOPE_CONFIGS,
  DEFAULT_ROLE_PERMISSIONS,
} from "@/types/database";

export interface WorkloadMember {
  id: string;
  displayName: string;
  jobTitle: string;
  role: string;
  access_scope?: AccessScope;
  custom_permissions?: CustomPermissions;
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
  rawToken?: string | null;
  isDraft?: boolean;
  isExpired?: boolean;
  effectiveStatus?: string;
  inviteUrl?: string;
  canCopyLink?: boolean;
  canResend?: boolean;
  canRevoke?: boolean;
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

function getDefaultScopeForRole(role: string): AccessScope {
  if (role === "owner" || role === "manager" || role === "marketing_director" || role === "business_owner_viewer") {
    return "workspace";
  }
  if (role === "strategy_lead" || role === "senior_reviewer") {
    return "assigned_team";
  }
  if (role === "strategist") {
    return "assigned_clients";
  }
  return "assigned_tasks";
}

function getMemberStatus(member: WorkloadMember, invitations: InvitationRecord[]) {
  const isOwner = member.role === "owner" || member.displayName.includes("عماد");
  if (isOwner) {
    return {
      key: "active" as const,
      label: "نشط",
      badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
      invitation: null,
    };
  }

  if (member.isActive === false) {
    return {
      key: "deactivated" as const,
      label: "معطل مؤقتاً",
      badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
      invitation: null,
    };
  }

  if (member.hasJoined) {
    return {
      key: "active" as const,
      label: "نشط",
      badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
      invitation: null,
    };
  }

  const matchingInvite = invitations.find(
    (inv) => inv.roster_person?.id === member.id || (inv as any).roster_person_id === member.id
  );

  if (matchingInvite) {
    const isExpired =
      matchingInvite.isExpired ||
      (matchingInvite.status === "pending" && new Date(matchingInvite.expires_at).getTime() < Date.now());

    if (matchingInvite.status === "accepted") {
      return {
        key: "active" as const,
        label: "نشط",
        badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
        invitation: matchingInvite,
      };
    }
    if (matchingInvite.status === "pending" || matchingInvite.status === "draft") {
      if (isExpired) {
        return {
          key: "expired" as const,
          label: "انتهت الدعوة",
          badgeClass: "bg-amber-100 text-amber-900 border-amber-300",
          invitation: matchingInvite,
        };
      }
      return {
        key: "pending" as const,
        label: "الدعوة معلقة",
        badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
        invitation: matchingInvite,
      };
    }
    if (matchingInvite.status === "revoked") {
      return {
        key: "revoked" as const,
        label: "تم إلغاء الدعوة",
        badgeClass: "bg-slate-100 text-slate-500 border-slate-200",
        invitation: matchingInvite,
      };
    }
  }

  return {
    key: "not_invited" as const,
    label: "لم تتم دعوته",
    badgeClass: "bg-slate-100 text-slate-600 border-slate-200",
    invitation: null,
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
  const [showPermissionsMatrix, setShowPermissionsMatrix] = useState<boolean>(false);

  // Active Team Count (excluding deactivated legacy owner)
  const activeMembersCount = useMemo(() => {
    return teamMembers.filter(
      (m) => m.isActive !== false && !m.displayName.includes("المدير العام (Owner)")
    ).length;
  }, [teamMembers]);

  // Add Member Modal State
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberJobTitle, setNewMemberJobTitle] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("designer");
  const [newMemberAccessScope, setNewMemberAccessScope] = useState<AccessScope>("assigned_tasks");
  const [newMemberCustomPermissions, setNewMemberCustomPermissions] = useState<CustomPermissions>(
    () => ({ ...(DEFAULT_ROLE_PERMISSIONS.designer || {}) })
  );
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
  const [editAccessScope, setEditAccessScope] = useState<AccessScope>("assigned_tasks");
  const [editCustomPermissions, setEditCustomPermissions] = useState<CustomPermissions>({});
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
  const [inviteMode, setInviteMode] = useState<"new_user" | "existing_roster">("new_user");
  const [inviteFullName, setInviteFullName] = useState<string>("");
  const [inviteJobTitle, setInviteJobTitle] = useState<string>("");
  const [selectedRosterId, setSelectedRosterId] = useState<string>("");
  const [inviteEmail, setInviteEmail] = useState<string>("");
  const [inviteRole, setInviteRole] = useState<string>("designer");
  const [submittingInvite, setSubmittingInvite] = useState<boolean>(false);
  const [inviteModalError, setInviteModalError] = useState<string | null>(null);
  const [inviteModalSuccess, setInviteModalSuccess] = useState<string | null>(null);
  const [invitePendingConflictId, setInvitePendingConflictId] = useState<string | null>(null);

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

  // Role change handler for adding member
  const handleNewMemberRoleChange = (role: string) => {
    setNewMemberRole(role);
    const scope = getDefaultScopeForRole(role);
    setNewMemberAccessScope(scope);
    const perms = DEFAULT_ROLE_PERMISSIONS[role as keyof typeof DEFAULT_ROLE_PERMISSIONS];
    if (perms) {
      setNewMemberCustomPermissions({ ...perms });
    }
  };

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
          accessScope: newMemberAccessScope,
          customPermissions: newMemberCustomPermissions,
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
      setNewMemberAccessScope("assigned_tasks");
      setNewMemberCustomPermissions({ ...(DEFAULT_ROLE_PERMISSIONS.designer || {}) });
      setNewMemberSpecialties(["design"]);
      fetchTeamData();
    } catch (err: any) {
      setMemberError(err.message || "حدث خطأ أثناء إضافة العضو.");
    } finally {
      setSubmittingMember(false);
    }
  };

  // Role change handler for editing member
  const handleEditRoleChange = (role: string) => {
    setEditRole(role);
    const scope = getDefaultScopeForRole(role);
    setEditAccessScope(scope);
    const perms = DEFAULT_ROLE_PERMISSIONS[role as keyof typeof DEFAULT_ROLE_PERMISSIONS];
    if (perms) {
      setEditCustomPermissions({ ...perms });
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
    const defaultScope = getDefaultScopeForRole(member.role);
    setEditAccessScope(member.access_scope || defaultScope);
    const defaultPerms = DEFAULT_ROLE_PERMISSIONS[member.role as keyof typeof DEFAULT_ROLE_PERMISSIONS] || {};
    setEditCustomPermissions(
      member.custom_permissions && Object.keys(member.custom_permissions).length > 0
        ? { ...member.custom_permissions }
        : { ...defaultPerms }
    );
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
          accessScope: editAccessScope,
          customPermissions: editCustomPermissions,
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

  const handleSendOrIssueInvite = async (actionType: "send" | "issue" | "create_draft" = "send") => {
    if (inviteMode === "new_user" && (!inviteFullName.trim() || !inviteEmail.trim())) {
      setInviteModalError("يرجى إدخال الاسم الكامل والبريد الإلكتروني للعضو الجديد.");
      return;
    }
    if (inviteMode === "existing_roster" && (!selectedRosterId || !inviteEmail.trim())) {
      setInviteModalError("يرجى اختيار العضو من القائمة وإدخال البريد الإلكتروني.");
      return;
    }

    setSubmittingInvite(true);
    setInviteModalError(null);
    setInviteModalSuccess(null);
    setInvitePendingConflictId(null);

    try {
      const res = await fetch("/api/team/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rosterPersonId: inviteMode === "existing_roster" ? selectedRosterId : undefined,
          fullName: inviteMode === "new_user" ? inviteFullName.trim() : undefined,
          jobTitle: inviteMode === "new_user" ? inviteJobTitle.trim() : undefined,
          email: inviteEmail.trim(),
          role: inviteRole,
          action: actionType,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.alreadyPending) {
          setInvitePendingConflictId(data.existingInvitationId);
        }
        throw new Error(data.error || "فشل معالجة الدعوة.");
      }

      const host = window.location.host;
      const baseOrigin =
        host.includes("localhost") || host.includes("127.0.0.1")
          ? window.location.origin
          : "https://omg-creative-workspace.vercel.app";

      if (data.rawToken) {
        navigator.clipboard.writeText(`${baseOrigin}/accept-invite?token=${data.rawToken}`);
      }

      setInviteModalSuccess(
        data.message ||
          "تم إرسال الدعوة وتفعيل الرابط بنجاح! تم نسخ رابط الدعوة المباشر إلى الحافظة تلقائياً."
      );
      setTimeout(() => {
        setShowInviteModal(false);
        setInviteModalSuccess(null);
        setSelectedRosterId("");
        setInviteFullName("");
        setInviteJobTitle("");
        setInviteEmail("");
        setInvitePendingConflictId(null);
        fetchTeamData();
      }, 1500);
    } catch (err: any) {
      setInviteModalError(err.message || "حدث خطأ أثناء حفظ الدعوة.");
    } finally {
      setSubmittingInvite(false);
    }
  };

  const handleResendInvite = async (invitationId: string) => {
    try {
      const res = await fetch("/api/team/invitations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: invitationId, action: "resend" }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "فشل إعادة إرسال الدعوة.");
        return;
      }
      if (data.rawToken) {
        const host = window.location.host;
        const baseOrigin =
          host.includes("localhost") || host.includes("127.0.0.1")
            ? window.location.origin
            : "https://omg-creative-workspace.vercel.app";
        navigator.clipboard.writeText(`${baseOrigin}/accept-invite?token=${data.rawToken}`);
        setCopySuccessId(invitationId);
        setTimeout(() => setCopySuccessId(null), 2500);
      }
      alert(data.message || "تم تجديد صلاحية الدعوة وإعادة إرسالها بنجاح!");
      fetchTeamData();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleIssueExistingInvite = async (invitationId: string) => {
    try {
      const res = await fetch("/api/team/invitations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: invitationId, action: "issue" }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "فشل تفعيل الرابط.");
        return;
      }
      fetchTeamData();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleRevokeInvite = async (invitationId: string) => {
    if (!confirm("هل أنت متأكد من رغبتك في إلغاء هذه الدعوة (Revoke)؟")) return;
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
    const inviteUrl = inv.rawToken
      ? `${baseOrigin}/accept-invite?token=${encodeURIComponent(inv.rawToken)}`
      : `${baseOrigin}/accept-invite?id=${inv.id}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopySuccessId(inv.id);
    setTimeout(() => setCopySuccessId(null), 2500);
  };

  const handleOpenInviteForMember = (member: WorkloadMember) => {
    setInviteMode("existing_roster");
    setSelectedRosterId(member.id);
    setInviteRole(member.role || "designer");
    setInviteFullName("");
    setInviteJobTitle("");
    setInviteEmail("");
    setInviteModalError(null);
    setInviteModalSuccess(null);
    setInvitePendingConflictId(null);
    setShowInviteModal(true);
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
          <button
            onClick={() => setShowPermissionsMatrix(true)}
            className="px-3.5 py-2 bg-purple-50 hover:bg-purple-100 text-purple-900 border border-purple-200 rounded-xl text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5"
            title="عرض مصفوفة الأدوار والصلاحيات"
          >
            <Shield className="w-4 h-4 text-purple-700" />
            <span>مصفوفة الصلاحيات</span>
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
                <span>دعوة مستخدم جديد</span>
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
            أعضاء الفريق ومعدلات الحمل الحالية ({activeMembersCount})
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
              const isLegacyOwner = member.displayName.includes("المدير العام (Owner)");

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
                        {isLegacyOwner ? (
                          <span className="px-2 py-0.5 rounded-md font-bold text-[10px] bg-slate-200 text-slate-700 border border-slate-300">
                            سجل أرشيفي قديم (معطل)
                          </span>
                        ) : (
                          <span className={cn("px-2 py-0.5 rounded-md font-bold text-[10px] border", memberStatus.badgeClass)}>
                            {memberStatus.label}
                          </span>
                        )}
                        <div className="flex items-center gap-1 flex-wrap justify-end">
                          <span className="px-2 py-0.5 rounded-md font-semibold text-[10px] bg-slate-100 text-slate-700">
                            {ROSTER_ROLE_LABELS[member.role as keyof typeof ROSTER_ROLE_LABELS] || member.role}
                          </span>
                          {member.access_scope && ACCESS_SCOPE_CONFIGS[member.access_scope] && (
                            <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-semibold border", ACCESS_SCOPE_CONFIGS[member.access_scope].badgeClass)}>
                              {ACCESS_SCOPE_CONFIGS[member.access_scope].label.split(" (")[0]}
                            </span>
                          )}
                        </div>
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

                      {/* CRM Access Status & Invitation Actions */}
                      {!isLegacyOwner && member.role !== "owner" && (
                        <div className="pt-2.5 border-t border-slate-100 space-y-2">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-500 font-semibold flex items-center gap-1">
                              <Mail className="w-3 h-3 text-slate-400" />
                              <span>حساب الـ CRM:</span>
                            </span>
                            <span className={cn("px-2 py-0.5 rounded-md font-bold text-[10px] border", memberStatus.badgeClass)}>
                              {memberStatus.label}
                            </span>
                          </div>

                          {!isViewer && (
                            <div>
                              {memberStatus.key === "not_invited" && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenInviteForMember(member)}
                                  className="w-full py-1.5 px-3 bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-2xs"
                                >
                                  <Send className="w-3.5 h-3.5" />
                                  <span>إرسال دعوة</span>
                                </button>
                              )}

                              {memberStatus.key === "pending" && memberStatus.invitation && (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleCopyLink(memberStatus.invitation!)}
                                    className="flex-1 py-1.5 px-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 transition-colors"
                                  >
                                    {copySuccessId === memberStatus.invitation!.id ? (
                                      <>
                                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                        <span className="text-emerald-700">تم النسخ</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="w-3 h-3" />
                                        <span>نسخ الرابط</span>
                                      </>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleResendInvite(memberStatus.invitation!.id)}
                                    className="flex-1 py-1.5 px-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 transition-colors"
                                  >
                                    <RefreshCw className="w-3 h-3" />
                                    <span>إعادة إرسال</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRevokeInvite(memberStatus.invitation!.id)}
                                    className="py-1.5 px-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 transition-colors"
                                    title="إلغاء الدعوة"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    <span>إلغاء</span>
                                  </button>
                                </div>
                              )}

                              {memberStatus.key === "expired" && memberStatus.invitation && (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleResendInvite(memberStatus.invitation!.id)}
                                    className="flex-1 py-1.5 px-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 transition-colors shadow-2xs"
                                  >
                                    <RefreshCw className="w-3 h-3" />
                                    <span>تجديد الدعوة</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRevokeInvite(memberStatus.invitation!.id)}
                                    className="py-1.5 px-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-[10px] font-semibold"
                                  >
                                    إلغاء
                                  </button>
                                </div>
                              )}

                              {memberStatus.key === "revoked" && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenInviteForMember(member)}
                                  className="w-full py-1.5 px-3 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-2xs"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>إرسال دعوة جديدة</span>
                                </button>
                              )}

                              {memberStatus.key === "active" && (
                                <div className="text-[10px] text-emerald-700 font-bold flex items-center justify-center gap-1.5 py-1 bg-emerald-50/60 rounded-lg border border-emerald-100">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                  <span>عضو نشط ومفعل في مساحة العمل</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Member Actions */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                        {isLegacyOwner ? (
                          <span className="text-[10px] text-slate-400 font-semibold flex items-center gap-1">
                            <Lock className="w-3 h-3 text-slate-400" />
                            <span>سجل أرشيفي قديم (معطل)</span>
                          </span>
                        ) : !isViewer ? (
                          <button
                            type="button"
                            onClick={() => handleOpenEditMember(member)}
                            className="px-2.5 py-1 rounded-lg text-[10px] font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 transition-colors flex items-center gap-1"
                          >
                            <Edit2 className="w-3 h-3" />
                            <span>تعديل</span>
                          </button>
                        ) : <div />}

                        {isLegacyOwner ? null : member.role === "owner" ? (
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
              إدارة دعوات الفريق وروابط الانضمام للمشاركين المعتمدين
            </p>
          </div>

          {!isViewer && (
            <button
              type="button"
              onClick={() => setShowInviteModal(true)}
              className="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl font-bold flex items-center gap-1.5 transition-colors self-start sm:self-auto"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>دعوة عضو جديد</span>
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
                invitations.map((inv) => {
                  const isExpired =
                    inv.isExpired ||
                    (inv.status === "pending" && new Date(inv.expires_at).getTime() < Date.now());
                  return (
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
                            inv.status === "accepted"
                              ? "bg-emerald-100 text-emerald-800"
                              : inv.status === "revoked"
                              ? "bg-rose-100 text-rose-800"
                              : isExpired
                              ? "bg-amber-100 text-amber-800 border border-amber-300"
                              : inv.status === "pending"
                              ? "bg-sky-100 text-sky-800"
                              : inv.status === "draft"
                              ? "bg-slate-100 text-slate-700"
                              : "bg-slate-100 text-slate-600"
                          )}
                        >
                          {inv.status === "accepted"
                            ? "تم القبول (Accepted)"
                            : inv.status === "revoked"
                            ? "ملغاة (Revoked)"
                            : isExpired
                            ? "منتهية الصلاحية (Expired)"
                            : inv.status === "pending"
                            ? "معلقة (Pending)"
                            : inv.status === "draft"
                            ? "مسودة (Draft)"
                            : inv.status}
                        </span>
                      </td>
                      <td className="p-3 text-slate-500 font-mono text-[11px]">
                        {new Date(inv.created_at).toLocaleDateString("ar-EG")}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1.5">
                          {/* Resend button for pending or expired */}
                          {!isViewer && (inv.status === "pending" || isExpired) && (
                            <button
                              type="button"
                              onClick={() => handleResendInvite(inv.id)}
                              className="p-1.5 rounded text-[11px] font-semibold flex items-center gap-1 text-sky-600 hover:text-sky-800 hover:bg-sky-50 transition-colors"
                              title={isExpired ? "إعادة إرسال وتجديد صلاحية الدعوة لـ 7 أيام" : "إعادة إرسال الدعوة"}
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">{isExpired ? "تجديد وإرسال" : "إعادة إرسال"}</span>
                            </button>
                          )}

                          {/* Issue/Activate Draft button */}
                          {!isViewer && inv.status === "draft" && (
                            <button
                              type="button"
                              onClick={() => handleIssueExistingInvite(inv.id)}
                              className="p-1.5 rounded text-[11px] font-semibold flex items-center gap-1 text-sky-600 hover:text-sky-800 hover:bg-sky-50 transition-colors"
                              title="تفعيل وإصدار رابط الدعوة للانضمام"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">إصدار الرابط</span>
                            </button>
                          )}

                          {/* Copy Link button */}
                          {inv.status !== "revoked" && inv.status !== "accepted" && (
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
                          )}

                          {/* Revoke button */}
                          {!isViewer && inv.status !== "revoked" && inv.status !== "accepted" && (
                            <button
                              type="button"
                              onClick={() => handleRevokeInvite(inv.id)}
                              className="text-rose-600 hover:text-rose-700 p-1.5 hover:bg-rose-50 rounded text-[11px] font-semibold flex items-center gap-1 transition-colors"
                              title="إلغاء الدعوة (Revoke)"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">إلغاء</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
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
            className="bg-surface rounded-2xl border border-slate-200 shadow-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150 text-xs"
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
                <label className="font-bold text-slate-700 block mb-1">الدور الوظيفي في المنظومة:</label>
                <select
                  value={newMemberRole}
                  onChange={(e) => handleNewMemberRoleChange(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-semibold"
                >
                  {AVAILABLE_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Access Scope Selector */}
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  نطاق الصلاحيات التشغيلي (Access Scope):
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {(Object.entries(ACCESS_SCOPE_CONFIGS) as [AccessScope, typeof ACCESS_SCOPE_CONFIGS[AccessScope]][]).map(([scopeKey, config]) => (
                    <label
                      key={scopeKey}
                      className={cn(
                        "flex flex-col p-2.5 rounded-xl border cursor-pointer text-[11px] transition-all",
                        newMemberAccessScope === scopeKey
                          ? "bg-purple-50 border-purple-300 ring-1 ring-purple-300 shadow-2xs"
                          : "bg-white border-slate-200 hover:bg-slate-50 text-slate-700"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="newMemberScope"
                          value={scopeKey}
                          checked={newMemberAccessScope === scopeKey}
                          onChange={() => setNewMemberAccessScope(scopeKey)}
                          className="text-purple-600 focus:ring-purple-500"
                        />
                        <span className="font-bold">{config.label.split(" (")[0]}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1 leading-normal pr-5">{config.description}</p>
                    </label>
                  ))}
                </div>
              </div>

              {/* Granular Permissions (14 Permissions) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-bold text-slate-700 block">
                    الصلاحيات الفردية المخصصة (14 صلاحية):
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const def = DEFAULT_ROLE_PERMISSIONS[newMemberRole as keyof typeof DEFAULT_ROLE_PERMISSIONS];
                      if (def) setNewMemberCustomPermissions({ ...def });
                    }}
                    className="text-[10px] font-semibold text-sky-600 hover:text-sky-800 underline"
                  >
                    استعادة الافتراضي للدور
                  </button>
                </div>

                <div className="space-y-3 bg-slate-50/80 p-3 rounded-xl border border-slate-200">
                  {/* Group 1: النظام والإدارة */}
                  <div>
                    <span className="text-[10px] font-bold text-purple-900 block mb-1">1. النظام والإدارة</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {GRANULAR_PERMISSIONS_LIST.filter((p) => p.category === "system").map((p) => {
                        const checked = !!newMemberCustomPermissions[p.key];
                        return (
                          <label
                            key={p.key}
                            className={cn(
                              "flex items-start gap-2 p-2 rounded-lg border text-[10px] cursor-pointer transition-colors",
                              checked
                                ? "bg-purple-50 border-purple-200 text-purple-950 font-semibold"
                                : "bg-white border-slate-200 text-slate-600"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setNewMemberCustomPermissions((prev) => ({ ...prev, [p.key]: e.target.checked }))
                              }
                              className="mt-0.5 rounded text-purple-600 focus:ring-purple-500"
                            />
                            <div>
                              <div className="leading-tight">{p.label}</div>
                              <div className="text-[9px] text-slate-400 font-normal mt-0.5">{p.description}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Group 2: إدارة العملاء والمهام */}
                  <div>
                    <span className="text-[10px] font-bold text-sky-900 block mb-1">2. إدارة العملاء والمهام</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {GRANULAR_PERMISSIONS_LIST.filter((p) => p.category === "clients_tasks").map((p) => {
                        const checked = !!newMemberCustomPermissions[p.key];
                        return (
                          <label
                            key={p.key}
                            className={cn(
                              "flex items-start gap-2 p-2 rounded-lg border text-[10px] cursor-pointer transition-colors",
                              checked
                                ? "bg-sky-50 border-sky-200 text-sky-950 font-semibold"
                                : "bg-white border-slate-200 text-slate-600"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setNewMemberCustomPermissions((prev) => ({ ...prev, [p.key]: e.target.checked }))
                              }
                              className="mt-0.5 rounded text-sky-600 focus:ring-sky-500"
                            />
                            <div>
                              <div className="leading-tight">{p.label}</div>
                              <div className="text-[9px] text-slate-400 font-normal mt-0.5">{p.description}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Group 3: المراجعات والوقت والتقارير */}
                  <div>
                    <span className="text-[10px] font-bold text-emerald-900 block mb-1">3. المراجعات والوقت والتقارير</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {GRANULAR_PERMISSIONS_LIST.filter((p) => p.category === "reviews_time").map((p) => {
                        const checked = !!newMemberCustomPermissions[p.key];
                        return (
                          <label
                            key={p.key}
                            className={cn(
                              "flex items-start gap-2 p-2 rounded-lg border text-[10px] cursor-pointer transition-colors",
                              checked
                                ? "bg-emerald-50 border-emerald-200 text-emerald-950 font-semibold"
                                : "bg-white border-slate-200 text-slate-600"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setNewMemberCustomPermissions((prev) => ({ ...prev, [p.key]: e.target.checked }))
                              }
                              className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                            />
                            <div>
                              <div className="leading-tight">{p.label}</div>
                              <div className="text-[9px] text-slate-400 font-normal mt-0.5">{p.description}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
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
            className="bg-surface rounded-2xl border border-slate-200 shadow-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150 text-xs"
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
                <label className="font-bold text-slate-700 block mb-1">الدور الوظيفي في المنظومة:</label>
                <select
                  value={editRole}
                  onChange={(e) => handleEditRoleChange(e.target.value)}
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

                {editingMember.role === "owner" && (
                  <div className="mt-1.5 p-2 bg-purple-50 border border-purple-200 text-purple-900 rounded-lg text-[10px] flex items-center gap-1.5 font-semibold">
                    <Lock className="w-3.5 h-3.5 text-purple-700 shrink-0" />
                    <span>حساب المدير العام محمي بموجب قواعد النظام بصلاحيات إدارية كاملة.</span>
                  </div>
                )}
              </div>

              {/* Access Scope Selector for Edit Member */}
              {editingMember.role !== "owner" && (
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    نطاق الصلاحيات التشغيلي (Access Scope):
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    {(Object.entries(ACCESS_SCOPE_CONFIGS) as [AccessScope, typeof ACCESS_SCOPE_CONFIGS[AccessScope]][]).map(([scopeKey, config]) => (
                      <label
                        key={scopeKey}
                        className={cn(
                          "flex flex-col p-2.5 rounded-xl border cursor-pointer text-[11px] transition-all",
                          editAccessScope === scopeKey
                            ? "bg-purple-50 border-purple-300 ring-1 ring-purple-300 shadow-2xs"
                            : "bg-white border-slate-200 hover:bg-slate-50 text-slate-700"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="editMemberScope"
                            value={scopeKey}
                            checked={editAccessScope === scopeKey}
                            onChange={() => setEditAccessScope(scopeKey)}
                            className="text-purple-600 focus:ring-purple-500"
                          />
                          <span className="font-bold">{config.label.split(" (")[0]}</span>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1 leading-normal pr-5">{config.description}</p>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Granular Permissions (14 Permissions) for Edit Member */}
              {editingMember.role !== "owner" && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="font-bold text-slate-700 block">
                      الصلاحيات الفردية المخصصة (14 صلاحية):
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const def = DEFAULT_ROLE_PERMISSIONS[editRole as keyof typeof DEFAULT_ROLE_PERMISSIONS];
                        if (def) setEditCustomPermissions({ ...def });
                      }}
                      className="text-[10px] font-semibold text-sky-600 hover:text-sky-800 underline"
                    >
                      استعادة الافتراضي للدور
                    </button>
                  </div>

                  <div className="space-y-3 bg-slate-50/80 p-3 rounded-xl border border-slate-200">
                    {/* Group 1: النظام والإدارة */}
                    <div>
                      <span className="text-[10px] font-bold text-purple-900 block mb-1">1. النظام والإدارة</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {GRANULAR_PERMISSIONS_LIST.filter((p) => p.category === "system").map((p) => {
                          const checked = !!editCustomPermissions[p.key];
                          return (
                            <label
                              key={p.key}
                              className={cn(
                                "flex items-start gap-2 p-2 rounded-lg border text-[10px] cursor-pointer transition-colors",
                                checked
                                  ? "bg-purple-50 border-purple-200 text-purple-950 font-semibold"
                                  : "bg-white border-slate-200 text-slate-600"
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setEditCustomPermissions((prev) => ({ ...prev, [p.key]: e.target.checked }))
                                }
                                className="mt-0.5 rounded text-purple-600 focus:ring-purple-500"
                              />
                              <div>
                                <div className="leading-tight">{p.label}</div>
                                <div className="text-[9px] text-slate-400 font-normal mt-0.5">{p.description}</div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* Group 2: إدارة العملاء والمهام */}
                    <div>
                      <span className="text-[10px] font-bold text-sky-900 block mb-1">2. إدارة العملاء والمهام</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {GRANULAR_PERMISSIONS_LIST.filter((p) => p.category === "clients_tasks").map((p) => {
                          const checked = !!editCustomPermissions[p.key];
                          return (
                            <label
                              key={p.key}
                              className={cn(
                                "flex items-start gap-2 p-2 rounded-lg border text-[10px] cursor-pointer transition-colors",
                                checked
                                  ? "bg-sky-50 border-sky-200 text-sky-950 font-semibold"
                                  : "bg-white border-slate-200 text-slate-600"
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setEditCustomPermissions((prev) => ({ ...prev, [p.key]: e.target.checked }))
                                }
                                className="mt-0.5 rounded text-sky-600 focus:ring-sky-500"
                              />
                              <div>
                                <div className="leading-tight">{p.label}</div>
                                <div className="text-[9px] text-slate-400 font-normal mt-0.5">{p.description}</div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* Group 3: المراجعات والوقت والتقارير */}
                    <div>
                      <span className="text-[10px] font-bold text-emerald-900 block mb-1">3. المراجعات والوقت والتقارير</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {GRANULAR_PERMISSIONS_LIST.filter((p) => p.category === "reviews_time").map((p) => {
                          const checked = !!editCustomPermissions[p.key];
                          return (
                            <label
                              key={p.key}
                              className={cn(
                                "flex items-start gap-2 p-2 rounded-lg border text-[10px] cursor-pointer transition-colors",
                                checked
                                  ? "bg-emerald-50 border-emerald-200 text-emerald-950 font-semibold"
                                  : "bg-white border-slate-200 text-slate-600"
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setEditCustomPermissions((prev) => ({ ...prev, [p.key]: e.target.checked }))
                                }
                                className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                              />
                              <div>
                                <div className="leading-tight">{p.label}</div>
                                <div className="text-[9px] text-slate-400 font-normal mt-0.5">{p.description}</div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

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

      {/* Modal 4: Invite User Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendOrIssueInvite("send");
            }}
            className="bg-surface rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150 text-xs"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <Mail className="w-4 h-4 text-sky-600" />
                دعوة مستخدم جديد لمساحة العمل
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowInviteModal(false);
                  setInvitePendingConflictId(null);
                }}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode Selector Tabs */}
            <div className="flex p-1 bg-slate-100 rounded-xl gap-1">
              <button
                type="button"
                onClick={() => {
                  setInviteMode("new_user");
                  setSelectedRosterId("");
                }}
                className={cn(
                  "flex-1 py-1.5 px-3 rounded-lg font-bold text-[11px] transition-all",
                  inviteMode === "new_user"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                عضو جديد
              </button>
              <button
                type="button"
                onClick={() => setInviteMode("existing_roster")}
                className={cn(
                  "flex-1 py-1.5 px-3 rounded-lg font-bold text-[11px] transition-all",
                  inviteMode === "existing_roster"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                اختيار من قائمة الفريق
              </button>
            </div>

            {invitationsPaused && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-[11px] leading-relaxed">
                <strong>تنبيه:</strong> قبول الدعوات متوقف حالياً في إعدادات مساحة العمل. يمكنك حفظ الدعوة كمسودة أو تفعيل قبول الدعوات من الإعدادات.
              </div>
            )}

            <div className="space-y-3">
              {inviteMode === "new_user" ? (
                <>
                  <div>
                    <label className="font-bold text-slate-700 block mb-1">
                      الاسم الكامل بالعربية <span className="text-rose-500">*</span>:
                    </label>
                    <input
                      type="text"
                      value={inviteFullName}
                      onChange={(e) => setInviteFullName(e.target.value)}
                      placeholder="مثال: حسام علي"
                      required
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-semibold focus:outline-sky-500"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 block mb-1">المسمى الوظيفي:</label>
                    <input
                      type="text"
                      value={inviteJobTitle}
                      onChange={(e) => setInviteJobTitle(e.target.value)}
                      placeholder="مثال: Senior Designer / كاتب إعلانات"
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs focus:outline-sky-500"
                    />
                  </div>
                </>
              ) : (
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
                    {teamMembers
                      .filter((m) => m.isActive !== false && !m.displayName.includes("المدير العام (Owner)"))
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.displayName} ({m.jobTitle})
                        </option>
                      ))}
                  </select>
                </div>
              )}

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
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-[11px] space-y-2">
                <div>{inviteModalError}</div>
                {invitePendingConflictId && (
                  <button
                    type="button"
                    onClick={async () => {
                      await handleResendInvite(invitePendingConflictId);
                      setShowInviteModal(false);
                      setInvitePendingConflictId(null);
                    }}
                    className="w-full py-1.5 px-3 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 shadow-2xs"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>إعادة إرسال وتجديد الدعوة القائمة الآن</span>
                  </button>
                )}
              </div>
            )}

            {inviteModalSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-[11px] font-bold space-y-1">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>{inviteModalSuccess}</span>
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowInviteModal(false);
                  setInvitePendingConflictId(null);
                }}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold"
              >
                إلغاء
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSendOrIssueInvite("create_draft")}
                  disabled={submittingInvite}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 disabled:bg-slate-100 disabled:text-slate-400 text-slate-800 rounded-xl font-bold text-xs transition-colors"
                >
                  {submittingInvite ? "جاري الحفظ..." : "حفظ كمسودة"}
                </button>

                <button
                  type="submit"
                  disabled={submittingInvite}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white rounded-xl font-bold text-xs shadow-xs transition-colors flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{submittingInvite ? "جاري الإرسال..." : "إرسال الدعوة وتفعيل الرابط"}</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Modal 5: Permissions Matrix Modal */}
      <PermissionsMatrixModal
        isOpen={showPermissionsMatrix}
        onClose={() => setShowPermissionsMatrix(false)}
      />
    </div>
  );
}
