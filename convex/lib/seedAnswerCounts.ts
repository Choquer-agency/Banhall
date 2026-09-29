import { v } from "convex/values";

/**
 * 2026-09-29 (first, run 7): one rejected Seed answer as counts, never
 * model text (`seedAnswerCounts` in seedContract.ts): Seeds returned and
 * kept, the minimum the Batch needed, and for each broken rule (and, for a
 * link, its reason) how many Seeds broke it. Stored on a failed Batch.
 */
export const seedAnswerCountsValidator = v.object({
  seedsReturned: v.number(),
  seedsValid: v.number(),
  minimum: v.number(),
  issues: v.array(
    v.object({
      code: v.string(),
      reason: v.optional(v.string()),
      seeds: v.number(),
    })
  ),
});

/** At most the two answers one attempt can send (answer and repair). */
export const MAX_RECORDED_ANSWERS = 2;
