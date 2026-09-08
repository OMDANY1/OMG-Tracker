import {
  DocumentInventory,
  DetailedPostItem,
  ReconciledCalendar,
} from "@/lib/ai/schemas";

/**
 * Fixture A: 12 Posts Standard Calendar
 * 13 pages total: Page 1 is Cover, Pages 2-13 are 12 static/reel posts.
 * Declared post count: 12
 */
export const FIXTURE_A_INVENTORY: DocumentInventory = {
  page_count: 13,
  declared_post_count: 12,
  page_classifications: [
    { page_number: 1, page_type: "cover", is_operational: false, notes: "Cover page with client logo" },
    ...Array.from({ length: 12 }, (_, i) => ({
      page_number: i + 2,
      page_type: "post_detail" as const,
      is_operational: true,
      notes: `Post ${i + 1} detail`,
    })),
  ],
  detected_blocks: Array.from({ length: 12 }, (_, i) => ({
    canonicalPostId: `fixture_a_post_${i + 1}`,
    post_number: `Post ${i + 1}`,
    title: `عنوان البوست ${i + 1}`,
    format_hint: i % 4 === 0 ? "Reel" : "Static",
    source_pages: [i + 2],
    is_multi_page: false,
    is_multi_post_page: false,
    confidence: 0.96,
  })),
  cross_references: [],
  confidence: 0.96,
  warnings: [],
};

export const FIXTURE_A_ITEMS: DetailedPostItem[] = Array.from({ length: 12 }, (_, i) => ({
  canonicalPostId: `fixture_a_post_${i + 1}`,
  post_number: `Post ${i + 1}`,
  title: `عنوان المنشور التسويقي ${i + 1}`,
  platform: "Instagram",
  content_format: i % 4 === 0 ? "Reel" : "Static",
  publish_date: `2026-09-${String(i * 2 + 1).padStart(2, "0")}`,
  design_due_date: `2026-09-${String(Math.max(1, i * 2)).padStart(2, "0")}`,
  on_design_text: `نص التصميم الأصلي للبوست رقم ${i + 1}`,
  hook: i % 4 === 0 ? `هل تعلم هذا السر عن علامتك التجارية؟ (بوست ${i + 1})` : null,
  cta: "سجل اهتمامك الآن عبر الرابط في البايو",
  reel_script: i % 4 === 0 ? `المشهد 1: افتتاحية سريعة\nالمشهد 2: شرح الميزة الأساسية\nالمشهد 3: الخاتمة والدعوة للإجراء` : null,
  slides: [],
  caption: `كابشن تسويقي جذاب للبوست رقم ${i + 1} مع وسوم الحملة`,
  brief: `التوجيه الفني: استخدام خط عريض وألوان الهوية للبوست ${i + 1}`,
  notes: null,
  source_pages: [i + 2],
  confidence: 0.95,
  warnings: [],
}));

/**
 * Fixture B: 20 Posts with Calendar Grid Overview (Deduplication Test)
 * Page 1: Cover
 * Page 2: Monthly Calendar Grid (Overview listing posts 1 to 20)
 * Pages 3-22: Detail pages for posts 1 to 20
 * Total pages: 22
 * Cross-references link page 2 entries to detail pages.
 */
