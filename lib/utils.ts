import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type {
  TaskStatus,
  TimeCategory,
  TaskPriority,
  ClientDifficulty,
  ClientExtraWorkload,
  RosterRole,
} from "@/types/database";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "قائمة الانتظار",
  ready: "جاهز للتنفيذ",
  in_progress: "قيد التنفيذ",
  internal_review: "مراجعة داخلية",
  changes_requested: "مطلوب تعديل",
  client_review: "مراجعة العميل",
  approved: "معتمد",
  delivered: "تم التسليم",
  blocked: "متوقف بسبب عائق",
  cancelled: "ملغي",
};

export const TASK_STATUS_COLORS: Record<TaskStatus, { bg: string; text: string; border: string }> = {
  backlog: { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-300" },
  ready: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  in_progress: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-300" },
  internal_review: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
  changes_requested: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-300" },
  client_review: { bg: "bg-cyan-50", text: "text-cyan-700", border: "border-cyan-200" },
  approved: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-300" },
  delivered: { bg: "bg-teal-50", text: "text-teal-800", border: "border-teal-300" },
  blocked: { bg: "bg-red-50", text: "text-red-700", border: "border-red-300" },
  cancelled: { bg: "bg-gray-100", text: "text-gray-500", border: "border-gray-300" },
};

export const TIME_CATEGORY_LABELS: Record<TimeCategory, string> = {
  research_references: "بحث ومراجع إلهام",
  initial_design: "التصميم المبدئي",
  internal_revision: "تعديلات داخلية",
  client_revision: "تعديلات العميل",
  final_preparation_export: "تجهيز وتصدير نهائي",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  Low: "منخفضة",
  Normal: "عادية",
  High: "عالية",
  Urgent: "عاجلة",
};

export const TASK_PRIORITY_COLORS: Record<TaskPriority, { bg: string; text: string }> = {
  Low: { bg: "bg-slate-100", text: "text-slate-600" },
  Normal: { bg: "bg-blue-100", text: "text-blue-700" },
  High: { bg: "bg-amber-100", text: "text-amber-800" },
  Urgent: { bg: "bg-rose-100", text: "text-rose-700" },
};

export const CLIENT_DIFFICULTY_LABELS: Record<ClientDifficulty, string> = {
  Easy: "سهل",
  Medium: "متوسط",
  Hard: "صعب",
  Unknown: "غير محدد",
};

export const CLIENT_EXTRA_WORKLOAD_LABELS: Record<ClientExtraWorkload, string> = {
  None: "طبيعي",
  "Many requests": "طلبات كثيرة",
  "Many revisions": "تعديلات متكررة",
  Unknown: "غير محدد",
};

export const ROSTER_ROLE_LABELS: Record<RosterRole, string> = {
  owner: "المدير العام (Owner)",
  manager: "مدير الفريق (Manager)",
  senior_reviewer: "مراجع أول (Senior Reviewer)",
  designer: "مصمم (Designer)",
};

export function formatDurationSeconds(seconds: number): string {
  if (!seconds || seconds <= 0) return "0 د";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0 && minutes > 0) {
    return `${hours} س ${minutes} د`;
  } else if (hours > 0) {
    return `${hours} س`;
  } else {
    return `${minutes} د`;
  }
}

export function formatMinutes(minutes: number): string {
  return formatDurationSeconds(minutes * 60);
}

/**
 * Sanitizes CSV cell content against spreadsheet formula injection (=, +, -, @)
 * and properly escapes quotes and delimiters.
 */
export function sanitizeCsvValue(val: any): string {
  if (val === null || val === undefined) return "";
  let str = String(val).trim();
  // Neutralize formula triggers
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  // Escape quotes if needed
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
