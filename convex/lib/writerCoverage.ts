import { v } from "convex/values";

/** One category of the stored "What they cover" analysis (round 2, I2). */
export const coverageCategoryValidator = v.object({
  addressed: v.boolean(),
  evidence: v.union(v.string(), v.null()),
});

export const coverageCategoriesValidator = v.object({
  bannedWords: coverageCategoryValidator,
  paragraphDensity: coverageCategoryValidator,
  sentenceConstruction: coverageCategoryValidator,
  repetitionCaps: coverageCategoryValidator,
  openingClauses: coverageCategoryValidator,
  reportSkeleton: coverageCategoryValidator,
});

/** `writerProfiles.coverage`: the analysis of the saved text with that hash. */
export const writerCoverageValidator = v.object({
  textHash: v.string(),
  analyzedAt: v.number(),
  categories: coverageCategoriesValidator,
});
