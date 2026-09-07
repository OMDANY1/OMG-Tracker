import { createAdminClient } from "./admin";

export interface DatabaseDiagnosticResult {
  status: "connected" | "unconfigured" | "error";
  message: string;
  isRealDatabaseConnected: boolean;
  missingEnvVars: string[];
  tablesFound?: string[];
  clientCount?: number;
  rosterCount?: number;
  errorDetail?: string;
}

export async function checkDatabaseConnection(): Promise<DatabaseDiagnosticResult> {
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL.includes("your-project-ref")) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.includes("your-publishable-anon-key")) {
    missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY.includes("your-supabase-service-role-key")) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }

  if (missing.length > 0) {
    return {
      status: "unconfigured",
      message: `قاعدة بيانات Supabase غير مهيأة بعد. المتغيرات الناقصة: ${missing.join(", ")}`,
      isRealDatabaseConnected: false,
      missingEnvVars: missing,
    };
  }

  const adminClient = createAdminClient();
  if (!adminClient) {
    return {
      status: "unconfigured",
      message: "تعذر إنشاء عميل Supabase الإداري بسبب غياب المفاتيح في متغيرات البيئة.",
      isRealDatabaseConnected: false,
      missingEnvVars: missing,
    };
  }

  try {
    // Perform a real read test on the clients and roster_people tables
    const { count: clientsCount, error: clientsErr } = await adminClient
      .from("clients")
      .select("*", { count: "exact", head: true });

    if (clientsErr) {
      return {
        status: "error",
        message: `فشل الاتصال بقاعدة بيانات Supabase: ${clientsErr.message}`,
        isRealDatabaseConnected: false,
        missingEnvVars: [],
        errorDetail: clientsErr.message,
      };
    }

    const { count: rosterCount, error: rosterErr } = await adminClient
      .from("roster_people")
      .select("*", { count: "exact", head: true });

    if (rosterErr) {
      return {
        status: "error",
        message: `فشل استعلام جدول الفريق في Supabase: ${rosterErr.message}`,
        isRealDatabaseConnected: false,
        missingEnvVars: [],
        errorDetail: rosterErr.message,
      };
    }

    return {
      status: "connected",
      message: "تم التحقق الفعلي من الاتصال بقاعدة بيانات Supabase بنجاح (قراءة وكتابة حقيقية).",
      isRealDatabaseConnected: true,
      missingEnvVars: [],
      clientCount: clientsCount || 0,
      rosterCount: rosterCount || 0,
    };
  } catch (err: any) {
    return {
      status: "error",
      message: `حدث خطأ غير متوقع أثناء فحص الاتصال بقاعدة البيانات: ${err.message || String(err)}`,
      isRealDatabaseConnected: false,
      missingEnvVars: [],
      errorDetail: err.message || String(err),
    };
  }
}
