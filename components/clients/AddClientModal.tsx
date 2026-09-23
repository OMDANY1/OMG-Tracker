"use client";

import React, { useState } from "react";
import {
  X,
  Building2,
  Palette,
  Feather,
  Compass,
  Video,
  FileText,
  Link2,
  CheckCircle2,
  AlertCircle,
  Shield,
  HelpCircle,
} from "lucide-react";
import {
  CLIENT_DIFFICULTY_LABELS,
  CLIENT_EXTRA_WORKLOAD_LABELS,
  cn,
} from "@/lib/utils";
import type { ClientDifficulty, ClientExtraWorkload, ClientState } from "@/types/database";

interface AddClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  designers: any[];
  writers: any[];
  strategists: any[];
  videoEditors: any[];
  allTeamMembers: any[];
}

export function AddClientModal({
  isOpen,
  onClose,
  onSuccess,
  designers,
  writers,
  strategists,
  videoEditors,
  allTeamMembers,
}: AddClientModalProps) {
  const [name, setName] = useState("");
  const [difficulty, setDifficulty] = useState<ClientDifficulty>("Medium");
  const [extraWorkload, setExtraWorkload] = useState<ClientExtraWorkload>("None");
  const [notes, setNotes] = useState("");
  const [brandGuideUrl, setBrandGuideUrl] = useState("");
  const [briefUrl, setBriefUrl] = useState("");

  // Services toggles
  const [enableDesign, setEnableDesign] = useState(true);
  const [enableCopywriting, setEnableCopywriting] = useState(false);
  const [enableStrategy, setEnableStrategy] = useState(false);
  const [enableVideo, setEnableVideo] = useState(false);

  // Assignment states
  const [primaryDesignerId, setPrimaryDesignerId] = useState("");
  const [designReviewerId, setDesignReviewerId] = useState("");

  const [primaryCopywriterId, setPrimaryCopywriterId] = useState("");
  const [copywritingReviewerId, setCopywritingReviewerId] = useState("");

  const [primaryStrategistId, setPrimaryStrategistId] = useState("");
  const [strategyReviewerId, setStrategyReviewerId] = useState("");

  const [primaryVideoEditorId, setPrimaryVideoEditorId] = useState("");
  const [videoReviewerId, setVideoReviewerId] = useState("");

  // Brief details
  const [objectives, setObjectives] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [assetsDriveUrl, setAssetsDriveUrl] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const reviewerCandidates = allTeamMembers.filter(
    (m) =>
      m.role === "owner" ||
      m.role === "manager" ||
      m.role === "senior_reviewer" ||
      m.role === "strategy_lead" ||
      m.role === "marketing_director"
  );

  const handleSubmit = async (targetState: ClientState) => {
    if (!name.trim()) {
      setErrorMsg("يرجى إدخال اسم العميل.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          difficulty,
          extraWorkload,
          state: targetState,
          notes: notes.trim() || null,
          brandGuideUrl: brandGuideUrl.trim() || null,
          briefUrl: briefUrl.trim() || null,

          // Design
          primaryDesignerId: enableDesign ? primaryDesignerId || null : null,
          designReviewerId: enableDesign ? designReviewerId || null : null,

          // Copywriting
          primaryCopywriterId: enableCopywriting ? primaryCopywriterId || null : null,
          copywritingReviewerId: enableCopywriting ? copywritingReviewerId || null : null,

          // Strategy
          primaryStrategistId: enableStrategy ? primaryStrategistId || null : null,
          strategyReviewerId: enableStrategy ? strategyReviewerId || null : null,

          // Video
          requiresVideo: enableVideo,
          primaryVideoEditorId: enableVideo ? primaryVideoEditorId || null : null,
          videoReviewerId: enableVideo ? videoReviewerId || null : null,

          // Brief
          objectives: objectives.trim() || null,
          targetAudience: targetAudience.trim() || null,
          assetsDriveUrl: assetsDriveUrl.trim() || null,
          brandGuidelinesUrl: brandGuideUrl.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "فشل إنشاء حساب العميل.");
      }

      setSuccessMsg(data.message || "تم إنشاء العميل بنجاح!");
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (err: any) {
      setErrorMsg(err.message || "حدث خطأ غير متوقع.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto overflow-x-hidden">
      <div className="bg-surface rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full p-4 sm:p-6 text-right space-y-5 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto overflow-x-hidden">
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
              <h2 className="text-lg font-bold text-slate-900">إضافة عميل جديد وتعيين مسارات العمل</h2>
              <p className="text-xs text-slate-500">إدخال بيانات الحساب واختيار الخدمات وتعيين الفريق المسؤول</p>
            </div>
            <div className="p-2.5 rounded-xl bg-sky-100 text-sky-700">
              <Building2 className="w-6 h-6 text-sky-600" />
            </div>
          </div>
        </div>

        {/* Alerts */}
        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Form Body */}
        <div className="space-y-4 text-xs">
          {/* Section 1: Basic Info */}
          <div className="bg-slate-50/70 p-3.5 rounded-xl border border-slate-200 space-y-3">
            <div className="font-bold text-slate-900 flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-slate-600" />
              البيانات الأساسية للعميل
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">اسم العميل / البراند *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: Zen Coffee"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 text-xs focus:ring-2 focus:ring-sky-500 outline-none"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">درجة الصعوبة المتوقعة</label>
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value as ClientDifficulty)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 text-xs focus:ring-2 focus:ring-sky-500 outline-none"
                >
                  <option value="Easy">{CLIENT_DIFFICULTY_LABELS.Easy}</option>
                  <option value="Medium">{CLIENT_DIFFICULTY_LABELS.Medium}</option>
                  <option value="Hard">{CLIENT_DIFFICULTY_LABELS.Hard}</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">حجم العمل الإضافي</label>
                <select
                  value={extraWorkload}
                  onChange={(e) => setExtraWorkload(e.target.value as ClientExtraWorkload)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 text-xs focus:ring-2 focus:ring-sky-500 outline-none"
                >
                  <option value="None">{CLIENT_EXTRA_WORKLOAD_LABELS.None}</option>
                  <option value="Many requests">{CLIENT_EXTRA_WORKLOAD_LABELS["Many requests"]}</option>
                  <option value="Many revisions">{CLIENT_EXTRA_WORKLOAD_LABELS["Many revisions"]}</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">ملاحظات تشغيلية</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="أي تعليمات أو ملاحظات خاصة بالعميل"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 text-xs focus:ring-2 focus:ring-sky-500 outline-none"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Services & Team Distribution */}
          <div className="space-y-3">
            <div className="font-bold text-slate-900 flex items-center justify-between">
              <span>الخدمات المطلوبة وتوزيع المسؤولين:</span>
              <span className="text-[10px] text-slate-400 font-normal">حدد المسارات المفعلة لحساب العميل</span>
            </div>

            {/* Track 1: Design */}
            <div className="p-3 rounded-xl border border-purple-200 bg-purple-50/30 space-y-2.5">
              <label className="flex items-center gap-2 cursor-pointer font-bold text-purple-900">
                <input
                  type="checkbox"
                  checked={enableDesign}
                  onChange={(e) => setEnableDesign(e.target.checked)}
                  className="rounded text-purple-600 focus:ring-purple-500"
                />
                <Palette className="w-4 h-4 text-purple-600" />
                <span>مسار التصميم الجرافيكي (Graphic Design)</span>
              </label>

              {enableDesign && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-purple-100">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">المصمم الأساسي:</label>
                    <select
                      value={primaryDesignerId}
                      onChange={(e) => setPrimaryDesignerId(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-purple-200 rounded-lg bg-white text-slate-800 text-xs"
                    >
                      <option value="">-- اختر المصمم الأساسي --</option>
                      {designers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.displayName} ({d.jobTitle})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">مراجع التصميم (Art Director):</label>
                    <select
                      value={designReviewerId}
                      onChange={(e) => setDesignReviewerId(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-purple-200 rounded-lg bg-white text-slate-800 text-xs"
                    >
                      <option value="">-- اختر مراجع التصميم --</option>
                      {reviewerCandidates.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.displayName} ({r.jobTitle})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Track 2: Content Writing */}
            <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/30 space-y-2.5">
              <label className="flex items-center gap-2 cursor-pointer font-bold text-emerald-900">
                <input
                  type="checkbox"
                  checked={enableCopywriting}
                  onChange={(e) => setEnableCopywriting(e.target.checked)}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                <Feather className="w-4 h-4 text-emerald-600" />
                <span>مسار كتابة المحتوى والاسكربت (Content Writing)</span>
              </label>

              {enableCopywriting && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-emerald-100">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">كاتب المحتوى الأساسي:</label>
                    <select
                      value={primaryCopywriterId}
                      onChange={(e) => setPrimaryCopywriterId(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-emerald-200 rounded-lg bg-white text-slate-800 text-xs"
                    >
                      <option value="">-- اختر كاتب المحتوى --</option>
                      {writers.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.displayName} ({w.jobTitle})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">مراجع المحتوى (الاستراتيجيست):</label>
                    <select
                      value={copywritingReviewerId}
                      onChange={(e) => setCopywritingReviewerId(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-emerald-200 rounded-lg bg-white text-slate-800 text-xs"
                    >
                      <option value="">-- اختر مراجع المحتوى --</option>
                      {reviewerCandidates.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.displayName} ({r.jobTitle})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Track 3: Strategy */}
            <div className="p-3 rounded-xl border border-sky-200 bg-sky-50/30 space-y-2.5">
              <label className="flex items-center gap-2 cursor-pointer font-bold text-sky-900">
                <input
                  type="checkbox"
                  checked={enableStrategy}
                  onChange={(e) => setEnableStrategy(e.target.checked)}
                  className="rounded text-sky-600 focus:ring-sky-500"
                />
                <Compass className="w-4 h-4 text-sky-600" />
                <span>مسار الاستراتيجية والبريف (Strategy Track)</span>
              </label>

              {enableStrategy && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-sky-100">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">الاستراتيجيست الأساسي:</label>
                    <select
                      value={primaryStrategistId}
                      onChange={(e) => setPrimaryStrategistId(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-sky-200 rounded-lg bg-white text-slate-800 text-xs"
                    >
                      <option value="">-- اختر الاستراتيجيست --</option>
                      {strategists.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.displayName} ({s.jobTitle})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">مراجع الاستراتيجية (Strategy Lead):</label>
                    <select
                      value={strategyReviewerId}
                      onChange={(e) => setStrategyReviewerId(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-sky-200 rounded-lg bg-white text-slate-800 text-xs"
                    >
                      <option value="">-- اختر مراجع الاستراتيجية --</option>
                      {reviewerCandidates.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.displayName} ({r.jobTitle})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Track 4: Video Editing */}
            <div className="p-3 rounded-xl border border-amber-200 bg-amber-50/30 space-y-2.5">
              <label className="flex items-center gap-2 cursor-pointer font-bold text-amber-900">
                <input
                  type="checkbox"
                  checked={enableVideo}
                  onChange={(e) => setEnableVideo(e.target.checked)}
                  className="rounded text-amber-600 focus:ring-amber-500"
                />
                <Video className="w-4 h-4 text-amber-600" />
                <span>مسار إنتاج ومونتاج الفيديو (Video Editing)</span>
              </label>

              {enableVideo && (
                <div className="space-y-2 pt-1 border-t border-amber-100">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">الإيديتور الأساسي:</label>
                      <select
                        value={primaryVideoEditorId}
                        onChange={(e) => setPrimaryVideoEditorId(e.target.value)}
                        className="w-full px-2.5 py-1.5 border border-amber-200 rounded-lg bg-white text-slate-800 text-xs"
                      >
                        <option value="">-- بانتظار إسناد إيديتور --</option>
                        {videoEditors.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.displayName} ({v.jobTitle})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">مراجع الفيديو المستقل:</label>
                      <select
                        value={videoReviewerId}
                        onChange={(e) => setVideoReviewerId(e.target.value)}
                        className="w-full px-2.5 py-1.5 border border-amber-200 rounded-lg bg-white text-slate-800 text-xs"
                      >
                        <option value="">-- اختر مراجع الفيديو --</option>
                        {reviewerCandidates.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.displayName} ({r.jobTitle})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="text-[10px] text-amber-700 bg-amber-100/60 p-1.5 rounded-lg">
                    ⚠️ مراجع الفيديو مستقل عن مراجع التصميم لضمان جودة المونتاج.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Section 3: Identity & Brand Links */}
          <div className="bg-slate-50/70 p-3.5 rounded-xl border border-slate-200 space-y-3">
            <div className="font-bold text-slate-900 flex items-center gap-1.5">
              <Link2 className="w-4 h-4 text-slate-600" />
              روابط الهوية والأصول (اختياري)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">رابط دليل الهوية (Brand Guide URL):</label>
                <input
                  type="url"
                  value={brandGuideUrl}
                  onChange={(e) => setBrandGuideUrl(e.target.value)}
                  placeholder="https://drive.google.com/..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 text-xs outline-none"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">رابط مجلد الأصول (Drive Assets URL):</label>
                <input
                  type="url"
                  value={assetsDriveUrl}
                  onChange={(e) => setAssetsDriveUrl(e.target.value)}
                  placeholder="https://drive.google.com/..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 text-xs outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="pt-3 border-t border-slate-100 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl text-center"
          >
            إلغاء
          </button>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleSubmit("Not started")}
              className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors text-center"
            >
              حفظ كمسودة
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleSubmit("Active")}
              className="px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs flex items-center justify-center gap-1.5 transition-all text-center"
            >
              {isSubmitting ? "جاري الحفظ..." : "إنشاء وتفعيل العميل"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