export const FIXTURE_B_INVENTORY: DocumentInventory = {
  page_count: 22,
  declared_post_count: 20,
  page_classifications: [
    { page_number: 1, page_type: "cover", is_operational: false, notes: "Cover" },
    { page_number: 2, page_type: "calendar_overview", is_operational: false, notes: "Monthly Overview Grid" },
    ...Array.from({ length: 20 }, (_, i) => ({
      page_number: i + 3,
      page_type: "post_detail" as const,
      is_operational: true,
      notes: `Detail page for post ${i + 1}`,
    })),
  ],
  detected_blocks: [
    // Overview duplicates (page 2)
    ...Array.from({ length: 20 }, (_, i) => ({
      canonicalPostId: `fixture_b_post_${i + 1}`,
      post_number: `Post ${i + 1}`,
      title: `ملخص شبكة التقويم ${i + 1}`,
      format_hint: "Static",
      source_pages: [2],
      is_multi_page: false,
      is_multi_post_page: true,
      confidence: 0.88,
    })),
    // Detailed items (pages 3-22)
    ...Array.from({ length: 20 }, (_, i) => ({
      canonicalPostId: `fixture_b_post_${i + 1}`,
      post_number: `Post ${i + 1}`,
      title: `التفاصيل الكاملة للبوست ${i + 1}`,
      format_hint: "Static",
      source_pages: [i + 3],
      is_multi_page: false,
      is_multi_post_page: false,
      confidence: 0.98,
    })),
  ],
  cross_references: Array.from({ length: 20 }, (_, i) => ({
    canonicalPostId: `fixture_b_post_${i + 1}`,
    overview_page: 2,
    detail_page: i + 3,
    notes: `Cross-reference from overview grid to detail page`,
  })),
  confidence: 0.94,
  warnings: ["تم رصد شبكة تقويم مجمعة في الصفحة 2 وتم ربطها بصفحات التفاصيل."],
};

export const FIXTURE_B_ITEMS: DetailedPostItem[] = [
  // The 20 detailed items
  ...Array.from({ length: 20 }, (_, i) => ({
    canonicalPostId: `fixture_b_post_${i + 1}`,
    post_number: `Post ${i + 1}`,
    title: `بوست تفصيلي رقم ${i + 1}`,
    platform: "Instagram",
    content_format: "Static",
    publish_date: `2026-09-${String(Math.min(28, i + 1)).padStart(2, "0")}`,
    design_due_date: `2026-09-${String(Math.min(27, i + 1)).padStart(2, "0")}`,
    on_design_text: `نص التصميم الكامل للبوست ${i + 1}`,
    hook: null,
    cta: "تواصل معنا للمزيد من المعلومات",
    reel_script: null,
    slides: [],
    caption: `كابشن تفصيلي للبوست ${i + 1}`,
    brief: `توجيه فني للبوست ${i + 1}`,
    notes: null,
    source_pages: [i + 3],
    confidence: 0.97,
    warnings: [],
  })),
  // Duplicate items detected from page 2 overview
  ...Array.from({ length: 20 }, (_, i) => ({
    canonicalPostId: `fixture_b_post_${i + 1}`,
    post_number: `Post ${i + 1}`,
    title: `ملخص جدول البوست ${i + 1}`,
    platform: "Instagram",
    content_format: "Static",
    publish_date: `2026-09-${String(Math.min(28, i + 1)).padStart(2, "0")}`,
    design_due_date: null,
    on_design_text: null,
    hook: null,
    cta: null,
    reel_script: null,
    slides: [],
    caption: null,
    brief: `ملخص من جدول التقويم`,
    notes: "سجل ملخص من شبكة التقويم الشهرية",
    source_pages: [2],
    confidence: 0.85,
    warnings: ["مستخرج من شبكة التقويم المجمعة"],
  })),
];

/**
 * Fixture C: 25 Posts with Carousels (Multi-slide) & Reels (Hook + Script + CTA)
 * Verifies that:
 * - Carousel with 5 slides is maintained as 1 single task.
 * - Reel with hook/script is maintained as 1 single task.
 * Total: exactly 25 operational tasks!
 */
