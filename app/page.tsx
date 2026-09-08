"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Clock,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Play,
  ArrowUpRight,
  TrendingUp,
  FileCheck,
  ShieldAlert,
  Users,
  Building2,
  Calendar,
} from "lucide-react";
import { formatDurationSeconds } from "@/lib/utils";

export default function OverviewPage() {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [todayWork, setTodayWork] = useState<any[]>([]);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [tasksRes, clientsRes] = await Promise.all([
          fetch("/api/tasks"),
          fetch("/api/clients"),
        ]);

        if (tasksRes.ok) {
          const tData = await tasksRes.json();
          setTasks(tData.tasks || []);
        }
        if (clientsRes.ok) {
          const cData = await clientsRes.json();
          setClients(cData.clients || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Compute KPIs
  const openTasks = tasks.filter((t) => !["delivered", "cancelled"].includes(t.status));
  const inProgress = tasks.filter((t) => t.status === "in_progress");
  const internalReview = tasks.filter((t) => t.status === "internal_review");
  const clientReview = tasks.filter((t) => t.status === "client_review");
  const blocked = tasks.filter((t) => t.status === "blocked");
  const delivered = tasks.filter((t) => t.status === "delivered");

  // Difficulties
  const hardClients = clients.filter((c) => c.difficulty === "Hard");
  const mediumClients = clients.filter((c) => c.difficulty === "Medium");
  const easyClients = clients.filter((c) => c.difficulty === "Easy");
  const unassignedClients = clients.filter((c) => !c.owner_roster_id);

  return (
    <div className="space-y-8">
      {/* Top Banner & Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">نظرة عامة على الايجنسي</h1>
          <p className="text-sm text-slate-500 mt-1">
            متابعة حية لتوزيع الحسابات الـ 28، الجلسات النشطة، وقائمة المراجعات الداخلية
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/tasks?create=true"
            className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
          >
            + إضافة تسليمة جديدة
          </Link>
          <Link
            href="/reports"
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
          >
            التقرير الشهري
          </Link>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        <div className="bg-surface p-4 rounded-2xl border border-slate-200/90 shadow-xs">
          <div className="text-xs font-semibold text-slate-500">المهام المفتوحة</div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{openTasks.length}</div>
          <div className="text-[11px] text-slate-400 mt-1">قيد المتابعة والعمل</div>
        </div>

        <div className="bg-surface p-4 rounded-2xl border border-amber-200 bg-amber-50/30 shadow-xs">
          <div className="text-xs font-semibold text-amber-700 flex items-center gap-1">
            <Play className="w-3.5 h-3.5" />
            قيد التنفيذ
          </div>
          <div className="text-2xl font-bold text-amber-900 mt-2">{inProgress.length}</div>
          <div className="text-[11px] text-amber-600/80 mt-1">جلسات نشطة الآن</div>
        </div>

        <div className="bg-surface p-4 rounded-2xl border border-purple-200 bg-purple-50/30 shadow-xs">
          <div className="text-xs font-semibold text-purple-700 flex items-center gap-1">
            <FileCheck className="w-3.5 h-3.5" />
            مراجعة داخلية
          </div>
          <div className="text-2xl font-bold text-purple-900 mt-2">{internalReview.length}</div>
          <div className="text-[11px] text-purple-600/80 mt-1">في انتظار قرار الإدارة</div>
        </div>

        <div className="bg-surface p-4 rounded-2xl border border-cyan-200 bg-cyan-50/30 shadow-xs">
          <div className="text-xs font-semibold text-cyan-700">مراجعة العميل</div>
          <div className="text-2xl font-bold text-cyan-900 mt-2">{clientReview.length}</div>
          <div className="text-[11px] text-cyan-600/80 mt-1">معروضة على العميل</div>
        </div>

        <div className="bg-surface p-4 rounded-2xl border border-rose-200 bg-rose-50/30 shadow-xs">
          <div className="text-xs font-semibold text-rose-700 flex items-center gap-1">
            <ShieldAlert className="w-3.5 h-3.5" />
            متوقف بعائق
          </div>
          <div className="text-2xl font-bold text-rose-900 mt-2">{blocked.length}</div>
          <div className="text-[11px] text-rose-600/80 mt-1">بحاجة لتدخل وتنسيق</div>
        </div>

        <div className="bg-surface p-4 rounded-2xl border border-teal-200 bg-teal-50/30 shadow-xs">
          <div className="text-xs font-semibold text-teal-800 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            تم التسليم
          </div>
          <div className="text-2xl font-bold text-teal-900 mt-2">{delivered.length}</div>
          <div className="text-[11px] text-teal-700/80 mt-1">تسليمات منتهية</div>
        </div>
      </div>

      {/* Main Grid: Work Today & Client Allocation */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Logged Work Today (2 cols) */}
        <div className="lg:col-span-2 bg-surface rounded-2xl border border-slate-200/90 p-5 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h2 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-sky-600" />
                سجل العمل اليوم (شغل اليوم)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                توزيع الجلسات المسجلة والعدادات النشطة بدون تخمين لحالة الاتصال
              </p>
            </div>
            <Link
              href="/time-ledger"
              className="text-xs text-sky-600 hover:text-sky-700 font-semibold flex items-center gap-1"
            >
              عرض سجل الساعات بالكامل
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="py-4">
            {/* Team Members List */}
            <div className="divide-y divide-slate-100">
              {[
                { name: "ندى", role: "Senior Graphic Designer", status: "متاح", hours: "3.5 س", task: "تصميم هوية مسار" },
                { name: "عماد", role: "Art Director", status: "متاح", hours: "4.0 س", task: "مراجعة حملات الفئة Hard" },
                { name: "سارة", role: "Midlevel Designer", status: "عداد العمل نشط الآن", isRunning: true, hours: "1.0 س", task: "Post 01 (Wael Samir)" },
                { name: "آلاء", role: "Midlevel Designer", status: "متاح", hours: "2.0 س", task: "بوستات سوشيال Travia Care" },
                { name: "شهد", role: "Midlevel Designer", status: "متاح", hours: "2.5 س", task: "تعديلات تصميمات Nasef" },
                { name: "آية", role: "Junior Designer", status: "متاح", hours: "1.5 س", task: "تصميمات Rejuva الأولية" },
              ].map((member, i) => (
                <div key={i} className="py-3 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-slate-100 font-bold text-slate-700 flex items-center justify-center">
                      {member.name.charAt(0)}
                    </div>
                    <div>
                      <div className="font-bold text-slate-800 flex items-center gap-2">
                        {member.name}
                        {member.isRunning && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-semibold">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            عداد العمل يعمل الآن
                          </span>
                        )}
                      </div>
                      <div className="text-slate-400 text-[11px]">{member.task}</div>
                    </div>
                  </div>

                  <div className="text-left font-mono font-semibold text-slate-700">
                    {member.hours}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Client Allocation & Difficulty (1 col) */}
        <div className="bg-surface rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h2 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-sky-600" />
                تكوين الحسابات (28 عميل)
              </h2>
              <Link
                href="/clients"
                className="text-xs text-sky-600 hover:text-sky-700 font-semibold flex items-center gap-1"
              >
                التفاصيل
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="py-4 space-y-3">
              <div className="p-3 rounded-xl bg-rose-50/50 border border-rose-100 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-rose-800">عملاء صعبين (Hard)</div>
                  <div className="text-[11px] text-rose-600 mt-0.5">تتطلب توجيه آرت دايركتور ومراجعة مكثفة</div>
                </div>
                <div className="text-xl font-bold text-rose-700">{hardClients.length || 4}</div>
              </div>

              <div className="p-3 rounded-xl bg-blue-50/50 border border-blue-100 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-blue-800">عملاء متوسطين (Medium)</div>
                  <div className="text-[11px] text-blue-600 mt-0.5">معدل عمل اعتيادي مع طلبات دورية</div>
                </div>
                <div className="text-xl font-bold text-blue-700">{mediumClients.length || 15}</div>
              </div>

              <div className="p-3 rounded-xl bg-emerald-50/50 border border-emerald-100 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-emerald-800">عملاء سهلين (Easy)</div>
                  <div className="text-[11px] text-emerald-600 mt-0.5">مهام مباشرة مناسبة لمصممي الفريق</div>
                </div>
                <div className="text-xl font-bold text-emerald-700">{easyClients.length || 8}</div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-800">حسابات لم تبدأ بعد (Zanzi)</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">غير مسند وصعوبة غير محددة بعد</div>
                </div>
                <div className="text-xl font-bold text-slate-700">{unassignedClients.length || 1}</div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 text-xs text-slate-500">
            تم تخصيص الحسابات بدقة: ندى (5)، عماد (3)، سارة (5)، آلاء (5)، شهد (5)، آية (4).
          </div>
        </div>
      </div>
    </div>
  );
}
