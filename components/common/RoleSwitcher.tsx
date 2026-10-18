"use client";

import React, { useState, useEffect } from "react";
import { User, ChevronDown } from "lucide-react";
import { ROSTER_ROLE_LABELS } from "@/lib/utils";
import type { RosterRole } from "@/types/database";

export interface ActivePersona {
  id: string;
  displayName: string;
  jobTitle: string;
  role: RosterRole;
  specialty?: string;
}

export const PRESET_PERSONAS: ActivePersona[] = [
  { id: "emad-id", displayName: "عماد", jobTitle: "Art Director", role: "owner" },
  { id: "ata-id", displayName: "عطا", jobTitle: "Marketing Director", role: "marketing_director", specialty: "management" },
  { id: "arwa-id", displayName: "اروى", jobTitle: "Strategy Team Lead", role: "strategy_lead", specialty: "strategy" },
  { id: "tasneem-id", displayName: "تسنيم", jobTitle: "Strategist", role: "strategist", specialty: "strategy" },
  { id: "hind-id", displayName: "هند", jobTitle: "Strategist", role: "strategist", specialty: "strategy" },
  { id: "hagar-id", displayName: "هاجر حسن", jobTitle: "Strategist", role: "strategist", specialty: "strategy" },
  { id: "mirhan-id", displayName: "ميرهان", jobTitle: "Content Writer", role: "content_writer", specialty: "copywriting" },
  { id: "mayar-id", displayName: "ميار", jobTitle: "Content Writer", role: "content_writer", specialty: "copywriting" },
  { id: "reham-id", displayName: "ريهام", jobTitle: "Content Writer", role: "content_writer", specialty: "copywriting" },
  { id: "nada-id", displayName: "ندى", jobTitle: "Senior Graphic Designer", role: "senior_reviewer", specialty: "design" },
  { id: "sarah-id", displayName: "سارة", jobTitle: "Midlevel Graphic Designer", role: "designer", specialty: "design" },
  { id: "alaa-id", displayName: "آلاء", jobTitle: "Midlevel Graphic Designer", role: "designer", specialty: "design" },
  { id: "shahd-id", displayName: "شهد", jobTitle: "Midlevel Graphic Designer", role: "designer", specialty: "design" },
  { id: "aya-id", displayName: "آية", jobTitle: "Junior Graphic Designer", role: "designer", specialty: "design" },
  { id: "viewer-id", displayName: "مالك الشركة (مشاهد)", jobTitle: "Business Owner Viewer", role: "business_owner_viewer" },
];

export function RoleSwitcher() {
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem("omg_active_persona");
      }
    } catch {}
  }, []);

  return null;
}

