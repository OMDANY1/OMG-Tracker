"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogOut, User } from "lucide-react";

export function UserMenu() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;

    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        setUserEmail(data.user.email || "المستخدم");
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        setUserEmail(session.user.email || "المستخدم");
      } else {
        setUserEmail(null);
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

  if (!userEmail) return null;

  return (
    <div className="flex items-center gap-3">
      <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200/60 text-xs text-slate-700">
        <User className="w-3.5 h-3.5 text-slate-500" />
        <span className="font-medium max-w-[160px] truncate">{userEmail}</span>
      </div>
      <button
        onClick={handleLogout}
        className="flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100/80 px-2.5 py-1 rounded-lg border border-red-200/60 transition-colors font-medium"
        title="تسجيل الخروج"
      >
        <LogOut className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">خروج</span>
      </button>
    </div>
  );
}
