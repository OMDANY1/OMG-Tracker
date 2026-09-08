import { z } from "zod";

// -----------------------------------------------------------------------------
// Pass A: Document Inventory Schema
// -----------------------------------------------------------------------------
export const PageTypeEnum = z.enum([
  "cover",
  "strategy",
  "content_pillar",
  "calendar_overview",
  "post_detail",
  "references",
  "thank_you",
  "other_operational",
  "unknown",
]);

export const PageClassificationSchema = z.object({
  page_number: z.number().int().min(1),
  page_type: PageTypeEnum,
  is_operational: z.boolean(),
  notes: z.string().optional(),
});

export const DetectedContentBlockSchema = z.object({
  canonicalPostId: z.string(),
  post_number: z.string().optional(),
  title: z.string().optional(),
  format_hint: z.string().optional(), // 'Static', 'Carousel', 'Reel', 'Story'
  source_pages: z.array(z.number().int().min(1)),
  is_multi_page: z.boolean().default(false),
  is_multi_post_page: z.boolean().default(false),
  confidence: z.number().min(0).max(1).default(0.9),
});

export const CrossReferenceSchema = z.object({
  canonicalPostId: z.string(),
  overview_page: z.number().int().min(1),
  detail_page: z.number().int().min(1),
  notes: z.string().optional(),
});

export const DocumentInventorySchema = z.object({
  page_count: z.number().int().min(1),
  declared_post_count: z.number().int().min(0).max(100).nullable().optional(),
  page_classifications: z.array(PageClassificationSchema),
  detected_blocks: z.array(DetectedContentBlockSchema),
  cross_references: z.array(CrossReferenceSchema).default([]),
  confidence: z.number().min(0).max(1).default(0.9),
  warnings: z.array(z.string()).default([]),
});

export type DocumentInventory = z.infer<typeof DocumentInventorySchema>;
export type PageClassification = z.infer<typeof PageClassificationSchema>;
export type DetectedContentBlock = z.infer<typeof DetectedContentBlockSchema>;

// -----------------------------------------------------------------------------
// Pass B: Detailed Post Item Schema
// -----------------------------------------------------------------------------
export const CarouselSlideSchema = z.object({
  slide_number: z.number().int().min(1),
  text: z.string(),
  visual_notes: z.string().optional(),
});

export const DetailedPostItemSchema = z.object({
  canonicalPostId: z.string(),
  post_number: z.string(),
  title: z.string(),
  platform: z.string().default("Instagram"),
  content_format: z.string().default("Static"), // 'Static' | 'Carousel' | 'Reel' | 'Story'
  publish_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  design_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  on_design_text: z.string().nullable().optional(),
  hook: z.string().nullable().optional(),
  cta: z.string().nullable().optional(),
  reel_script: z.string().nullable().optional(),
  slides: z.array(CarouselSlideSchema).default([]),
  caption: z.string().nullable().optional(),
  brief: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  source_pages: z.array(z.number().int().min(1)).default([]),
  confidence: z.number().min(0).max(1).default(0.9),
  warnings: z.array(z.string()).default([]),
});

export const BatchedExtractionSchema = z.object({
  items: z.array(DetailedPostItemSchema),
  batch_index: z.number().int().optional(),
  total_batches: z.number().int().optional(),
  warnings: z.array(z.string()).default([]),
});

export type CarouselSlide = z.infer<typeof CarouselSlideSchema>;
export type DetailedPostItem = z.infer<typeof DetailedPostItemSchema>;
export type BatchedExtraction = z.infer<typeof BatchedExtractionSchema>;

// -----------------------------------------------------------------------------
// Pass C: Reconciled Content Item & Final Calendar Schema
// -----------------------------------------------------------------------------
export const ReconciledItemSchema = DetailedPostItemSchema.extend({
  id: z.string().optional(),
  post_order: z.number().int().min(1),
  is_included: z.boolean().default(true),
  is_excluded_from_tasks: z.boolean().default(false),
  exclusion_reason: z.string().nullable().optional(),
  content_fingerprint: z.string().optional(),
  possible_duplicate: z.boolean().default(false),
  duplicate_of_item_id: z.string().nullable().optional(),
  needs_manual_review: z.boolean().default(false),
  suggested_assignee_id: z.string().nullable().optional(),
  approved_assignee_id: z.string().nullable().optional(),
});

export const ReconciledCalendarSchema = z.object({
  items: z.array(ReconciledItemSchema),
  declared_post_count: z.number().int().nullable().optional(),
  detected_post_count: z.number().int().min(0).max(100),
  overall_confidence: z.number().min(0).max(1),
  inventory: DocumentInventorySchema.optional(),
  token_usage: z.object({
    prompt_tokens: z.number().int().default(0),
    completion_tokens: z.number().int().default(0),
    total_tokens: z.number().int().default(0),
  }).default({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }),
  warnings: z.array(z.string()).default([]),
  file_sha256: z.string(),
  model_used: z.string(),
  provider: z.string().default("google"),
  prompt_version: z.string().default("v2.0"),
  schema_version: z.string().default("2026-09-08"),
});

export type ReconciledItem = z.infer<typeof ReconciledItemSchema>;
export type ReconciledCalendar = z.infer<typeof ReconciledCalendarSchema>;
