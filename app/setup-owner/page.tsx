import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasExistingOwner, getOrCreateSetupToken } from "@/lib/auth/owner-setup-token";
import SetupOwnerForm from "./SetupOwnerForm";

export const dynamic = "force-dynamic";

export default async function SetupOwnerPage() {
  // 1. Strict Environment Guard: only available in development
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  const admin = createAdminClient();
  if (!admin) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-4">
        <div className="bg-red-50 text-red-700 p-6 rounded-2xl border border-red-200 max-w-md text-center">
          <h2 className="text-lg font-bold mb-2">إعدادات Supabase غير متوفرة</h2>
          <p className="text-sm">يرجى التأكد من ضبط ملف .env.local والمتغيرات البيئية قبل المتابعة.</p>
        </div>
      </div>
    );
  }

  // 2. Lockout Guard: If an active owner already exists, redirect to login
  const ownerExists = await hasExistingOwner(admin);
  if (ownerExists) {
    redirect("/login");
  }

  // 3. Ensure a setup token exists on disk and pass it securely
  const token = getOrCreateSetupToken();

  return <SetupOwnerForm initialToken={token} />;
}
