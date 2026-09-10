import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/server-auth";
import { sanitizeCsvValue } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireOwner(req);
    if (!authResult.success) {
      return authResult.errorResponse;
    }

    const { membership, admin } = authResult.data;
    const workspaceId = membership.workspaceId;

    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "25", 10)));
    const actionFilter = url.searchParams.get("action");
    const entityFilter = url.searchParams.get("entityType");
    const format = url.searchParams.get("format");

    // Fetch roster people to map actor_id to name
    const { data: roster } = await admin
      .from("roster_people")
      .select("id, display_name, job_title")
      .eq("workspace_id", workspaceId);

    const rosterMap = new Map<string, { name: string; title: string }>();
    (roster || []).forEach((p) => {
      rosterMap.set(p.id, { name: p.display_name, title: p.job_title || "" });
    });

    // Build query
    let query = admin
      .from("audit_events")
      .select("*", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (actionFilter && actionFilter !== "all") {
      query = query.eq("action", actionFilter);
    }
    if (entityFilter && entityFilter !== "all") {
      query = query.eq("entity_type", entityFilter);
    }

    // CSV Export: export up to 500 rows
    if (format === "csv") {
      const { data: allEvents, error: csvErr } = await query.limit(500);
      if (csvErr) {
        return NextResponse.json({ error: csvErr.message }, { status: 500 });
      }

      const headers = [
        "التاريخ والوقت (UTC)",
        "المسؤول (Actor)",
        "الحدث (Action)",
        "نوع الكيان (Entity Type)",
        "معرف الكيان (Entity ID)",
        "التفاصيل (Metadata)",
      ];

      const csvRows = [headers.map(sanitizeCsvValue).join(",")];

      (allEvents || []).forEach((ev) => {
        const actor = ev.actor_id ? rosterMap.get(ev.actor_id)?.name || ev.actor_id : "نظام آلي (System)";
        csvRows.push(
          [
            ev.created_at,
            actor,
            ev.action,
            ev.entity_type,
            ev.entity_id || "",
            JSON.stringify(ev.metadata || {}),
          ]
            .map(sanitizeCsvValue)
            .join(",")
        );
      });

      // UTF-8 BOM
      const csvContent = "\uFEFF" + csvRows.join("\r\n");

      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="audit_logs_${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    // Paginated JSON response
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: events, count, error: fetchErr } = await query.range(from, to);

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    const enrichedEvents = (events || []).map((ev) => {
      const actorInfo = ev.actor_id ? rosterMap.get(ev.actor_id) : null;
      return {
        id: ev.id,
        actorId: ev.actor_id,
        actorName: actorInfo?.name || (ev.actor_id ? "مستخدم مسجل" : "النظام الآلي (System)"),
        actorTitle: actorInfo?.title || null,
        action: ev.action,
        entityType: ev.entity_type,
        entityId: ev.entity_id,
        metadata: ev.metadata,
        createdAt: ev.created_at,
      };
    });

    return NextResponse.json({
      success: true,
      events: enrichedEvents,
      pagination: {
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (err: any) {
    console.error("Error in /api/audit-events:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch audit events" }, { status: 500 });
  }
}
