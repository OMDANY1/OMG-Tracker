import { toZonedTime, fromZonedTime, format as formatTz } from "date-fns-tz";
import { subDays, isFriday, isSaturday, setHours, setMinutes, setSeconds } from "date-fns";
import { createAdminClient } from "@/lib/supabase/admin";

export const CAIRO_TIMEZONE = "Africa/Cairo";

export interface WorkspaceDeadlineConfig {
  static_lead_days: number;
  carousel_lead_days: number;
  video_lead_days: number;
  review_lead_days: number;
  hard_client_extra_days: number;
  working_days: number[]; // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  default_publish_time: string; // e.g. "18:00"
  timezone: string; // e.g. "Africa/Cairo"
}

export const DEFAULT_DEADLINE_CONFIG: WorkspaceDeadlineConfig = {
  static_lead_days: 2,
  carousel_lead_days: 3,
  video_lead_days: 3,
  review_lead_days: 1,
  hard_client_extra_days: 1,
  working_days: [0, 1, 2, 3, 4], // Sunday to Thursday (Egypt)
  default_publish_time: "18:00",
  timezone: "Africa/Cairo",
};

export interface SmartDeadlinesResult {
  publishAt: string;       // ISO string formatted for DB (timestamptz)
  reviewDueDate: string;   // ISO string (timestamptz)
  designDueDate: string;   // ISO string (timestamptz)
  formattedCairo: {
    publish: string;
    review: string;
    design: string;
  };
}

/**
 * Fetches workspace deadline settings from database, falling back to defaults.
 */
export async function getWorkspaceDeadlineSettings(workspaceId: string): Promise<WorkspaceDeadlineConfig> {
  const admin = createAdminClient();
  if (!admin) return DEFAULT_DEADLINE_CONFIG;

  try {
    const { data } = await admin
      .from("workspace_deadline_settings")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!data) return DEFAULT_DEADLINE_CONFIG;

    return {
      static_lead_days: data.static_lead_days ?? DEFAULT_DEADLINE_CONFIG.static_lead_days,
      carousel_lead_days: data.carousel_lead_days ?? DEFAULT_DEADLINE_CONFIG.carousel_lead_days,
      video_lead_days: data.video_lead_days ?? DEFAULT_DEADLINE_CONFIG.video_lead_days,
      review_lead_days: data.review_lead_days ?? DEFAULT_DEADLINE_CONFIG.review_lead_days,
      hard_client_extra_days: data.hard_client_extra_days ?? DEFAULT_DEADLINE_CONFIG.hard_client_extra_days,
      working_days: Array.isArray(data.working_days) ? data.working_days : DEFAULT_DEADLINE_CONFIG.working_days,
      default_publish_time: data.default_publish_time || DEFAULT_DEADLINE_CONFIG.default_publish_time,
      timezone: data.timezone || DEFAULT_DEADLINE_CONFIG.timezone,
    };
  } catch {
    return DEFAULT_DEADLINE_CONFIG;
  }
}

/**
 * Checks if a given date falls on an Egyptian weekend (Friday or Saturday).
 */
export function isEgyptWeekend(date: Date): boolean {
  return isFriday(date) || isSaturday(date);
}

/**
 * Checks if date is a non-working day according to configuration.
 */
export function isNonWorkingDay(date: Date, workingDays: number[]): boolean {
  const day = date.getDay(); // 0 = Sunday, ..., 6 = Saturday
  return !workingDays.includes(day);
}

/**
 * Subtracts working business days, skipping non-working days.
 */
export function subtractWorkingDays(startDate: Date, businessDays: number, workingDays: number[] = [0, 1, 2, 3, 4]): Date {
  let current = new Date(startDate);
  let daysLeft = businessDays;

  while (daysLeft > 0) {
    current = subDays(current, 1);
    if (!isNonWorkingDay(current, workingDays)) {
      daysLeft--;
    }
  }

  return current;
}

/**
 * Backward compatibility alias for Egypt standard business days.
 */
export function subtractEgyptBusinessDays(startDate: Date, businessDays: number): Date {
  return subtractWorkingDays(startDate, businessDays, [0, 1, 2, 3, 4]);
}

/**
 * Calculates decoupled smart deadlines for agency production:
 * 1. publish_at: Date of publication (anchored to default_publish_time in target timezone).
 * 2. review_due_date: review_lead_days working days before publication.
 * 3. design_due_date: lead days based on deliverable format + hard client extra days.
 */
