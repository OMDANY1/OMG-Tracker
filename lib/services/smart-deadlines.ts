import { toZonedTime, fromZonedTime, format as formatTz } from "date-fns-tz";
import { subDays, isFriday, isSaturday, setHours, setMinutes, setSeconds } from "date-fns";

export const CAIRO_TIMEZONE = "Africa/Cairo";

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
 * Checks if a given date falls on an Egyptian weekend (Friday or Saturday).
 */
export function isEgyptWeekend(date: Date): boolean {
  return isFriday(date) || isSaturday(date);
}

/**
 * Subtracts business days in Egypt (skipping Friday and Saturday).
 */
export function subtractEgyptBusinessDays(startDate: Date, businessDays: number): Date {
  let current = new Date(startDate);
  let daysLeft = businessDays;

  while (daysLeft > 0) {
    current = subDays(current, 1);
    if (!isEgyptWeekend(current)) {
      daysLeft--;
    }
  }

  return current;
}

/**
 * Calculates decoupled smart deadlines for agency production:
 * 1. publish_at: Date of publication (default 18:00 Cairo time).
 * 2. review_due_date: 1 business day before publication at 14:00 Cairo time.
 * 3. design_due_date: 2 business days before publication (3 for Reels/Carousel/Hard clients) at 18:00 Cairo time.
 */
export function calculateSmartDeadlines(params: {
  publishDate: string | Date;
  format?: string;
  difficulty?: string;
}): SmartDeadlinesResult {
  const { publishDate, format = "Static", difficulty = "Medium" } = params;

  // 1. Convert input to Cairo zoned time
  let pubDateZoned: Date;
  if (typeof publishDate === "string") {
    // If it's a date string like '2026-09-25'
    const dateOnlyMatch = publishDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dateOnlyMatch) {
      const [, y, m, d] = dateOnlyMatch;
      // Anchor to 18:00 Cairo time on that date
      pubDateZoned = toZonedTime(new Date(Number(y), Number(m) - 1, Number(d), 18, 0, 0), CAIRO_TIMEZONE);
    } else {
      pubDateZoned = toZonedTime(new Date(publishDate), CAIRO_TIMEZONE);
    }
  } else {
    pubDateZoned = toZonedTime(publishDate, CAIRO_TIMEZONE);
  }

  // Ensure default publish hour is 18:00 Cairo if not explicitly set
  const cairoPublish = setSeconds(setMinutes(setHours(pubDateZoned, 18), 0), 0);

  // 2. Review Due Date: 1 business day before publish at 14:00 Cairo
  const cairoReviewDate = subtractEgyptBusinessDays(cairoPublish, 1);
  const cairoReview = setSeconds(setMinutes(setHours(cairoReviewDate, 14), 0), 0);

  // 3. Design Due Date: Lead time based on format & difficulty
  const isHeavyFormat = /reel|video|motion|carousel/i.test(format);
  const isHardClient = /hard/i.test(difficulty);
  const designLeadDays = (isHeavyFormat || isHardClient) ? 3 : 2;

  const cairoDesignDate = subtractEgyptBusinessDays(cairoPublish, designLeadDays);
  const cairoDesign = setSeconds(setMinutes(setHours(cairoDesignDate, 18), 0), 0);

  // Convert back to UTC for Postgres timestamptz
  const utcPublish = fromZonedTime(cairoPublish, CAIRO_TIMEZONE);
  const utcReview = fromZonedTime(cairoReview, CAIRO_TIMEZONE);
  const utcDesign = fromZonedTime(cairoDesign, CAIRO_TIMEZONE);

  return {
    publishAt: utcPublish.toISOString(),
    reviewDueDate: utcReview.toISOString(),
    designDueDate: utcDesign.toISOString(),
    formattedCairo: {
      publish: formatTz(cairoPublish, "yyyy-MM-dd HH:mm", { timeZone: CAIRO_TIMEZONE }),
      review: formatTz(cairoReview, "yyyy-MM-dd HH:mm", { timeZone: CAIRO_TIMEZONE }),
      design: formatTz(cairoDesign, "yyyy-MM-dd HH:mm", { timeZone: CAIRO_TIMEZONE }),
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

  // Filter for designers/production staff
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
        reason: `المصمم المعتمد للحساب (${owner.name}) - نسبة الحمل متوازنة (${owner.loadRatio}%)`,
      };
    }
  }

  // 2. Select designer with lowest load
  const sorted = [...eligible].sort((a, b) => a.loadRatio - b.loadRatio || a.activeTasksCount - b.activeTasksCount);
  const best = sorted[0];

  return {
    recommendedId: best.id,
    reason: `أقل مصمم تحميلاً في الفريق (${best.name}) - نسبة الحمل: ${best.loadRatio}%`,
  };
}
