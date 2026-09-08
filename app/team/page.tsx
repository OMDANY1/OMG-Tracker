"use client";

import React, { useState, useEffect } from "react";
import {
  Users,
  Briefcase,
  Shield,
  Clock,
  TrendingUp,
  Mail,
  UserCheck,
  CheckCircle2,
  Sliders,
  AlertCircle,
} from "lucide-react";
import { ROSTER_ROLE_LABELS, cn } from "@/lib/utils";

export default function TeamPage() {
  const [teamMembers] = useState([
    {
      id: "emad-id",
      displayName: "عماد عادل",
      jobTitle: "Owner & Art Director",
      role: "owner",
      weeklyHours: 40,
      reservedHours: 15,
      activeClients: 3,
      activeTasks: 4,
      plannedLoadRatio: 85,
      notes: "مالك الايجنسي والمدير الفني (Art Director): إدارة استراتيجية وتوجيه فني ومراجعة الحسابات الصعبة",
    },
    {
      id: "nada-id",
      displayName: "ندى عبد النبي",
      jobTitle: "Senior Graphic Designer",
      role: "senior_reviewer",
      weeklyHours: 40,
      reservedHours: 8,
      activeClients: 5,
      activeTasks: 6,
      plannedLoadRatio: 78,
      notes: "مراجع أول + مراجعة كافة تصاميم آية وتصاميم عماد",
    },
    {
      id: "sarah-id",
      displayName: "سارة",
      jobTitle: "Midlevel Graphic Designer",
      role: "designer",
      weeklyHours: 40,
      reservedHours: 0,
      activeClients: 5,
      activeTasks: 7,
      plannedLoadRatio: 72,
      notes: "مصممة إنتاج أساسية للحسابات المتوسطة والصعبة",
    },
    {
      id: "alaa-id",
      displayName: "آلاء حسام",
      jobTitle: "Midlevel Graphic Designer",
      role: "designer",
      weeklyHours: 40,
      reservedHours: 0,
      activeClients: 5,
      activeTasks: 8,
      plannedLoadRatio: 88,
      notes: "مصممة إنتاج لحسابات ذات طلبات مكثفة (Travia Care)",
    },
    {
      id: "shahd-id",
      displayName: "شهد لاشين",
      jobTitle: "Midlevel Graphic Designer",
      role: "designer",
      weeklyHours: 40,
      reservedHours: 0,
      activeClients: 5,
      activeTasks: 6,
      plannedLoadRatio: 80,
      notes: "مصممة إنتاج لحسابات ذات تعديلات متكررة (Nasef)",
    },
    {
      id: "aya-id",
      displayName: "آية حمزة",
      jobTitle: "Junior Graphic Designer",
      role: "designer",
      weeklyHours: 40,
      reservedHours: 0,
      activeClients: 4,
      activeTasks: 5,
      plannedLoadRatio: 65,
      notes: "مصممة مبتدئة: تراجع كافة مهامها داخلياً بواسطة ندى",
    },
  ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">فريق العمل والطاقة الاستيعابية</h1>
          <p className="text-sm text-slate-500 mt-1">
            إدارة أعضاء الفريق، صلاحيات النظام، الساعات المتاحة، ومعدل الحمل المخطط (Planned Load)
          </p>
        </div>
      </div>

      {/* Roster Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {teamMembers.map((member) => {
          const isHighLoad = member.plannedLoadRatio > 85;

          return (
            <div
              key={member.id}
              className="bg-surface rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-sky-300 hover:shadow-sm transition-all flex flex-col justify-between text-xs space-y-4"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-900 text-white font-bold flex items-center justify-center text-sm shadow-xs">
                      {member.displayName.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-bold text-base text-slate-900 leading-tight">
                        {member.displayName}
                      </h3>
                      <p className="text-slate-500 text-[11px] mt-0.5">{member.jobTitle}</p>
                    </div>
                  </div>

                  <span className="px-2 py-0.5 rounded-md font-semibold text-[10px] bg-slate-100 text-slate-700">
                    {ROSTER_ROLE_LABELS[member.role as keyof typeof ROSTER_ROLE_LABELS]}
                  </span>
                </div>

                <div className="mt-4 space-y-2 text-slate-600 text-[11px] pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">ساعات العمل الأسبوعية:</span>
                    <span className="font-bold text-slate-800">{member.weeklyHours} ساعة / أسبوع</span>
                  </div>

                  {member.reservedHours > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">ساعات محجوزة للإدارة والمراجعة:</span>
                      <span className="font-semibold text-purple-700">{member.reservedHours} ساعة</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">الحسابات المسندة (Clients):</span>
                    <span className="font-bold text-sky-700">{member.activeClients} عملاء</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">المهام المفتوحة:</span>
                    <span className="font-bold text-slate-800">{member.activeTasks} مهام</span>
                  </div>

                  {/* Planned Load Ratio */}
                  <div className="pt-2 border-t border-slate-100 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-semibold">معدل الحمل المخطط (Planned Load):</span>
                      <span
                        className={cn(
                          "font-bold font-mono",
                          isHighLoad ? "text-rose-600" : "text-emerald-700"
                        )}
                      >
                        {member.plannedLoadRatio}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={cn(
                          "h-1.5 rounded-full transition-all",
                          isHighLoad ? "bg-rose-500" : "bg-emerald-500"
                        )}
                        style={{ width: `${member.plannedLoadRatio}%` }}
                      />
                    </div>
                  </div>

                  {member.notes && (
                    <div className="text-[11px] text-slate-400 italic pt-1">
                      {member.notes}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