export function calculateSmartDeadlines(params: {
  publishDate: string | Date;
  format?: string;
  difficulty?: string;
  settings?: WorkspaceDeadlineConfig;
}): SmartDeadlinesResult {
  const {
    publishDate,
    format = "Static",
    difficulty = "Medium",
    settings = DEFAULT_DEADLINE_CONFIG,
  } = params;

  const tz = settings.timezone || CAIRO_TIMEZONE;
  const workingDays = settings.working_days || [0, 1, 2, 3, 4];

  // 1. Parse default publish hour & minute
  const [pubHStr, pubMStr] = (settings.default_publish_time || "18:00").split(":");
  const pubH = parseInt(pubHStr, 10) || 18;
  const pubM = parseInt(pubMStr, 10) || 0;

  // 2. Convert input to target zoned time
  let pubDateZoned: Date;
  if (typeof publishDate === "string") {
    const dateOnlyMatch = publishDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dateOnlyMatch) {
      const [, y, m, d] = dateOnlyMatch;
      pubDateZoned = toZonedTime(new Date(Number(y), Number(m) - 1, Number(d), pubH, pubM, 0), tz);
    } else {
      pubDateZoned = toZonedTime(new Date(publishDate), tz);
    }
  } else {
    pubDateZoned = toZonedTime(publishDate, tz);
  }

  const cairoPublish = setSeconds(setMinutes(setHours(pubDateZoned, pubH), pubM), 0);

  // 3. Review Due Date: review_lead_days before publish at 14:00
  const reviewLeadDays = Math.max(1, settings.review_lead_days || 1);
  const cairoReviewDate = subtractWorkingDays(cairoPublish, reviewLeadDays, workingDays);
  const cairoReview = setSeconds(setMinutes(setHours(cairoReviewDate, 14), 0), 0);

  // 4. Design Due Date: Format-specific lead days + Hard client modifier
  const isCarousel = /carousel/i.test(format);
  const isVideoOrReel = /reel|video|motion/i.test(format);
  const isHardClient = /hard/i.test(difficulty);

  let baseLeadDays = settings.static_lead_days;
  if (isCarousel) {
    baseLeadDays = settings.carousel_lead_days;
  } else if (isVideoOrReel) {
    baseLeadDays = settings.video_lead_days;
  }

  const extraDays = isHardClient ? (settings.hard_client_extra_days || 1) : 0;
  const totalDesignLead = baseLeadDays + extraDays;

  const cairoDesignDate = subtractWorkingDays(cairoPublish, totalDesignLead, workingDays);
  const cairoDesign = setSeconds(setMinutes(setHours(cairoDesignDate, pubH), pubM), 0);

  // Convert back to UTC for Postgres timestamptz
  const utcPublish = fromZonedTime(cairoPublish, tz);
  const utcReview = fromZonedTime(cairoReview, tz);
  const utcDesign = fromZonedTime(cairoDesign, tz);

  return {
    publishAt: utcPublish.toISOString(),
    reviewDueDate: utcReview.toISOString(),
    designDueDate: utcDesign.toISOString(),
    formattedCairo: {
      publish: formatTz(cairoPublish, "yyyy-MM-dd HH:mm", { timeZone: tz }),
      review: formatTz(cairoReview, "yyyy-MM-dd HH:mm", { timeZone: tz }),
      design: formatTz(cairoDesign, "yyyy-MM-dd HH:mm", { timeZone: tz }),
    },
  };
}

export interface DesignerCandidate {
  id: string;
  name: string;
  role: string;
  loadRatio: number;          // 0 - 100+
  activeTasksCount: number;
  isClientOwner?: boolean;
}

/**
 * Capacity-aware designer assignment recommendation:
 * - Prioritizes actual graphic designers (role === 'designer').
 * - Prefers client account owner if loadRatio <= 85%.
 * - Otherwise recommends the designer with the lowest load ratio.
 */
export function recommendAssignee(params: {
  candidates: DesignerCandidate[];
  clientOwnerRosterId?: string | null;
}): {
  recommendedId: string | null;
  reason: string;
} {
  const { candidates, clientOwnerRosterId } = params;

  if (!candidates || candidates.length === 0) {
    return { recommendedId: null, reason: "لا يوجد مصممون متاحون في الفريق" };
  }

  // Filter for production designers (prefer role === 'designer' over reviewers/owners)
  const designers = candidates.filter((c) => c.role === "designer");
  const eligible = designers.length > 0 ? designers : candidates.filter((c) => c.role !== "client");
  if (eligible.length === 0) {
    return { recommendedId: null, reason: "لا يوجد مصممون مؤهلون" };
  }

  // 1. Check client owner first
  if (clientOwnerRosterId) {
    const owner = eligible.find((c) => c.id === clientOwnerRosterId);
    if (owner && owner.loadRatio <= 85) {
      return {
        recommendedId: owner.id,
        reason: "المصمم المعتمد للحساب (" + owner.name + ") - نسبة الحمل متوازنة (" + owner.loadRatio + "%)",
      };
    }
  }

  // 2. Select designer with lowest load
  const sorted = [...eligible].sort((a, b) => a.loadRatio - b.loadRatio || a.activeTasksCount - b.activeTasksCount);
  const best = sorted[0];

  return {
    recommendedId: best.id,
    reason: "أقل مصمم تحميلاً في الفريق (" + best.name + ") - نسبة الحمل: " + best.loadRatio + "%",
  };
}
