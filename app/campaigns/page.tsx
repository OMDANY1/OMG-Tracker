"use client";

import React, { useState, useEffect } from "react";
import {
  Calendar,
  FileText,
  Upload,
  Plus,
  Trash2,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  X,
  Layers,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  User,
  Eye,
  CheckCheck,
  Building2,
  Clock,
  HelpCircle,
  Search,
  ChevronDown,
  ChevronUp,
  Sliders,
  Scissors,
  GitMerge,
  ShieldCheck,
  Video,
  Image as ImageIcon,
} from "lucide-react";
import {
  CLIENT_DIFFICULTY_LABELS,
  TASK_STATUS_LABELS,
  cn,
} from "@/lib/utils";
import { ApplyRevisionModal } from "@/components/campaigns/ApplyRevisionModal";

interface ClientCalendarRow {
  client: {
    id: string;
    name: string;
    difficulty: "Easy" | "Medium" | "Hard" | "Unknown";
    owner_roster_id: string | null;
    owner?: { id: string; display_name: string } | null;
  };
  campaign: {
    id: string;
    client_id: string;
    month_key: string;
    revision_number: number;
    calendar_status: string;
    status: string;
    original_file_name: string;
    storage_path: string;
    updated_at: string;
    ai_overall_confidence?: number;
    detected_post_count?: number;
    declared_post_count?: number;
    ai_warnings?: string[];
    processing_error?: string | null;
    ai_model?: string | null;
  } | null;
  postCount: number;
  tasksCreatedCount: number;
  calendarStatus: string;
  lastUpdated: string | null;
  aiConfidence?: number | null;
  detectedPostCount?: number;
}

interface CarouselSlide {
  slide_number: number;
  text: string;
  visual_notes?: string;
}

interface CalendarPostItem {
  id?: string;
  post_order: number;
  post_number: string;
  title: string;
  caption: string;
  brief: string;
  platform: string;
  content_format: string;
  publish_date: string | null;
  design_due_date: string | null;
  notes?: string;
  confidence?: number;
  needs_manual_review?: boolean;
  suggested_assignee_id?: string | null;
  approved_assignee_id?: string | null;
  task_id?: string | null;
  is_included: boolean;
  warning?: string | null;
  // Enhanced AI Pipeline Fields
  on_design_text?: string | null;
  hook?: string | null;
  cta?: string | null;
  reel_script?: string | null;
  slides?: CarouselSlide[];
  is_excluded_from_tasks?: boolean;
  exclusion_reason?: string | null;
  possible_duplicate?: boolean;
  duplicate_of_item_id?: string | null;
  source_pages?: number[];
  content_fingerprint?: string;
}

const PLATFORM_OPTIONS = ["Instagram", "Facebook", "LinkedIn", "TikTok", "X (Twitter)", "Snapchat"];
const FORMAT_OPTIONS = ["Static", "Carousel", "Reel", "Story", "Video", "Motion"];

