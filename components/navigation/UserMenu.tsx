"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogOut, User, Shield } from "lucide-react";
import { ROSTER_ROLE_LABELS } from "@/lib/utils";
import type { RosterRole } from "@/types/database";

interface UserProfile {
  email: string;
  displayName: string;
  role: RosterRole | null;
}

export function UserMenu() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    // Purge any residual role simulation state
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem("omg_active_persona");
      }
    } catch {}

    const fetchMe = async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          setProfile({
            email: data.user?.email || "",
            displayName: data.membership?.displayName || data.user?.email?.split("@")[0] || "المستخدم",
            role: data.membership?.role || null,
          });
          return;
        }
      } catch {}

      // Fallback to supabase auth directly
      const supabase = createClient();
      if (supabase) {
        const { data } = await supabase.auth.getUser();
        if (data?.user) {
          setProfile({
            email: data.user.email || "",
            displayName: data.user.email?.split("@")[0] || "المستخدم",
            role: null,
          });
        }
      }
    };

    fetchMe();

    const supabase = createClient();
    if (!supabase) return;

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        fetchMe();
      } else {
        setProfile(null);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    router.push("/login");
    router.refresh();
  };

  if (!profile) return null;

  const roleLabel = profile.role ? ROSTER_ROLE_LABELS[profile.role] || profile.role : null;

  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100/90 border border-slate-200/80 text-xs text-slate-800">
        <div className="w-6 h-6 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center font-bold text-xs shrink-0">
          {profile.displayName.charAt(0).toUpperCase()}
        </div>
        <div className="text-right leading-tight min-w-0">
          <div className="font-bold truncate max-w-[130px]">{profile.displayName}</div>
          {roleLabel && (
            <div className="text-[10px] text-sky-700 font-semibold truncate max-w-[150px]">
              {roleLabel}
            </div>
          )}
        </div>
      </div>

      <button
        onClick={handleLogout}
        className="flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100/80 px-2.5 py-1.5 rounded-xl border border-red-200/60 transition-colors font-medium shrink-0"
        title="تسجيل الخروج"
      >
        <LogOut className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">خروج</span>
      </button>
    </div>
  );
}