export const FIXTURE_C_INVENTORY: DocumentInventory = {
  page_count: 26,
  declared_post_count: 25,
  page_classifications: [
    { page_number: 1, page_type: "cover", is_operational: false },
    ...Array.from({ length: 25 }, (_, i) => ({
      page_number: i + 2,
      page_type: "post_detail" as const,
      is_operational: true,
      notes: i === 3 ? "Carousel 5 slides" : i === 6 ? "Reel script" : `Post ${i + 1}`,
    })),
  ],
  detected_blocks: Array.from({ length: 25 }, (_, i) => ({
    canonicalPostId: `fixture_c_post_${i + 1}`,
    post_number: `Post ${i + 1}`,
    title: i === 3 ? "كاروسيل 5 خطوات للنجاح" : i === 6 ? "ريل نصائح التصميم الإبداعي" : `منشور تسويقي ${i + 1}`,
    format_hint: i === 3 ? "Carousel" : i === 6 ? "Reel" : "Static",
    source_pages: [i + 2],
    is_multi_page: false,
    is_multi_post_page: false,
    confidence: 0.96,
  })),
  cross_references: [],
  confidence: 0.96,
  warnings: [],
};

export const FIXTURE_C_ITEMS: DetailedPostItem[] = Array.from({ length: 25 }, (_, i) => {
  if (i === 3) {
    // Post 4: Carousel with 5 slides
    return {
      canonicalPostId: `fixture_c_post_${i + 1}`,
      post_number: `Post ${i + 1}`,
      title: "كاروسيل 5 خطوات للنجاح",
      platform: "Instagram",
      content_format: "Carousel",
      publish_date: "2026-09-04",
      design_due_date: "2026-09-02",
      on_design_text: "5 خطوات عملية للارتقاء بعلامتك التجارية",
      hook: null,
      cta: "احفظ هذا البوست للرجوع إليه لاحقاً",
      reel_script: null,
      slides: [
        { slide_number: 1, text: "الغلاف: 5 خطوات للنجاح الرقمي", visual_notes: "صورة ثلاثية الأبعاد جذابة" },
        { slide_number: 2, text: "الخطوة الأولى: حدد جمهورك بدقة", visual_notes: "رسم بياني لتحديد الفئات" },
        { slide_number: 3, text: "الخطوة الثانية: ابنِ هوية بصرية متماسكة", visual_notes: "لوحة ألوان متناسقة" },
        { slide_number: 4, text: "الخطوة الثالثة: قدم محتوى ذا قيمة حقيقية", visual_notes: "أيقونات إبداعية" },
        { slide_number: 5, text: "الخاتمة: شارك المنشور مع فريقك", visual_notes: "شعار الشركة وزر المتابعة" },
      ],
      caption: "إليك الدليل الكامل لتطوير علامتك التجارية خطوة بخطوة.",
      brief: "تصميم كاروسيل من 5 سلايدز بنفس النسق والخطوط المتناسقة.",
      notes: null,
      source_pages: [5],
      confidence: 0.98,
      warnings: [],
    };
  }

  if (i === 6) {
    // Post 7: Reel with Hook + Script + CTA
    return {
      canonicalPostId: `fixture_c_post_${i + 1}`,
      post_number: `Post ${i + 1}`,
      title: "ريل نصائح التصميم الإبداعي",
      platform: "Instagram",
      content_format: "Reel",
      publish_date: "2026-09-07",
      design_due_date: "2026-09-05",
      on_design_text: "أكبر 3 أخطاء تقع فيها عند اختيار خطوط التصميم!",
      hook: "توقف فوراً! هل ما زلت تستخدم هذا الخط في تصاميمك؟",
      cta: "اكتب لنا في التعليقات ما هو خطك المفضل لنقيمه لك مجاناً!",
      reel_script: "المشهد 1 (0-3 ثوان): ظهور المصمم مشيراً لخط سيء باللون الأحمر.\nالمشهد 2 (3-15 ثانية): المقارنة بين الخط العشوائي والخط الهندسي المتوازن.\nالمشهد 3 (15-25 ثانية): عرض مثال واقعي لزيادة التفاعل بنسبة 40%.\nالمشهد 4 (25-30 ثانية): الدعوة للتعليق والمتابعة.",
      slides: [],
      caption: "شاهد الريل وتعرف على الخطوط التي يجب تجنبها تماماً في 2026.",
      brief: "مطلوب ريل موشن خفيف 30 ثانية مع ترانزيشن سريع ومؤثرات صوتية.",
      notes: null,
      source_pages: [8],
      confidence: 0.97,
      warnings: [],
    };
  }

  return {
    canonicalPostId: `fixture_c_post_${i + 1}`,
    post_number: `Post ${i + 1}`,
    title: `منشور تسويقي رقم ${i + 1}`,
    platform: "Instagram",
    content_format: "Static",
    publish_date: `2026-09-${String(Math.min(28, i + 1)).padStart(2, "0")}`,
    design_due_date: `2026-09-${String(Math.min(26, i + 1)).padStart(2, "0")}`,
    on_design_text: `تصميم رقم ${i + 1}`,
    hook: null,
    cta: "اطلب الآن عبر موقعنا",
    reel_script: null,
    slides: [],
    caption: `كابشن منشور ${i + 1}`,
    brief: `توجيه تصميم ${i + 1}`,
    notes: null,
    source_pages: [i + 2],
    confidence: 0.95,
    warnings: [],
  };
});

