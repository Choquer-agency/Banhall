import { v } from "convex/values";

/**
 * Convex validators for the per-writer house-style override toggles
 * (PSOS-49). The canonical key list and normalization live in
 * shared/styleOverrides.ts; these validators mirror that shape for schema,
 * function args, and returns so client and server cannot drift.
 */

/** Stored/arg shape: partial — absent keys mean "not waived". */
export const styleOverridesValidator = v.object({
  bannedWords: v.optional(v.boolean()),
  paragraphDensity: v.optional(v.boolean()),
  sentenceConstruction: v.optional(v.boolean()),
  repetitionCaps: v.optional(v.boolean()),
  openingClauses: v.optional(v.boolean()),
});

/** Normalized shape returned to the generation pipeline: every key present. */
export const normalizedStyleOverridesValidator = v.object({
  bannedWords: v.boolean(),
  paragraphDensity: v.boolean(),
  sentenceConstruction: v.boolean(),
  repetitionCaps: v.boolean(),
  openingClauses: v.boolean(),
});
