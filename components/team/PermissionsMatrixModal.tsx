"use client";

import React from "react";
import {
  X,
  Shield,
  ShieldCheck,
  Check,
  Minus,
  Lock,
  Eye,
  FileSpreadsheet,
  Users,
  Building2,
  Clock,
  Sparkles,
} from "lucide-react";
import { ROLE_PERMISSIONS_MATRIX, type RosterRole } from "@/types/database";

interface PermissionsMatrixModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PermissionsMatrixModal({ isOpen, onClose }: PermissionsMatrixModalProps) {
  if (!isOpen) return null;

  const roles = Object.entries(ROLE_PERMISSIONS_MATRIX) as [RosterRole, typeof ROLE_PERMISSIONS_MATRIX[RosterRole]][];

  const SCOPE_LABELS: Record<string, { label: string; badgeClass: string }> = {
    workspace: { label: "مساحة العمل كلها", badgeClass: "bg-purple-100 text-purple-800" },
    assigned_team: { label: "فريقه وتخصصه", badgeClass: "bg-blue-100 text-blue-800" },
    assigned_clients: { label: "العملاء المسندون له", badgeClass: "bg-sky-100 text-sky-800" },
    own_tasks: { label: "مهامه الخاصة فقط", badgeClass: "bg-slate-100 text-slate-700" },
    none: { label: "لا صلاحية", badgeClass: "bg-rose-100 text-rose-800" },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-surface rounded-2xl border border-slate-200 shadow-2xl max-w-5xl w-full p-4 sm:p-6 text-right space-y-4 animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2.5">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-sky-600" />
                مصفوفة الأدوار والصلاحيات المعتمدة
              </h2>
              <p className="text-xs text-slate-500">
                استعراض تفصيلي لنطاقات الوصول والصلاحيات الممنوحة لكل دور صلاحياتي في مساحة العمل
              </p>
            </div>
            <div className="p-2 rounded-xl bg-sky-100 text-sky-700 hidden sm:block">
              <Shield className="w-5 h-5 text-sky-600" />
            </div>
          </div>
        </div>

        {/* Informational Guidance Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="p-3 bg-purple-50/70 border border-purple-200 rounded-xl space-y-1">
            <span className="font-bold text-purple-900 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-purple-700" />
              مدير النظام (عماد)
            </span>
            <p className="text-purple-800 text-[11px] leading-relaxed">
              إدارة كاملة للنظام والفريق والعملاء والمهام. محمي بقيد صارم يمنع تعطيل أو خفض رتبة آخر مدير عام نشط.
            </p>
          </div>

          <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl space-y-1">
            <span className="font-bold text-amber-900 flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 text-amber-700" />
              مالك الشركة (مشاهد فقط)
            </span>
            <p className="text-amber-800 text-[11px] leading-relaxed">
              قراءة واسعة وشاملة لكافة البيانات والتقارير. حظر كامل ومطلق لكافة عمليات الكتابة أو التعديل أو التصدير.
            </p>
          </div>

          <div className="p-3 bg-sky-50/70 border border-sky-200 rounded-xl space-y-1">
            <span className="font-bold text-sky-900 flex items-center gap-1.5">
              <FileSpreadsheet className="w-3.5 h-3.5 text-sky-700" />
              مدير التسويق (عطا)
            </span>
            <p className="text-sky-800 text-[11px] leading-relaxed">
              صلاحيات قراءة شاملة وتصدير التقارير وسجلات الوقت والتقييمات، دون صلاحية تعديل العملاء أو إسناد الفريق.
            </p>
          </div>
        </div>

        {/* Matrix Table */}
        <div className="border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
              <tr>
                <th className="p-3 whitespace-nowrap">الدور في النظام</th>
                <th className="p-3 whitespace-nowrap">نطاق الصلاحية</th>
                <th className="p-2.5 text-center whitespace-nowrap">عرض البيانات</th>
                <th className="p-2.5 text-center whitespace-nowrap">إدارة العملاء</th>
                <th className="p-2.5 text-center whitespace-nowrap">إسناد الفرق</th>
                <th className="p-2.5 text-center whitespace-nowrap">الاعتماد والمراجعة</th>
                <th className="p-2.5 text-center whitespace-nowrap">تشغيل المؤقت</th>
                <th className="p-2.5 text-center whitespace-nowrap">عرض الوقت والتقارير</th>
                <th className="p-2.5 text-center whitespace-nowrap">تصدير التقارير</th>
                <th className="p-2.5 text-center whitespace-nowrap">إدارة النظام</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {roles.map(([roleKey, cfg]) => {
                const scopeInfo = SCOPE_LABELS[cfg.scope] || { label: cfg.scope, badgeClass: "bg-slate-100 text-slate-700" };
                const canViewTimeLogs = roleKey !== "designer" && roleKey !== "content_writer" && roleKey !== "video_editor";
                return (
                  <tr key={roleKey} className="hover:bg-slate-50/60 transition-colors">
                    <td className="p-3 font-bold text-slate-900">
                      <div>
                        <div className="text-slate-900 font-bold">{cfg.label}</div>
                        <div className="text-[10px] text-slate-500 font-normal mt-0.5">{cfg.description}</div>
                      </div>
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${scopeInfo.badgeClass}`}>
                        {scopeInfo.label}
                      </span>
                    </td>
                    <td className="p-2.5 text-center">
                      {cfg.canViewData ? (
                        <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                      ) : (
                        <Minus className="w-4 h-4 text-slate-300 mx-auto" />
                      )}
                    </td>
                    <td className="p-2.5 text-center">
                      {cfg.canManageClients ? (
                        <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                      ) : (
                        <Minus className="w-4 h-4 text-slate-300 mx-auto" />
                      )}
                    </td>
                    <td className="p-2.5 text-center">
                      {cfg.canAssignTeam ? (
                        <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                      ) : (
                        <Minus className="w-4 h-4 text-slate-300 mx-auto" />
                      )}
                    </td>
                    <td className="p-2.5 text-center">
                      {cfg.canApproveReviews ? (
                        <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                      ) : (
                        <Minus className="w-4 h-4 text-slate-300 mx-auto" />
                      )}
                    </td>
                    <td className="p-2.5 text-center">
                      {cfg.canTrackTime ? (
                        <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                      ) : (
                        <Minus className="w-4 h-4 text-slate-300 mx-auto" />
                      )}
                    </td>
                    <td className="p-2.5 text-center">
                      {canViewTimeLogs ? (
                        <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                      ) : (
                        <Minus className="w-4 h-4 text-slate-300 mx-auto" />
                      )}
                    </td>
                    <td className="p-2.5 text-center">
                      {cfg.canExportReports ? (
                        <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                      ) : (
                        <Minus className="w-4 h-4 text-slate-300 mx-auto" />
                      )}
                    </td>
                    <td className="p-2.5 text-center">
                      {cfg.canManageWorkspace ? (
                        <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                      ) : (
                        <Minus className="w-4 h-4 text-slate-300 mx-auto" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>يتم تطبيق كافة الصلاحيات المذكورة على مستوى الخادم (Server-Side) وقواعد RLS.</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
