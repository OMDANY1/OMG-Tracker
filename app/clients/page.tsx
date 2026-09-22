"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Building2,
  Users,
  AlertTriangle,
  ArrowRightLeft,
  Search,
  Filter,
  CheckCircle2,
  X,
  ShieldAlert,
  ShieldCheck,
  Briefcase,
  Layers,
  Compass,
  Feather,
  Video,
  Palette,
  FileText,
  RefreshCw,
  PlusCircle,
  Clock,
  Sparkles,
  Info,
} from "lucide-react";
import {
  CLIENT_DIFFICULTY_LABELS,
  CLIENT_EXTRA_WORKLOAD_LABELS,
  cn,
} from "@/lib/utils";
import { ClientTeamModal } from "@/components/clients/ClientTeamModal";
import { ClientBriefModal } from "@/components/clients/ClientBriefModal";
import { AddClientModal } from "@/components/clients/AddClientModal";

interface Designer {
  id: string;
  displayName: string;
  jobTitle: string;
  clientCount: number;
  openTasksCount: number;
}

type AgencyView = "all" | "design" | "video" | "copywriting" | "strategy";

export default function ClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [designers, setDesigners] = useState<Designer[]>([]);
  const [allTeamMembers, setAllTeamMembers] = useState<any[]>([]);
  const [strategists, setStrategists] = useState<any[]>([]);
  const [writers, setWriters] = useState<any[]>([]);
  const [videoEditors, setVideoEditors] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [isViewer, setIsViewer] = useState(false);
  const [isAddClientModalOpen, setIsAddClientModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Agency View & Filters
  const [activeView, setActiveView] = useState<AgencyView>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDifficulty, setSelectedDifficulty] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [videoFilter, setVideoFilter] = useState<string>("all"); // "all" | "needs_video_unassigned" | "assigned" | "not_needed"

  // Modals state
  const [teamModalClient, setTeamModalClient] = useState<any | null>(null);
  const [briefModalClient, setBriefModalClient] = useState<any | null>(null);

  // Edit / Reassignment Modal
  const [editingClient, setEditingClient] = useState<any>(null);
  const [newOwnerId, setNewOwnerId] = useState<string>("");
  const [reassignOpenTasks, setReassignOpenTasks] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const fetchClients = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/clients");
      const data = await res.json();
      if (!res.ok || data.error) {
        setFetchError(data.error || `خطأ في الاتصال بقاعدة البيانات (كود ${res.status})`);
        return;
      }
      setClients(data.clients || []);
      if (data.designers) setDesigners(data.designers);
      if (data.allTeamMembers) setAllTeamMembers(data.allTeamMembers);
      if (data.strategists) setStrategists(data.strategists);
      if (data.writers) setWriters(data.writers);
      if (data.videoEditors) setVideoEditors(data.videoEditors);
      if (data.managers) setManagers(data.managers);
      if (typeof data.isOwner === "boolean") setIsOwner(data.isOwner);
      if (typeof data.isViewer === "boolean") setIsViewer(data.isViewer);
    } catch (e: any) {
      console.error(e);
      setFetchError(e.message || "حدث خطأ غير متوقع أثناء الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  // Listen for persona changes
  useEffect(() => {
    const handlePersonaChange = (e: any) => {
      if (e.detail?.role === "owner") {
        setIsOwner(true);
        setIsViewer(false);
      } else if (e.detail?.role === "business_owner_viewer") {
        setIsOwner(false);
        setIsViewer(true);
      } else if (e.detail) {
        setIsOwner(false);
        setIsViewer(false);
      }
    };
    window.addEventListener("persona_changed", handlePersonaChange);
    return () => window.removeEventListener("persona_changed", handlePersonaChange);
  }, []);

  // 1. Dynamic Design stats calculated from actual data
  const designStats = useMemo(() => {
    const counts: Record<string, number> = {};
    let unassigned = 0;
    clients.forEach((c) => {
      const designerId = c.team_assignment?.primary_designer_id || c.owner_roster_id;
      if (designerId) {
        counts[designerId] = (counts[designerId] || 0) + 1;
      } else {
        unassigned++;
      }
    });
    return { counts, unassigned };
  }, [clients]);

  // 2. Dynamic Strategy stats
  const strategyStats = useMemo(() => {
    const counts: Record<string, number> = {};
    let unassigned = 0;
    clients.forEach((c) => {
      const id = c.team_assignment?.primary_strategist_id;
      if (id) {
        counts[id] = (counts[id] || 0) + 1;
      } else {
        unassigned++;
      }
    });
    return { counts, unassigned };
  }, [clients]);

  // 3. Dynamic Copywriting stats
  const copywritingStats = useMemo(() => {
    const counts: Record<string, number> = {};
    let unassigned = 0;
    clients.forEach((c) => {
      const id = c.team_assignment?.primary_copywriter_id;
      if (id) {
        counts[id] = (counts[id] || 0) + 1;
      } else {
        unassigned++;
      }
    });
    return { counts, unassigned };
  }, [clients]);

  // 4. Dynamic Video stats
  const videoStats = useMemo(() => {
    const counts: Record<string, number> = {};
    let needsVideoUnassigned = 0;
    let notNeeded = 0;
    let assigned = 0;

    clients.forEach((c) => {
      const req = Boolean(c.team_assignment?.requires_video || c.team_assignment?.primary_video_editor_id);
      const editorId = c.team_assignment?.primary_video_editor_id;
      if (editorId) {
        counts[editorId] = (counts[editorId] || 0) + 1;
        assigned++;
      } else if (req) {
        needsVideoUnassigned++;
      } else {
        notNeeded++;
      }
    });
    return { counts, needsVideoUnassigned, notNeeded, assigned };
  }, [clients]);

  // Filter clients based on view and sub-filters
  const filteredClients = useMemo(() => {
    return clients.filter((c) => {
      // General Search & Difficulty
      if (searchQuery && !c.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (selectedDifficulty && c.difficulty !== selectedDifficulty) return false;

      // View-specific filters
      if (activeView === "design") {
        const designerId = c.team_assignment?.primary_designer_id || c.owner_roster_id;
        if (selectedMemberId === "unassigned") {
          if (designerId) return false;
        } else if (selectedMemberId && designerId !== selectedMemberId) {
          return false;
        }
      } else if (activeView === "strategy") {
        const stratId = c.team_assignment?.primary_strategist_id;
        if (selectedMemberId === "unassigned") {
          if (stratId) return false;
        } else if (selectedMemberId && stratId !== selectedMemberId) {
          return false;
        }
      } else if (activeView === "copywriting") {
        const writerId = c.team_assignment?.primary_copywriter_id;
        if (selectedMemberId === "unassigned") {
          if (writerId) return false;
        } else if (selectedMemberId && writerId !== selectedMemberId) {
          return false;
        }
      } else if (activeView === "video") {
        const req = Boolean(c.team_assignment?.requires_video || c.team_assignment?.primary_video_editor_id);
        const editorId = c.team_assignment?.primary_video_editor_id;

        if (videoFilter === "not_needed" && req) return false;
        if (videoFilter === "needs_video_unassigned" && (!req || editorId)) return false;
        if (videoFilter === "assigned" && !editorId) return false;

        if (selectedMemberId === "unassigned") {
          if (!req || editorId) return false;
        } else if (selectedMemberId && editorId !== selectedMemberId) {
          return false;
        }
      }

      return true;
    });
  }, [clients, activeView, searchQuery, selectedDifficulty, selectedMemberId, videoFilter]);

  // Calculate open tasks on the currently editing client
  const clientOpenTasksCount = editingClient
    ? (editingClient.tasks || []).filter((t: any) => !["delivered", "cancelled"].includes(t.status)).length
    : 0;

  const targetDesigner = designers.find((d) => d.id === newOwnerId);
  const currentDesignerName = editingClient?.owner?.display_name || "غير مسند";
  const newDesignerName = targetDesigner?.displayName || (newOwnerId ? "مصمم محدد" : "إزالة الإسناد (غير مسند)");

  const handleOpenReassignModal = (client: any) => {
    setEditingClient(client);
    setNewOwnerId(client.owner_roster_id || "");
    setReassignOpenTasks(false);
    setShowConfirmation(false);
    setStatusMessage(null);
  };

  const handleProceedToConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setShowConfirmation(true);
  };

  const handleExecuteAssignment = async () => {
    if (!editingClient) return;

    setIsSaving(true);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/clients", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reassign",
          clientId: editingClient.id,
          newOwnerRosterId: newOwnerId ? newOwnerId : null,
          reassignOpenTasksToNewOwner: reassignOpenTasks,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const reassignedCount = data.result?.reassigned_tasks_count || 0;
        setStatusMessage({
          type: "success",
          text: reassignOpenTasks
            ? `تم نقل مسؤولية العميل (${editingClient.name}) بنجاح ونقل ${reassignedCount} مهمة مفتوحة للمسؤول الجديد.`
            : `تم تحديث مسؤولية العميل (${editingClient.name}) للمهام المستقبلية بنجاح.`,
        });
        setTimeout(() => {
          setEditingClient(null);
          setShowConfirmation(false);
          setStatusMessage(null);
          fetchClients();
        }, 1200);
      } else {
        const err = await res.json();
        setStatusMessage({
          type: "error",
          text: `فشل نقل المسؤولية: ${err.error || "حدث خطأ غير متوقع"}`,
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: `خطأ أثناء الاتصال: ${err.message}`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">إدارة حسابات العملاء وتوزيع فرق العمل</h1>
          <p className="text-sm text-slate-500 mt-1">
            {loading ? (
              <span className="flex items-center gap-1.5 text-sky-600">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                جاري مزامنة بيانات حسابات العملاء من بيئة العمل...
              </span>
            ) : fetchError ? (
              <span className="text-rose-600 font-semibold">{fetchError}</span>
            ) : (
              `${clients.length} حساب عميل مع تتبع وتوزيع مسؤوليات التصميم والمحتوى والاستراتيجية والمونتاج`
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isViewer && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-xs font-semibold">
              <ShieldAlert className="w-4 h-4 text-amber-600" />
              <span>مالك الشركة (مشاهد فقط - بدون صلاحيات تعديل)</span>
            </div>
          )}
          {isOwner && !isViewer && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-semibold">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>صلاحية إدارة وتوزيع فرق العملاء نشطة (Owner)</span>
            </div>
          )}
          {!isViewer && (
            <button
              onClick={() => setIsAddClientModalOpen(true)}
              className="px-3.5 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <PlusCircle className="w-4 h-4" />
              <span>إضافة عميل جديد</span>
            </button>
          )}
          <button
            onClick={fetchClients}
            disabled={loading}
            className="p-2 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 transition-colors"
            title="تحديث البيانات"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-sky-600")} />
          </button>
        </div>
      </div>

      {/* Database Error Banner if connection failed */}
      {fetchError && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 flex items-start gap-3 text-xs">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-bold text-sm">تعذر تحميل بيانات العملاء من قاعدة البيانات</h4>
            <p className="text-slate-600">{fetchError}</p>
            <button
              onClick={fetchClients}
              className="mt-2 px-3 py-1.5 bg-rose-600 text-white rounded-lg font-bold text-xs hover:bg-rose-700"
            >
              إعادة محاولة الاتصال
            </button>
          </div>
        </div>
      )}

      {/* Agency View Selector Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl border border-slate-200/80 overflow-x-auto text-xs font-bold text-slate-600">
        <button
          onClick={() => {
            setActiveView("all");
            setSelectedMemberId("");
          }}
          className={cn(
            "px-4 py-2 rounded-xl flex items-center gap-2 transition-all whitespace-nowrap",
            activeView === "all"
              ? "bg-white text-slate-900 shadow-xs border border-slate-200"
              : "hover:text-slate-900"
          )}
        >
          <Building2 className="w-4 h-4 text-slate-700" />
          <span>جميع العملاء</span>
          <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded-full font-mono">
            {clients.length}
          </span>
        </button>

        <button
          onClick={() => {
            setActiveView("design");
            setSelectedMemberId("");
          }}
          className={cn(
            "px-4 py-2 rounded-xl flex items-center gap-2 transition-all whitespace-nowrap",
            activeView === "design"
              ? "bg-white text-purple-900 shadow-xs border border-purple-200"
              : "hover:text-purple-900"
          )}
        >
          <Palette className="w-4 h-4 text-purple-600" />
          <span>فريق التصميم</span>
          <span className="text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded-full font-mono">
            {designers.length} مصممين
          </span>
        </button>

        <button
          onClick={() => {
            setActiveView("video");
            setSelectedMemberId("");
            setVideoFilter("all");
          }}
          className={cn(
            "px-4 py-2 rounded-xl flex items-center gap-2 transition-all whitespace-nowrap",
            activeView === "video"
              ? "bg-white text-amber-900 shadow-xs border border-amber-200"
              : "hover:text-amber-900"
          )}
        >
          <Video className="w-4 h-4 text-amber-600" />
          <span>فريق الفيديو والمونتاج</span>
          <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full font-mono">
            {videoStats.assigned} مسند
          </span>
        </button>

        <button
          onClick={() => {
            setActiveView("copywriting");
            setSelectedMemberId("");
          }}
          className={cn(
            "px-4 py-2 rounded-xl flex items-center gap-2 transition-all whitespace-nowrap",
            activeView === "copywriting"
              ? "bg-white text-emerald-900 shadow-xs border border-emerald-200"
              : "hover:text-emerald-900"
          )}
        >
          <Feather className="w-4 h-4 text-emerald-600" />
          <span>فريق المحتوى</span>
          <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-full font-mono">
            {writers.length} كتاب
          </span>
        </button>

        <button
          onClick={() => {
            setActiveView("strategy");
            setSelectedMemberId("");
          }}
          className={cn(
            "px-4 py-2 rounded-xl flex items-center gap-2 transition-all whitespace-nowrap",
            activeView === "strategy"
              ? "bg-white text-sky-900 shadow-xs border border-sky-200"
              : "hover:text-sky-900"
          )}
        >
          <Compass className="w-4 h-4 text-sky-600" />
          <span>فريق الاستراتيجية</span>
          <span className="text-[10px] bg-sky-100 text-sky-800 px-1.5 py-0.5 rounded-full font-mono">
            {strategists.length} استراتيجيين
          </span>
        </button>
      </div>

      {/* View-Specific Trackers & Allocation Banners */}
      {/* 1. VIEW: ALL CLIENTS */}
      {activeView === "all" && (
        <div className="bg-surface rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-slate-500" />
              نظرة عامة على تغطية التخصصات لحسابات مساحة العمل ({clients.length} عميل):
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="p-2.5 rounded-xl border bg-purple-50/50 border-purple-200 text-purple-900 flex flex-col items-center">
              <span className="font-semibold text-[11px]">فريق التصميم</span>
              <span className="text-sm font-extrabold mt-0.5">
                {clients.length - designStats.unassigned} / {clients.length} مسند
              </span>
            </div>
            <div className="p-2.5 rounded-xl border bg-amber-50/50 border-amber-200 text-amber-900 flex flex-col items-center">
              <span className="font-semibold text-[11px]">فريق المونتاج والفيديو</span>
              <span className="text-sm font-extrabold mt-0.5">
                {videoStats.assigned} مسند | {videoStats.notNeeded} لا يحتاج حالياً
              </span>
            </div>
            <div className="p-2.5 rounded-xl border bg-emerald-50/50 border-emerald-200 text-emerald-900 flex flex-col items-center">
              <span className="font-semibold text-[11px]">فريق كتابة المحتوى</span>
              <span className="text-sm font-extrabold mt-0.5">
                {clients.length - copywritingStats.unassigned} / {clients.length} مسند
              </span>
            </div>
            <div className="p-2.5 rounded-xl border bg-sky-50/50 border-sky-200 text-sky-900 flex flex-col items-center">
              <span className="font-semibold text-[11px]">فريق الاستراتيجية</span>
              <span className="text-sm font-extrabold mt-0.5">
                {clients.length - strategyStats.unassigned} / {clients.length} مسند
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 2. VIEW: DESIGN TEAM */}
      {activeView === "design" && (
        <div className="bg-surface rounded-2xl border border-purple-200/80 p-4 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
            <div className="font-bold text-purple-900 flex items-center gap-2">
              <Palette className="w-4 h-4 text-purple-600" />
              <span>توزيع العملاء الفعلي بين مصممي الفريق (انقر على المصمم للتصفية):</span>
            </div>
            {selectedMemberId && (
              <button
                onClick={() => setSelectedMemberId("")}
                className="px-2.5 py-1 bg-purple-100 hover:bg-purple-200 text-purple-800 rounded-lg font-semibold text-[11px] transition-colors"
              >
                إلغاء التصفية وعرض جميع المصممين
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
            {designers.map((d) => {
              const actual = designStats.counts[d.id] || 0;
              const isSelected = selectedMemberId === d.id;
              return (
                <div
                  key={d.id}
                  onClick={() => setSelectedMemberId(isSelected ? "" : d.id)}
                  className={cn(
                    "p-2.5 rounded-xl border flex flex-col items-center justify-center text-center cursor-pointer transition-all",
                    isSelected
                      ? "bg-purple-600 text-white border-purple-700 shadow-sm"
                      : "bg-slate-50 border-slate-200 hover:border-purple-300 hover:bg-purple-50/40 text-slate-800"
                  )}
                >
                  <span className="font-bold">{d.displayName}</span>
                  <span className={cn("text-sm font-extrabold mt-0.5", isSelected ? "text-purple-100" : "text-purple-700")}>
                    {actual} <span className={cn("text-[10px] font-normal", isSelected ? "text-purple-200" : "text-slate-400")}>عملاء</span>
                  </span>
                </div>
              );
            })}
            {/* Unassigned Designer Badge */}
            <div
              onClick={() => setSelectedMemberId(selectedMemberId === "unassigned" ? "" : "unassigned")}
              className={cn(
                "p-2.5 rounded-xl border flex flex-col items-center justify-center text-center cursor-pointer transition-all",
                selectedMemberId === "unassigned"
                  ? "bg-amber-600 text-white border-amber-700 shadow-sm"
                  : designStats.unassigned > 0
                  ? "bg-amber-50/70 border-amber-300 text-amber-900 hover:bg-amber-100"
                  : "bg-slate-50 border-slate-200 text-slate-500"
              )}
            >
              <span className="font-bold">غير مسند</span>
              <span className="text-sm font-extrabold mt-0.5">
                {designStats.unassigned} <span className="text-[10px] font-normal">عميل</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 3. VIEW: VIDEO TEAM */}
      {activeView === "video" && (
        <div className="bg-surface rounded-2xl border border-amber-200/80 p-4 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
            <div className="font-bold text-amber-900 flex items-center gap-2">
              <Video className="w-4 h-4 text-amber-600" />
              <span>متابعة وتوزيع مسار إنتاج ومونتاج الفيديو:</span>
            </div>
            {(videoFilter !== "all" || selectedMemberId) && (
              <button
                onClick={() => {
                  setVideoFilter("all");
                  setSelectedMemberId("");
                }}
                className="px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg font-semibold text-[11px] transition-colors"
              >
                عرض كل حالات الفيديو
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
            <div
              onClick={() => {
                setVideoFilter(videoFilter === "not_needed" ? "all" : "not_needed");
                setSelectedMemberId("");
              }}
              className={cn(
                "p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between",
                videoFilter === "not_needed"
                  ? "bg-slate-800 text-white border-slate-900 shadow-sm"
                  : "bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300"
              )}
            >
              <div>
                <div className="font-bold">لا يحتاج فيديو حالياً</div>
                <div className="text-[10px] text-slate-400">حسابات قائمة لا تتطلب محتوى فيديو</div>
              </div>
              <span className="text-lg font-black">{videoStats.notNeeded}</span>
            </div>

            <div
              onClick={() => {
                setVideoFilter(videoFilter === "needs_video_unassigned" ? "all" : "needs_video_unassigned");
                setSelectedMemberId("");
              }}
              className={cn(
                "p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between",
                videoFilter === "needs_video_unassigned"
                  ? "bg-amber-600 text-white border-amber-700 shadow-sm"
                  : "bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100"
              )}
            >
              <div>
                <div className="font-bold">⚠️ يتطلب فيديو - بانتظار إسناد</div>
                <div className="text-[10px] text-amber-700">عملاء بحاجة لمونتاج ولم يُعيّن لهم إيديتور</div>
              </div>
              <span className="text-lg font-black">{videoStats.needsVideoUnassigned}</span>
            </div>

            <div
              onClick={() => {
                setVideoFilter(videoFilter === "assigned" ? "all" : "assigned");
                setSelectedMemberId("");
              }}
              className={cn(
                "p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between",
                videoFilter === "assigned"
                  ? "bg-sky-600 text-white border-sky-700 shadow-sm"
                  : "bg-sky-50 border-sky-200 text-sky-900 hover:bg-sky-100"
              )}
            >
              <div>
                <div className="font-bold">مسند لإيديتور معتمد</div>
                <div className="text-[10px] text-sky-700">عملاء لديهم مسؤول مونتاج محدد</div>
              </div>
              <span className="text-lg font-black">{videoStats.assigned}</span>
            </div>
          </div>

          {/* Onboarding Notice for Video Members */}
          <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-xl text-[11px] text-amber-900 flex items-start gap-2">
            <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <strong>جاهزية إضافة أعضاء الفيديو الحقيقيين:</strong> أسماء فريق المونتاج الحقيقيين سيتم إدخالها بواسطة عماد من صفحة الفريق فور توافرها. لن يتم إنشاء حسابات وهمية أو إرسال إيميلات عشوائية. فور إضافة الإيديتور، سيظهر فورياً في قوائم الإسناد أدناه.
            </div>
          </div>
        </div>
      )}

      {/* 4. VIEW: CONTENT & COPYWRITING TEAM */}
      {activeView === "copywriting" && (
        <div className="bg-surface rounded-2xl border border-emerald-200/80 p-4 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
            <div className="font-bold text-emerald-900 flex items-center gap-2">
              <Feather className="w-4 h-4 text-emerald-600" />
              <span>فريق كتابة المحتوى والاسكربتات (ميرهان، ميار، ريهام):</span>
            </div>
            {selectedMemberId && (
              <button
                onClick={() => setSelectedMemberId("")}
                className="px-2.5 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded-lg font-semibold text-[11px] transition-colors"
              >
                عرض جميع الكتاب
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {writers.map((w) => {
              const actual = copywritingStats.counts[w.id] || 0;
              const isSelected = selectedMemberId === w.id;
              return (
                <div
                  key={w.id}
                  onClick={() => setSelectedMemberId(isSelected ? "" : w.id)}
                  className={cn(
                    "p-2.5 rounded-xl border flex flex-col items-center justify-center text-center cursor-pointer transition-all",
                    isSelected
                      ? "bg-emerald-600 text-white border-emerald-700 shadow-sm"
                      : "bg-slate-50 border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/40 text-slate-800"
                  )}
                >
                  <span className="font-bold">{w.displayName}</span>
                  <span className={cn("text-sm font-extrabold mt-0.5", isSelected ? "text-emerald-100" : "text-emerald-700")}>
                    {actual} <span className={cn("text-[10px] font-normal", isSelected ? "text-emerald-200" : "text-slate-400")}>عملاء مسندين</span>
                  </span>
                </div>
              );
            })}
            <div
              onClick={() => setSelectedMemberId(selectedMemberId === "unassigned" ? "" : "unassigned")}
              className={cn(
                "p-2.5 rounded-xl border flex flex-col items-center justify-center text-center cursor-pointer transition-all",
                selectedMemberId === "unassigned"
                  ? "bg-amber-600 text-white border-amber-700 shadow-sm"
                  : "bg-amber-50/70 border-amber-300 text-amber-900 hover:bg-amber-100"
              )}
            >
              <span className="font-bold">غير مسند لكاتب</span>
              <span className="text-sm font-extrabold mt-0.5">
                {copywritingStats.unassigned} <span className="text-[10px] font-normal">عميل</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 5. VIEW: STRATEGY TEAM */}
      {activeView === "strategy" && (
        <div className="bg-surface rounded-2xl border border-sky-200/80 p-4 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
            <div className="font-bold text-sky-900 flex items-center gap-2">
              <Compass className="w-4 h-4 text-sky-600" />
              <span>فريق الاستراتيجية (أروى قائدة الفريق، تسنيم، هند، هاجر حسن):</span>
            </div>
            {selectedMemberId && (
              <button
                onClick={() => setSelectedMemberId("")}
                className="px-2.5 py-1 bg-sky-100 hover:bg-sky-200 text-sky-800 rounded-lg font-semibold text-[11px] transition-colors"
              >
                عرض جميع الاستراتيجيين
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            {strategists.map((s) => {
              const actual = strategyStats.counts[s.id] || 0;
              const isSelected = selectedMemberId === s.id;
              return (
                <div
                  key={s.id}
                  onClick={() => setSelectedMemberId(isSelected ? "" : s.id)}
                  className={cn(
                    "p-2.5 rounded-xl border flex flex-col items-center justify-center text-center cursor-pointer transition-all",
                    isSelected
                      ? "bg-sky-600 text-white border-sky-700 shadow-sm"
                      : "bg-slate-50 border-slate-200 hover:border-sky-300 hover:bg-sky-50/40 text-slate-800"
                  )}
                >
                  <span className="font-bold">{s.displayName}</span>
                  <span className={cn("text-sm font-extrabold mt-0.5", isSelected ? "text-sky-100" : "text-sky-700")}>
                    {actual} <span className={cn("text-[10px] font-normal", isSelected ? "text-sky-200" : "text-slate-400")}>عملاء</span>
                  </span>
                </div>
              );
            })}
            <div
              onClick={() => setSelectedMemberId(selectedMemberId === "unassigned" ? "" : "unassigned")}
              className={cn(
                "p-2.5 rounded-xl border flex flex-col items-center justify-center text-center cursor-pointer transition-all",
                selectedMemberId === "unassigned"
                  ? "bg-amber-600 text-white border-amber-700 shadow-sm"
                  : "bg-amber-50/70 border-amber-300 text-amber-900 hover:bg-amber-100"
              )}
            >
              <span className="font-bold">غير مسند لاستراتيجيست</span>
              <span className="text-sm font-extrabold mt-0.5">
                {strategyStats.unassigned} <span className="text-[10px] font-normal">عميل</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-surface p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-2 text-slate-400">
          <Filter className="w-4 h-4" />
          <span className="font-semibold text-slate-700">تصفية:</span>
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 absolute right-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="بحث باسم العميل..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pr-8 pl-3 py-1.5 border border-slate-200 rounded-xl text-xs focus:outline-sky-500"
          />
        </div>

        {/* Difficulty Filter */}
        <select
          value={selectedDifficulty}
          onChange={(e) => setSelectedDifficulty(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs bg-white text-slate-700 font-medium"
        >
          <option value="">جميع درجات الصعوبة</option>
          <option value="Hard">صعب (Hard)</option>
          <option value="Medium">متوسط (Medium)</option>
          <option value="Easy">سهل (Easy)</option>
          <option value="Unknown">غير محدد</option>
        </select>

        {/* Member selector in current view */}
        {activeView === "design" && (
          <select
            value={selectedMemberId}
            onChange={(e) => setSelectedMemberId(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs bg-white text-slate-700 font-medium"
          >
            <option value="">جميع المصممين ({designers.length})</option>
            {designers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.displayName} ({designStats.counts[d.id] || 0} عملاء)
              </option>
            ))}
            <option value="unassigned">غير مسند ({designStats.unassigned})</option>
          </select>
        )}

        {activeView === "strategy" && (
          <select
            value={selectedMemberId}
            onChange={(e) => setSelectedMemberId(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs bg-white text-slate-700 font-medium"
          >
            <option value="">جميع الاستراتيجيين ({strategists.length})</option>
            {strategists.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName} ({strategyStats.counts[s.id] || 0} عملاء)
              </option>
            ))}
            <option value="unassigned">غير مسند ({strategyStats.unassigned})</option>
          </select>
        )}

        {activeView === "copywriting" && (
          <select
            value={selectedMemberId}
            onChange={(e) => setSelectedMemberId(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs bg-white text-slate-700 font-medium"
          >
            <option value="">جميع كتاب المحتوى ({writers.length})</option>
            {writers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.displayName} ({copywritingStats.counts[w.id] || 0} عملاء)
              </option>
            ))}
            <option value="unassigned">غير مسند ({copywritingStats.unassigned})</option>
          </select>
        )}

        {activeView === "video" && (
          <select
            value={videoFilter}
            onChange={(e) => setVideoFilter(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs bg-white text-slate-700 font-medium"
          >
            <option value="all">جميع الحالات ({clients.length})</option>
            <option value="assigned">مسند لإيديتور ({videoStats.assigned})</option>
            <option value="needs_video_unassigned">يتطلب فيديو - بانتظار إسناد ({videoStats.needsVideoUnassigned})</option>
            <option value="not_needed">لا يحتاج فيديو حالياً ({videoStats.notNeeded})</option>
          </select>
        )}

        {/* Counter of matching clients */}
        <div className="text-[11px] font-semibold text-slate-500 mr-auto">
          المطابق: <span className="text-sky-700 font-extrabold">{filteredClients.length}</span> من {clients.length}
        </div>
      </div>

      {/* Clients Cards Grid */}
      {clients.length === 0 ? (
        <div className="p-12 sm:p-16 text-center bg-surface rounded-2xl border-2 border-dashed border-slate-200 space-y-4 max-w-xl mx-auto my-6">
          <div className="w-16 h-16 bg-sky-50 text-sky-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
            <Building2 className="w-8 h-8" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-base sm:text-lg font-bold text-slate-800">مساحة العمل جاهزة ونظيفة للتشغيل الفعلي</h3>
            <p className="text-xs text-slate-500 leading-relaxed max-w-md mx-auto">
              لم تتم إضافة أي عملاء بعد. يمكنك البدء الآن بتهيئة مساحة العمل عبر إضافة أول عميل، وتحديد الصعوبة وتوزيع أعضاء الفريق على التخصصات.
            </p>
          </div>
          {!isViewer && (
            <div className="pt-2">
              <button
                onClick={() => setIsAddClientModalOpen(true)}
                className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-2 transition-all shadow-sm"
              >
                <PlusCircle className="w-4 h-4" />
                <span>إضافة أول عميل الآن</span>
              </button>
            </div>
          )}
        </div>
      ) : filteredClients.length === 0 ? (
        <div className="p-12 text-center bg-surface rounded-2xl border border-slate-200 space-y-3">
          <Building2 className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="font-bold text-slate-700">لا توجد حسابات عملاء مطابقة للفلاتر المحددة</h3>
          <p className="text-xs text-slate-400">يرجى تعديل خيارات البحث أو تصفية الأعضاء.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredClients.map((client) => {
            const diffColor =
              client.difficulty === "Hard"
                ? "bg-rose-50 text-rose-700 border-rose-200"
                : client.difficulty === "Medium"
                ? "bg-blue-50 text-blue-700 border-blue-200"
                : client.difficulty === "Easy"
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-slate-100 text-slate-600 border-slate-200";

            const openTasks = (client.tasks || []).filter(
              (t: any) => !["delivered", "cancelled"].includes(t.status)
            ).length;

            const assignedDesigner = client.team_assignment?.primary_designer?.display_name || client.owner?.display_name || "غير مسند";
            const designReviewer = client.team_assignment?.design_reviewer?.display_name || "توجيه تلقائي";

            const assignedStrategist = client.team_assignment?.primary_strategist?.display_name || "غير مسند";
            const strategyReviewer = client.team_assignment?.strategy_reviewer?.display_name;

            const assignedWriter = client.team_assignment?.primary_copywriter?.display_name || "غير مسند";
            const writerReviewer = client.team_assignment?.copywriting_reviewer?.display_name;

            const videoReq = Boolean(client.team_assignment?.requires_video || client.team_assignment?.primary_video_editor_id);
            const assignedEditor = client.team_assignment?.primary_video_editor?.display_name;
            const videoReviewer = client.team_assignment?.video_reviewer?.display_name;

            return (
              <div
                key={client.id}
                className="bg-surface rounded-2xl border border-slate-200/90 p-4 shadow-xs hover:border-sky-300 hover:shadow-sm transition-all flex flex-col justify-between text-xs space-y-3"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-sm text-slate-900 tracking-wide">
                      {client.name}
                    </h3>
                    <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] border ${diffColor}`}>
                      {CLIENT_DIFFICULTY_LABELS[client.difficulty as keyof typeof CLIENT_DIFFICULTY_LABELS] || client.difficulty}
                    </span>
                  </div>

                  <div className="mt-3 space-y-2 text-slate-600 text-[11px]">
                    {/* Primary Designer */}
                    <div className="flex items-center justify-between p-1.5 rounded-lg bg-purple-50/40 border border-purple-100/60">
                      <span className="text-purple-900 font-semibold flex items-center gap-1">
                        <Palette className="w-3 h-3 text-purple-600" />
                        المصمم:
                      </span>
                      <span className="font-bold text-slate-900">
                        {assignedDesigner}
                      </span>
                    </div>

                    {/* Agency Team Specialty Summary */}
                    <div className="p-2 bg-slate-50/70 rounded-xl border border-slate-200/70 space-y-1.5 text-[10px]">
                      {/* Strategy */}
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 flex items-center gap-1">
                          <Compass className="w-3 h-3 text-sky-600" />
                          الاستراتيجية:
                        </span>
                        <span className={cn("font-bold", assignedStrategist !== "غير مسند" ? "text-sky-900" : "text-slate-400")}>
                          {assignedStrategist}
                        </span>
                      </div>

                      {/* Content */}
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 flex items-center gap-1">
                          <Feather className="w-3 h-3 text-emerald-600" />
                          المحتوى:
                        </span>
                        <span className={cn("font-bold", assignedWriter !== "غير مسند" ? "text-emerald-900" : "text-slate-400")}>
                          {assignedWriter}
                        </span>
                      </div>

                      {/* Video */}
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 flex items-center gap-1">
                          <Video className="w-3 h-3 text-amber-600" />
                          المونتاج:
                        </span>
                        {assignedEditor ? (
                          <span className="font-bold text-amber-900">{assignedEditor}</span>
                        ) : videoReq ? (
                          <span className="font-bold text-amber-600 bg-amber-100/70 px-1 rounded text-[9px]">⚠️ يتطلب فيديو</span>
                        ) : (
                          <span className="text-slate-400 font-normal">لا يحتاج حالياً</span>
                        )}
                      </div>

                      {/* Brief status */}
                      <div className="flex items-center justify-between pt-1 border-t border-slate-200/50">
                        <span className="text-slate-400">حالة الـ Brief:</span>
                        <span
                          className={cn(
                            "px-1.5 py-0.5 rounded text-[9px] font-bold",
                            client.brief_data?.status === "approved"
                              ? "bg-emerald-100 text-emerald-800"
                              : client.brief_data?.status === "draft"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-500"
                          )}
                        >
                          {client.brief_data?.status === "approved"
                            ? `معتمد (v${client.brief_data?.strategy_version || 1})`
                            : client.brief_data?.status === "draft"
                            ? "مسودة"
                            : "غير محدد"}
                        </span>
                      </div>
                    </div>

                    {/* Secondary stats */}
                    <div className="flex items-center justify-between pt-1 text-[10px]">
                      <span className="text-slate-400">الكامبينز: {client.campaigns?.length || 0}</span>
                      <span className={cn("font-bold", openTasks > 0 ? "text-amber-600" : "text-slate-400")}>
                        {openTasks} مهام نشطة
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 space-y-1.5">
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        onClick={() => setTeamModalClient(client)}
                        disabled={isViewer}
                        className={cn(
                          "px-2 py-1.5 rounded-xl font-bold flex items-center justify-center gap-1 transition-colors text-[10px]",
                          isViewer
                            ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
                            : "bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200"
                        )}
                        title={isViewer ? "حساب مشاهد فقط" : isOwner ? "توزيع فريق العمل متعدد التخصصات" : "صلاحية حصرية للمدير العام"}
                      >
                        <Users className="w-3 h-3 text-sky-600" />
                        <span>توزيع فريق العميل</span>
                      </button>
                      <button
                        onClick={() => setBriefModalClient(client)}
                        className="px-2 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl font-semibold flex items-center justify-center gap-1 transition-colors text-[10px]"
                      >
                        <Compass className="w-3 h-3 text-emerald-600" />
                        <span>الـ Brief</span>
                      </button>
                    </div>

                    {!isViewer && (
                      <button
                        onClick={() => handleOpenReassignModal(client)}
                        className="w-full px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-xl font-medium flex items-center justify-center gap-1.5 transition-colors text-[10px]"
                        title={isOwner ? "نقل المصمم المسؤول" : "صلاحية حصرية للمدير العام"}
                      >
                        <ArrowRightLeft className="w-3 h-3 text-slate-500" />
                        <span>إعادة إسناد المصمم</span>
                      </button>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Step 1: Reassign / Edit Client Modal */}
      {editingClient && !showConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <form
            onSubmit={handleProceedToConfirm}
            className="bg-surface rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-sky-600" />
                إعادة إسناد مسؤول العميل: <span className="text-sky-700 font-extrabold">{editingClient.name}</span>
              </h3>
              <button
                type="button"
                onClick={() => setEditingClient(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Workload Preview Before Transfer */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Briefcase className="w-4 h-4 text-sky-600" />
                الحمل الحالي وتوزيع المصممين (Workload Overview):
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                {designers.map((d) => {
                  const isSelected = d.id === newOwnerId;
                  const isCurrent = d.id === editingClient.owner_roster_id;
                  const actualCount = designStats.counts[d.id] || 0;
                  return (
                    <div
                      key={d.id}
                      onClick={() => setNewOwnerId(d.id)}
                      className={cn(
                        "p-2 rounded-lg border cursor-pointer transition-all",
                        isSelected
                          ? "bg-sky-50 border-sky-400 shadow-xs"
                          : isCurrent
                          ? "bg-amber-50/50 border-amber-300"
                          : "bg-white border-slate-200 hover:border-slate-300"
                      )}
                    >
                      <div className="flex items-center justify-between font-bold text-slate-800">
                        <span>{d.displayName}</span>
                        {isCurrent && <span className="text-[9px] bg-amber-200 text-amber-900 px-1 rounded">الحالي</span>}
                        {isSelected && <span className="text-[9px] bg-sky-200 text-sky-900 px-1 rounded">المختار</span>}
                      </div>
                      <div className="text-slate-500 text-[10px] mt-0.5">
                        {actualCount} عملاء | {d.openTasksCount} مهمة نشطة
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Target Designer Dropdown */}
            <div className="space-y-1.5 text-xs">
              <label className="font-bold text-slate-800 block">المصمم المسؤول الجديد:</label>
              <select
                value={newOwnerId}
                onChange={(e) => setNewOwnerId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white text-slate-800 font-medium focus:ring-2 focus:ring-sky-500 focus:outline-none"
              >
                <option value="">-- إزالة الإسناد (غير مسند / Unassigned) --</option>
                {designers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.displayName} — {d.jobTitle} ({designStats.counts[d.id] || 0} عميل)
                  </option>
                ))}
              </select>
            </div>

            {/* Transfer Mode Radio Options */}
            <div className="space-y-2 pt-2">
              <label className="text-xs font-bold text-slate-800 block">خيار نقل المهام المفتوحة:</label>
              <div className="space-y-2 text-xs">
                <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="transferOption"
                    checked={!reassignOpenTasks}
                    onChange={() => setReassignOpenTasks(false)}
                    className="mt-0.5 text-sky-600 focus:ring-sky-500"
                  />
                  <div>
                    <div className="font-bold text-slate-800">
                      1. تغيير المسؤول الأساسي عن العميل فقط للمهام المستقبلية
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      تبقى المهام الحالية قيد التنفيذ مع المصمم القديم دون تغيير، ويكتفي النظام بتغيير مالك الحساب.
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 p-3 rounded-xl border border-amber-200 bg-amber-50/50 hover:bg-amber-50 cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="transferOption"
                    checked={reassignOpenTasks}
                    onChange={() => setReassignOpenTasks(true)}
                    className="mt-0.5 text-amber-600 focus:ring-amber-500"
                  />
                  <div>
                    <div className="font-bold text-amber-900">
                      2. تغيير المسؤول ونقل المهام المفتوحة الحالية أيضاً ({clientOpenTasksCount} مهمة مفتوحة)
                    </div>
                    <div className="text-[11px] text-amber-700 mt-0.5">
                      يتم فوراً نقل جميع المهام غير المسلمة وغير الملغاة إلى المسؤول الجديد.
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <div className="text-[10px] text-slate-400 bg-slate-50 p-2 rounded-lg border border-slate-100">
              * تنبيه أمني: لا يتم نقل المهام المسلمة أو الملغاة أو السجلات التاريخية للحفاظ على صحة التقارير.
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setEditingClient(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs flex items-center gap-1.5"
              >
                متابعة لتأكيد النقل
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Step 2: Confirmation Modal */}
      {editingClient && showConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-surface rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100 text-sky-700">
              <div className="p-2 rounded-xl bg-sky-100 text-sky-700">
                <AlertTriangle className="w-6 h-6 text-sky-600" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">تأكيد عملية نقل الحساب</h3>
                <p className="text-xs text-slate-500">يرجى مراجعة التفاصيل قبل اعتماد النقل النهائي</p>
              </div>
            </div>

            {statusMessage && (
              <div
                className={cn(
                  "p-3 rounded-xl text-xs font-semibold",
                  statusMessage.type === "success"
                    ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                    : "bg-rose-50 text-rose-800 border border-rose-200"
                )}
              >
                {statusMessage.text}
              </div>
            )}

            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2.5 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500">اسم العميل:</span>
                <span className="font-extrabold text-slate-900">{editingClient.name}</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500">المسؤول القديم:</span>
                <span className="font-bold text-slate-700">{currentDesignerName}</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500">المسؤول الجديد:</span>
                <span className="font-extrabold text-sky-700">{newDesignerName}</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500">المهام المفتوحة التي ستُنقل:</span>
                <span className={cn("font-bold", reassignOpenTasks ? "text-amber-700 font-extrabold" : "text-slate-600")}>
                  {reassignOpenTasks ? `${clientOpenTasksCount} مهمة` : "0 (للمستقبلية فقط)"}
                </span>
              </div>
              {targetDesigner && (
                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-500">الحمل المتوقع للمصمم الجديد:</span>
                  <span className="font-bold text-slate-800">
                    {(designStats.counts[targetDesigner.id] || 0) + (editingClient.owner_roster_id !== targetDesigner.id ? 1 : 0)} عملاء
                  </span>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setShowConfirmation(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                رجوع للتعديل
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={handleExecuteAssignment}
                className="px-6 py-2.5 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs flex items-center gap-2"
              >
                {isSaving ? "جاري تنفيذ النقل..." : "تأكيد النقل النهائي"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Client Team Assignment Modal */}
      <ClientTeamModal
        client={teamModalClient}
        isOpen={!!teamModalClient}
        onClose={() => setTeamModalClient(null)}
        onSaved={fetchClients}
        allTeamMembers={allTeamMembers}
        strategists={strategists}
        writers={writers}
        designers={designers}
        videoEditors={videoEditors}
        managers={managers}
      />

      {/* Client Brief & Strategy Modal */}
      <ClientBriefModal
        client={briefModalClient}
        isOpen={!!briefModalClient}
        onClose={() => setBriefModalClient(null)}
        onSaved={fetchClients}
        isOwner={isOwner}
      />

      {/* Add Client Onboarding Modal */}
      <AddClientModal
        isOpen={isAddClientModalOpen}
        onClose={() => setIsAddClientModalOpen(false)}
        onSuccess={fetchClients}
        designers={designers}
        writers={writers}
        strategists={strategists}
        videoEditors={videoEditors}
        allTeamMembers={allTeamMembers}
      />
    </div>
  );
}
