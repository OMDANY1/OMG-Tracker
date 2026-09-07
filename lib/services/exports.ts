import JSZip from "jszip";
import { sanitizeCsvValue } from "@/lib/utils";
import { formatCairoDateTime } from "@/lib/timezone";
import type { MonthlyReportData } from "./reports";

const UTF8_BOM = "\uFEFF";

export function generateTimeEntriesCsv(timeEntries: any[], timezone = "Africa/Cairo"): string {
  const headers = [
    "معرف الجلسة",
    "التاريخ والتوقيت المحلي (القاهرة)",
    "نهاية الجلسة (القاهرة)",
    "المصمم",
    "العميل",
    "الكامبين",
    "عنوان المهمة",
    "رقم التسليم",
    "المدة (دقائق)",
    "تصنيف العمل",
    "مصدر التسجيل",
    "ملاحظات",
  ];

  const rows = timeEntries.map((e) => [
    e.id,
    e.started_at ? formatCairoDateTime(e.started_at, timezone) : "",
    e.ended_at ? formatCairoDateTime(e.ended_at, timezone) : "قيد التشغيل",
    e.person?.display_name || "",
    e.task?.campaign?.client?.name || "",
    e.task?.campaign?.title || "",
    e.task?.title || "",
    e.task?.deliverable_number || "",
    e.ended_at
      ? Math.round(
          (new Date(e.ended_at).getTime() - new Date(e.started_at).getTime()) / 60000
        )
      : "",
    e.category,
    e.entry_source,
    e.note || "",
  ]);

  const csvContent = [
    `# النطاق الزمني للملف: ${timezone}`,
    headers.map(sanitizeCsvValue).join(","),
    ...rows.map((row) => row.map(sanitizeCsvValue).join(",")),
  ].join("\r\n");

  return UTF8_BOM + csvContent;
}

export function generateTaskDeliveriesCsv(tasks: any[], timezone = "Africa/Cairo"): string {
  const headers = [
    "معرف المهمة",
    "عنوان المهمة",
    "العميل",
    "الكامبين",
    "نوع التسليم",
    "رقم التسليم",
    "المصمم عند التسليم",
    "تاريخ التسليم (القاهرة)",
    "الموعد النهائي المعتمد",
    "في الموعد (On-Time)",
  ];

  const rows = tasks.map((t) => [
    t.id,
    t.title,
    t.client?.name || "",
    t.campaign?.title || "",
    t.deliverable_type,
    t.deliverable_number,
    t.assignee?.display_name || "",
    t.delivered_at ? formatCairoDateTime(t.delivered_at, timezone) : "",
    t.due_at ? formatCairoDateTime(t.due_at, timezone) : "غير محدد",
    t.is_on_time ? "نعم" : "لا",
  ]);

  const csvContent = [
    `# ملف تسليمات المهام - التوقيت: ${timezone}`,
    headers.map(sanitizeCsvValue).join(","),
    ...rows.map((row) => row.map(sanitizeCsvValue).join(",")),
  ].join("\r\n");

  return UTF8_BOM + csvContent;
}

export function generateDesignerSummaryCsv(designers: MonthlyReportData["designerSummary"]): string {
  const headers = [
    "اسم المصمم",
    "المسمى الوظيفي",
    "الدور في النظام",
    "المهام المسلمة (أول مرة)",
    "إجمالي الساعات المسجلة",
    "ساعات التعديلات",
    "عدد الجلسات",
    "الكامبينز النشطة",
  ];

  const rows = designers.map((d) => [
    d.displayName,
    d.jobTitle,
    d.role,
    d.firstDeliveredTasks,
    d.loggedHours,
    d.revisionHours,
    d.sessionCount,
    d.campaignsWorkedOn,
  ]);

  const csvContent = [
    headers.map(sanitizeCsvValue).join(","),
    ...rows.map((row) => row.map(sanitizeCsvValue).join(",")),
  ].join("\r\n");

  return UTF8_BOM + csvContent;
}

export function generateClientSummaryCsv(clients: MonthlyReportData["clientSummary"]): string {
  const headers = [
    "اسم العميل",
    "المسؤول (Owner)",
    "الصعوبة",
    "عبء العمل الإضافي",
    "المهام المسلمة",
    "إجمالي الساعات",
    "ساعات التعديل الداخلي",
    "ساعات تعديل العميل",
    "المهام النشطة",
  ];

  const rows = clients.map((c) => [
    c.clientName,
    c.ownerName,
    c.difficulty,
    c.extraWorkload,
    c.deliveredTasks,
    c.totalHours,
    c.internalRevisionHours,
    c.clientRevisionHours,
    c.activeTasks,
  ]);

  const csvContent = [
    headers.map(sanitizeCsvValue).join(","),
    ...rows.map((row) => row.map(sanitizeCsvValue).join(",")),
  ].join("\r\n");

  return UTF8_BOM + csvContent;
}

