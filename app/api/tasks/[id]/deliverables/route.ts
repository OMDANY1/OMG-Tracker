import { NextRequest, NextResponse } from "next/server";
import { requireTaskAccess, validateSameOrigin } from "@/lib/auth/server-auth";
import { getTaskDeliverables, submitTaskDeliverable } from "@/lib/services/tasks";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const access = await requireTaskAccess(req, params.id);
    if (!access.success) return access.errorResponse;

    const deliverables = await getTaskDeliverables(params.id);
    return NextResponse.json({ success: true, deliverables });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to fetch deliverables" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!validateSameOrigin(req)) {
    return NextResponse.json(
      { error: "رفض الطلب: انتهاك التحقق من مصدر الطلب (CSRF/Same-Origin)." },
      { status: 403 }
    );
  }

  const access = await requireTaskAccess(req, params.id);
  if (!access.success) return access.errorResponse;

  try {
    const body = await req.json();
    const { deliverableType, title, bodyContent, payload, deliverableUrl, notes } = body;

    if (!deliverableType) {
      return NextResponse.json({ error: "نوع التسليم مطلوب (deliverableType is required)" }, { status: 400 });
    }

    const result = await submitTaskDeliverable({
      taskId: params.id,
      deliverableType,
      title: title || null,
      bodyContent: bodyContent || null,
      payload: payload || {},
      deliverableUrl: deliverableUrl || null,
      notes: notes || null,
    });

    return NextResponse.json({ success: true, result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to submit deliverable" }, { status: 500 });
  }
}
