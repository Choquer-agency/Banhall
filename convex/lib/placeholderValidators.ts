/**
 * The one validator for a stored placeholder entry (owner decision 26).
 * Every table and function that stores or returns a placeholder map uses
 * it, so a new optional entry field widens all of them at once (review
 * 2026-09-26: `briefPreparations.placeholders` lacked `at` and refused any
 * project with a loose label).
 */
import { v } from "convex/values";

export const placeholderEntryValidator = v.object({
  token: v.string(),
  value: v.string(),
  // 2026-09-25: the id also restores when a model writes it without brackets.
  bare: v.optional(v.boolean()),
  // 2026-09-26 (parser v8): hidden only where it stands as a speaker label.
  at: v.optional(v.literal("label")),
});

export const placeholderMapValidator = v.array(placeholderEntryValidator);
