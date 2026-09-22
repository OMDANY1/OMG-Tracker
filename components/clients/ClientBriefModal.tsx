"use client";

import React, { useState, useEffect } from "react";
import { FileText, X, Check, AlertTriangle, ShieldCheck, Link2, Compass, ExternalLink, Calendar, User } from "lucide-react";
import type { Client } from "@/types/database";

interface ClientBriefModalProps {
  client: Client | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  isOwner?: boolean;
}

export function ClientBriefModal({
  client,
  isOpen,
  onClose,
  onSaved,
  isOwner = false,
}: ClientBriefModalProps) {
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const brief = client?.brief_data;

  const [objectives, setObjectives] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [productsServices, setProductsServices] = useState("");
  const [toneOfVoice, setToneOfVoice] = useState("");
  const [contentPillarsStr, setContentPillarsStr] = useState("");
  const [dosAndDonts, setDosAndDonts] = useState("");
  const [brandGuidelinesUrl, setBrandGuidelinesUrl] = useState("");
  const [assetsDriveUrl, setAssetsDriveUrl] = useState("");
  const [strategySummary, setStrategySummary] = useState("");

  useEffect(() => {
    if (client) {
      setObjectives(brief?.objectives || "");
      setTargetAudience(brief?.target_audience || "");
      setProductsServices(brief?.products_services || "");
      setToneOfVoice(brief?.tone_of_voice || "");
      setContentPillarsStr((brief?.content_pillars || []).join("، "));
      setDosAndDonts(brief?.dos_and_donts || "");
      setBrandGuidelinesUrl(brief?.brand_guidelines_url || client.brand_guide_url || "");
      setAssetsDriveUrl(brief?.assets_drive_url || client.brief_url || "");
      setStrategySummary(brief?.strategy_summary || brief?.approved_strategy_content || "");
      setError(null);
      setSuccess(null);
    }
  }, [client, brief]);

  if (!isOpen || !client) return null;

  const handleSaveBrief = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const pillars = contentPillarsStr
      .split(/[،,]/)
      .map((p) => p.trim())
      .filter(Boolean);

    try {
      const res = await fetch("/api/clients", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id,
          action: "update_brief",
          objectives,
          targetAudience,
          productsServices,
          toneOfVoice,
          contentPillars: pillars,
          dosAndDonts,
          brandGuidelinesUrl,
          assetsDriveUrl,
          strategySummary,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "فشل حفظ الـBrief");
      }

      setSuccess("تم حفظ بيانات الـBrief بنجاح!");
      onSaved();
    } catch (err: any) {
      setError(err.message || "حدث خطأ أثناء الحفظ");
    } finally {
      setLoading(false);
    }
  };

  const handleOperationalReview = async () => {
    if (!strategySummary || !strategySummary.trim()) {
      setError("يرجى كتابة ملخص ومسودة الاستراتيجية أولاً قبل اعتماد المراجعة التشغيلية.");
      return;
    }

    if (!confirm("هل أنت متأكد من اجتياز مسودة الاستراتيجية للمراجعة التشغيلية (قيادة الاستراتيجية)؟")) return;

    setReviewing(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/clients", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id,
          action: "review_strategy_operational",
          decision: "approved",
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "فشل تسجيل المراجعة التشغيلية");
      }

      setSuccess("تم اجتياز المراجعة التشغيلية بنجاح! الاستراتيجية الآن جاهزة للاعتماد النهائي لمساحة العمل (عماد).");
      onSaved();
    } catch (err: any) {
      setError(err.message || "فشل تسجيل المراجعة التشغيلية");
    } finally {
      setReviewing(false);
    }
  };

  const handleApproveStrategy = async () => {
    if (!strategySummary || !strategySummary.trim()) {
      setError("لا يمكن اعتماد استراتيجية خالية؛ يرجى كتابة ملخص الاستراتيجية أولاً.");
      return;
    }

    if (!confirm("هل أنت متأكد من الاعتماد النهائي لمسودة الاستراتيجية على مستوى مساحة العمل (المالك عماد)؟")) return;

    setApproving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/clients", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id,
          action: "approve_strategy",
          approvedContent: strategySummary.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "فشل اعتماد الاستراتيجية");
      }

      setSuccess("تم الاعتماد النهائي للاستراتيجية لمساحة العمل وتحديث النسخة المعتمدة بنجاح!");
      onSaved();
    } catch (err: any) {
      setError(err.message || "فشل اعتماد الاستراتيجية");
    } finally {
      setApproving(false);
    }
  };

  const isApproved = brief?.status === "approved";
  const isReviewed = brief?.status === "reviewed";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-surface rounded-2xl border border-slate-200 shadow-2xl max-w-3xl w-full p-6 text-right space-y-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                <Compass className="w-5 h-5 text-sky-600" />
                Brief واستراتيجية العميل: <span className="text-sky-700">{client.name}</span>
              </h3>
              {isApproved ? (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  معتمدة لمساحة العمل (نسخة {brief?.strategy_version || 1})
                </span>
              ) : isReviewed ? (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-sky-100 text-sky-800 border border-sky-300 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  اجتازت المراجعة التشغيلية (أروى) - بانتظار اعتماد مساحة العمل
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                  مسودة قيد الإعداد (Draft)
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              هوية العميل، الأهداف، الجمهور، نبرة الكتابة، والمراجع المعتمدة لفريق الاستراتيجية والإنتاج
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

        {success && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2 font-medium">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {/* Approval metadata banner */}
        {isApproved && brief?.approved_at && (
          <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>
                تم اعتماد الاستراتيجية بتاريخ:{" "}
                <strong>{new Date(brief.approved_at).toLocaleDateString("ar-EG")}</strong>
              </span>
            </div>
            <span className="text-[11px] text-emerald-700">نسخة معتمدة v{brief.strategy_version}</span>
          </div>
        )}

        <form onSubmit={handleSaveBrief} className="space-y-4 text-xs">
          {/* Section 1: الأهداف والجمهور */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="font-bold text-slate-800 block mb-1">الأهداف التسويقية الرئيسية:</label>
              <textarea
                value={objectives}
                onChange={(e) => setObjectives(e.target.value)}
                placeholder="مثال: زيادة الوعي بالعلامة التجارية، جذب عملاء محتملين، إطلاق خدمة جديدة..."
                rows={3}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 text-xs focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="font-bold text-slate-800 block mb-1">الجمهور المستهدف (Target Audience):</label>
              <textarea
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                placeholder="مثال: الفئة العمرية 25-45، أصحاب الأعمال، المهتمين بالصحة والجمال..."
                rows={3}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 text-xs focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          {/* Section 2: المنتجات والنبرة */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="font-bold text-slate-800 block mb-1">الخدمات أو المنتجات الرئيسية:</label>
              <textarea
                value={productsServices}
                onChange={(e) => setProductsServices(e.target.value)}
                placeholder="المنتجات أو الخدمات الأساسية التي يتم الترويج لها..."
                rows={2}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 text-xs focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="font-bold text-slate-800 block mb-1">نبرة الكتابة والصوت (Tone of Voice):</label>
              <input
                type="text"
                value={toneOfVoice}
                onChange={(e) => setToneOfVoice(e.target.value)}
                placeholder="مثال: احترافية، ودية وملهمة، رسمية وطبية، شبابية وحماسية..."
                className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 text-xs focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          {/* Section 3: محاور المحتوى والمحاذير */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="font-bold text-slate-800 block mb-1">محاور المحتوى (Content Pillars):</label>
              <input
                type="text"
                value={contentPillarsStr}
                onChange={(e) => setContentPillarsStr(e.target.value)}
                placeholder="افصل بينها بفاصلة: تثقيفي، ترويجي، قصص نجاح، كواليس..."
                className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 text-xs focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div>
              <label className="font-bold text-slate-800 block mb-1">المحاذير والممنوعات (Do's & Don'ts):</label>
              <textarea
                value={dosAndDonts}
                onChange={(e) => setDosAndDonts(e.target.value)}
                placeholder="كلمات ممنوعة، منافسين لا يجب ذكرهم، ألوان غير مرغوبة..."
                rows={2}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 text-xs focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          {/* Section 4: روابط الهوية والأصول */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <label className="font-bold text-slate-800 flex items-center gap-1.5 mb-1">
                <Link2 className="w-3.5 h-3.5 text-sky-600" />
                رابط دليل الهوية (Brand Guidelines):
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  value={brandGuidelinesUrl}
                  onChange={(e) => setBrandGuidelinesUrl(e.target.value)}
                  placeholder="https://drive.google.com/..."
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 text-xs"
                />
                {brandGuidelinesUrl && (
                  <a
                    href={brandGuidelinesUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 text-sky-600 hover:bg-sky-100 rounded-lg transition-colors"
                    title="فتح الرابط"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>

            <div>
              <label className="font-bold text-slate-800 flex items-center gap-1.5 mb-1">
                <Link2 className="w-3.5 h-3.5 text-amber-600" />
                مجلد أصول ومراجع العميل (Drive Assets):
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  value={assetsDriveUrl}
                  onChange={(e) => setAssetsDriveUrl(e.target.value)}
                  placeholder="https://drive.google.com/..."
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 text-xs"
                />
                {assetsDriveUrl && (
                  <a
                    href={assetsDriveUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 text-amber-600 hover:bg-amber-100 rounded-lg transition-colors"
                    title="فتح المجلد"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Section 5: وثيقة الاستراتيجية المعتمدة */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-bold text-slate-900 flex items-center gap-1.5 text-xs">
                <FileText className="w-4 h-4 text-sky-600" />
                ملخص وخطة الاستراتيجية المعتمدة (Approved Strategy Content):
              </label>
              <span className="text-[11px] text-slate-400">النص الكامل المحفوظ داخل النظام</span>
            </div>
            <textarea
              value={strategySummary}
              onChange={(e) => setStrategySummary(e.target.value)}
              placeholder="اكتب هنا الاتجاه الاستراتيجي المعتمد وخطة العمل الرئيسية للشهر..."
              rows={5}
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl bg-white text-slate-900 text-xs font-mono focus:ring-2 focus:ring-sky-500 leading-relaxed"
            />
          </div>

          {/* Action Buttons */}
          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {/* Step 1: Operational Review by Strategy Lead (Arwa) */}
              <button
                type="button"
                onClick={handleOperationalReview}
                disabled={reviewing || approving || loading}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 ${
                  isReviewed
                    ? "bg-sky-100 text-sky-800 border border-sky-300"
                    : "bg-sky-600 hover:bg-sky-700 text-white"
                }`}
                title="مراجعة مسودة الاستراتيجية تشغيلياً (أروى / مراجع الاستراتيجية المعتمد)"
              >
                <Compass className="w-4 h-4" />
                <span>
                  {reviewing
                    ? "جارٍ تسجيل المراجعة..."
                    : isReviewed
                    ? "✓ اجتازت المراجعة التشغيلية (أروى)"
                    : "المراجعة التشغيلية (أروى - قيادة الاستراتيجية)"}
                </span>
              </button>

              {/* Step 2: Final Workspace Strategy Approval (Owner Emad) */}
              <button
                type="button"
                onClick={handleApproveStrategy}
                disabled={approving || reviewing || loading}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
                title="الاعتماد النهائي للاستراتيجية لمساحة العمل (خاص بالمالك عماد)"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>{approving ? "جارٍ الاعتماد..." : "اعتماد مساحة العمل (عماد - Owner)"}</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                إغلاق
              </button>
              <button
                type="submit"
                disabled={loading || approving}
                className="px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>{loading ? "جارٍ الحفظ..." : "حفظ مسودة الـBrief"}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
