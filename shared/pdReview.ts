import { z } from "zod";

/**
 * The one runtime contract for a PD review result, shared by the agent that
 * produces it (convex/ai/reviewAgent.ts) and the report that renders it
 * (src/lib/components/review-pd/PdReviewReport.svelte).
 *
 * Same lesson as the QA scorecard: the shape was declared separately on each
 * side and validated all-or-nothing, so a review could be stored as
 * `completed`, be unreadable, and render as a blank panel with no way to tell
 * it apart from a normal empty state — and no retry, because retry only
 * accepted `failed` rows.
 *
 * Permissive where meaning doesn't change (absent lists default to empty), and
 * per-item `.catch()` so one malformed bullet can't discard the whole review.
 * Still strict about the fields that carry the verdict.
 */

const bulletList = z
  .array(z.string().catch("(an item in this review could not be read)"))
  .default([]);

export const pdReviewResultSchema = z.object({
  summary: z.string(),
  // A 0-100 strength rating; outside that range it is not interpretable.
  qualitative_score: z.number().min(0).max(100),
  score_rationale: z.string().default(""),
  strengths: bulletList,
  risks: bulletList,
  suggested_strengthening: bulletList,
});

export type PdReviewResultParsed = z.infer<typeof pdReviewResultSchema>;
