import { toZonedTime, fromZonedTime, format as formatTz } from "date-fns-tz";
import { parseISO, isValid } from "date-fns";

export const DEFAULT_TIMEZONE = process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE || "Africa/Cairo";

const ARABIC_MONTH_NAMES = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

const ARABIC_DAY_NAMES = [
  "الأحد",
  "الإثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];

/**
 * Parses UTC ISO timestamp and converts to local Date in target timezone (default Africa/Cairo)
 */
export function toCairoDate(utcIsoOrDate: string | Date, timeZone = DEFAULT_TIMEZONE): Date {
  const date = typeof utcIsoOrDate === "string" ? parseISO(utcIsoOrDate) : utcIsoOrDate;
  if (!isValid(date)) return new Date();
  return toZonedTime(date, timeZone);
}

/**
 * Converts a local date-time string (e.g. "2026-09-06T11:00") in Africa/Cairo to UTC ISO string
 */
export function cairoLocalToUtcIso(localDateTimeStr: string, timeZone = DEFAULT_TIMEZONE): string {
  // Replace space with T if needed
  const cleanStr = localDateTimeStr.replace(" ", "T");
  const localDate = new Date(cleanStr);
  const utcDate = fromZonedTime(localDate, timeZone);
  return utcDate.toISOString();
}

/**
 * Formats a UTC timestamp into Cairo local date string e.g. "6 سبتمبر 2026"
 */
export function formatCairoDate(utcIsoOrDate: string | Date, timeZone = DEFAULT_TIMEZONE): string {
  const date = typeof utcIsoOrDate === "string" ? parseISO(utcIsoOrDate) : utcIsoOrDate;
  if (!isValid(date)) return "";
  const zoned = toZonedTime(date, timeZone);
  const day = zoned.getDate();
  const month = ARABIC_MONTH_NAMES[zoned.getMonth()];
  const year = zoned.getFullYear();
  return `${day} ${month} ${year}`;
}

/**
 * Formats a UTC timestamp into Cairo local date & time e.g. "الأحد 6 سبتمبر 2026، 11:00 ص"
 */
export function formatCairoDateTime(utcIsoOrDate: string | Date, timeZone = DEFAULT_TIMEZONE): string {
  const date = typeof utcIsoOrDate === "string" ? parseISO(utcIsoOrDate) : utcIsoOrDate;
  if (!isValid(date)) return "";
  const zoned = toZonedTime(date, timeZone);
  const dayName = ARABIC_DAY_NAMES[zoned.getDay()];
  const day = zoned.getDate();
  const month = ARABIC_MONTH_NAMES[zoned.getMonth()];
  const year = zoned.getFullYear();
  const hours = zoned.getHours();
  const minutes = String(zoned.getMinutes()).padStart(2, "0");
  const period = hours >= 12 ? "م" : "ص";
  const displayHours = hours % 12 || 12;

  return `${dayName}، ${day} ${month} ${year} - ${displayHours}:${minutes} ${period}`;
}

/**
 * Formats a UTC timestamp into 24-hour Cairo time e.g. "11:00"
 */
export function formatCairoTime(utcIsoOrDate: string | Date, timeZone = DEFAULT_TIMEZONE): string {
  const date = typeof utcIsoOrDate === "string" ? parseISO(utcIsoOrDate) : utcIsoOrDate;
  if (!isValid(date)) return "";
  const zoned = toZonedTime(date, timeZone);
  const hours = String(zoned.getHours()).padStart(2, "0");
  const minutes = String(zoned.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Computes the UTC interval [start, end) for a given Cairo month (e.g. "2026-09")
 */
export function getMonthIntervalUtc(monthKey: string, timeZone = DEFAULT_TIMEZONE): { startUtc: Date; endUtc: Date } {
  const [yearStr, monthStr] = monthKey.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10); // 1-12

  // Start of current month in local time: YYYY-MM-01 00:00:00
  const localStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const startUtc = fromZonedTime(localStart, timeZone);

  // Start of next month in local time
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const localEnd = new Date(nextYear, nextMonth - 1, 1, 0, 0, 0, 0);
  const endUtc = fromZonedTime(localEnd, timeZone);

  return { startUtc, endUtc };
}

/**
 * Calculates session overlap in seconds with a specified interval [intervalStart, intervalEnd].
 * Does not count any time outside the boundary.
 */
export function calculateSessionOverlapSeconds(
  startedAtIso: string,
  endedAtIso: string | null | undefined,
  intervalStart: Date,
  intervalEnd: Date
): number {
  if (!endedAtIso) return 0; // provisional running sessions excluded from closed totals
  const sessionStart = parseISO(startedAtIso).getTime();
  const sessionEnd = parseISO(endedAtIso).getTime();
  const iStart = intervalStart.getTime();
  const iEnd = intervalEnd.getTime();

  const overlapStart = Math.max(sessionStart, iStart);
  const overlapEnd = Math.min(sessionEnd, iEnd);

  if (overlapEnd > overlapStart) {
    return Math.floor((overlapEnd - overlapStart) / 1000);
  }
  return 0;
}
