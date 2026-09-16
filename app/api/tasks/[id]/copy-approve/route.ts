import { NextRequest, NextResponse } from "next/server";
import { requireTaskAccess, validateSameOrigin } from "@/lib/auth/server-auth";
import { approveCopywritingAndUnlockDownstream } from "@/lib/services/tasks";

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
    const { approvedCopy } = body;

    const result = await approveCopywritingAndUnlockDownstream({
      copyTaskId: params.id,
      approvedCopy: approvedCopy || "",
    });

    return NextResponse.json({ success: true, result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to approve copywriting" }, { status: 400 });
  }
}
