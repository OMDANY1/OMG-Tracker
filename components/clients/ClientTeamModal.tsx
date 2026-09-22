"use client";

import React, { useState, useEffect } from "react";
import { Users, X, Check, AlertTriangle, Shield, UserCheck, Video, Feather, Palette, Compass } from "lucide-react";
import type { Client } from "@/types/database";

interface ClientTeamModalProps {
  client: Client | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  allTeamMembers: any[];
  strategists: any[];
  writers: any[];
  designers: any[];
  videoEditors: any[];
  managers: any[];
}

export function ClientTeamModal({
  client,
  isOpen,
  onClose,
  onSaved,
  allTeamMembers,
  strategists,
  writers,
  designers,
  videoEditors,
  managers,
}: ClientTeamModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const team = client?.team_assignment;

  const [primaryStrategistId, setPrimaryStrategistId] = useState("");
  const [strategyReviewerId, setStrategyReviewerId] = useState("");
  const [primaryCopywriterId, setPrimaryCopywriterId] = useState("");
  const [copywritingReviewerId, setCopywritingReviewerId] = useState("");
  const [primaryDesignerId, setPrimaryDesignerId] = useState("");
  const [designReviewerId, setDesignReviewerId] = useState("");
  const [primaryVideoEditorId, setPrimaryVideoEditorId] = useState("");
  const [videoReviewerId, setVideoReviewerId] = useState("");
  const [marketingDirectorId, setMarketingDirectorId] = useState("");
  const [strategyLeadId, setStrategyLeadId] = useState("");

  useEffect(() => {
    if (client) {
      setPrimaryStrategistId(team?.primary_strategist_id || "");
      setStrategyReviewerId(team?.strategy_reviewer_id || "");
      setPrimaryCopywriterId(team?.primary_copywriter_id || "");
      setCopywritingReviewerId(team?.copywriting_reviewer_id || "");
      setPrimaryDesignerId(team?.primary_designer_id || client.owner_roster_id || "");
      setDesignReviewerId(team?.design_reviewer_id || "");
      setPrimaryVideoEditorId(team?.primary_video_editor_id || "");
      setVideoReviewerId(team?.video_reviewer_id || "");
      setMarketingDirectorId(team?.marketing_director_id || "");
      setStrategyLeadId(team?.strategy_lead_id || "");
      setError(null);
    }
  }, [client, team]);

  // Reviewers must exclude Marketing Director (Ata)
  const reviewerCandidates = allTeamMembers.filter(
    (p) => !p.displayName.includes("عطا") && p.jobTitle !== "Marketing Director"
  );

  if (!isOpen || !client) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/clients", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id,
          action: "update_team",
          primaryStrategistId: primaryStrategistId || null,
          strategyReviewerId: strategyReviewerId || null,
          primaryCopywriterId: primaryCopywriterId || null,
          copywritingReviewerId: copywritingReviewerId || null,
          primaryDesignerId: primaryDesignerId || null,
          designReviewerId: designReviewerId || null,
          primaryVideoEditorId: primaryVideoEditorId || null,
          videoReviewerId: videoReviewerId || null,
          marketingDirectorId: marketingDirectorId || null,
          strategyLeadId: strategyLeadId || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "فشل حفظ فريق العميل");
      }

      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || "حدث خطأ أثناء الحفظ");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-surface rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full p-6 text-right space-y-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
              <Users className="w-5 h-5 text-sky-600" />
              فريق عمل العميل: <span className="text-sky-700">{client.name}</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              توزيع وتعيين تخصصات الاستراتيجية والكتابة والتصميم والمونتاج مع مراجعي كل مسار
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          {/* Section 1: مسار الاستراتيجية */}
          <div className="p-3.5 bg-sky-50/40 rounded-xl border border-sky-100 space-y-3">
            <div className="text-xs font-bold text-sky-900 flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-sky-600" />
              مسار الاستراتيجية (Strategy Team)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">الاستراتيجيست الأساسي:</label>
                <select
                  value={primaryStrategistId}
                  onChange={(e) => setPrimaryStrategistId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 font-medium text-xs focus:ring-2 focus:ring-sky-500"
                >
                  <option value="">-- يحتاج تعيين استراتيجيست --</option>
                  {(strategists.length ? strategists : allTeamMembers).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName} ({p.jobTitle})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">مراجع الاستراتيجية:</label>
                <select
                  value={strategyReviewerId}
                  onChange={(e) => setStrategyReviewerId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 font-medium text-xs focus:ring-2 focus:ring-sky-500"
                >
                  <option value="">-- يحتاج تعيين مراجع --</option>
                  {reviewerCandidates.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName} ({p.jobTitle})
                    </option>
                  ))}
                </select>
                {!strategyReviewerId && (
                  <p className="text-[10px] text-amber-600 font-medium mt-1">⚠️ يحتاج تعيين مراجع معتمد</p>
                )}
              </div>
            </div>
          </div>

          {/* Section 2: مسار كتابة المحتوى */}
          <div className="p-3.5 bg-emerald-50/40 rounded-xl border border-emerald-100 space-y-3">
            <div className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
              <Feather className="w-4 h-4 text-emerald-600" />
              مسار كتابة المحتوى والاسكربت (Content & Copywriting)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">كاتب المحتوى الأساسي:</label>
                <select
                  value={primaryCopywriterId}
                  onChange={(e) => setPrimaryCopywriterId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 font-medium text-xs focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">-- يحتاج تعيين كاتب --</option>
                  {(writers.length ? writers : allTeamMembers).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName} ({p.jobTitle})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">مراجع المحتوى (الاستراتيجيست):</label>
                <select
                  value={copywritingReviewerId}
                  onChange={(e) => setCopywritingReviewerId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 font-medium text-xs focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">-- يحتاج تعيين مراجع --</option>
                  {reviewerCandidates.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName} ({p.jobTitle})
                    </option>
                  ))}
                </select>
                {!copywritingReviewerId && (
                  <p className="text-[10px] text-amber-600 font-medium mt-1">⚠️ يحتاج تعيين مراجع معتمد</p>
                )}
              </div>
            </div>
          </div>

          {/* Section 3: مسار التصميم الجرافيكي */}
          <div className="p-3.5 bg-purple-50/40 rounded-xl border border-purple-100 space-y-3">
            <div className="text-xs font-bold text-purple-900 flex items-center gap-1.5">
              <Palette className="w-4 h-4 text-purple-600" />
              مسار التصميم الجرافيكي (Graphic Design)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">المصمم الأساسي:</label>
                <select
                  value={primaryDesignerId}
                  onChange={(e) => setPrimaryDesignerId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 font-medium text-xs focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">-- يحتاج تعيين مصمم --</option>
                  {designers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName} ({p.jobTitle})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">مراجع التصميم (Art Director / Senior):</label>
                <select
                  value={designReviewerId}
                  onChange={(e) => setDesignReviewerId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 font-medium text-xs focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">-- يحتاج تعيين مراجع --</option>
                  {reviewerCandidates.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName} ({p.jobTitle})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Section 4: مسار الفيديو والمونتاج */}
          <div className="p-3.5 bg-amber-50/40 rounded-xl border border-amber-100 space-y-3">
            <div className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
              <Video className="w-4 h-4 text-amber-600" />
              مسار إنتاج ومونتاج الفيديو (Video Editing)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">الإيديتور الأساسي:</label>
                <select
                  value={primaryVideoEditorId}
                  onChange={(e) => setPrimaryVideoEditorId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 font-medium text-xs focus:ring-2 focus:ring-amber-500"
                >
                  <option value="">-- غير محدد (حسب الحاجة) --</option>
                  {(videoEditors.length ? videoEditors : allTeamMembers).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName} ({p.jobTitle})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">مراجع الفيديو المعتمد:</label>
                <select
                  value={videoReviewerId}
                  onChange={(e) => setVideoReviewerId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 font-medium text-xs focus:ring-2 focus:ring-amber-500"
                >
                  <option value="">-- يحتاج تعيين مراجع --</option>
                  {reviewerCandidates.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName} ({p.jobTitle})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Section 5: الإشراف والمتابعة الإدارية (عطا واروى) */}
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-slate-600" />
              نطاق المتابعة الإدارية (Marketing & Strategy Oversight)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">مدير التسويق (Marketing Director):</label>
                <select
                  value={marketingDirectorId}
                  onChange={(e) => setMarketingDirectorId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 font-medium text-xs focus:ring-2 focus:ring-slate-500"
                >
                  <option value="">-- غير مسند لمشرف محدد --</option>
                  {allTeamMembers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName} ({p.jobTitle})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">ليدر قسم الاستراتيجية (Strategy Lead):</label>
                <select
                  value={strategyLeadId}
                  onChange={(e) => setStrategyLeadId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 font-medium text-xs focus:ring-2 focus:ring-slate-500"
                >
                  <option value="">-- غير مسند لليدر محدد --</option>
                  {allTeamMembers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName} ({p.jobTitle})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>{loading ? "جارٍ الحفظ..." : "حفظ فريق العمل"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