/**
 * Fixture D: Scanned / Mixed Layout with Non-Content Sections
 * Total 17 pages:
 * - Page 1: Cover (non-operational)
 * - Page 2: Strategy (non-operational)
 * - Page 3: Content Pillars (non-operational)
 * - Pages 4-15: 12 Posts (operational)
 * - Page 16: References (non-operational)
 * - Page 17: Thank You (non-operational)
 * Exactly 5 non-content sections, exactly 12 operational posts!
 */
export const FIXTURE_D_INVENTORY: DocumentInventory = {
  page_count: 17,
  declared_post_count: 12,
  page_classifications: [
    { page_number: 1, page_type: "cover", is_operational: false, notes: "Cover page" },
    { page_number: 2, page_type: "strategy", is_operational: false, notes: "Marketing Strategy" },
    { page_number: 3, page_type: "content_pillar", is_operational: false, notes: "Brand Pillars" },
    ...Array.from({ length: 12 }, (_, i) => ({
      page_number: i + 4,
      page_type: "post_detail" as const,
      is_operational: true,
      notes: `Operational post ${i + 1}`,
    })),
    { page_number: 16, page_type: "references", is_operational: false, notes: "Design references" },
    { page_number: 17, page_type: "thank_you", is_operational: false, notes: "Thank you & contact page" },
  ],
  detected_blocks: Array.from({ length: 12 }, (_, i) => ({
    canonicalPostId: `fixture_d_post_${i + 1}`,
    post_number: `Post ${i + 1}`,
    title: `بوست تشغيلي ${i + 1}`,
    format_hint: "Static",
    source_pages: [i + 4],
    is_multi_page: false,
    is_multi_post_page: false,
    confidence: 0.92,
  })),
  cross_references: [],
  confidence: 0.92,
  warnings: ["تم استبعاد 5 أقسام غير تشغيلية (الغلاف، الاستراتيجية، المحاور، المراجع، الشكر)"],
};

export const FIXTURE_D_ITEMS: DetailedPostItem[] = Array.from({ length: 12 }, (_, i) => ({
  canonicalPostId: `fixture_d_post_${i + 1}`,
  post_number: `Post ${i + 1}`,
  title: `بوست تشغيلي رقم ${i + 1}`,
  platform: "Instagram",
  content_format: "Static",
  publish_date: `2026-09-${String(i * 2 + 2).padStart(2, "0")}`,
  design_due_date: `2026-09-${String(i * 2 + 1).padStart(2, "0")}`,
  on_design_text: `نص البوست ${i + 1}`,
  hook: null,
  cta: "سجل الآن",
  reel_script: null,
  slides: [],
  caption: `كابشن البوست ${i + 1}`,
  brief: `توجيه التصميم ${i + 1}`,
  notes: null,
  source_pages: [i + 4],
  confidence: 0.93,
  warnings: [],
}));