export default function CampaignsPage() {
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const [calendars, setCalendars] = useState<ClientCalendarRow[]>([]);
  const [allClients, setAllClients] = useState<any[]>([]);
  const [designers, setDesigners] = useState<any[]>([]);
  const [isOwner, setIsOwner] = useState<boolean>(false);
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // AI Consent State
  const [hasGeminiConsent, setHasGeminiConsent] = useState<boolean>(false);
  const [showConsentModal, setShowConsentModal] = useState<boolean>(false);
  const [pendingConsentAction, setPendingConsentAction] = useState<(() => void) | null>(null);

  // Upload Modal & Two-Step Flow State
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [targetClient, setTargetClient] = useState<any>(null);
  const [uploadClientId, setUploadClientId] = useState<string>("");
  const [uploadMonth, setUploadMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState<"idle" | "uploading" | "processing_ai">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Review Matrix Modal State
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewCampaign, setReviewCampaign] = useState<any>(null);
  const [reviewItems, setReviewItems] = useState<CalendarPostItem[]>([]);
  const [reviewPreviewUrl, setReviewPreviewUrl] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);
  const [importingTasks, setImportingTasks] = useState(false);
  const [importSummary, setImportSummary] = useState<any>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [expandedRowIndex, setExpandedRowIndex] = useState<number | null>(null);

  // Diff Modal State
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [diffReport, setDiffReport] = useState<any>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [applyCampaignId, setApplyCampaignId] = useState<string>("");
  const [pollingStatusText, setPollingStatusText] = useState<string>("");

  const handleOpenDiff = async (campaignId: string) => {
    setApplyCampaignId(campaignId);
    setShowDiffModal(true);
    setDiffLoading(true);
    setDiffError(null);
    try {
      const res = await fetch(`/api/campaigns/diff?campaignId=${campaignId}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "فشل تحميل مقارنة التعديلات.");
      }
      setDiffReport(data.report);
    } catch (e: any) {
      setDiffError(e.message || "حدث خطأ أثناء مقارنة التعديلات");
    } finally {
      setDiffLoading(false);
    }
  };

  // Slides Editor Modal
  const [slidesModalIndex, setSlidesModalIndex] = useState<number | null>(null);

  // Manual Add Post Modal
  const [showAddPostModal, setShowAddPostModal] = useState(false);
  const [newPostTitle, setNewPostTitle] = useState("");
  const [newPostNumber, setNewPostNumber] = useState("");
  const [newPostPlatform, setNewPostPlatform] = useState("Instagram");
  const [newPostFormat, setNewPostFormat] = useState("Static");
  const [newPostBrief, setNewPostBrief] = useState("");
  const [newPostCaption, setNewPostCaption] = useState("");
  const [newPostDueDate, setNewPostDueDate] = useState("");
  const [newPostAssignee, setNewPostAssignee] = useState("");

  // Check AI consent on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("omg_gemini_ai_consent");
      if (stored === "true") {
        setHasGeminiConsent(true);
      }
    }
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setApiError(null);
    try {
      // Parallel fetch: /api/clients (canonical 28 clients) & /api/campaigns/calendar (monthly states)
      const [clientsRes, calRes] = await Promise.all([
        fetch("/api/clients"),
        fetch(`/api/campaigns/calendar?monthKey=${selectedMonth}`),
      ]);

      let rawClientsList: any[] = [];
      const calendarsMap = new Map<string, any>();

      // 1. Process /api/clients
      if (clientsRes.ok) {
        const clData = await clientsRes.json();
        if (Array.isArray(clData.clients) && clData.clients.length > 0) {
          rawClientsList = clData.clients;
          setAllClients(clData.clients);
        }
        if (clData.designers) setDesigners(clData.designers);
        if (typeof clData.isOwner === "boolean") setIsOwner(clData.isOwner);
        if (clData.workspaceId) setWorkspaceId(clData.workspaceId);
      } else {
        console.error("Clients API error status:", clientsRes.status);
      }

      // 2. Process /api/campaigns/calendar
      if (calRes.ok) {
        const calData = await calRes.json();
        if (calData.workspaceId) setWorkspaceId(calData.workspaceId);
        if (typeof calData.isOwner === "boolean") setIsOwner(calData.isOwner);
        if (Array.isArray(calData.clientCalendars)) {
          calData.clientCalendars.forEach((row: any) => {
            if (row.client?.id) {
              calendarsMap.set(row.client.id, row);
            }
          });
        }
      } else {
        console.error("Calendar API error status:", calRes.status);
      }

      // If both completely failed, throw error
      if (!clientsRes.ok && !calRes.ok) {
        throw new Error("تعذر الاتصال بالخادم لجلب بيانات العملاء والتقويمات.");
      }

      // 3. Guaranteed Left Join: every client from rawClientsList is represented
      if (rawClientsList.length > 0) {
        const combined: ClientCalendarRow[] = rawClientsList.map((client) => {
          const calRow = calendarsMap.get(client.id);
          if (calRow) {
            return {
              ...calRow,
              client: {
                id: client.id,
                name: client.name,
                difficulty: client.difficulty || "Medium",
                owner_roster_id: client.owner_roster_id,
                owner: client.owner || calRow.client?.owner || null,
                state: client.state,
              },
              aiConfidence: calRow.campaign?.ai_overall_confidence || null,
              detectedPostCount: calRow.campaign?.detected_post_count || calRow.postCount,
            };
          }

          // Left-join fallback: client has no calendar uploaded yet for this month
          return {
            client: {
              id: client.id,
              name: client.name,
              difficulty: client.difficulty || "Medium",
              owner_roster_id: client.owner_roster_id,
              owner: client.owner || null,
              state: client.state,
            },
            campaign: null,
            postCount: 0,
            tasksCreatedCount: 0,
            calendarStatus: "not_uploaded",
            lastUpdated: null,
            aiConfidence: null,
            detectedPostCount: 0,
          };
        });

        setCalendars(combined);
      } else if (calendarsMap.size > 0) {
        const rows = Array.from(calendarsMap.values());
        setCalendars(rows);
        setAllClients(rows.map((r) => r.client));
      } else {
        throw new Error("لم يتم العثور على أي عملاء مسجلين في مساحة العمل.");
      }
    } catch (err: any) {
      console.error("fetchData error:", err);
      setApiError(err.message || "تعذر تحميل بيانات العملاء. يرجى التحقق من الاتصال بالخادم.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedMonth]);

  const changeMonth = (delta: number) => {
    const [yearStr, monthStr] = selectedMonth.split("-");
    let year = parseInt(yearStr, 10);
    let month = parseInt(monthStr, 10) + delta;
    if (month > 12) {
      month = 1;
      year += 1;
    } else if (month < 1) {
      month = 12;
      year -= 1;
    }
    const newMonth = `${year}-${String(month).padStart(2, "0")}`;
    setSelectedMonth(newMonth);
    setUploadMonth(newMonth);
  };

  // Open Upload Modal (with consent check)
  const handleOpenUpload = (client?: any) => {
    const proceed = () => {
      if (client) {
        setTargetClient(client);
        setUploadClientId(client.id);
      } else {
        setTargetClient(null);
        setUploadClientId("");
      }
      setUploadMonth(selectedMonth);
      setUploadFile(null);
      setUploadError(null);
      setUploadStage("idle");
      setShowUploadModal(true);
    };

    if (!hasGeminiConsent) {
      setPendingConsentAction(() => proceed);
      setShowConsentModal(true);
    } else {
      proceed();
    }
  };

  // Submit Decoupled PDF Upload + AI Processing
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || !uploadClientId) {
      setUploadError("يرجى اختيار العميل وتحديد ملف PDF.");
      return;
    }

    if (!uploadFile.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("نوع الملف غير صالح. يرجى اختيار ملف PDF فقط.");
      return;
    }

    if (uploadFile.size > 15 * 1024 * 1024) {
      setUploadError("حجم الملف يتجاوز الحد الأقصى (15 ميجابايت).");
      return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadStage("uploading");

    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("clientId", uploadClientId);
    formData.append("monthKey", uploadMonth || selectedMonth);

    try {
      // Step 1: Fast Storage Upload & Durable Job Enqueue (returns 202 Accepted)
      const uploadRes = await fetch("/api/campaigns/upload", {
        method: "POST",
        body: formData,
      });

      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) {
        throw new Error(uploadData.error || "فشل رفع الملف إلى التخزين.");
      }

      const { campaignId, jobId } = uploadData;
      setUploadStage("processing_ai");
      setPollingStatusText("تم تسجيل المهمة في طابور العمليات الخلفية (Worker Queue)...");

      // Step 2: Poll Durable AI Worker Job Status
      let jobCompleted = false;
      let attemptsCount = 0;
      const maxPollAttempts = 40; // 40 * 2500ms = 100 seconds max

      while (!jobCompleted && attemptsCount < maxPollAttempts) {
        await new Promise((r) => setTimeout(r, 2500));
        attemptsCount++;

        const jobRes = await fetch(`/api/ai/jobs?jobId=${jobId}`);
        if (jobRes.ok) {
          const jobData = await jobRes.json();
          const job = jobData.job;
          if (job) {
            if (job.status === "completed") {
              jobCompleted = true;
              setPollingStatusText("اكتمل استخراج وتقسيم البوستات بنجاح!");
              break;
            } else if (job.status === "failed") {
              throw new Error(job.error_message || "فشلت معالجة التقويم في الخلفية.");
            } else if (job.status === "processing") {
              setPollingStatusText(`جاري التحليل واستخراج البوستات بواسطة الذكاء الاصطناعي... (${attemptsCount})`);
            } else {
              setPollingStatusText("في الانتظار... جاري استلام المهمة من قبل الـWorker...");
            }
          }
        }
      }

      if (!jobCompleted) {
        // If timed out waiting for UI, the job is still safely progressing on server
        setShowUploadModal(false);
        setUploadFile(null);
        setUploadClientId("");
        setTargetClient(null);
        await fetchData();
        alert("المعالجة مستمرة في الخلفية عبر الـWorker. سيظهر التقويم في الجدول بمجرد اكتمال الفحص.");
        return;
      }

      setShowUploadModal(false);
      setUploadFile(null);
      setUploadClientId("");
      setTargetClient(null);

      // Refresh and open Review Matrix
      await fetchData();
      openReviewMatrix(uploadClientId);
    } catch (err: any) {
      setUploadError(err.message || "حدث خطأ أثناء رفع الملف ومعالجته.");
    } finally {
      setUploading(false);
      setUploadStage("idle");
    }
  };

  // Open Review Matrix Modal
  const openReviewMatrix = async (clientId: string) => {
    setReviewLoading(true);
    setShowReviewModal(true);
    setImportSummary(null);
    setImportError(null);
    setShowConfirmation(false);
    setExpandedRowIndex(null);

    try {
      const res = await fetch(`/api/campaigns/calendar?clientId=${clientId}&monthKey=${selectedMonth}`);
      if (res.ok) {
        const data = await res.json();
        setReviewCampaign(data.campaign);
        setReviewItems(data.items || []);
        setReviewPreviewUrl(data.previewUrl || null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setReviewLoading(false);
    }
  };

  // Re-run AI Analysis on Campaign
  const handleReanalyze = async (campaignId: string) => {
    if (!campaignId) return;
    setReanalyzing(true);
    setReanalyzeError(null);
    try {
      const res = await fetch("/api/campaigns/process-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, forceRefresh: true, forceNewAnalysis: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 503 || data.code === "GEMINI_NOT_CONFIGURED") {
          throw new Error("تحليل Gemini غير مهيأ — لم يتم تحليل الملف");
        }
        throw new Error(data.safeMessageAr || data.error || "فشل إعادة تحليل التقويم.");
      }
      await fetchData();
      if (reviewCampaign?.client_id) {
        await openReviewMatrix(reviewCampaign.client_id);
      }
    } catch (err: any) {
      setReanalyzeError(err.message || "فشل التحليل");
    } finally {
      setReanalyzing(false);
    }
  };

  // Toggle item inclusion
  const toggleItemInclude = (index: number) => {
    const updated = [...reviewItems];
    updated[index].is_included = !updated[index].is_included;
    setReviewItems(updated);
  };

  // Select all or deselect all
  const toggleSelectAll = (select: boolean) => {
    setReviewItems((prev) =>
      prev.map((item) => {
        // Excluded non-operational items remain unselected by default
        if (item.is_excluded_from_tasks) return { ...item, is_included: false };
        return { ...item, is_included: select };
      })
    );
  };

  // Update item field locally
  const updateItemField = (index: number, field: keyof CalendarPostItem, value: any) => {
    const updated = [...reviewItems];
    (updated[index] as any)[field] = value;
    setReviewItems(updated);
  };

  // Delete draft item
  const handleDeleteItem = async (index: number) => {
    const item = reviewItems[index];
    if (item.id) {
      try {
        const res = await fetch(`/api/campaigns/items/${item.id}`, { method: "DELETE" });
        if (!res.ok) {
          const err = await res.json();
          alert(`فشل الحذف: ${err.error}`);
          return;
        }
      } catch (e: any) {
        alert(e.message);
        return;
      }
    }
    setReviewItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Soft merge duplicate item with another post
  const handleMergeItem = (sourceIdx: number, targetIdx: number) => {
    const source = reviewItems[sourceIdx];
    const target = reviewItems[targetIdx];
    if (!source || !target) return;

    const mergedCaption = [target.caption, source.caption].filter(Boolean).join("\n\n---\n\n");
    const mergedBrief = [target.brief, source.brief].filter(Boolean).join("\n\n");
    const mergedOnDesign = [target.on_design_text, source.on_design_text].filter(Boolean).join(" | ");

    const updated = [...reviewItems];
    updated[targetIdx] = {
      ...target,
      caption: mergedCaption,
      brief: mergedBrief,
      on_design_text: mergedOnDesign,
    };
    // Mark source as excluded and unincluded
    updated[sourceIdx] = {
      ...source,
      is_included: false,
      is_excluded_from_tasks: true,
      exclusion_reason: `تم الدمج مع ${target.post_number}`,
      possible_duplicate: false,
    };

    setReviewItems(updated);
  };

  // Split post into two posts
  const handleSplitItem = (index: number) => {
    const item = reviewItems[index];
    if (!item) return;

    const postA: CalendarPostItem = {
      ...item,
      post_number: `${item.post_number}A`,
      title: `${item.title} (الجزء 1)`,
      is_included: true,
    };

    const postB: CalendarPostItem = {
      ...item,
      id: undefined,
      post_order: item.post_order + 1,
      post_number: `${item.post_number}B`,
      title: `${item.title} (الجزء 2)`,
      is_included: true,
    };

    const updated = [...reviewItems];
    updated.splice(index, 1, postA, postB);
    setReviewItems(updated);
  };

  // Add manual post item to calendar
  const handleAddManualPost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewCampaign || !newPostTitle) return;

    try {
      const res = await fetch("/api/campaigns/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: reviewCampaign.id,
          clientId: reviewCampaign.client_id,
          postNumber: newPostNumber || `Post ${String(reviewItems.length + 1).padStart(2, "0")}`,
          title: newPostTitle,
          brief: newPostBrief,
          caption: newPostCaption,
          platform: newPostPlatform,
          contentFormat: newPostFormat,
          designDueDate: newPostDueDate || null,
          suggestedAssigneeId: newPostAssignee || reviewCampaign.client?.owner_roster_id || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "فشل إضافة البوست.");
      }

      setReviewItems((prev) => [...prev, data.item]);
      setShowAddPostModal(false);
      setNewPostTitle("");
      setNewPostBrief("");
      setNewPostCaption("");
      setNewPostDueDate("");
      setNewPostNumber("");
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Confirm and batch import tasks
  const handleConfirmImport = async () => {
    if (!reviewCampaign) return;

    const selectedItems = reviewItems.filter((i) => i.is_included && !i.is_excluded_from_tasks);
    if (selectedItems.length === 0) {
      setImportError("يرجى اختيار بوست تشغيلي واحد على الأقل للاعتماد وإنشاء التاسك.");
      return;
    }

    // Validation: Ensure every selected post has an assigned designer
    const unassignedPost = selectedItems.find(
      (item) => !item.approved_assignee_id && !item.suggested_assignee_id && !reviewCampaign.client?.owner_roster_id
    );

    if (unassignedPost) {
      setImportError(`البوست (${unassignedPost.post_number}) ليس له مصمم محدد والعميل غير مسند لمصمم. يرجى اختيار مصمم للبوست قبل المتابعة.`);
      return;
    }

    setImportingTasks(true);
    setImportError(null);
    try {
      const res = await fetch("/api/campaigns/import-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          campaignId: reviewCampaign.id,
          idempotencyKey: `import-${reviewCampaign.id}-${Date.now()}`,
          items: selectedItems,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "فشل اعتماد وتوليد التاسكات.");
      }

      setImportSummary(data.result);
      setShowConfirmation(false);
      setImportError(null);
      fetchData();
      openReviewMatrix(reviewCampaign.client_id);
    } catch (err: any) {
      setImportError(`خطأ أثناء اعتماد التاسكات: ${err.message}`);
    } finally {
      setImportingTasks(false);
    }
  };

  // Stats calculation
  const totalClients = calendars.length;
  const uploadedCount = calendars.filter((c) => c.calendarStatus !== "not_uploaded").length;
  const totalPosts = calendars.reduce((acc, c) => acc + (c.detectedPostCount || c.postCount), 0);
  const totalTasks = calendars.reduce((acc, c) => acc + c.tasksCreatedCount, 0);

  // Filtered calendars by search and status
  const filteredCalendars = calendars.filter((row) => {
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const matchName = row.client.name.toLowerCase().includes(q);
      const matchOwner = row.client.owner?.display_name?.toLowerCase().includes(q);
      if (!matchName && !matchOwner) return false;
    }
    if (statusFilter === "all") return true;
    if (statusFilter === "not_uploaded") return row.calendarStatus === "not_uploaded";
    if (statusFilter === "ready") return row.calendarStatus === "ready" || row.calendarStatus === "uploaded";
    if (statusFilter === "imported") return row.calendarStatus === "imported";
    if (statusFilter === "needs_review") return row.calendarStatus === "needs_review";
    return true;
  });

  return (
    <div className="space-y-6 text-right" dir="rtl">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 flex items-center gap-2.5">
            <Calendar className="w-7 h-7 text-sky-600" />
            تقويم المحتوى الشهري (Content Calendars)
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            إدارة خطط المحتوى الشهرية بصيغة PDF، الفحص البصري التكيفي بالذكاء الاصطناعي (Gemini Flash)، وتوليد مهام التصميم في مساحة عمل الايجنسي
          </p>
        </div>

        {/* Action Controls: Month Selector & Standalone Upload Button */}
        <div className="flex items-center flex-wrap gap-2.5">
          {/* Month Selector */}
          <div className="flex items-center gap-2 bg-surface p-1.5 rounded-2xl border border-slate-200 shadow-xs">
            <button
              onClick={() => changeMonth(1)}
              title="الشهر التالي"
              className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>

            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => {
                setSelectedMonth(e.target.value);
                setUploadMonth(e.target.value);
              }}
              className="px-3 py-1 font-bold text-slate-800 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-sky-500"
            />

            <button
              onClick={() => changeMonth(-1)}
              title="الشهر السابق"
              className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          </div>

          {/* Standalone Primary Upload Button for Owner */}
          {isOwner && (
            <button
              onClick={() => handleOpenUpload(null)}
              className="px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-2xl text-xs font-bold shadow-xs flex items-center gap-2 transition-colors shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>رفع Content Calendar</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="bg-surface p-4 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-slate-400 font-semibold block text-[11px]">إجمالي العملاء</span>
          <span className="text-xl sm:text-2xl font-bold text-slate-900 mt-1 block">{totalClients}</span>
        </div>
        <div className="bg-surface p-4 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-slate-400 font-semibold block text-[11px]">الملفات المرفوعة للشهر</span>
          <span className="text-xl sm:text-2xl font-bold text-sky-600 mt-1 block">
            {uploadedCount} <span className="text-xs text-slate-400 font-normal">/ {totalClients}</span>
          </span>
        </div>
        <div className="bg-surface p-4 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-slate-400 font-semibold block text-[11px]">إجمالي البوستات المستخرجة</span>
          <span className="text-xl sm:text-2xl font-bold text-purple-600 mt-1 block">{totalPosts}</span>
        </div>
        <div className="bg-surface p-4 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-slate-400 font-semibold block text-[11px]">التاسكات المنشأة (انتظار)</span>
          <span className="text-xl sm:text-2xl font-bold text-emerald-600 mt-1 block">{totalTasks}</span>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 text-xs">
        {/* Search Bar */}
        <div className="relative flex-1 max-w-xs">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث عن عميل أو مصمم..."
            className="w-full px-3 py-2 pr-8 text-xs bg-surface border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:outline-none"
          />
          <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
        </div>

        {/* Filter Chips */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setStatusFilter("all")}
            className={cn(
              "px-3 py-1.5 rounded-xl font-bold transition-colors shrink-0",
              statusFilter === "all" ? "bg-sky-600 text-white shadow-xs" : "bg-surface border border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            الكل ({calendars.length})
          </button>
          <button
            onClick={() => setStatusFilter("imported")}
            className={cn(
              "px-3 py-1.5 rounded-xl font-bold transition-colors shrink-0",
              statusFilter === "imported" ? "bg-emerald-600 text-white shadow-xs" : "bg-surface border border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            تم الاستيراد
          </button>
          <button
            onClick={() => setStatusFilter("needs_review")}
            className={cn(
              "px-3 py-1.5 rounded-xl font-bold transition-colors shrink-0",
              statusFilter === "needs_review" ? "bg-purple-600 text-white shadow-xs" : "bg-surface border border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            بانتظار المراجعة
          </button>
          <button
            onClick={() => setStatusFilter("not_uploaded")}
            className={cn(
              "px-3 py-1.5 rounded-xl font-bold transition-colors shrink-0",
              statusFilter === "not_uploaded" ? "bg-slate-700 text-white shadow-xs" : "bg-surface border border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            لم يُرفع بعد
          </button>
        </div>
      </div>

      {/* API Error State */}
      {apiError && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-xs font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{apiError}</span>
          </div>
          <button
            onClick={fetchData}
            className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>إعادة المحاولة</span>
          </button>
        </div>
      )}

      {/* Grid of Client Cards */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-surface p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3 animate-pulse">
              <div className="h-5 bg-slate-100 rounded-md w-1/2" />
              <div className="h-4 bg-slate-100 rounded-md w-3/4" />
              <div className="h-10 bg-slate-100 rounded-xl w-full" />
            </div>
          ))}
        </div>
      ) : filteredCalendars.length === 0 ? (
        <div className="p-12 text-center bg-surface border border-slate-200 rounded-2xl space-y-3">
          <Calendar className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="font-bold text-slate-700 text-sm">لا توجد سجلات تطابق الفلاتر المحددة</h3>
          <p className="text-xs text-slate-400">
            {searchQuery ? "لا يوجد عميل مطابق للبحث" : "لم يتم العثور على عملاء في هذا التصنيف."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredCalendars.map((row) => {
            const hasCampaign = !!row.campaign;
            const status = row.calendarStatus;
            const designerName = row.client.owner?.display_name || "غير مسند";

            return (
              <div
                key={row.client.id}
                className={cn(
                  "bg-surface rounded-2xl border p-5 shadow-xs flex flex-col justify-between transition-all hover:shadow-md",
                  status === "imported" && "border-emerald-200 bg-emerald-50/10",
                  status === "needs_review" && "border-purple-200 bg-purple-50/10",
                  status === "not_uploaded" && "border-slate-200 bg-surface"
                )}
              >
                <div>
                  {/* Top: Client Name & Status Badge */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                        <Building2 className="w-4 h-4 text-slate-400" />
                        {row.client.name}
                      </h3>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                        <span>صعوبة: {(CLIENT_DIFFICULTY_LABELS as Record<string, string>)[row.client.difficulty] || row.client.difficulty}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3 text-slate-400" />
                          {designerName === "غير مسند" ? (
                            <span className="text-amber-600 font-semibold">غير مسند / لم يبدأ</span>
                          ) : (
                            designerName
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <div>
                      {status === "imported" ? (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          تم الاستيراد
                        </span>
                      ) : (status === "failed" || row.campaign?.calendar_status === "failed") ? (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-rose-600" />
                          فشل التحليل
                        </span>
                      ) : status === "needs_review" ? (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200 flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-purple-600" />
                          بانتظار المراجعة
                        </span>
                      ) : status === "uploaded" ? (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800 border border-sky-200">
                          مرفوع
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">
                          لم يُرفع بعد
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Processing Error Notice if failed */}
                  {hasCampaign && row.campaign?.processing_error && (
                    <div className="my-2 p-2 bg-rose-50 border border-rose-200 rounded-xl text-[11px] text-rose-800 flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-600 mt-0.5" />
                      <span className="leading-tight">{row.campaign.processing_error}</span>
                    </div>
                  )}

                  {/* AI Metadata Stats if real confidence is present and posts detected */}
                  {hasCampaign && row.aiConfidence != null && (row.detectedPostCount ?? row.postCount) > 0 && (
                    <div className="my-3 p-2.5 bg-slate-50 rounded-xl border border-slate-100 grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <span className="text-slate-400 block text-[10px]">البوستات المكتشفة:</span>
                        <strong className="text-slate-800 text-xs">{row.detectedPostCount ?? row.postCount} بوست</strong>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">دقة التحليل:</span>
                        <strong className="text-purple-700 text-xs">
                          {`${Math.round(row.aiConfidence * 100)}%`}
                        </strong>
                      </div>
                    </div>
                  )}
                </div>

                {/* Bottom Card Actions */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 mt-2">
                  {hasCampaign ? (
                    <>
                      <button
                        onClick={() => openReviewMatrix(row.client.id)}
                        className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 transition-colors"
                      >
                        <Sliders className="w-3.5 h-3.5" />
                        <span>مصفوفة المراجعة</span>
                      </button>

                      {isOwner && (
                        <button
                          onClick={() => handleOpenUpload(row.client)}
                          title="استبدال أو رفع إصدار جديد"
                          className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-colors flex items-center gap-1"
                        >
                          <Upload className="w-3 h-3" />
                          <span>تحديث</span>
                        </button>
                      )}
                    </>
                  ) : (
                    isOwner && (
                      <button
                        onClick={() => handleOpenUpload(row.client)}
                        className="w-full py-2 bg-slate-100 hover:bg-sky-50 hover:text-sky-700 text-slate-700 rounded-xl text-xs font-bold border border-slate-200 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Upload className="w-3.5 h-3.5 text-sky-600" />
                        <span>رفع تقويم المحتوى (PDF)</span>
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* AI Privacy & Processing Consent Modal */}
      {showConsentModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-surface rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150 text-xs">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-600 shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">موافقة فحص المحتوى بالذكاء الاصطناعي</h3>
                <p className="text-[11px] text-slate-500">Google Gemini Flash Engine</p>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-slate-600">
              يستخدم نظام OMG Workspace نموذج <strong>Google Gemini Flash</strong> لتحليل ملفات Content Calendar بصرياً ودلالياً لاستخراج نصوص التصميم حرفياً، والكابشن، وسلايدز الكاروسيل، واسكريبتات الريلز بدقة متناهية.
            </p>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-600 space-y-1.5">
              <div className="flex items-center gap-1.5 font-bold text-slate-800">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>ضمانات الخصوصية والأمان:</span>
              </div>
              <p>• لا يتم استخدام بيانات عملاء الايجنسي في تدريب النماذج العامة.</p>
              <p>• يتم حفظ النتائج المستخرجة حصرياً في خوادم OMG Creative Workspace الآمنة.</p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setShowConsentModal(false);
                  setPendingConsentAction(null);
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => {
                  localStorage.setItem("omg_gemini_ai_consent", "true");
                  setHasGeminiConsent(true);
                  setShowConsentModal(false);
                  if (pendingConsentAction) {
                    pendingConsentAction();
                    setPendingConsentAction(null);
                  }
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-xs flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>موافق والمتابعة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Modal with Two-Step Status Indicator */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <form
            onSubmit={handleUploadSubmit}
            className="bg-surface rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150 text-xs"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <Upload className="w-4 h-4 text-sky-600" />
                {targetClient ? `رفع تقويم المحتوى — ${targetClient.name}` : "رفع Content Calendar"}
              </h3>
              <button
                type="button"
                disabled={uploading}
                onClick={() => setShowUploadModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5">
              {/* Client Selection */}
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  العميل <span className="text-rose-500">*</span>:
                </label>
                <select
                  value={uploadClientId}
                  disabled={uploading}
                  onChange={(e) => {
                    setUploadClientId(e.target.value);
                    const found = allClients.find((c) => c.id === e.target.value);
                    setTargetClient(found || null);
                  }}
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white font-semibold text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                >
                  <option value="">-- اختر العميل من القائمة ({allClients.length} عميل) --</option>
                  {allClients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.owner?.display_name ? `(${c.owner.display_name})` : "(غير مسند)"} {c.difficulty ? `— صعوبة ${(CLIENT_DIFFICULTY_LABELS as Record<string, string>)[c.difficulty] || c.difficulty}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Month Selection */}
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  الشهر والسنة المستهدفة <span className="text-rose-500">*</span>:
                </label>
                <input
                  type="month"
                  value={uploadMonth}
                  disabled={uploading}
                  onChange={(e) => setUploadMonth(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white font-semibold text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
              </div>

              {/* Assigned Designer Info */}
              {targetClient && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">المصمم المسؤول الحالي:</span>
                  <span className="font-bold text-slate-800">
                    {targetClient.owner?.display_name || (
                      <strong className="text-amber-600 font-semibold">غير مسند (سيطلب تحديد مصمم)</strong>
                    )}
                  </span>
                </div>
              )}

              {uploadError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{uploadError}</span>
                </div>
              )}

              {/* PDF File Input */}
              <div>
                <label className="font-bold text-slate-700 block mb-1.5">
                  ملف تقويم المحتوى الشهري (PDF) <span className="text-rose-500">*</span>:
                </label>
                <div className="border-2 border-dashed border-slate-200 hover:border-sky-400 rounded-2xl p-5 text-center transition-colors bg-slate-50/50">
                  <input
                    type="file"
                    accept="application/pdf"
                    required
                    disabled={uploading}
                    onChange={(e) => {
                      if (e.target.files?.[0]) setUploadFile(e.target.files[0]);
                    }}
                    className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-sky-100 file:text-sky-700 hover:file:bg-sky-200 cursor-pointer"
                  />
                  {uploadFile ? (
                    <div className="mt-3 p-2.5 bg-sky-50 border border-sky-200 rounded-xl text-sky-800 text-[11px] font-semibold flex items-center justify-between">
                      <span className="truncate max-w-[220px] font-bold">{uploadFile.name}</span>
                      <span className="shrink-0 font-mono text-slate-500">
                        {(uploadFile.size / (1024 * 1024)).toFixed(2)} MB
                      </span>
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-400 mt-2">
                      الحد الأقصى 15 ميجابايت. يدعم أي عدد بوستات (1 إلى 100)، والكاروسيل، والريلز.
                    </p>
                  )}
                </div>
              </div>

              {/* Two-stage Loading Indicator */}
              {uploading && (
                <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl space-y-2 animate-pulse">
                  <div className="flex items-center gap-2 text-sky-800 font-bold">
                    <div className="w-3.5 h-3.5 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
                    <span>
                      {uploadStage === "uploading"
                        ? "المرحلة 1: جاري حفظ الملف في التخزين السحابي الآمن..."
                        : (pollingStatusText || "المرحلة 2: جاري تحليل وفحص التقويم بالذكاء الاصطناعي (Gemini Flash)...")}
                    </span>
                  </div>
                  <div className="w-full bg-sky-200 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-sky-600 h-full transition-all duration-500"
                      style={{ width: uploadStage === "uploading" ? "40%" : "85%" }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                disabled={uploading}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={uploading || !uploadClientId || !uploadMonth || !uploadFile}
                className="px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 rounded-xl shadow-xs flex items-center gap-2"
              >
                {uploading ? (
                  <span>جاري المعالجة...</span>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>رفع وتحليل التقويم</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Review Matrix Modal */}
      {showReviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-surface rounded-2xl border border-slate-200 shadow-2xl max-w-6xl w-full p-4 sm:p-6 text-right space-y-4 max-h-[95vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-base sm:text-lg text-slate-900">
                    مراجعة واعتماد خطة المحتوى — {reviewCampaign?.client?.name}
                  </h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                    إصدار #{reviewCampaign?.revision_number || 1}
                  </span>
                  {/* AI Model & Confidence Badge */}
                  {reviewCampaign?.ai_overall_confidence != null && (reviewCampaign?.detected_post_count ?? 0) > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-purple-600" />
                      دقة التحليل: {Math.round(reviewCampaign.ai_overall_confidence * 100)}%
                    </span>
                  )}
                  {reviewCampaign?.detected_post_count && reviewCampaign.detected_post_count > 0 && reviewCampaign?.ai_model ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                      {reviewCampaign.ai_model}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                      لم يتم التحليل بعد
                    </span>
                  )}
                  {/* Detected vs Declared count badge */}
                  {reviewCampaign?.detected_post_count != null && reviewCampaign.detected_post_count > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800 border border-sky-200">
                      البوستات المكتشفة: {reviewCampaign.detected_post_count}
                      {reviewCampaign?.declared_post_count ? ` (المعلن: ${reviewCampaign.declared_post_count})` : ""}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  الشهر: {selectedMonth} • العميل: {reviewCampaign?.client?.name} • المصمم الافتراضي:{" "}
                  <strong>
                    {designers.find((d) => d.id === reviewCampaign?.client?.owner_roster_id)?.display_name || "غير مسند"}
                  </strong>
                </p>
              </div>

              <div className="flex items-center gap-2">
                {isOwner && reviewCampaign?.id && (
                  <button
                    onClick={() => handleReanalyze(reviewCampaign.id)}
                    disabled={reanalyzing}
                    className="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={cn("w-3.5 h-3.5", reanalyzing && "animate-spin")} />
                    <span>{reanalyzing ? "جاري التحليل..." : "إعادة التحليل بالذكاء الاصطناعي"}</span>
                  </button>
                )}

                {reviewCampaign?.id && (
                  <button
                    type="button"
                    onClick={() => handleOpenDiff(reviewCampaign.id)}
                    className="px-3 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                  >
                    <GitMerge className="w-3.5 h-3.5" />
                    <span>مقارنة التعديلات (Diff)</span>
                  </button>
                )}

                {reviewPreviewUrl && (
                  <a
                    href={reviewPreviewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>معاينة PDF</span>
                    <ExternalLink className="w-3 h-3 text-slate-400" />
                  </a>
                )}
                <button
                  onClick={() => setShowReviewModal(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {reviewLoading ? (
              <div className="p-12 text-center space-y-3">
                <div className="w-8 h-8 border-3 border-sky-600 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs font-semibold text-slate-500">جاري تحميل البوستات المستخرجة...</p>
              </div>
            ) : (
              <>
                {/* Notice / Warning Bar */}
                {(reviewCampaign?.processing_error || reanalyzeError) && (
                  <div className="p-3 bg-rose-50 border border-rose-200 text-rose-900 rounded-xl text-xs flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                      <div>
                        <strong>تنبيه التحليل:</strong> {reanalyzeError || reviewCampaign?.processing_error}
                      </div>
                    </div>
                    {isOwner && reviewCampaign?.id && (
                      <button
                        onClick={() => handleReanalyze(reviewCampaign.id)}
                        disabled={reanalyzing}
                        className="px-3 py-1 bg-white hover:bg-rose-100 text-rose-800 border border-rose-300 rounded-lg font-bold text-[11px] shrink-0"
                      >
                        إعادة المحاولة
                      </button>
                    )}
                  </div>
                )}

                {/* Batch Actions Bar */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      onClick={() => toggleSelectAll(true)}
                      className="text-sky-600 hover:text-sky-800 font-bold"
                    >
                      تحديد الكل ({reviewItems.filter((i) => !i.is_excluded_from_tasks).length})
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      onClick={() => toggleSelectAll(false)}
                      className="text-slate-500 hover:text-slate-700 font-bold"
                    >
                      إلغاء التحديد
                    </button>
                    <span className="text-slate-300">|</span>
                    <span className="text-slate-600">
                      المختار:{" "}
                      <strong className="text-slate-900">
                        {reviewItems.filter((i) => i.is_included && !i.is_excluded_from_tasks).length}
                      </strong>{" "}
                      من {reviewItems.filter((i) => !i.is_excluded_from_tasks).length} بوست تشغيلي
                    </span>
                  </div>

                  {isOwner && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowAddPostModal(true)}
                        className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 rounded-xl font-bold flex items-center gap-1 shadow-2xs"
                      >
                        <Plus className="w-3.5 h-3.5 text-sky-600" />
                        إضافة بوست يدوي
                      </button>
                    </div>
                  )}
                </div>

                {/* Items Matrix Table */}
                <div className="flex-1 overflow-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-right text-xs divide-y divide-slate-200">
                    <thead className="bg-slate-100/80 sticky top-0 z-10 text-slate-700 font-bold text-[11px]">
                      <tr>
                        <th className="p-2.5 w-10 text-center">تضمين</th>
                        <th className="p-2.5 w-20">رقم البوست</th>
                        <th className="p-2.5 min-w-44">العنوان / الموضوع</th>
                        <th className="p-2.5 min-w-48">الكابشن (Caption)</th>
                        <th className="p-2.5 min-w-44">توجيه التصميم (Brief)</th>
                        <th className="p-2.5 w-28">المنصة</th>
                        <th className="p-2.5 w-28">النوع والمحتوى</th>
                        <th className="p-2.5 w-32">تاريخ التسليم</th>
                        <th className="p-2.5 w-36">المصمم المسؤول</th>
                        <th className="p-2.5 w-24 text-center">الحالة</th>
                        {isOwner && <th className="p-2.5 w-20 text-center">إجراءات</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {reviewItems.length === 0 ? (
                        <tr>
                          <td colSpan={11} className="p-8 text-center text-slate-400">
                            لا توجد بوستات مستخرجة في هذا التقويم بعد. يمكنك إضافة بوستات يدوياً.
                          </td>
                        </tr>
                      ) : (
                        reviewItems.map((item, idx) => {
                          const hasTask = !!item.task_id;
                          const isExcluded = !!item.is_excluded_from_tasks;
                          const isDuplicate = !!item.possible_duplicate;
                          const currentAssignee =
                            item.approved_assignee_id ||
                            item.suggested_assignee_id ||
                            reviewCampaign?.client?.owner_roster_id ||
                            "";
                          const isExpanded = expandedRowIndex === idx;

                          return (
                            <React.Fragment key={item.id || idx}>
                              <tr
                                className={cn(
                                  "transition-colors hover:bg-slate-50/70",
                                  isExcluded && "bg-slate-100/60 opacity-60",
                                  isDuplicate && "bg-amber-50/50",
                                  !item.is_included && !isExcluded && "opacity-40 bg-slate-50/30"
                                )}
                              >
                                <td className="p-2.5 text-center">
                                  <input
                                    type="checkbox"
                                    checked={item.is_included && !isExcluded}
                                    disabled={isExcluded}
                                    onChange={() => toggleItemInclude(idx)}
                                    className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 cursor-pointer disabled:cursor-not-allowed"
                                  />
                                </td>
                                <td className="p-2.5">
                                  <div className="space-y-1">
                                    <input
                                      type="text"
                                      value={item.post_number}
                                      disabled={!isOwner || isExcluded}
                                      onChange={(e) => updateItemField(idx, "post_number", e.target.value)}
                                      className="w-20 px-2 py-1 border border-slate-200 rounded-lg text-xs font-mono font-bold bg-white"
                                    />
                                    {isDuplicate && (
                                      <span className="block text-[9px] font-bold text-amber-700 bg-amber-100 px-1 py-0.5 rounded">
                                        تكرار محتمل
                                      </span>
                                    )}
                                    {isExcluded && (
                                      <span className="block text-[9px] font-bold text-slate-600 bg-slate-200 px-1 py-0.5 rounded">
                                        {item.exclusion_reason || "قسم مستبعد"}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="p-2.5">
                                  <input
                                    type="text"
                                    value={item.title}
                                    disabled={!isOwner || isExcluded}
                                    onChange={(e) => updateItemField(idx, "title", e.target.value)}
                                    className="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs font-semibold bg-white"
                                  />
                                  {item.on_design_text && (
                                    <div className="mt-1 text-[10px] text-slate-500 bg-slate-50 p-1 rounded border border-slate-100 truncate">
                                      <span className="font-bold text-slate-700">النص على التصميم:</span> {item.on_design_text}
                                    </div>
                                  )}
                                </td>
                                <td className="p-2.5">
                                  <textarea
                                    rows={2}
                                    value={item.caption || ""}
                                    disabled={!isOwner || isExcluded}
                                    onChange={(e) => updateItemField(idx, "caption", e.target.value)}
                                    placeholder="نص البوست..."
                                    className="w-full px-2 py-1 border border-slate-200 rounded-lg text-[11px] bg-white leading-relaxed resize-none"
                                  />
                                </td>
                                <td className="p-2.5">
                                  <textarea
                                    rows={2}
                                    value={item.brief || ""}
                                    disabled={!isOwner || isExcluded}
                                    onChange={(e) => updateItemField(idx, "brief", e.target.value)}
                                    placeholder="توجيه التصميم..."
                                    className="w-full px-2 py-1 border border-slate-200 rounded-lg text-[11px] bg-white leading-relaxed resize-none"
                                  />
                                </td>
                                <td className="p-2.5">
                                  <select
                                    value={item.platform || "Instagram"}
                                    disabled={!isOwner || isExcluded}
                                    onChange={(e) => updateItemField(idx, "platform", e.target.value)}
                                    className="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white"
                                  >
                                    {PLATFORM_OPTIONS.map((p) => (
                                      <option key={p} value={p}>
                                        {p}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="p-2.5">
                                  <div className="space-y-1">
                                    <select
                                      value={item.content_format || "Static"}
                                      disabled={!isOwner || isExcluded}
                                      onChange={(e) => updateItemField(idx, "content_format", e.target.value)}
                                      className="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white"
                                    >
                                      {FORMAT_OPTIONS.map((f) => (
                                        <option key={f} value={f}>
                                          {f}
                                        </option>
                                      ))}
                                    </select>

                                    {/* Action button to expand carousel slides or reel details */}
                                    {item.content_format === "Carousel" && (
                                      <button
                                        type="button"
                                        onClick={() => setSlidesModalIndex(idx)}
                                        className="w-full text-[10px] font-bold px-1.5 py-0.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded border border-purple-200 flex items-center justify-center gap-1"
                                      >
                                        <Layers className="w-3 h-3" />
                                        <span>السلايدز ({item.slides?.length || 0})</span>
                                      </button>
                                    )}

                                    {item.content_format === "Reel" && (
                                      <button
                                        type="button"
                                        onClick={() => setExpandedRowIndex(isExpanded ? null : idx)}
                                        className="w-full text-[10px] font-bold px-1.5 py-0.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded border border-rose-200 flex items-center justify-center gap-1"
                                      >
                                        <Video className="w-3 h-3" />
                                        <span>الاسكريبت والخطاف</span>
                                      </button>
                                    )}
                                  </div>
                                </td>
                                <td className="p-2.5">
                                  <input
                                    type="date"
                                    value={item.design_due_date || ""}
                                    disabled={!isOwner || isExcluded}
                                    onChange={(e) => updateItemField(idx, "design_due_date", e.target.value)}
                                    className="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white"
                                  />
                                </td>
                                <td className="p-2.5">
                                  <select
                                    value={currentAssignee}
                                    disabled={!isOwner || isExcluded}
                                    onChange={(e) => updateItemField(idx, "approved_assignee_id", e.target.value)}
                                    className="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white font-semibold"
                                  >
                                    <option value="">-- اختر المصمم --</option>
                                    {designers.map((d) => (
                                      <option key={d.id} value={d.id}>
                                        {d.display_name}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="p-2.5 text-center">
                                  {hasTask ? (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      {TASK_STATUS_LABELS.backlog}
                                    </span>
                                  ) : isExcluded ? (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500">
                                      مستبعد
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">
                                      مسودة
                                    </span>
                                  )}
                                </td>
                                {isOwner && (
                                  <td className="p-2.5 text-center">
                                    <div className="flex items-center justify-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => setExpandedRowIndex(isExpanded ? null : idx)}
                                        title="عرض وتعديل التفاصيل الإضافية"
                                        className="p-1 text-slate-400 hover:text-sky-600 rounded-lg"
                                      >
                                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                      </button>
                                      {!hasTask && (
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteItem(idx)}
                                          title="حذف هذا البوست من المسودة"
                                          className="p-1 text-slate-400 hover:text-rose-600 rounded-lg"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                )}
                              </tr>

                              {/* Expanded Row for Advanced AI Details (Hook, Script, CTA, On-Design Text) */}
                              {isExpanded && (
                                <tr className="bg-slate-50/80">
                                  <td colSpan={11} className="p-3 border-t border-slate-100">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                                      <div>
                                        <label className="font-bold text-slate-700 block mb-1">النص على التصميم (On-Design Text):</label>
                                        <textarea
                                          rows={2}
                                          value={item.on_design_text || ""}
                                          disabled={!isOwner}
                                          onChange={(e) => updateItemField(idx, "on_design_text", e.target.value)}
                                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl bg-white text-[11px]"
                                        />
                                      </div>
                                      <div>
                                        <label className="font-bold text-slate-700 block mb-1">الخطاف (Hook):</label>
                                        <input
                                          type="text"
                                          value={item.hook || ""}
                                          disabled={!isOwner}
                                          onChange={(e) => updateItemField(idx, "hook", e.target.value)}
                                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl bg-white text-[11px]"
                                          placeholder="أول 3 ثوانٍ لجذب الانتباه..."
                                        />
                                      </div>
                                      <div>
                                        <label className="font-bold text-slate-700 block mb-1">الدعوة للتفاعل (CTA):</label>
                                        <input
                                          type="text"
                                          value={item.cta || ""}
                                          disabled={!isOwner}
                                          onChange={(e) => updateItemField(idx, "cta", e.target.value)}
                                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl bg-white text-[11px]"
                                          placeholder="شاركنا رأيك، احفظ البوست..."
                                        />
                                      </div>
                                      {item.reel_script !== undefined && (
                                        <div className="md:col-span-3">
                                          <label className="font-bold text-slate-700 block mb-1">اسكريبت الريل / الفيديو المشهدي:</label>
                                          <textarea
                                            rows={3}
                                            value={item.reel_script || ""}
                                            disabled={!isOwner}
                                            onChange={(e) => updateItemField(idx, "reel_script", e.target.value)}
                                            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl bg-white text-[11px] leading-relaxed"
                                            placeholder="المشهد 1... المشهد 2..."
                                          />
                                        </div>
                                      )}
                                      <div className="md:col-span-3 flex items-center justify-between pt-1 text-[11px]">
                                        <div className="flex items-center gap-2">
                                          <button
                                            type="button"
                                            onClick={() => handleSplitItem(idx)}
                                            className="px-2.5 py-1 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg font-bold flex items-center gap-1"
                                          >
                                            <Scissors className="w-3 h-3 text-sky-600" />
                                            <span>تقسيم البوست إلى بوستين</span>
                                          </button>
                                          {idx > 0 && (
                                            <button
                                              type="button"
                                              onClick={() => handleMergeItem(idx, idx - 1)}
                                              className="px-2.5 py-1 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg font-bold flex items-center gap-1"
                                            >
                                              <GitMerge className="w-3 h-3 text-purple-600" />
                                              <span>دمج مع البوست السابق ({reviewItems[idx - 1]?.post_number})</span>
                                            </button>
                                          )}
                                        </div>
                                        <span className="text-slate-400">
                                          الصفحات المصدرية: {item.source_pages?.join(", ") || "غير محدد"}
                                        </span>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Dynamic Summary & Task Count Breakdown */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs flex-wrap gap-2">
                  <div className="flex items-center gap-4">
                    <span>
                      إجمالي البوستات التشغيلية المعتمدة:{" "}
                      <strong className="text-slate-900">
                        {reviewItems.filter((i) => i.is_included && !i.is_excluded_from_tasks).length}
                      </strong>
                    </span>
                    <span className="text-slate-300">•</span>
                    <span>
                      تاسكات سيتم إنشاؤها:{" "}
                      <strong className="text-emerald-700">
                        {reviewItems.filter((i) => i.is_included && !i.is_excluded_from_tasks && !i.task_id).length}
                      </strong>
                    </span>
                    <span className="text-slate-300">•</span>
                    <span>
                      أقسام مستبعدة (غلاف/استراتيجية):{" "}
                      <strong className="text-slate-500">
                        {reviewItems.filter((i) => i.is_excluded_from_tasks).length}
                      </strong>
                    </span>
                  </div>
                </div>

                {/* Import Confirmation / Summary Footer */}
                {importSummary && (
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-900 space-y-2 text-xs animate-in zoom-in-95">
                    <div className="font-bold flex items-center gap-1.5 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      تم اعتماد الخطة وتوليد التاسكات بنجاح!
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-[11px] mt-1">
                      <div>
                        <strong>عدد التاسكات المنشأة:</strong> {importSummary.tasks_created} مهمة
                      </div>
                      <div>
                        <strong>حالة التاسك الأولية:</strong> {TASK_STATUS_LABELS.backlog}
                      </div>
                      <div>
                        <strong>الإشعارات المرسلة:</strong> {importSummary.notifications_created} إشعار للمصممين
                      </div>
                    </div>
                  </div>
                )}

                {/* Pre-generation confirmation dialog */}
                {showConfirmation && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 space-y-3 text-xs">
                    <div className="font-bold text-sm flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      تأكيد اعتماد الخطة وإنشاء التاسكات في النظام
                    </div>
                    <p className="text-[11px] leading-relaxed text-amber-800">
                      سيتم تحويل <strong>{reviewItems.filter((i) => i.is_included && !i.is_excluded_from_tasks).length}</strong> بوست مختار إلى
                      تاسكات فعلية بحالة أولية <strong>«{TASK_STATUS_LABELS.backlog}»</strong>، وإرسال إشعارات داخلية
                      للمصممين المسندة إليهم. مهام عماد (المدير العام) لا تتطلب مراجعة داخلية (Review Bypass).
                    </p>

                    {importError && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center gap-2 animate-in fade-in-50">
                        <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                        <span>{importError}</span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => {
                          setShowConfirmation(false);
                          setImportError(null);
                        }}
                        className="px-4 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        إلغاء
                      </button>
                      <button
                        onClick={handleConfirmImport}
                        disabled={importingTasks}
                        className="px-5 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5"
                      >
                        {importingTasks ? "جاري الإنشاء..." : "تأكيد وإنشاء التاسكات"}
                      </button>
                    </div>
                  </div>
                )}

                {importError && !showConfirmation && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center gap-2 animate-in fade-in-50">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <span>{importError}</span>
                  </div>
                )}

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <div className="text-[11px] text-slate-400">
                    * تبدأ جميع التاسكات المنشأة بحالة «{TASK_STATUS_LABELS.backlog}» وفق المعايير الرسمية للايجنسي.
                  </div>

                  {isOwner && (
                    <button
                      onClick={() => {
                        setShowConfirmation(true);
                        setImportError(null);
                      }}
                      disabled={importingTasks || reviewItems.filter((i) => i.is_included && !i.is_excluded_from_tasks).length === 0}
                      className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-2"
                    >
                      <CheckCheck className="w-4 h-4" />
                      <span>
                        اعتماد وإنشاء التاسكات ({reviewItems.filter((i) => i.is_included && !i.is_excluded_from_tasks).length})
                      </span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Carousel Slides Editor Modal */}
      {slidesModalIndex !== null && reviewItems[slidesModalIndex] && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-surface rounded-2xl border border-slate-200 shadow-2xl max-w-xl w-full p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-600" />
                <span>شرائح الكاروسيل ({reviewItems[slidesModalIndex].post_number})</span>
              </h3>
              <button
                type="button"
                onClick={() => setSlidesModalIndex(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-slate-500 text-[11px]">
              تظل جميع شرائح الكاروسيل تابعة لنفس البوست والتاسك الفردي الواحد، ويتم حفظ نصوص كل شريحة للمصمم.
            </p>

            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {(reviewItems[slidesModalIndex].slides || []).map((slide, sIdx) => (
                <div key={sIdx} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between font-bold text-slate-800">
                    <span>الشريحة #{slide.slide_number}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const updatedSlides = (reviewItems[slidesModalIndex!].slides || []).filter((_, idx) => idx !== sIdx);
                        updateItemField(slidesModalIndex!, "slides", updatedSlides);
                      }}
                      className="text-rose-500 hover:text-rose-700 p-1"
                      title="حذف الشريحة"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={slide.text}
                    onChange={(e) => {
                      const updatedSlides = [...(reviewItems[slidesModalIndex!].slides || [])];
                      updatedSlides[sIdx] = { ...updatedSlides[sIdx], text: e.target.value };
                      updateItemField(slidesModalIndex!, "slides", updatedSlides);
                    }}
                    placeholder="نص الشريحة..."
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white text-xs"
                  />
                  <input
                    type="text"
                    value={slide.visual_notes || ""}
                    onChange={(e) => {
                      const updatedSlides = [...(reviewItems[slidesModalIndex!].slides || [])];
                      updatedSlides[sIdx] = { ...updatedSlides[sIdx], visual_notes: e.target.value };
                      updateItemField(slidesModalIndex!, "slides", updatedSlides);
                    }}
                    placeholder="ملاحظات الصورة أو التوجيه البصري..."
                    className="w-full px-2.5 py-1 border border-slate-200 rounded-lg bg-white text-[11px] text-slate-500"
                  />
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                const currentSlides = reviewItems[slidesModalIndex!].slides || [];
                const nextSlideNum = currentSlides.length + 1;
                const updatedSlides = [...currentSlides, { slide_number: nextSlideNum, text: "", visual_notes: "" }];
                updateItemField(slidesModalIndex!, "slides", updatedSlides);
              }}
              className="w-full py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-xl font-bold border border-purple-200 flex items-center justify-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة شريحة جديدة للكاروسيل</span>
            </button>

            <div className="pt-2 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setSlidesModalIndex(null)}
                className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold"
              >
                حفظ وإغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add Manual Post */}
      {showAddPostModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <form
            onSubmit={handleAddManualPost}
            className="bg-surface rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150 text-xs"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <Plus className="w-4 h-4 text-sky-600" />
                إضافة بوست جديد إلى الخطة
              </h3>
              <button
                type="button"
                onClick={() => setShowAddPostModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">رقم البوست (مثال: Post 05):</label>
                  <input
                    type="text"
                    value={newPostNumber}
                    onChange={(e) => setNewPostNumber(e.target.value)}
                    placeholder="Post 01"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">المصمم المسؤول:</label>
                  <select
                    value={newPostAssignee}
                    onChange={(e) => setNewPostAssignee(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white font-semibold"
                  >
                    <option value="">-- اختر المصمم --</option>
                    {designers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.display_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">العنوان / فكرة البوست:</label>
                <input
                  type="text"
                  required
                  value={newPostTitle}
                  onChange={(e) => setNewPostTitle(e.target.value)}
                  placeholder="مثال: إطلاق الميزة الجديدة..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">المنصة:</label>
                  <select
                    value={newPostPlatform}
                    onChange={(e) => setNewPostPlatform(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white"
                  >
                    {PLATFORM_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">نوع المخرج:</label>
                  <select
                    value={newPostFormat}
                    onChange={(e) => setNewPostFormat(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white"
                  >
                    {FORMAT_OPTIONS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">تاريخ التسليم:</label>
                  <input
                    type="date"
                    value={newPostDueDate}
                    onChange={(e) => setNewPostDueDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">الكابشن (Caption):</label>
                <textarea
                  rows={2}
                  value={newPostCaption}
                  onChange={(e) => setNewPostCaption(e.target.value)}
                  placeholder="نص المنشور المقرر..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl resize-none"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">توجيه التصميم (Design Brief):</label>
                <textarea
                  rows={2}
                  value={newPostBrief}
                  onChange={(e) => setNewPostBrief(e.target.value)}
                  placeholder="ملاحظات وتوجيهات للمصمم..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl resize-none"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowAddPostModal(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-bold shadow-xs"
              >
                إضافة البوست
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Diff Preview Modal */}
      {showDiffModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-surface rounded-2xl border border-slate-200 shadow-2xl max-w-4xl w-full p-4 sm:p-6 text-right space-y-4 max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-150 text-xs">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="space-y-0.5">
                <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                  <GitMerge className="w-4 h-4 text-sky-600" />
                  مقارنة التعديلات بين الإصدارات (Calendar Revision Diff Engine)
                </h3>
                <p className="text-[11px] text-slate-500">
                  فحص الفروقات بين التقويم الحالي والإصدار السابق مع حماية المهام قيد التنفيذ
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDiffModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto space-y-4">
              {diffLoading ? (
                <div className="text-center py-12 text-slate-400">جاري احتساب الفروقات بين التعديلات...</div>
              ) : diffError ? (
                <div className="p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl">
                  {diffError}
                </div>
              ) : diffReport ? (
                <div className="space-y-4">
                  {/* Summary Badges Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                      <span className="text-emerald-800 block text-[10px] font-bold">بوستات جديدة مضافة:</span>
                      <strong className="text-lg text-emerald-700 font-bold">+{diffReport.summary.addedCount}</strong>
                    </div>
                    <div className="p-3 bg-rose-50 rounded-xl border border-rose-200">
                      <span className="text-rose-800 block text-[10px] font-bold">بوستات تم حذفها:</span>
                      <strong className="text-lg text-rose-700 font-bold">-{diffReport.summary.removedCount}</strong>
                    </div>
                    <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
                      <span className="text-amber-800 block text-[10px] font-bold">بوستات تم تعديلها:</span>
                      <strong className="text-lg text-amber-700 font-bold">{diffReport.summary.changedCount}</strong>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                      <span className="text-slate-500 block text-[10px] font-bold">بوستات متطابقة:</span>
                      <strong className="text-lg text-slate-700 font-bold">{diffReport.summary.unchangedCount}</strong>
                    </div>
                  </div>

                  {/* Active Tasks Protection Warning */}
                  {diffReport.summary.activeTasksAtRiskCount > 0 && (
                    <div className="p-4 bg-amber-50/90 border border-amber-300 rounded-xl text-amber-950 space-y-1">
                      <div className="font-bold text-xs flex items-center gap-1.5 text-amber-900">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>تنبيه حماية المهام النشطة (In-Progress Protection Guard):</span>
                      </div>
                      <p className="text-[11px] leading-relaxed">
                        يوجد <strong>{diffReport.summary.activeTasksAtRiskCount}</strong> مهمة سابقة قيد التنفيذ أو المراجعة مرتبطة ببوستات تم تعديلها أو حذفها في هذا الإصدار.
                        لحماية جهود المصممين، <strong>يمنع النظام الحذف الآلي أو الكتابة فوق المهام الجارية</strong>، وتبقى هذه المهام محفوظة في النظام مع ربط الإصدار الجديد.
                      </p>
                    </div>
                  )}

                  {/* Diff Items List */}
                  <div className="space-y-2">
                    <div className="font-bold text-slate-800 text-xs">تفاصيل البوستات المقارنة:</div>
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                      {diffReport.items.map((item: any, idx: number) => (
                        <div key={idx} className="p-3 bg-white hover:bg-slate-50/60 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "px-2 py-0.5 rounded text-[10px] font-bold",
                                  item.status === "added"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : item.status === "removed"
                                    ? "bg-rose-100 text-rose-800"
                                    : item.status === "changed"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-slate-100 text-slate-600"
                                )}
                              >
                                {item.status === "added"
                                  ? "بوست جديد (+)"
                                  : item.status === "removed"
                                  ? "محذوف (-)"
                                  : item.status === "changed"
                                  ? "معدل"
                                  : "مطابق"}
                              </span>
                              <span className="font-bold text-slate-800">{item.postNumber}</span>
                              <span className="text-slate-600 font-medium">— {item.title}</span>
                            </div>

                            {item.existingTask && (
                              <span className="text-[10px] px-2 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200 font-semibold">
                                تاسك مرتبط: {item.existingTask.status} ({item.existingTask.assigneeName || "المصمم"})
                              </span>
                            )}
                          </div>

                          {/* Changed Fields breakdown */}
                          {item.changes && item.changes.length > 0 && (
                            <div className="pr-4 space-y-1 bg-amber-50/40 p-2 rounded-lg border border-amber-100 text-[11px]">
                              {item.changes.map((ch: any, cIdx: number) => (
                                <div key={cIdx} className="grid grid-cols-1 sm:grid-cols-3 gap-1">
                                  <span className="font-bold text-slate-700">{ch.labelAr}:</span>
                                  <span className="text-rose-600 line-through text-[10px] break-words">
                                    {String(ch.oldValue || "فارغ")}
                                  </span>
                                  <span className="text-emerald-700 font-semibold text-[10px] break-words">
                                    ← {String(ch.newValue || "فارغ")}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Footer */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowDiffModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs"
              >
                إغلاق
              </button>

              {isOwner && diffReport && (
                <button
                  type="button"
                  onClick={() => setShowApplyModal(true)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition-all"
                >
                  <GitMerge className="w-3.5 h-3.5" />
                  <span>اعتماد وتطبيق التعديلات (Safe Apply)</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Apply Revision Modal */}
      <ApplyRevisionModal
        isOpen={showApplyModal}
        onClose={() => setShowApplyModal(false)}
        diffReport={diffReport}
        campaignId={applyCampaignId}
        onSuccess={async () => {
          setShowDiffModal(false);
          await fetchData();
          if (reviewCampaign?.client_id) {
            await openReviewMatrix(reviewCampaign.client_id);
          }
        }}
      />
    </div>
  );
}
