"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  X,
  ExternalLink,
  FileText,
  Calendar,
  User,
  Copy,
  Check,
  CheckCircle2,
  MessageSquare,
  Send,
  Layers,
  Sparkles,
  Clock,
  AlertTriangle,
  ChevronRight,
  Eye,
  CheckSquare,
  HelpCircle,
  Video,
  Image as ImageIcon,
  UploadCloud,
  ArrowRight,
  ShieldCheck,
  RotateCcw,
} from "lucide-react";
import {
  TASK_STATUS_LABELS,
  TASK_STATUS_COLORS,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_COLORS,
  CLIENT_DIFFICULTY_LABELS,
  cn,
} from "@/lib/utils";
import type { TaskStatus, TaskPriority } from "@/types/database";

interface TaskDetailsDrawerProps {
  task: any | null;
  isOpen: boolean;
  onClose: () => void;
  onStatusTransition?: (taskId: string, newStatus: TaskStatus) => void;
  onTaskUpdated?: () => void;
}

export default function TaskDetailsDrawer({
  task,
  isOpen,
  onClose,
  onStatusTransition,
  onTaskUpdated,
}: TaskDetailsDrawerProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Deliverable link state
  const [deliverableUrl, setDeliverableUrl] = useState<string>("");
  const [savingDeliverable, setSavingDeliverable] = useState(false);

  // Review submission state
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  // Review decision state
  const [showDecisionModal, setShowDecisionModal] = useState<"approve" | "changes" | null>(null);
  const [decisionFeedback, setDecisionFeedback] = useState("");
  const [submittingDecision, setSubmittingDecision] = useState(false);

  // Current authenticated user
  const [currentUser, setCurrentUser] = useState<{
    rosterPersonId: string;
    role: string;
    displayName?: string;
  } | null>(null);

  // Comments state
  const [comments, setComments] = useState<any[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newCommentText, setNewCommentText] = useState("");
  const [newCommentType, setNewCommentType] = useState<"general" | "internal_review" | "client_note">("general");
  const [submittingComment, setSubmittingComment] = useState(false);

  // Extract content calendar item safely
  const cci = Array.isArray(task?.content_calendar_item)
    ? task?.content_calendar_item[0]
    : task?.content_calendar_item || null;

  // Initialize deliverable and current user
  useEffect(() => {
    if (task?.id) {
      setDeliverableUrl(task.final_deliverable_url || "");
    }
  }, [task?.id, task?.final_deliverable_url]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.membership) {
          setCurrentUser({
            rosterPersonId: data.membership.rosterPersonId,
            role: data.membership.role,
            displayName: data.membership.displayName,
          });
        }
      })
      .catch(() => {});
  }, []);

  // Fetch comments when task changes
  useEffect(() => {
    if (!task?.id || !isOpen) {
      setComments([]);
      setPreviewUrl(null);
      return;
    }

    const fetchComments = async () => {
      setCommentsLoading(true);
      try {
        const res = await fetch(`/api/tasks/${task.id}/comments`);
        if (res.ok) {
          const data = await res.json();
          setComments(data.comments || []);
        }
      } catch (err) {
        console.error("Failed to fetch task comments:", err);
      } finally {
        setCommentsLoading(false);
      }
    };

    fetchComments();
  }, [task?.id, isOpen]);

  if (!isOpen || !task) return null;

  const copyToClipboard = (text: string, fieldName: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleOpenPdfPreview = async () => {
    if (previewUrl) {
      window.open(previewUrl, "_blank");
      return;
    }

    const storagePath = task.campaign?.storage_path;
    if (!storagePath) {
      alert("مسار ملف الـ PDF غير متوفر لهذه الحملة.");
      return;
    }

    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/campaigns/preview-url?storagePath=${encodeURIComponent(storagePath)}`);
      const data = await res.json();
      if (res.ok && data.url) {
        setPreviewUrl(data.url);
        window.open(data.url, "_blank");
      } else {
        alert(data.error || "تعذر فتح معاينة الـ PDF");
      }
    } catch (e: any) {
      alert(e.message || "حدث خطأ أثناء تحميل المعاينة");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSaveDeliverable = async () => {
    if (!deliverableUrl.trim()) {
      alert("يرجى إدخال رابط التسليم أولاً.");
      return;
    }
    setSavingDeliverable(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toStatus: task.status,
          deliverableUrl: deliverableUrl.trim(),
        }),
      });
      if (res.ok) {
        alert("تم حفظ رابط التسليم بنجاح.");
        onTaskUpdated?.();
      } else {
        const err = await res.json();
        alert(err.error || "فشل حفظ رابط التسليم");
      }
    } catch (e: any) {
      alert(e.message || "حدث خطأ أثناء حفظ رابط التسليم");
    } finally {
      setSavingDeliverable(false);
    }
  };

  const handleStartWork = async () => {
    try {
      const res = await fetch(`/api/tasks/${task.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStatus: "in_progress" }),
      });
      if (res.ok) {
        // Start timer
        await fetch("/api/timer/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: task.id, category: "initial_design" }),
        });
        window.dispatchEvent(new CustomEvent("timer_state_changed"));
        onTaskUpdated?.();
        if (onStatusTransition) onStatusTransition(task.id, "in_progress");
      } else {
        const err = await res.json();
        alert(err.error || "فشل بدء العمل");
      }
    } catch (e: any) {
      alert(e.message || "حدث خطأ أثناء بدء العمل");
    }
  };

  const handleSubmitForReview = async () => {
    const url = deliverableUrl.trim() || task.final_deliverable_url;
    if (!url) {
      alert("يرجى إدخال رابط المعاينة أو التصميم قبل التسليم للمراجعة.");
      return;
    }
    setSubmittingReview(true);
    try {
      const res = await fetch("/api/reviews/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          previewUrl: url,
          note: reviewNote.trim() || null,
          reviewerId: task.reviewer_id || undefined,
        }),
      });
      if (res.ok) {
        setShowSubmitModal(false);
        setReviewNote("");
        alert("تم تسليم المهمة للمراجعة الداخلية بنجاح.");
        onTaskUpdated?.();
        if (onStatusTransition) onStatusTransition(task.id, "internal_review");
      } else {
        const err = await res.json();
        alert(err.error || "فشل تسليم المهمة للمراجعة");
      }
    } catch (e: any) {
      alert(e.message || "حدث خطأ أثناء تسليم المهمة للمراجعة");
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleDecideReview = async (decision: "approved" | "changes_requested") => {
    if (decision === "changes_requested" && !decisionFeedback.trim()) {
      alert("يرجى كتابة ملاحظات وتوجيهات التعديل للمصمم.");
      return;
    }

    const pendingRound = Array.isArray(task.review_rounds)
      ? task.review_rounds.find((r: any) => r.decision === "pending")
      : null;

    if (!pendingRound) {
      alert("لم يتم العثور على جولة مراجعة نشطة.");
      return;
    }

    setSubmittingDecision(true);
    try {
      const res = await fetch("/api/reviews/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roundId: pendingRound.id,
          decision,
          feedback: decisionFeedback.trim() || null,
        }),
      });
      if (res.ok) {
        setShowDecisionModal(null);
        setDecisionFeedback("");
        alert(decision === "approved" ? "تم اعتماد التصميم بنجاح ✓" : "تم إرسال طلب التعديلات للمصمم.");
        onTaskUpdated?.();
        if (onStatusTransition) onStatusTransition(task.id, decision === "approved" ? "approved" : "changes_requested");
      } else {
        const err = await res.json();
        alert(err.error || "فشل تسجيل قرار المراجعة");
      }
    } catch (e: any) {
      alert(e.message || "حدث خطأ أثناء تسجيل قرار المراجعة");
    } finally {
      setSubmittingDecision(false);
    }
  };

  const handleOwnerDirectApprove = async () => {
    try {
      const res = await fetch(`/api/tasks/${task.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStatus: "approved" }),
      });
      if (res.ok) {
        alert("تم اعتماد المهمة مباشرةً (تجاوز المراجعة للمالك).");
        onTaskUpdated?.();
        if (onStatusTransition) onStatusTransition(task.id, "approved");
      } else {
        const err = await res.json();
        alert(err.error || "فشل اعتماد المهمة");
      }
    } catch (e: any) {
      alert(e.message || "حدث خطأ");
    }
  };

  const handleMarkDelivered = async () => {
    const url = deliverableUrl.trim() || task.final_deliverable_url;
    if (!url) {
      alert("رابط التسليم النهائي إلزامي لتحديد المهمة كـ تم التسليم.");
      return;
    }
    try {
      const res = await fetch(`/api/tasks/${task.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toStatus: "delivered",
          deliverableUrl: url,
        }),
      });
      if (res.ok) {
        alert("تم تسليم المهمة نهائياً بنجاح ✓");
        onTaskUpdated?.();
        if (onStatusTransition) onStatusTransition(task.id, "delivered");
      } else {
        const err = await res.json();
        alert(err.error || "فشل تسليم المهمة");
      }
    } catch (e: any) {
      alert(e.message || "حدث خطأ أثناء التسليم");
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentText.trim() || submittingComment) return;

    setSubmittingComment(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: newCommentText.trim(),
          commentType: newCommentType,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setComments((prev) => [...prev, data.comment]);
        setNewCommentText("");
      } else {
        alert(data.error || "فشل إرسال التعليق");
      }
    } catch (err: any) {
      alert(err.message || "حدث خطأ أثناء إضافة التعليق");
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleToggleResolve = async (commentId: string, currentResolved: boolean) => {
    try {
      const res = await fetch(`/api/tasks/${task.id}/comments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commentId,
          isResolved: !currentResolved,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? { ...c, is_resolved: !currentResolved } : c))
        );
      }
    } catch (err) {
      console.error(err);
    }
  };

  const onDesignText = cci?.on_design_text || null;
  const captionText = cci?.caption || task.description || null;
  const hookText = cci?.hook || null;
  const ctaText = cci?.cta || null;
  const reelScriptText = cci?.reel_script || null;
  const slidesList = Array.isArray(cci?.slides) ? cci.slides : [];
  const sourcePages = Array.isArray(cci?.source_pages) && cci.source_pages.length > 0
    ? cci.source_pages.join("، ")
    : cci?.source_page ? String(cci.source_page) : "غير محدد";

  const statusConfig = TASK_STATUS_COLORS[task.status as TaskStatus] || {
    bg: "bg-slate-100",
    text: "text-slate-800",
    border: "border-slate-200",
  };

  const isOwner = currentUser?.role === "owner";
  const isAssignee = currentUser?.rosterPersonId === task.primary_assignee_id;
  const isReviewer = currentUser?.rosterPersonId === task.reviewer_id;
  const isPendingReview = task.status === "internal_review";
  const isTaskAssignedToOwner = isOwner && isAssignee;
  const canDecideReview = isPendingReview && (isReviewer || isOwner) && !isAssignee;
  const reviewRounds = Array.isArray(task.review_rounds)
    ? [...task.review_rounds].sort((a: any, b: any) => (a.round_number || 0) - (b.round_number || 0))
    : [];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 transition-opacity"
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-surface shadow-2xl border-l border-slate-200 flex flex-col text-right text-xs animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-start justify-between gap-3 bg-slate-50/50">
          <div className="space-y-1.5 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-md font-mono font-bold text-[11px] bg-slate-200 text-slate-800">
                {task.deliverable_number || "Post"}
              </span>
              <span
                className={cn(
                  "px-2.5 py-0.5 rounded-full font-bold text-[11px] border",
                  statusConfig.bg,
                  statusConfig.text,
                  statusConfig.border
                )}
              >
                {TASK_STATUS_LABELS[task.status as TaskStatus] || task.status}
              </span>
              <span
                className={cn(
                  "px-2 py-0.5 rounded font-semibold text-[10px]",
                  TASK_PRIORITY_COLORS[task.priority as TaskPriority]?.bg || "bg-slate-100"
                )}
              >
                أولوية {TASK_PRIORITY_LABELS[task.priority as TaskPriority] || task.priority}
              </span>
              {task.client?.difficulty && (
                <span className="px-2 py-0.5 rounded text-[10px] bg-amber-50 text-amber-800 border border-amber-200">
                  صعوبة العميل: {(CLIENT_DIFFICULTY_LABELS as Record<string, string>)[task.client.difficulty] || task.client.difficulty}
                </span>
              )}
            </div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-snug break-words">
              {task.title}
            </h2>
            <div className="flex items-center gap-3 text-slate-500 text-[11px]">
              <span className="font-semibold text-slate-800">العميل: {task.client?.name}</span>
              {task.campaign?.month_key && (
                <span>التقويم: {task.campaign.month_key}</span>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-6">
          {/* Section 1: Source Traceability (Calendar & PDF Origin) */}
          <div className="bg-sky-50/70 border border-sky-200/80 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sky-950 text-xs flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-sky-600" />
                أصل ومصدر المهمة في Content Calendar
              </h3>
              <span className="text-[10px] bg-sky-200 text-sky-900 px-2 py-0.5 rounded-full font-bold">
                إصدار #{task.campaign?.revision_number || 1}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-[11px]">
              <div>
                <span className="text-slate-500 block text-[10px]">العميل:</span>
                <strong className="text-slate-800">{task.client?.name || "غير محدد"}</strong>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">شهر التقويم:</span>
                <strong className="text-slate-800">{task.campaign?.month_key || "غير محدد"}</strong>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">الصفحات في PDF:</span>
                <strong className="text-sky-800 font-mono">صفحة {sourcePages}</strong>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <span className="text-slate-500 block text-[10px]">الملف الأصلي المرفوع:</span>
                <span className="text-slate-700 font-mono text-[10px] break-all">
                  {task.campaign?.original_file_name || "calendar.pdf"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-sky-100 flex-wrap">
              {task.campaign?.storage_path && (
                <button
                  type="button"
                  onClick={handleOpenPdfPreview}
                  disabled={previewLoading}
                  className="px-3 py-1.5 bg-white hover:bg-sky-100 text-sky-700 border border-sky-300 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shadow-2xs transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{previewLoading ? "جاري تجهيز الرابط..." : "معاينة الملف الأصلي (PDF)"}</span>
                  <ExternalLink className="w-3 h-3 text-sky-500" />
                </button>
              )}
              {task.campaign?.id && (
                <Link
                  href={`/campaigns?clientId=${task.client_id}&month=${task.campaign.month_key || ""}`}
                  className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shadow-2xs transition-colors"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>فتح تقويم المحتوى في صفحة الحملات</span>
                </Link>
              )}
            </div>
          </div>

          {/* Section 2: Deliverable & Submission Handoff */}
          <div className="bg-slate-50/90 border border-slate-200/90 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                <UploadCloud className="w-4 h-4 text-sky-600" />
                رابط التصميم والتسليم (Deliverable)
              </h3>
              {task.final_deliverable_url && (
                <a
                  href={task.final_deliverable_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-sky-600 hover:text-sky-800 font-bold inline-flex items-center gap-1"
                >
                  <span>معاينة الرابط المعتمد</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>

            <div className="flex gap-2">
              <input
                type="url"
                value={deliverableUrl}
                onChange={(e) => setDeliverableUrl(e.target.value)}
                placeholder="https://figma.com/file/... أو رابط Google Drive"
                className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white focus:outline-sky-500 font-mono text-left"
                dir="ltr"
              />
              <button
                type="button"
                onClick={handleSaveDeliverable}
                disabled={savingDeliverable}
                className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold transition-colors shrink-0"
              >
                {savingDeliverable ? "جاري الحفظ..." : "حفظ الرابط"}
              </button>
            </div>
          </div>

          {/* Section 3: Review Rounds History */}
          {reviewRounds.length > 0 && (
            <div className="space-y-2.5">
              <h3 className="font-bold text-slate-900 text-xs flex items-center gap-1.5 border-b border-slate-100 pb-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                سجل جولات المراجعة الداخلية ({reviewRounds.length} جولة)
              </h3>
              <div className="space-y-2">
                {reviewRounds.map((round: any, idx: number) => (
                  <div
                    key={round.id || idx}
                    className={cn(
                      "p-3 rounded-xl border text-xs space-y-1.5",
                      round.decision === "approved"
                        ? "bg-emerald-50/70 border-emerald-200"
                        : round.decision === "changes_requested"
                        ? "bg-amber-50/70 border-amber-200"
                        : "bg-sky-50/70 border-sky-200"
                    )}
                  >
                    <div className="flex items-center justify-between font-bold text-[11px]">
                      <span>جولة #{round.round_number || idx + 1}</span>
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded font-bold text-[10px]",
                          round.decision === "approved"
                            ? "bg-emerald-200 text-emerald-900"
                            : round.decision === "changes_requested"
                            ? "bg-amber-200 text-amber-900"
                            : "bg-sky-200 text-sky-900"
                        )}
                      >
                        {round.decision === "approved"
                          ? "معتمد ✓"
                          : round.decision === "changes_requested"
                          ? "مطلوب تعديلات"
                          : "بانتظار المراجعة"}
                      </span>
                    </div>
                    {round.preview_url && (
                      <div className="text-[11px] text-slate-600">
                        <span>رابط المعاينة: </span>
                        <a
                          href={round.preview_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-600 hover:underline font-mono"
                          dir="ltr"
                        >
                          {round.preview_url}
                        </a>
                      </div>
                    )}
                    {round.notes && (
                      <p className="text-slate-700 text-[11px]">ملاحظة المصمم: {round.notes}</p>
                    )}
                    {round.feedback && (
                      <div className="p-2 bg-white rounded-lg border border-amber-200 text-amber-900 text-xs font-medium">
                        توجيهات المراجع: {round.feedback}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 4: Creative Deliverable Blueprint */}
          <div className="space-y-4">
            <h3 className="font-bold text-slate-900 text-xs border-b border-slate-100 pb-2 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-indigo-600" />
              مواصفات وتفاصيل المحتوى المطلوب تصميمه
            </h3>

            {/* Quick Metadata Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-[11px]">
              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-400 block text-[10px]">نوع المحتوى:</span>
                <strong className="text-slate-800 flex items-center gap-1 mt-0.5">
                  {task.deliverable_format === "Carousel" ? (
                    <Layers className="w-3.5 h-3.5 text-purple-600" />
                  ) : task.deliverable_format === "Reel" ? (
                    <Video className="w-3.5 h-3.5 text-rose-600" />
                  ) : (
                    <ImageIcon className="w-3.5 h-3.5 text-sky-600" />
                  )}
                  {task.deliverable_format || "Static"}
                </strong>
              </div>

              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-400 block text-[10px]">موعد التسليم:</span>
                <strong className="text-slate-800 font-mono mt-0.5 block">
                  {task.due_date ? new Date(task.due_date).toLocaleDateString("ar-EG") : "غير محدد"}
                </strong>
              </div>

              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-400 block text-[10px]">المصمم المسند:</span>
                <strong className="text-slate-800 mt-0.5 block">
                  {task.assignee?.display_name || "غير مسند"}
                </strong>
              </div>

              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-400 block text-[10px]">المراجع الداخلي:</span>
                <strong className="text-slate-800 mt-0.5 block">
                  {task.reviewer?.display_name || "عماد (افتراضي)"}
                </strong>
              </div>
            </div>

            {/* On-Design Text (High-Priority Highlight) */}
            {onDesignText && (
              <div className="p-3.5 bg-purple-50/80 border border-purple-200 rounded-xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-purple-900 text-xs flex items-center gap-1">
                    ✨ النص المكتوب داخل التصميم (On-Design Text):
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(onDesignText, "onDesign")}
                    className="p-1 hover:bg-purple-200/60 rounded text-purple-700 text-[11px] inline-flex items-center gap-1"
                  >
                    {copiedField === "onDesign" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedField === "onDesign" ? "تم النسخ" : "نسخ النص"}</span>
                  </button>
                </div>
                <div className="text-slate-900 text-xs font-semibold leading-relaxed whitespace-pre-wrap bg-white p-2.5 rounded-lg border border-purple-100">
                  {onDesignText}
                </div>
              </div>
            )}

            {/* Hook / Headline */}
            {hookText && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <span className="font-bold text-slate-700 text-[11px] block">
                  🎯 الخطاف البصري / العنوان (Hook):
                </span>
                <div className="text-slate-800 text-xs font-medium">{hookText}</div>
              </div>
            )}

            {/* Caption */}
            {captionText && (
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 text-xs">
                    📝 نص المنشور / الكابشن (Caption):
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(captionText, "caption")}
                    className="p-1 hover:bg-slate-200 rounded text-slate-600 text-[11px] inline-flex items-center gap-1"
                  >
                    {copiedField === "caption" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedField === "caption" ? "تم النسخ" : "نسخ الكابشن"}</span>
                  </button>
                </div>
                <div className="text-slate-700 text-xs leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto bg-white p-2.5 rounded-lg border border-slate-100">
                  {captionText}
                </div>
              </div>
            )}

            {/* Carousel Slides */}
            {slidesList.length > 0 && (
              <div className="space-y-2">
                <div className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-purple-600" />
                  شرائح الكاروسيل ({slidesList.length} شريحة):
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {slidesList.map((slide: any, idx: number) => (
                    <div
                      key={idx}
                      className="p-2.5 bg-purple-50/50 border border-purple-100 rounded-xl text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between font-bold text-purple-900 text-[11px]">
                        <span>شريحة #{slide.slide_number || idx + 1}</span>
                      </div>
                      <p className="text-slate-800 leading-relaxed">{slide.text}</p>
                      {slide.visual_notes && (
                        <p className="text-slate-500 text-[10px] italic">ملاحظة بصرية: {slide.visual_notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reel Script */}
            {reelScriptText && (
              <div className="p-3.5 bg-rose-50/70 border border-rose-200 rounded-xl space-y-1.5">
                <span className="font-bold text-rose-950 text-xs flex items-center gap-1.5">
                  <Video className="w-4 h-4 text-rose-600" />
                  اسكريبت الريل وتوجيهات الفيديو:
                </span>
                <div className="text-slate-800 text-xs leading-relaxed whitespace-pre-wrap bg-white p-2.5 rounded-lg border border-rose-100">
                  {reelScriptText}
                </div>
              </div>
            )}

            {/* CTA */}
            {ctaText && (
              <div className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-xl text-xs space-y-0.5">
                <span className="font-bold text-emerald-900 text-[11px] block">
                  📢 الدعوة للتفاعل (CTA):
                </span>
                <div className="text-emerald-800 font-semibold">{ctaText}</div>
              </div>
            )}

            {/* Brief / Notes */}
            {task.brief && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <span className="font-bold text-slate-700 text-[11px] block">
                  📌 البريف وتوجيهات التنفيذ:
                </span>
                <p className="text-slate-600 leading-relaxed">{task.brief}</p>
              </div>
            )}
          </div>

          {/* Section 5: Comments & Internal Discussion */}
          <div className="space-y-3 pt-2">
            <h3 className="font-bold text-slate-900 text-xs border-b border-slate-100 pb-2 flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4 text-sky-600" />
              الملاحظات والتعديلات والمراجعة الداخلية ({comments.length})
            </h3>

            {/* Comments List */}
            {commentsLoading ? (
              <div className="text-center py-4 text-slate-400 text-xs">جاري تحميل الملاحظات...</div>
            ) : comments.length === 0 ? (
              <div className="text-center py-6 bg-slate-50 rounded-xl border border-slate-200 text-slate-400 text-xs">
                لا توجد ملاحظات أو تعديلات مسجلة على هذه المهمة بعد.
              </div>
            ) : (
              <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                {comments.map((comment) => (
                  <div
                    key={comment.id}
                    className={cn(
                      "p-3 rounded-xl border text-xs space-y-1.5",
                      comment.comment_type === "internal_review"
                        ? "bg-amber-50/60 border-amber-200"
                        : comment.comment_type === "client_note"
                        ? "bg-purple-50/60 border-purple-200"
                        : "bg-slate-50 border-slate-200"
                    )}
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-2">
                        <strong className="text-slate-800">
                          {comment.author?.display_name || "عضو الفريق"}
                        </strong>
                        <span
                          className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-bold",
                            comment.comment_type === "internal_review"
                              ? "bg-amber-100 text-amber-800"
                              : comment.comment_type === "client_note"
                              ? "bg-purple-100 text-purple-800"
                              : "bg-slate-200 text-slate-700"
                          )}
                        >
                          {comment.comment_type === "internal_review"
                            ? "مراجعة داخلية"
                            : comment.comment_type === "client_note"
                            ? "ملاحظة عميل"
                            : "عام"}
                        </span>
                      </div>
                      <span className="text-slate-400 font-mono text-[10px]">
                        {new Date(comment.created_at).toLocaleTimeString("ar-EG", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>

                    <p className="text-slate-800 leading-relaxed whitespace-pre-wrap">{comment.content}</p>

                    {comment.comment_type === "internal_review" && (
                      <div className="pt-1.5 border-t border-amber-200/60 flex items-center justify-between text-[11px]">
                        <span
                          className={cn(
                            "font-bold",
                            comment.is_resolved ? "text-emerald-700" : "text-amber-800"
                          )}
                        >
                          {comment.is_resolved ? "✓ تم استيفاء الملاحظة" : "⏳ قيد التنفيذ"}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleToggleResolve(comment.id, comment.is_resolved)}
                          className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-bold border transition-colors",
                            comment.is_resolved
                              ? "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                              : "bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700"
                          )}
                        >
                          {comment.is_resolved ? "إعادة الفتح" : "تحديد كمستوفى ✓"}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Add Comment Form */}
            <form onSubmit={handleAddComment} className="pt-2 space-y-2">
              <div className="flex items-center gap-2">
                <select
                  value={newCommentType}
                  onChange={(e) => setNewCommentType(e.target.value as any)}
                  className="px-2.5 py-1.5 border border-slate-200 rounded-xl text-xs bg-white text-slate-700"
                >
                  <option value="general">تعليق عام</option>
                  <option value="internal_review">ملاحظة مراجعة وتعديل</option>
                  <option value="client_note">ملاحظة من العميل</option>
                </select>
                <span className="text-[11px] text-slate-400">
                  {newCommentType === "internal_review"
                    ? "تظهر كمهمة تعديل قابلة للاستيفاء"
                    : "نقاش وتنسيق داخلي"}
                </span>
              </div>

              <div className="flex gap-2">
                <textarea
                  value={newCommentText}
                  onChange={(e) => setNewCommentText(e.target.value)}
                  placeholder="اكتب ملاحظة أو توجيه للمصمم..."
                  rows={2}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-xs resize-none focus:outline-sky-500 bg-white"
                />
                <button
                  type="submit"
                  disabled={!newCommentText.trim() || submittingComment}
                  className="px-4 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white rounded-xl font-bold flex items-center justify-center shrink-0 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Footer Lifecycle Actions */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {/* Start Work (from backlog, ready, or changes_requested) */}
            {(task.status === "backlog" || task.status === "ready") && (
              <button
                type="button"
                onClick={handleStartWork}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-colors"
              >
                <Clock className="w-4 h-4" />
                <span>بدء العمل والمؤقت</span>
              </button>
            )}

            {task.status === "changes_requested" && (
              <button
                type="button"
                onClick={handleStartWork}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                <span>بدء العمل على التعديلات</span>
              </button>
            )}

            {/* Submit for Review (from in_progress or changes_requested) */}
            {(task.status === "in_progress" || task.status === "changes_requested") && (
              <button
                type="button"
                onClick={() => setShowSubmitModal(true)}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-colors"
              >
                <Send className="w-4 h-4" />
                <span>تسليم للمراجعة الداخلية</span>
              </button>
            )}

            {/* Owner Review Bypass (from in_progress ONLY if task is assigned to Workspace Owner) */}
            {task.status === "in_progress" && isTaskAssignedToOwner && (
              <button
                type="button"
                onClick={handleOwnerDirectApprove}
                className="px-3 py-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-300 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>اعتماد مباشر (تجاوز المراجعة للمالك)</span>
              </button>
            )}

            {/* Review Decision Buttons (when internal_review) - strictly guards against self-approval */}
            {canDecideReview && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowDecisionModal("approve")}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-colors"
                >
                  <Check className="w-4 h-4" />
                  <span>اعتماد التصميم ✓</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowDecisionModal("changes")}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-colors"
                >
                  <AlertTriangle className="w-4 h-4" />
                  <span>طلب تعديلات ⚠️</span>
                </button>
              </div>
            )}

            {/* Mark as Delivered (when approved) */}
            {task.status === "approved" && (isOwner || currentUser?.role === "manager") && (
              <button
                type="button"
                onClick={handleMarkDelivered}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>تسليم نهائي للعميل</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-semibold text-xs transition-colors"
          >
            إغلاق
          </button>
        </div>

        {/* Modal: Submit for Review */}
        {showSubmitModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-60 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl text-right animate-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                  <Send className="w-4 h-4 text-purple-600" />
                  تسليم المهمة للمراجعة الداخلية
                </h3>
                <button
                  onClick={() => setShowSubmitModal(false)}
                  className="text-slate-400 hover:text-slate-600 p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-slate-700 text-xs font-semibold mb-1">
                    رابط المعاينة / التصميم *
                  </label>
                  <input
                    type="url"
                    value={deliverableUrl}
                    onChange={(e) => setDeliverableUrl(e.target.value)}
                    placeholder="https://figma.com/file/... أو رابط Drive"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-slate-50 focus:bg-white focus:outline-sky-500 font-mono text-left"
                    dir="ltr"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 text-xs font-semibold mb-1">
                    ملاحظات للمراجع (اختياري)
                  </label>
                  <textarea
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                    placeholder="تم الانتهاء من التصميم وتطبيق الخطاف البصري..."
                    rows={3}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:outline-sky-500 resize-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowSubmitModal(false)}
                  className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-xl text-xs font-semibold"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleSubmitForReview}
                  disabled={submittingReview || !deliverableUrl.trim()}
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-colors"
                >
                  {submittingReview ? "جاري الإرسال..." : "تأكيد التسليم للمراجعة"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Review Decision */}
        {showDecisionModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-60 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl text-right animate-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                  {showDecisionModal === "approve" ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-600" />
                      <span>اعتماد تصميم المهمة</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      <span>طلب تعديلات على التصميم</span>
                    </>
                  )}
                </h3>
                <button
                  onClick={() => setShowDecisionModal(null)}
                  className="text-slate-400 hover:text-slate-600 p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                {showDecisionModal === "changes" ? (
                  <div>
                    <label className="block text-slate-700 text-xs font-semibold mb-1">
                      ملاحظات وتوجيهات التعديل للمصمم * (إلزامي)
                    </label>
                    <textarea
                      value={decisionFeedback}
                      onChange={(e) => setDecisionFeedback(e.target.value)}
                      placeholder="يرجى تعديل تباين النص في الشريحة 2، وتكبير الشعار..."
                      rows={4}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:outline-amber-500 resize-none"
                    />
                  </div>
                ) : (
                  <p className="text-slate-600 text-xs leading-relaxed">
                    هل أنت متأكد من اعتماد التصميم؟ ستتحول حالة المهمة إلى <strong>معتمد</strong> وسيتم إشعار المصمم.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowDecisionModal(null)}
                  className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-xl text-xs font-semibold"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={() => handleDecideReview(showDecisionModal === "approve" ? "approved" : "changes_requested")}
                  disabled={submittingDecision}
                  className={cn(
                    "px-4 py-1.5 text-white rounded-xl text-xs font-bold transition-colors",
                    showDecisionModal === "approve"
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-amber-600 hover:bg-amber-700"
                  )}
                >
                  {submittingDecision
                    ? "جاري الحفظ..."
                    : showDecisionModal === "approve"
                    ? "تأكيد الاعتماد ✓"
                    : "إرسال طلب التعديلات"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
