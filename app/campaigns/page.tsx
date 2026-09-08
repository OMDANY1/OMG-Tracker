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
} from "lucide-react";
import {
  CLIENT_DIFFICULTY_LABELS,
  TASK_STATUS_LABELS,
  cn,
} from "@/lib/utils";

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
  } | null;
  postCount: number;
  tasksCreatedCount: number;
  calendarStatus: string;
  lastUpdated: string | null;
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

  // Upload Modal State
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [targetClient, setTargetClient] = useState<any>(null);
  const [uploadClientId, setUploadClientId] = useState<string>("");
  const [uploadMonth, setUploadMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Review Matrix Modal State
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewCampaign, setReviewCampaign] = useState<any>(null);
  const [reviewItems, setReviewItems] = useState<CalendarPostItem[]>([]);
  const [reviewPreviewUrl, setReviewPreviewUrl] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [importingTasks, setImportingTasks] = useState(false);
  const [importSummary, setImportSummary] = useState<any>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);

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
          };
        });

        setCalendars(combined);
      } else if (calendarsMap.size > 0) {
        // Fallback in case clients route was empty but calendars was populated
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

  // Open Upload Modal (either with a pre-selected client or empty for standalone button)
  const handleOpenUpload = (client?: any) => {
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
    setShowUploadModal(true);
  };

  // Submit PDF Upload
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

    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("clientId", uploadClientId);
    formData.append("monthKey", uploadMonth || selectedMonth);

    try {
      const res = await fetch("/api/campaigns/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "فشل رفع الملف ومعالجته.");
      }

      setShowUploadModal(false);
      setUploadFile(null);
      setUploadClientId("");
      setTargetClient(null);

      // Refresh data to update client card
      await fetchData();

      // Automatically open review matrix
      openReviewMatrix(uploadClientId);
    } catch (err: any) {
      setUploadError(err.message || "حدث خطأ أثناء رفع الملف.");
    } finally {
      setUploading(false);
    }
  };

  // Open Review Matrix Modal
  const openReviewMatrix = async (clientId: string) => {
    setReviewLoading(true);
    setShowReviewModal(true);
    setImportSummary(null);
    setShowConfirmation(false);

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

  // Toggle item inclusion
  const toggleItemInclude = (index: number) => {
    const updated = [...reviewItems];
    updated[index].is_included = !updated[index].is_included;
    setReviewItems(updated);
  };

  // Select all or deselect all
  const toggleSelectAll = (select: boolean) => {
    setReviewItems((prev) => prev.map((item) => ({ ...item, is_included: select })));
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

    const selectedItems = reviewItems.filter((i) => i.is_included);
    if (selectedItems.length === 0) {
      alert("يرجى اختيار بوست واحد على الأقل للاعتماد وإنشاء التاسك.");
      return;
    }

    // Validation: Ensure every selected post has an assigned designer
    const unassignedPost = selectedItems.find(
      (item) => !item.approved_assignee_id && !item.suggested_assignee_id && !reviewCampaign.client?.owner_roster_id
    );

    if (unassignedPost) {
      alert(`البوست (${unassignedPost.post_number}) ليس له مصمم محدد والعميل غير مسند لمصمم. يرجى اختيار مصمم للبوست قبل المتابعة.`);
      return;
    }

    setImportingTasks(true);
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
      fetchData();
      openReviewMatrix(reviewCampaign.client_id);
    } catch (err: any) {
      alert(`خطأ: ${err.message}`);
    } finally {
      setImportingTasks(false);
    }
  };

  // Stats calculation
  const totalClients = calendars.length;
  const uploadedCount = calendars.filter((c) => c.calendarStatus !== "not_uploaded").length;
  const totalPosts = calendars.reduce((acc, c) => acc + c.postCount, 0);
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
            إدارة خطط المحتوى الشهرية بصيغة PDF، مراجعة البوستات، وتوليد مهام التصميم في مساحة عمل الايجنسي
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
            تم استيراد التاسكات ({calendars.filter((c) => c.calendarStatus === "imported").length})
          </button>
          <button
            onClick={() => setStatusFilter("ready")}
            className={cn(
              "px-3 py-1.5 rounded-xl font-bold transition-colors shrink-0",
              statusFilter === "ready" ? "bg-sky-600 text-white shadow-xs" : "bg-surface border border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            جاهز للاعتماد ({calendars.filter((c) => c.calendarStatus === "ready" || c.calendarStatus === "uploaded").length})
          </button>
          <button
            onClick={() => setStatusFilter("needs_review")}
            className={cn(
              "px-3 py-1.5 rounded-xl font-bold transition-colors shrink-0",
              statusFilter === "needs_review" ? "bg-amber-600 text-white shadow-xs" : "bg-surface border border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            يحتاج مراجعة / مسح ضوئي ({calendars.filter((c) => c.calendarStatus === "needs_review").length})
          </button>
          <button
            onClick={() => setStatusFilter("not_uploaded")}
            className={cn(
              "px-3 py-1.5 rounded-xl font-bold transition-colors shrink-0",
              statusFilter === "not_uploaded" ? "bg-slate-700 text-white shadow-xs" : "bg-surface border border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            لم يُرفع بعد ({calendars.filter((c) => c.calendarStatus === "not_uploaded").length})
          </button>
        </div>
      </div>

      {/* Client Calendars Grid or State Notices */}
      {loading ? (
        <div className="p-12 text-center bg-surface rounded-2xl border border-slate-200">
          <div className="w-8 h-8 border-3 border-sky-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-500 font-semibold mt-3">جاري تحميل العملاء والتقويمات...</p>
        </div>
      ) : apiError ? (
        <div className="p-12 text-center bg-surface rounded-2xl border border-rose-200 bg-rose-50/40 space-y-3">
          <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto" />
          <h3 className="font-bold text-slate-800 text-sm">تعذر تحميل بيانات العملاء</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">{apiError}</p>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs inline-flex items-center gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>إعادة المحاولة</span>
          </button>
        </div>
      ) : filteredCalendars.length === 0 ? (
        <div className="p-12 text-center bg-surface rounded-2xl border border-slate-200 space-y-2">
          <Building2 className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="font-bold text-slate-700 text-sm">
            {searchQuery ? "لا يوجد عميل مطابق للبحث" : "لا توجد سجلات تطابق الفلتر المحدد"}
          </h3>
          <p className="text-xs text-slate-400">اختر فلتراً آخر أو غيّر عبارة البحث للاستعراض.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCalendars.map((row) => {
            const { client, campaign, postCount, tasksCreatedCount, calendarStatus } = row;
            const hasCampaign = !!campaign;
            const isImported = calendarStatus === "imported";

            let statusBadge = (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                لم يُرفع بعد
              </span>
            );

            if (calendarStatus === "imported") {
              statusBadge = (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  تم استيراد المهام
                </span>
              );
            } else if (calendarStatus === "ready" || calendarStatus === "uploaded") {
              statusBadge = (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  جاهز للاعتماد
                </span>
              );
            } else if (calendarStatus === "needs_review") {
              statusBadge = (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  يحتاج مراجعة
                </span>
              );
            }

            return (
              <div
                key={client.id}
                className="bg-surface rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-sky-300 hover:shadow-sm transition-all flex flex-col justify-between text-xs space-y-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-base text-slate-900">{client.name}</h3>
                        {client.name === "zanzi" && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                            غير مسند / لم يبدأ
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-[11px] text-slate-500 flex items-center gap-1">
                          <User className="w-3 h-3 text-slate-400" />
                          {client.owner?.display_name || (
                            <strong className="text-amber-600">غير مسند</strong>
                          )}
                        </span>
                        <span className="text-slate-300">•</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 font-semibold">
                          صعوبة {CLIENT_DIFFICULTY_LABELS[client.difficulty] || "عادي"}
                        </span>
                        <span className="text-slate-300">•</span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {selectedMonth}
                        </span>
                      </div>
                    </div>
                    {statusBadge}
                  </div>

                  {/* Calendar details */}
                  <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-slate-400 block">البوستات المستخرجة:</span>
                      <span className="font-bold text-slate-800 text-xs">
                        {postCount > 0 ? `${postCount} بوست` : "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">التاسكات المنشأة:</span>
                      <span className="font-bold text-emerald-700 text-xs">
                        {tasksCreatedCount > 0 ? `${tasksCreatedCount} تاسك` : "0"}
                      </span>
                    </div>
                  </div>

                  {hasCampaign && (
                    <div className="mt-2 text-[10px] text-slate-400 flex items-center justify-between">
                      <span>إصدار #{campaign.revision_number}</span>
                      <span>
                        {new Date(campaign.updated_at).toLocaleDateString("ar-EG", {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  {hasCampaign ? (
                    <div className="flex items-center gap-1.5 w-full">
                      <button
                        onClick={() => openReviewMatrix(client.id)}
                        className="flex-1 py-2 px-3 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-colors text-xs"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        {isOwner ? (isImported ? "استعراض البوستات" : "مراجعة واعتماد") : "استعراض الخطة"}
                      </button>

                      {isOwner && (
                        <button
                          onClick={() => handleOpenUpload(client)}
                          title="استبدال بإصدار أحدث (Revision جديد)"
                          className="p-2 text-slate-400 hover:text-sky-600 hover:bg-slate-100 rounded-xl transition-colors shrink-0"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ) : (
                    isOwner ? (
                      <button
                        onClick={() => handleOpenUpload(client)}
                        className="w-full py-2 px-3 bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-bold flex items-center justify-center gap-1.5 transition-colors text-xs shadow-xs"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        رفع تقويم PDF
                      </button>
                    ) : (
                      <span className="text-slate-400 text-[11px] italic">لم يُرفع تقويم لهذا الشهر بعد</span>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload / Replace PDF Modal / Wizard */}
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
                onClick={() => setShowUploadModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5">
              {/* Client Selection (Mandatory Dropdown of all 28 clients) */}
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  العميل <span className="text-rose-500">*</span>:
                </label>
                <select
                  value={uploadClientId}
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
                      الحد الأقصى 15 ميجابايت. يُفضل ملف PDF نصي للحصول على استخراج تلقائي للبوستات.
                    </p>
                  )}
                </div>
              </div>
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
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>جاري الرفع والمعالجة...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>رفع ومعالجة الملف</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Review Screen Matrix Modal */}
      {showReviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-surface rounded-2xl border border-slate-200 shadow-2xl max-w-6xl w-full p-4 sm:p-6 text-right space-y-4 max-h-[95vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-base sm:text-lg text-slate-900">
                    مراجعة واعتماد خطة المحتوى — {reviewCampaign?.client?.name}
                  </h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                    إصدار #{reviewCampaign?.revision_number || 1}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  الشهر: {selectedMonth} • العميل: {reviewCampaign?.client?.name} • المصمم الافتراضي:{" "}
                  <strong>
                    {designers.find((d) => d.id === reviewCampaign?.client?.owner_roster_id)?.display_name || "غير مسند"}
                  </strong>
                </p>
              </div>

              <div className="flex items-center gap-2">
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
                {reviewCampaign?.processing_error && (
                  <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl text-xs flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                    <div>
                      <strong>تنبيه الاستخراج:</strong> {reviewCampaign.processing_error}
                    </div>
                  </div>
                )}

                {/* Batch Actions Bar */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => toggleSelectAll(true)}
                      className="text-sky-600 hover:text-sky-800 font-bold"
                    >
                      تحديد الكل ({reviewItems.length})
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
                        {reviewItems.filter((i) => i.is_included).length}
                      </strong>{" "}
                      من {reviewItems.length} بوست
                    </span>
                  </div>

                  {isOwner && (
                    <button
                      onClick={() => setShowAddPostModal(true)}
                      className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 rounded-xl font-bold flex items-center gap-1 shadow-2xs"
                    >
                      <Plus className="w-3.5 h-3.5 text-sky-600" />
                      إضافة بوست يدوي
                    </button>
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
                        <th className="p-2.5 w-24">النوع</th>
                        <th className="p-2.5 w-32">تاريخ التسليم</th>
                        <th className="p-2.5 w-36">المصمم المسؤول</th>
                        <th className="p-2.5 w-24 text-center">الحالة</th>
                        {isOwner && <th className="p-2.5 w-12 text-center">إجراء</th>}
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
                          const currentAssignee =
                            item.approved_assignee_id ||
                            item.suggested_assignee_id ||
                            reviewCampaign?.client?.owner_roster_id ||
                            "";

                          return (
                            <tr
                              key={item.id || idx}
                              className={cn(
                                "transition-colors hover:bg-slate-50/70",
                                !item.is_included && "opacity-40 bg-slate-50/30"
                              )}
                            >
                              <td className="p-2.5 text-center">
                                <input
                                  type="checkbox"
                                  checked={item.is_included}
                                  onChange={() => toggleItemInclude(idx)}
                                  className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 cursor-pointer"
                                />
                              </td>
                              <td className="p-2.5">
                                <input
                                  type="text"
                                  value={item.post_number}
                                  disabled={!isOwner}
                                  onChange={(e) => updateItemField(idx, "post_number", e.target.value)}
                                  className="w-20 px-2 py-1 border border-slate-200 rounded-lg text-xs font-mono font-bold bg-white"
                                />
                              </td>
                              <td className="p-2.5">
                                <input
                                  type="text"
                                  value={item.title}
                                  disabled={!isOwner}
                                  onChange={(e) => updateItemField(idx, "title", e.target.value)}
                                  className="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs font-semibold bg-white"
                                />
                              </td>
                              <td className="p-2.5">
                                <textarea
                                  rows={2}
                                  value={item.caption || ""}
                                  disabled={!isOwner}
                                  onChange={(e) => updateItemField(idx, "caption", e.target.value)}
                                  placeholder="نص البوست..."
                                  className="w-full px-2 py-1 border border-slate-200 rounded-lg text-[11px] bg-white leading-relaxed resize-none"
                                />
                              </td>
                              <td className="p-2.5">
                                <textarea
                                  rows={2}
                                  value={item.brief || ""}
                                  disabled={!isOwner}
                                  onChange={(e) => updateItemField(idx, "brief", e.target.value)}
                                  placeholder="توجيه التصميم..."
                                  className="w-full px-2 py-1 border border-slate-200 rounded-lg text-[11px] bg-white leading-relaxed resize-none"
                                />
                              </td>
                              <td className="p-2.5">
                                <select
                                  value={item.platform || "Instagram"}
                                  disabled={!isOwner}
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
                                <select
                                  value={item.content_format || "Static"}
                                  disabled={!isOwner}
                                  onChange={(e) => updateItemField(idx, "content_format", e.target.value)}
                                  className="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white"
                                >
                                  {FORMAT_OPTIONS.map((f) => (
                                    <option key={f} value={f}>
                                      {f}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="p-2.5">
                                <input
                                  type="date"
                                  value={item.design_due_date || ""}
                                  disabled={!isOwner}
                                  onChange={(e) => updateItemField(idx, "design_due_date", e.target.value)}
                                  className="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white"
                                />
                              </td>
                              <td className="p-2.5">
                                <select
                                  value={currentAssignee}
                                  disabled={!isOwner}
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
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">
                                    مسودة
                                  </span>
                                )}
                              </td>
                              {isOwner && (
                                <td className="p-2.5 text-center">
                                  {!hasTask && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteItem(idx)}
                                      title="حذف هذا البوست من المسودة"
                                      className="p-1 text-slate-400 hover:text-rose-600 rounded-lg"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
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
                      سيتم تحويل <strong>{reviewItems.filter((i) => i.is_included).length}</strong> بوست مختار إلى
                      تاسكات فعلية بحالة أولية <strong>«{TASK_STATUS_LABELS.backlog}»</strong>، وإرسال إشعارات داخلية
                      للمصممين المسندة إليهم. مهام عماد (المدير العام) لا تتطلب مراجعة داخلية (Review Bypass).
                    </p>
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => setShowConfirmation(false)}
                        className="px-4 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        إلغاء
                      </button>
                      <button
                        onClick={handleConfirmImport}
                        disabled={importingTasks}
                        className="px-5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5"
                      >
                        {importingTasks ? "جاري الإنشاء..." : "تأكيد وإنشاء التاسكات"}
                      </button>
                    </div>
                  </div>
                )}

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <div className="text-[11px] text-slate-400">
                    * تبدأ جميع التاسكات المنشأة بحالة «{TASK_STATUS_LABELS.backlog}» وفق المعايير الرسمية للايجنسي.
                  </div>

                  {isOwner && (
                    <button
                      onClick={() => setShowConfirmation(true)}
                      disabled={importingTasks || reviewItems.filter((i) => i.is_included).length === 0}
                      className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-2"
                    >
                      <CheckCheck className="w-4 h-4" />
                      <span>
                        اعتماد وإنشاء التاسكات ({reviewItems.filter((i) => i.is_included).length})
                      </span>
                    </button>
                  )}
                </div>
              </>
            )}
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
    </div>
  );
}
