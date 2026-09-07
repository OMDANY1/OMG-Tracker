"use client";

import React, { useState, useEffect } from "react";
import { User, ChevronDown } from "lucide-react";
import { ROSTER_ROLE_LABELS } from "@/lib/utils";

export interface ActivePersona {
  id: string;
  displayName: string;
  jobTitle: string;
  role: "owner" | "manager" | "senior_reviewer" | "designer";
}

export const PRESET_PERSONAS: ActivePersona[] = [
  { id: "emad-id", displayName: "عماد", jobTitle: "Owner & Art Director", role: "owner" },
  { id: "nada-id", displayName: "ندى", jobTitle: "Senior Graphic Designer", role: "senior_reviewer" },
  { id: "sarah-id", displayName: "سارة", jobTitle: "Midlevel Graphic Designer", role: "designer" },
  { id: "alaa-id", displayName: "آلاء", jobTitle: "Midlevel Graphic Designer", role: "designer" },
  { id: "shahd-id", displayName: "شهد", jobTitle: "Midlevel Graphic Designer", role: "designer" },
  { id: "aya-id", displayName: "آية", jobTitle: "Junior Graphic Designer", role: "designer" },
];

export function RoleSwitcher() {
  const [activePersona, setActivePersona] = useState<ActivePersona>(PRESET_PERSONAS[0]);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("omg_active_persona");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const match = PRESET_PERSONAS.find((p) => p.displayName === parsed.displayName);
        if (match) setActivePersona(match);
      } catch {}
    }
  }, []);

  const selectPersona = (p: ActivePersona) => {
    setActivePersona(p);
    localStorage.setItem("omg_active_persona", JSON.stringify(p));
    setDropdownOpen(false);
    window.dispatchEvent(new CustomEvent("persona_changed", { detail: p }));
  };

  return (
    <div className="relative">
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 bg-surface hover:bg-slate-50 transition-colors text-xs font-semibold text-slate-800"
      >
        <div className="w-5 h-5 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center font-bold text-[10px]">
          {activePersona.displayName.charAt(0)}
        </div>
        <div className="text-right">
          <div className="leading-tight">{activePersona.displayName}</div>
          <div className="text-[10px] text-slate-400 font-normal">{ROSTER_ROLE_LABELS[activePersona.role]}</div>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>

      {dropdownOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setDropdownOpen(false)} />
          <div className="absolute left-0 mt-1.5 w-60 rounded-xl bg-surface border border-slate-200 shadow-lg py-1.5 z-40 text-right">
            <div className="px-3 py-1 text-[11px] font-semibold text-slate-400 border-b border-slate-100">
              تبديل هوية المستخدم (Role Simulation):
            </div>
            {PRESET_PERSONAS.map((p) => (
              <button
                key={p.id}
                onClick={() => selectPersona(p)}
                className={`w-full px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 transition-colors ${
                  activePersona.displayName === p.displayName ? "bg-sky-50 text-sky-700 font-bold" : "text-slate-700"
                }`}
              >
                <div>
                  <div>{p.displayName}</div>
                  <div className="text-[10px] text-slate-400 font-normal">{p.jobTitle}</div>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                  {p.role}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