export function generateMarkdownReport(report: MonthlyReportData): string {
  const exec = report.executiveSummary;
  const timing = report.timingMetrics;
  const commentary = report.managementCommentary;

  const monthNames: Record<string, string> = {
    "01": "يناير", "02": "فبراير", "03": "مارس", "04": "أبريل",
    "05": "مايو", "06": "يونيو", "07": "يوليو", "08": "أغسطس",
    "09": "سبتمبر", "10": "أكتوبر", "11": "نوفمبر", "12": "ديسمبر"
  };
  const [year, month] = report.monthKey.split("-");
  const arabicMonth = monthNames[month] ? `${monthNames[month]} ${year}` : report.monthKey;

  return `# تقرير الأداء الإداري والتشغيلي لوكالة OMG Creative
**الشهر**: ${arabicMonth} (${report.monthKey}) | **المنطقة الزمنية**: ${report.timezone}
**رقم المراجعة**: ${report.revisionNumber} (${report.isSnapshotFinalized ? "معتمد ومجمد" : "مسودة مباشرة"})

---

## 1. الملخص التنفيذي (Executive Summary)
- **إجمالي الساعات المسجلة**: ${exec.totalLoggedHours} ساعة عمل فعلية.
- **ساعات التعديلات (داخلية + عملاء)**: ${exec.totalRevisionHours} ساعة.
- **إجمالي المهام المسلمة لأول مرة**: ${exec.uniqueFirstDeliveries} تسليمة فريدة.
- **إعادة التسليم بعد الفتح (Re-deliveries)**: ${exec.redeliveries}.
- **نسبة التسليم في الموعد (On-Time Delivery)**: ${
    timing.onTimeRatioPercentage !== null ? `${timing.onTimeRatioPercentage}%` : "N/A"
  } (${timing.onTimeNumerator}/${timing.onTimeDenominator} مهمة لها موعد محدد).
- **المهام المتأخرة عند إقفال الشهر**: ${exec.monthEndOverdue} مهمة.
- **قائمة الانتظار الحالية (Backlog)**: ${exec.backlogCount} مهمة.

---

## 2. أداء فريق التصميم (Designers Performance)
| المصمم | المسمى | التسليمات الفريدة | الساعات المسجلة | ساعات التعديل | الجلسات |
|---|---|---|---|---|---|
${report.designerSummary
  .map(
    (d) =>
      `| ${d.displayName} | ${d.jobTitle} | ${d.firstDeliveredTasks} | ${d.loggedHours} س | ${d.revisionHours} س | ${d.sessionCount} |`
  )
  .join("\n")}

---

## 3. تحليل العملاء (Clients Breakdown)
| العميل | المسؤول | الصعوبة | التسليمات | إجمالي الساعات | تعديل داخلي | تعديل العميل |
|---|---|---|---|---|---|---|
${report.clientSummary
  .map(
    (c) =>
      `| ${c.clientName} | ${c.ownerName} | ${c.difficulty} | ${c.deliveredTasks} | ${c.totalHours} س | ${c.internalRevisionHours} س | ${c.clientRevisionHours} س |`
  )
  .join("\n")}

---

## 4. التحليل الإداري وقرارات التطوير (Management Commentary)
### ما سار بشكل ممتاز:
${commentary?.whatWentWell || "لا توجد ملاحظات مسجلة."}

### العوائق والتحديات المرصودة:
${commentary?.blockers || "لا توجد ملاحظات مسجلة."}

### مقترح إعادة التوزيع والتطوير:
${commentary?.proposedRedistribution || "لا توجد ملاحظات مسجلة."}

---
*تم إنشاء هذا التقرير آلياً بواسطة OMG Creative Workspace مع حماية كاملة للتاريخ التشغيلي والتدقيق.*
`;
}

export async function generateAnalysisPackZip(params: {
  report: MonthlyReportData;
  timeEntries: any[];
  tasks: any[];
}): Promise<Buffer> {
  const zip = new JSZip();

  const timeEntriesCsv = generateTimeEntriesCsv(params.timeEntries, params.report.timezone);
  const tasksCsv = generateTaskDeliveriesCsv(params.tasks, params.report.timezone);
  const designersCsv = generateDesignerSummaryCsv(params.report.designerSummary);
  const clientsCsv = generateClientSummaryCsv(params.report.clientSummary);
  const mdReport = generateMarkdownReport(params.report);

  zip.file(`time_entries_${params.report.monthKey}.csv`, timeEntriesCsv);
  zip.file(`task_deliveries_${params.report.monthKey}.csv`, tasksCsv);
  zip.file(`designer_summary_${params.report.monthKey}.csv`, designersCsv);
  zip.file(`client_summary_${params.report.monthKey}.csv`, clientsCsv);
  zip.file(`monthly_report_${params.report.monthKey}.md`, mdReport);

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return buffer;
}
