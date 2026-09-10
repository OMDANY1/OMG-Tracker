import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function escapeCsvField(val: any): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(req: NextRequest) {
  try {
    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "تعذر الاتصال بقاعدة البيانات." }, { status: 500 });
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "tasks";

    // 1. Get Workspace
    const { data: ws } = await admin
      .from("workspaces")
      .select("id, name")
      .limit(1)
      .single();

    if (!ws) {
      return NextResponse.json({ error: "لم يتم العثور على مساحة العمل." }, { status: 404 });
    }

    let csvContent = "";
    let fileName = `export_${type}_${new Date().toISOString().slice(0, 10)}.csv`;

    if (type === "tasks") {
      const { data: tasks, error } = await admin
        .from("tasks")
        .select(`
          id,
          title,
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
        "العميل",
        "صعوبة العميل",
        "رقم البوست / التسليمة",
        "نوع المحتوى",
        "الحالة",
        "الأولوية",
        "المصمم المسند",
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
      // Return team members and capacities
      const { data: roster, error } = await admin
        .from("roster_people")
        .select(`
          id,
          display_name,
          job_title,
          role,
          capacity:member_capacities(*)
        `)
        .eq("workspace_id", ws.id)
        .eq("is_active", true);

      if (error) throw new Error(error.message);

      const headers = [
        "معرف العضو (ID)",
        "اسم العضو",
        "المسمى الوظيفي",
        "الدور",
        "ساعات العمل الأسبوعية",
        "الساعات المحجوزة للمراجعة",
        "السعة القصوى للحمل الموزون",
      ];

      const rows = (roster || []).map((r: any) => {
        const cap = Array.isArray(r.capacity) ? r.capacity[0] : r.capacity;
        return [
          r.id,
          r.display_name,
          r.job_title || "",
          r.role,
          cap?.weekly_hours_limit || 40,
          r.role === "owner" ? 15 : r.role === "senior_reviewer" ? 8 : 0,
          cap?.max_weighted_load || 15.0,
        ].map(escapeCsvField).join(",");
      });

      csvContent = [headers.join(","), ...rows].join("\n");
    } else {
      return NextResponse.json({ error: "نوع التقرير غير مدعوم." }, { status: 400 });
    }

    // Prepend UTF-8 Byte Order Mark (BOM) so Arabic renders cleanly in Microsoft Excel
    const bomCsv = "\uFEFF" + csvContent;

    return new Response(bomCsv, {
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
