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

/**
 * Why a row on the review tab needs a person to look at it. "no_text"
 * (2026-11-11, phase 3b fixes): the file was read but no text came out of it
 * (a PDF that is only a scan); "could_not_read" stays for a file that failed.
 * "unmatched_initials" (2026-11-12): a final PD whose file name gave the
 * writer's initials, which no person has said who they are yet
 * (importWriterInitials); "no_writer" stays for one with no initials at all.
 */
export const checkReasonValidator = v.union(
  v.literal("no_company"),
  v.literal("unknown_category"),
  v.literal("could_not_read"),
  v.literal("no_text"),
  v.literal("no_fiscal_year"),
  v.literal("no_science_code"),
  v.literal("no_writer"),
  v.literal("unmatched_initials")
);
export type CheckReason = Infer<typeof checkReasonValidator>;

/**
 * Where a row's writer name came from (2026-11-12): a person set it on the
 * file ("person"), or a person said once which writer the file name's
 * initials stand for ("initials", importWriterInitials). Absent with no
 * name; a name set before this existed is a person's (its editedLabels say so).
 */
export const writerNameSourceValidator = v.union(v.literal("person"), v.literal("initials"));

/** Why a batch call left a file as it was (shared/importSheetRules.ts BatchSkipReason). */
export const batchSkipReasonValidator = v.union(
  v.literal("missing"),
  v.literal("not_on_tab"),
  v.literal("being_read"),
  v.literal("approved"),
  v.literal("already_deleted"),
  v.literal("does_not_apply"),
  v.literal("removed_in_onedrive")
);

/**
 * What setSheetLabels, removeItems and restoreItems did (2026-11-11, phase
 * 3b fixes): how many files they changed, exactly which, and each file they
 * left as it was with why. A file that already had the value asked for is in
 * neither list.
 */
export const batchResultValidator = v.object({
  changed: v.number(),
  changedIds: v.array(v.id("ingestionItems")),
  skipped: v.array(v.object({ id: v.id("ingestionItems"), reason: batchSkipReasonValidator })),
});
export type BatchResult = Infer<typeof batchResultValidator>;

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

/**
 * One category's counts in a company band. Year keys are "2025" or "none".
 * `checkReasons` (2026-11-11, phase 3a): how many of the files that need a
 * check have each check reason ("no_writer": 9). A file with two reasons
 * counts once in `needsCheck` and once under each reason. Left out when no
 * file needs a check. A band row written before it existed has none, which
 * reads as empty; ingestion.repairImportCompanyTab fills it in.
 */
export const importCategoryCountsValidator = v.object({
  total: v.number(),
  needsCheck: v.number(),
  fiscalYears: v.record(v.string(), v.number()),
  checkReasons: v.optional(v.record(v.string(), v.number())),
  // 2026-11-12 (adding files): how many of the section's files are New
  // (ingestionItems.isNew, To review only), and their fiscal years. Left
  // out when none is New.
  newFiles: v.optional(v.number()),
  newFiscalYears: v.optional(v.record(v.string(), v.number())),
});

/**
 * The counts a company band shows. `ready` is rows that need no check and
 * are already read. `categories` is keyed by the section a file shows in
 * (since 2026-11-12 a file still being read shows in "unknown", Not sorted
 * yet, whatever its category: lib/ingestionSheet.ts sheetSectionFor), with
 * only the sections that have files. `newFiles`: files that are New, left
 * out when none is.
 */
export const importCountFields = {
  total: v.number(),
  needsCheck: v.number(),
  ready: v.number(),
  beingRead: v.number(),
  newFiles: v.optional(v.number()),
  categories: v.record(v.string(), importCategoryCountsValidator),
};
export const importCountsValidator = v.object(importCountFields);
export type ImportCounts = Infer<typeof importCountsValidator>;
