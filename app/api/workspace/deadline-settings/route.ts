import { NextRequest, NextResponse } from "next/server";
import { requireOwner, requireWorkspaceMembership, validateSameOrigin } from "@/lib/auth/server-auth";
import { calculateSmartDeadlines, WorkspaceDeadlineConfig } from "@/lib/services/smart-deadlines";

export const dynamic = "force-dynamic";

/**
 * GET /api/workspace/deadline-settings
 * Fetches current workspace deadline rules.
 */
export async function GET(req: NextRequest) {
  try {
    const authRes = await requireWorkspaceMembership(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, admin } = authRes.data;

    let { data: settings, error } = await admin
      .from("workspace_deadline_settings")
      .select("*")
      .eq("workspace_id", membership.workspaceId)
      .maybeSingle();

    if (!settings) {
      // Auto-insert default settings if not yet present
      const { data: inserted, error: insErr } = await admin
        .from("workspace_deadline_settings")
        .insert({ workspace_id: membership.workspaceId })
        .select()
        .single();

      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
      settings = inserted;
    }

    return NextResponse.json({
      success: true,
      settings,
      isOwner: membership.role === "owner",
    });
  } catch (err: any) {
    console.error("Error in GET /api/workspace/deadline-settings:", err);
    return NextResponse.json({ error: err.message || "Failed to load settings" }, { status: 500 });
  }
}

/**
 * PATCH /api/workspace/deadline-settings
 * Updates workspace deadline rules (Owner only).
 */
export async function PATCH(req: NextRequest) {
  try {
    if (!validateSameOrigin(req)) {
      return NextResponse.json({ error: "طلب غير مصرح به (Same-Origin check failed)." }, { status: 403 });
    }

    const authRes = await requireOwner(req);
    if (!authRes.success) {
      return authRes.errorResponse;
    }

    const { membership, admin } = authRes.data;
    const body = await req.json();

    const updates: Partial<WorkspaceDeadlineConfig> & { [key: string]: any } = {};

    // 1. Validate & sanitize lead days
    if (body.static_lead_days !== undefined) {
      const val = parseInt(body.static_lead_days, 10);
      if (isNaN(val) || val < 1 || val > 14) {
        return NextResponse.json({ error: "أيام تجهيز التصميم الثابت يجب أن تكون بين 1 و 14 يوماً." }, { status: 400 });
      }
      updates.static_lead_days = val;
    }

    if (body.carousel_lead_days !== undefined) {
      const val = parseInt(body.carousel_lead_days, 10);
      if (isNaN(val) || val < 1 || val > 14) {
        return NextResponse.json({ error: "أيام تجهيز الكاروسيل يجب أن تكون بين 1 و 14 يوماً." }, { status: 400 });
      }
      updates.carousel_lead_days = val;
    }

    if (body.video_lead_days !== undefined) {
      const val = parseInt(body.video_lead_days, 10);
      if (isNaN(val) || val < 1 || val > 14) {
        return NextResponse.json({ error: "أيام تجهيز الفيديو والريلز يجب أن تكون بين 1 و 14 يوماً." }, { status: 400 });
      }
      updates.video_lead_days = val;
    }

    if (body.review_lead_days !== undefined) {
      const val = parseInt(body.review_lead_days, 10);
      if (isNaN(val) || val < 1 || val > 7) {
        return NextResponse.json({ error: "أيام المراجعة يجب أن تكون بين 1 و 7 أيام." }, { status: 400 });
      }
      updates.review_lead_days = val;
    }

    if (body.hard_client_extra_days !== undefined) {
      const val = parseInt(body.hard_client_extra_days, 10);
      if (isNaN(val) || val < 0 || val > 7) {
        return NextResponse.json({ error: "الأيام الإضافية للعملاء الصعبين يجب أن تكون بين 0 و 7 أيام." }, { status: 400 });
      }
      updates.hard_client_extra_days = val;
    }

    if (body.default_publish_time !== undefined) {
      const val = String(body.default_publish_time).trim();
      if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(val)) {
        return NextResponse.json({ error: "تنسيق وقت النشر الافتراضي غير صالح (يجب أن يكون HH:mm مثل 18:00)." }, { status: 400 });
      }
      updates.default_publish_time = val;
    }

    if (body.timezone !== undefined) {
      updates.timezone = String(body.timezone).trim() || "Africa/Cairo";
    }

    if (Array.isArray(body.working_days)) {
      const days = body.working_days.map((d: any) => parseInt(d, 10)).filter((d: number) => d >= 0 && d <= 6);
      if (days.length === 0) {
        return NextResponse.json({ error: "يجب اختيار يوم عمل واحد على الأقل." }, { status: 400 });
      }
      updates.working_days = days;
    }

    updates.updated_at = new Date().toISOString();
    updates.updated_by_id = membership.rosterPersonId || null;

    // 2. Persist in database
    const { data: updated, error: updateErr } = await admin
      .from("workspace_deadline_settings")
      .update(updates)
      .eq("workspace_id", membership.workspaceId)
      .select()
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // 3. Audit log
    await admin.from("audit_events").insert({
      workspace_id: membership.workspaceId,
      actor_id: membership.rosterPersonId || null,
      action: "update_deadline_settings",
      entity_type: "workspace_deadline_settings",
      entity_id: updated.id,
      metadata: {
        updates,
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      message: "تم حفظ إعدادات مواعيد التسليم بنجاح.",
      settings: updated,
    });
  } catch (err: any) {
    console.error("Error in PATCH /api/workspace/deadline-settings:", err);
    return NextResponse.json({ error: err.message || "Failed to update settings" }, { status: 500 });
  }
}
