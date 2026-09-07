"use client";

import React, { useState, useEffect } from "react";
import { Play, Square, Pause, AlertCircle, Clock, ChevronDown, Check } from "lucide-react";
import { TIME_CATEGORY_LABELS, formatDurationSeconds } from "@/lib/utils";
import type { TimeCategory } from "@/types/database";

export function ActiveTimerBar() {
  const [activeTimer, setActiveTimer] = useState<any>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [category, setCategory] = useState<TimeCategory>("initial_design");
  const [note, setNote] = useState<string>("");
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  const fetchActive = async () => {
    try {
      const res = await fetch("/api/timer/active");
      if (res.ok) {
        const data = await res.json();
        if (data.timer) {
          setActiveTimer(data.timer);
          setCategory(data.timer.category);
          setNote(data.timer.note || "");
        } else {
          setActiveTimer(null);
        }
      }
    } catch {
      // Ignored if offline
    }
  };

  useEffect(() => {
    fetchActive();
    const handleTimerChange = () => fetchActive();
    window.addEventListener("timer_state_changed", handleTimerChange);
    window.addEventListener("persona_changed", handleTimerChange);
    return () => {
      window.removeEventListener("timer_state_changed", handleTimerChange);
      window.removeEventListener("persona_changed", handleTimerChange);
    };
  }, []);

  // Update elapsed seconds every second
  useEffect(() => {
    if (!activeTimer || !activeTimer.started_at) {
      setElapsedSeconds(0);
      return;
    }

    const startMs = new Date(activeTimer.started_at).getTime();
    const updateElapsed = () => {
      const nowMs = Date.now();
      const sec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
      setElapsedSeconds(sec);
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [activeTimer]);

  const handleStop = async () => {
    if (!activeTimer) return;
    setIsStopping(true);
    try {
      const res = await fetch("/api/timer/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timeEntryId: activeTimer.id,
          note: note,
        }),
      });
      if (res.ok) {
        setActiveTimer(null);
        window.dispatchEvent(new CustomEvent("timer_state_changed"));
      } else {
        const err = await res.json();
        alert(`فشل إيقاف المؤقت: ${err.error || "خطأ غير متوقع"}`);
      }
    } catch (e: any) {
      alert(`حدث خطأ: ${e.message}`);
    } finally {
      setIsStopping(false);
    }
  };

  if (!activeTimer) return null;

  const isLongSession = elapsedSeconds > 4 * 3600; // > 4 hours warning

  return (
    <div className="bg-slate-900 text-white px-4 py-2.5 shadow-md border-b border-sky-800 flex flex-wrap items-center justify-between gap-3 text-xs z-20 no-print animate-in slide-in-from-top-2 duration-200">
      {/* Task & Client Info */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <span className="font-semibold text-sky-300">عداد العمل نشط:</span>
        </div>

        <div className="font-medium text-slate-100 flex items-center gap-1.5">
          <span>{activeTimer.task?.title || "مهمة جارية"}</span>
          {activeTimer.task?.campaign?.client?.name && (
            <span className="text-slate-400">({activeTimer.task.campaign.client.name})</span>
          )}
        </div>

        {/* Category selector */}
        <div className="relative">
          <button
            onClick={() => setIsCategoryOpen(!isCategoryOpen)}
            className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded-lg border border-slate-700"
          >
            <span>{TIME_CATEGORY_LABELS[category]}</span>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          {isCategoryOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setIsCategoryOpen(false)} />
              <div className="absolute top-full mt-1 right-0 bg-slate-800 border border-slate-700 rounded-xl shadow-xl py-1 z-40 w-44">
                {(Object.keys(TIME_CATEGORY_LABELS) as TimeCategory[]).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => {
                      setCategory(cat);
                      setIsCategoryOpen(false);
                    }}
                    className={`w-full px-3 py-1.5 text-right flex items-center justify-between hover:bg-slate-700 ${
                      category === cat ? "text-sky-400 font-bold" : "text-slate-300"
                    }`}
                  >
                    <span>{TIME_CATEGORY_LABELS[cat]}</span>
                    {category === cat && <Check className="w-3.5 h-3.5" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Timer & Controls */}
      <div className="flex items-center gap-4">
        {isLongSession && (
          <div className="flex items-center gap-1 text-amber-400 bg-amber-950/80 px-2 py-1 rounded-md border border-amber-800/60">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>جلسة عمل طويلة جداً (تجاوزت 4 ساعات)</span>
          </div>
        )}

        <div className="flex items-center gap-1.5 bg-slate-800/80 px-3 py-1 rounded-lg font-mono text-sm font-bold text-emerald-400 border border-slate-700">
          <Clock className="w-4 h-4 text-slate-400" />
          <span>{formatDurationSeconds(elapsedSeconds)}</span>
        </div>

        <button
          onClick={handleStop}
          disabled={isStopping}
          className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-500 text-white px-3.5 py-1.5 rounded-lg font-semibold transition-colors shadow-xs"
        >
          <Square className="w-3.5 h-3.5 fill-white" />
          <span>{isStopping ? "جاري الحفظ..." : "إيقاف وحفظ الجلسة"}</span>
        </button>
      </div>
    </div>
  );
}
