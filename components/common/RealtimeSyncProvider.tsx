"use client";

import React, { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export function RealtimeSyncProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // 1. Purge legacy role simulation state if present in browser storage
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem("omg_active_persona");
      }
    } catch {}

    const supabase = createClient();
    if (!supabase) return;

    // 2. Setup Realtime subscription on core tables
    const channel = supabase
      .channel("omg_realtime_data_sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        (payload) => {
          window.dispatchEvent(new CustomEvent("tasks_data_changed", { detail: payload }));
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "clients" },
        (payload) => {
          window.dispatchEvent(new CustomEvent("clients_data_changed", { detail: payload }));
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "roster_people" },
        (payload) => {
          window.dispatchEvent(new CustomEvent("team_data_changed", { detail: payload }));
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "workspace_memberships" },
        (payload) => {
          window.dispatchEvent(new CustomEvent("membership_data_changed", { detail: payload }));
          window.dispatchEvent(new CustomEvent("team_data_changed", { detail: payload }));
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "time_entries" },
        (payload) => {
          window.dispatchEvent(new CustomEvent("timer_state_changed", { detail: payload }));
        }
      )
      .subscribe();

    // 3. Re-sync triggers on tab focus or visibility return
    let lastFocusSync = Date.now();
    const handleRevalidation = () => {
      const now = Date.now();
      // Throttle revalidation to avoid spamming within 5 seconds
      if (now - lastFocusSync > 5000) {
        lastFocusSync = now;
        window.dispatchEvent(new CustomEvent("window_reconnected_sync"));
      }
    };

    window.addEventListener("focus", handleRevalidation);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        handleRevalidation();
      }
    });

    return () => {
      window.removeEventListener("focus", handleRevalidation);
      supabase.removeChannel(channel);
    };
  }, []);

  return <>{children}</>;
}
