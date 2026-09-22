import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMembership, requireOwner } from "@/lib/auth/server-auth";
import { getMonthIntervalUtc, toCairoDate, formatCairoDate } from "@/lib/timezone";
import { WORK_STAGE_LABELS, TIME_CATEGORY_LABELS, getActivityLabel } from "@/lib/utils";

export const dynamic = "force-dynamic";

function escapeCsvField(val: any): string {
  if (val === null || val === undefined) return "";
  let str = String(val);
  // Neutralize CSV Formula Injection (=, +, -, @, \t, \r)
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(req: NextRequest) {
  try {
    // Marketing Director (Ata), Owner (Emad), and Manager are authorized to export reports
    const authRes = await requireWorkspaceMembership(req, {
      allowedRoles: ["owner", "manager", "marketing_director"],
    });
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, admin } = authRes.data;
    const ws = { id: membership.workspaceId };

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "tasks";
    const monthKey = searchParams.get("monthKey") || "2026-09";
    const personId = searchParams.get("personId") || "";
    const teamSpecialty = searchParams.get("team") || "";
    const clientId = searchParams.get("clientId") || "";
    const campaignId = searchParams.get("campaignId") || "";

    let csvContent = "";
    let fileName = `export_${type}_${new Date().toISOString().slice(0, 10)}.csv`;

    if (type === "timesheet") {
      // 1. Timesheet Export with clear separation of work, review, revision, and waiting times
      let query = admin
        .from("time_entries")
        .select(`
          id,
          roster_person_id,
          task_id,
          category,
          source,
          duration_seconds,
          started_at,
          ended_at,
          note,
          is_voided,
          person:roster_people!fk_time_person(id, display_name, job_title, specialties),
          task:tasks!fk_time_task(
            id,
            title,
            work_stage,
            status,
            client_id,
            campaign_id,
            estimated_hours,
            waiting_reason,
            waiting_since,
            client:clients(id, name),
            campaign:campaigns(id, title)
          )
        `)
        .eq("workspace_id", ws.id)
        .eq("is_voided", false)
        .order("started_at", { ascending: false });

      if (personId) {
        query = query.eq("roster_person_id", personId);
      }

      const { data: rawEntries, error } = await query;
      if (error) throw new Error(error.message);

      let entries = rawEntries || [];

      // Filter by team specialty if requested
      if (teamSpecialty) {
        entries = entries.filter((e: any) => {
          const specs = e.person?.specialties || [];
          return specs.includes(teamSpecialty);
        });
      }

      // Filter by client if requested
      if (clientId) {
        entries = entries.filter((e: any) => e.task?.client_id === clientId);
      }

      // Filter by campaign if requested
      if (campaignId) {
        entries = entries.filter((e: any) => e.task?.campaign_id === campaignId);
      }

      const headers = [
        "معرف الجلسة",
        "اسم العضو",
        "المسمى الوظيفي",
        "التخصص / الفريق",
        "العميل",
        "المشروع / الحملة",
        "عنوان التكليف",
        "مرحلة العمل",
        "فئة النشاط",
        "الوقت التقديري (ساعة)",
        "ساعات العمل الفعلي (ساعة)",
        "ساعات المراجعة (ساعة)",
        "ساعات التعديل (ساعة)",
        "ساعات الانتظار والتعطيل (مفصولة)",
        "سبب التعطيل / الانتظار",
        "وقت البدء (توقيت القاهرة)",
        "وقت الانتهاء (توقيت القاهرة)",
        "ملاحظات الجلسة",
      ];

      const rows = entries.map((e: any) => {
        const p = e.person || {};
        const t = e.task || {};
        const cl = Array.isArray(t.client) ? t.client[0] : t.client;
        const cp = Array.isArray(t.campaign) ? t.campaign[0] : t.campaign;

        const durationSec = e.duration_seconds || 0;
        const durationHours = (durationSec / 3600).toFixed(2);
        const estimatedHours = t.estimated_hours ? Number(t.estimated_hours).toFixed(2) : "0.00";

        // Separate work time, review time, revision time, and waiting time strictly
        const isWaiting = e.category === "waiting";
        const isReview = e.category === "review";
        const isRevision = e.category === "internal_revision" || e.category === "client_revision";

        const reviewHours = isReview ? durationHours : "0.00";
        const revisionHours = isRevision ? durationHours : "0.00";
        const waitingHours = isWaiting ? durationHours : "0.00";
        const workHours = (!isReview && !isRevision && !isWaiting) ? durationHours : "0.00";

        const workStageLabel = WORK_STAGE_LABELS[t.work_stage] || t.work_stage || "تصميم";
        const categoryLabel = getActivityLabel(e.category, t.work_stage);
        const waitingReason = isWaiting
          ? (e.note || t.waiting_reason || "")
          : (t.status === "blocked" ? (t.waiting_reason || "") : "");

        const startTimeStr = e.started_at ? toCairoDate(e.started_at).toLocaleString("ar-EG") : "";
        const endTimeStr = e.ended_at ? toCairoDate(e.ended_at).toLocaleString("ar-EG") : "مفتوح";

        return [
          e.id,
          p.display_name || "",
          p.job_title || "",
          (p.specialties || []).join(" | "),
          cl?.name || "",
          cp?.title || "",
          t.title || "",
          workStageLabel,
          categoryLabel,
          estimatedHours,
          workHours,
          reviewHours,
          revisionHours,
          waitingHours,
          waitingReason,
          startTimeStr,
          endTimeStr,
          e.note || "",
        ].map(escapeCsvField).join(",");
      });

      csvContent = [headers.join(","), ...rows].join("\n");
      fileName = `omg_timesheet_${monthKey}_${new Date().toISOString().slice(0, 10)}.csv`;
    } else if (type === "evaluations") {
      // 2. Real evaluations & reviews report (based strictly on verified review rounds and turnaround)
      const { data: rawRounds, error } = await admin
        .from("review_rounds")
        .select(`
          id,
          round_number,
          round_type,
          decision,
          feedback,
          created_at,
          decided_at,
          reviewer:roster_people!fk_round_reviewer(display_name, job_title),
          submitter:roster_people!fk_round_submitter(display_name, job_title),
          task:tasks!fk_round_task(
            id,
            title,
            work_stage,
            status,
            client_id,
            client:clients(name)
          )
        `)
        .eq("workspace_id", ws.id)
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message);

      let rounds = rawRounds || [];
      if (clientId) {
        rounds = rounds.filter((r: any) => r.task?.client_id === clientId);
      }

      const headers = [
        "معرف جولة المراجعة",
        "العميل",
        "عنوان المهمة",
        "مرحلة العمل",
        "رقم الجولة",
        "نوع المراجعة",
        "المنفذ / مقدم التسليم",
        "المراجع",
        "القرار والتقييم الفعلي",
        "ملاحظات وتقييم المراجع",
        "تاريخ تقديم المراجعة",
        "تاريخ اتخاذ القرار",
        "وقت الاستجابة للمراجعة (بالساعات)",
      ];

      const rows = rounds.map((r: any) => {
        const t = r.task || {};
        const cl = Array.isArray(t.client) ? t.client[0] : t.client;
        const rev = Array.isArray(r.reviewer) ? r.reviewer[0] : r.reviewer;
        const sub = Array.isArray(r.submitter) ? r.submitter[0] : r.submitter;

        let turnaroundHours = "";
        if (r.created_at && r.decided_at) {
          const diffMs = new Date(r.decided_at).getTime() - new Date(r.created_at).getTime();
          turnaroundHours = (diffMs / 3600000).toFixed(2);
        }

        const decisionLabel =
          r.decision === "approved"
            ? "معتمد (Approved)"
            : r.decision === "changes_requested"
            ? "مطلوب تعديلات (Changes Requested)"
            : "قيد المراجعة (Pending)";

        const roundTypeLabel = r.round_type === "internal" ? "مراجعة داخلية" : "مراجعة العميل";
        const stageLabel = WORK_STAGE_LABELS[t.work_stage] || t.work_stage || "";

        return [
          r.id,
          cl?.name || "",
          t.title || "",
          stageLabel,
          r.round_number || 1,
          roundTypeLabel,
          sub?.display_name || "",
          rev?.display_name || "",
          decisionLabel,
          r.feedback || "",
          r.created_at ? toCairoDate(r.created_at).toLocaleString("ar-EG") : "",
          r.decided_at ? toCairoDate(r.decided_at).toLocaleString("ar-EG") : "",
          turnaroundHours,
        ].map(escapeCsvField).join(",");
      });

      csvContent = [headers.join(","), ...rows].join("\n");
      fileName = `omg_evaluations_${monthKey}_${new Date().toISOString().slice(0, 10)}.csv`;
    } else if (type === "tasks") {
      const { data: tasks, error } = await admin
        .from("tasks")
        .select(`
          id,
          title,
          work_stage,
          status,
          priority,
          deliverable_format,
          deliverable_number,
          due_date,
          created_at,
          client:clients(name, difficulty),
          assignee:roster_people!fk_task_assignee(display_name),
          reviewer:roster_people!fk_task_reviewer(display_name)
        `)
        .eq("workspace_id", ws.id)
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message);

      const headers = [
        "معرف المهمة (ID)",
        "عنوان المهمة",
        "مرحلة العمل",
        "العميل",
        "صعوبة العميل",
        "رقم البوست / التسليمة",
        "نوع المحتوى",
        "الحالة",
        "الأولوية",
        "المسند إليه",
        "المراجع الداخلي",
        "موعد التسليم",
        "تاريخ الإنشاء",
      ];

      const rows = (tasks || []).map((t: any) => {
        const clientObj = Array.isArray(t.client) ? t.client[0] : t.client;
        const assigneeObj = Array.isArray(t.assignee) ? t.assignee[0] : t.assignee;
        const reviewerObj = Array.isArray(t.reviewer) ? t.reviewer[0] : t.reviewer;

        return [
          t.id,
          t.title,
          WORK_STAGE_LABELS[t.work_stage] || t.work_stage || "تصميم",
          clientObj?.name || "",
          clientObj?.difficulty || "",
          t.deliverable_number || "",
          t.deliverable_format || "",
          t.status || "",
          t.priority || "",
          assigneeObj?.display_name || "",
          reviewerObj?.display_name || "",
          t.due_date || "",
          t.created_at || "",
        ].map(escapeCsvField).join(",");
      });

      csvContent = [headers.join(","), ...rows].join("\n");
    } else if (type === "calendars") {
      const { data: campaigns, error } = await admin
        .from("campaigns")
        .select(`
          id,
          title,
          month_key,
          revision_number,
          calendar_status,
          detected_post_count,
          declared_post_count,
          ai_overall_confidence,
          ai_model,
          original_file_name,
          created_at,
          client:clients(name)
        `)
        .eq("workspace_id", ws.id)
        .order("month_key", { ascending: false });

      if (error) throw new Error(error.message);

      const headers = [
        "معرف الحملة (ID)",
        "العميل",
        "الشهر",
        "رقم الإصدار",
        "حالة التقويم",
        "البوستات المكتشفة",
        "البوستات المعلنة",
        "دقة التحليل",
        "نموذج الذكاء الاصطناعي",
        "اسم الملف الأصلي",
        "تاريخ الرفع",
      ];

      const rows = (campaigns || []).map((c: any) => {
        const clientObj = Array.isArray(c.client) ? c.client[0] : c.client;
        return [
          c.id,
          clientObj?.name || "",
          c.month_key || "",
          c.revision_number || 1,
          c.calendar_status || "",
          c.detected_post_count || 0,
          c.declared_post_count || "",
          c.ai_overall_confidence ? `${Math.round(c.ai_overall_confidence * 100)}%` : "",
          c.ai_model || "",
          c.original_file_name || "",
          c.created_at || "",
        ].map(escapeCsvField).join(",");
      });

      csvContent = [headers.join(","), ...rows].join("\n");
    } else if (type === "workload") {
      const [rosterRes, membershipsRes, capacitiesRes] = await Promise.all([
        admin
          .from("roster_people")
          .select("id, display_name, job_title, specialties, is_active")
          .eq("workspace_id", ws.id)
          .eq("is_active", true)
          .order("display_name", { ascending: true }),
        admin
          .from("workspace_memberships")
          .select("roster_person_id, role")
          .eq("workspace_id", ws.id)
          .eq("is_active", true),
        admin
          .from("member_capacities")
          .select("*")
          .eq("workspace_id", ws.id),
      ]);

      if (rosterRes.error) throw new Error(rosterRes.error.message);

      const roster = rosterRes.data || [];
      const memberships = membershipsRes.data || [];
      const capacities = capacitiesRes.data || [];

      const membershipRoleMap = new Map<string, string>();
      for (const m of memberships) {
        if (m.roster_person_id && m.role) {
          membershipRoleMap.set(m.roster_person_id, m.role);
        }
      }

      const capacityMap = new Map<string, any>();
      for (const c of capacities) {
        if (c.roster_person_id) {
          capacityMap.set(c.roster_person_id, c);
        }
      }

      const headers = [
        "معرف العضو (ID)",
        "اسم العضو",
        "المسمى الوظيفي",
        "الدور التقني",
        "التخصصات",
        "ساعات العمل الأسبوعية",
        "الساعات المحجوزة للمراجعة",
        "السعة القصوى للحمل الموزون",
      ];

      const rows = roster.map((r: any) => {
        const role = membershipRoleMap.get(r.id) || "designer";
        const cap = capacityMap.get(r.id);
        return [
          r.id,
          r.display_name,
          r.job_title || "",
          role,
          (r.specialties || []).join(" | "),
          cap?.weekly_hours_limit || 40,
          role === "owner" ? 15 : role === "senior_reviewer" ? 8 : 0,
          cap?.max_weighted_load || 15.0,
        ].map(escapeCsvField).join(",");
      });

      csvContent = [headers.join(","), ...rows].join("\n");
    } else {
      return NextResponse.json({ error: "نوع التقرير غير مدعوم." }, { status: 400 });
    }

    // Prepend UTF-8 Byte Order Mark (\uFEFF: 0xEF, 0xBB, 0xBF) so Arabic renders cleanly in Microsoft Excel
    const bomBuffer = Buffer.concat([
      Buffer.from("\uFEFF", "utf-8"),
      Buffer.from(csvContent, "utf-8"),
    ]);

    return new Response(bomBuffer, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err: any) {
    console.error("CSV Export error:", err);
    return NextResponse.json({ error: err.message || "فشل تصدير ملف CSV" }, { status: 500 });
  }
}
