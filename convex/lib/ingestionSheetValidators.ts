// Validators for the Import sheet fields (2026-11-11, phase 2). Kept apart
// from convex/lib/ingestionSheet.ts so the schema imports only validators.

import { v, type Infer } from "convex/values";

/** What a file is on the sheet (convex/lib/ingestionClassify.ts INGESTION_CATEGORIES). */
export const ingestionCategoryValidator = v.union(
  v.literal("final_pd"),
  v.literal("draft"),
  v.literal("review_copy"),
  v.literal("transcript"),
  v.literal("supporting"),
  v.literal("company_file"),
  v.literal("unknown")
);

/** The version letter: T to be submitted, S submitted, R in review. */
export const pdVersionCodeValidator = v.union(v.literal("T"), v.literal("S"), v.literal("R"));

/** The sheet tab a row shows on, from its status. */
export const sheetTabValidator = v.union(
  v.literal("review"),
  v.literal("approved"),
  v.literal("deleted")
);
export type SheetTab = Infer<typeof sheetTabValidator>;

/** Why a row on the review tab needs a person to look at it. */
export const checkReasonValidator = v.union(
  v.literal("no_company"),
  v.literal("unknown_category"),
  v.literal("could_not_read"),
  v.literal("no_fiscal_year"),
  v.literal("no_science_code"),
  v.literal("no_writer")
);
export type CheckReason = Infer<typeof checkReasonValidator>;

/** The labels a person can set on the sheet; a set one wins over the path. */
export const editableLabelValidator = v.union(
  v.literal("company"),
  v.literal("category"),
  v.literal("fiscalYearEnd"),
  v.literal("pdNumber"),
  v.literal("version"),
  v.literal("writerName"),
  v.literal("scienceCode")
);
export type EditableLabel = Infer<typeof editableLabelValidator>;

/** Where a row's science code came from. */
export const scienceCodeSourceValidator = v.union(v.literal("document"), v.literal("person"));

/**
 * The labels one sheet edit may set (ingestion.setSheetLabels). Absent keys
 * are left as they are. `company` is a name, stored as the row's clientName;
 * `fiscalYearEnd` is the UTC midnight of the picked date.
 */
export const sheetLabelPatchValidator = v.object({
  company: v.optional(v.string()),
  category: v.optional(ingestionCategoryValidator),
  fiscalYearEnd: v.optional(v.number()),
  pdNumber: v.optional(v.string()),
  version: v.optional(v.object({ code: pdVersionCodeValidator, number: v.number() })),
  writerName: v.optional(v.string()),
  scienceCode: v.optional(v.string()),
});
export type SheetLabelPatch = Infer<typeof sheetLabelPatchValidator>;

/** One category's counts in a company band. Year keys are "2025" or "none". */
export const importCategoryCountsValidator = v.object({
  total: v.number(),
  needsCheck: v.number(),
  fiscalYears: v.record(v.string(), v.number()),
});

/**
 * The counts a company band shows. `ready` is rows that need no check and
 * are already read. `categories` is keyed by category, with only the
 * categories that have files.
 */
export const importCountFields = {
  total: v.number(),
  needsCheck: v.number(),
  ready: v.number(),
  beingRead: v.number(),
  categories: v.record(v.string(), importCategoryCountsValidator),
};
export const importCountsValidator = v.object(importCountFields);
export type ImportCounts = Infer<typeof importCountsValidator>;
