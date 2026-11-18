/**
 * Words and labels for the Import sheet (/admin/import, 2026-11-11 phase 3a).
 * Pure: no Svelte, no Convex client. The components under
 * src/lib/components/import/ read the sheet queries in convex/ingestion.ts
 * (sheetTotals, sheetCompanies, sheetFiles, sheetSearch) and turn each value
 * into what a cell shows through these helpers.
 */
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";
import { categoryTakes, writerInitialsKey } from "../../../../shared/importSheetRules";
import { scienceCodeDisplay } from "$lib/components/project/details/detailsFormat";

export type SheetTab = "review" | "approved" | "deleted";
export type SheetTotals = NonNullable<FunctionReturnType<typeof api.ingestion.sheetTotals>>;
export type SheetBand = FunctionReturnType<typeof api.ingestion.sheetCompanies>["page"][number];
export type SheetFileRow = FunctionReturnType<typeof api.ingestion.sheetFiles>["page"][number];
export type SheetSearchResult = NonNullable<FunctionReturnType<typeof api.ingestion.sheetSearch>>;
export type SheetSearchFile = SheetSearchResult["files"][number];
export type SheetSearchCompany = SheetSearchResult["companies"][number];
export type ImportCategory = SheetFileRow["category"];
export type CheckReason = SheetFileRow["checkReasons"][number];
export type CategoryCounts = SheetBand["categories"][string];

/** The tabs, in order, with their names. */
export const SHEET_TABS: readonly { id: SheetTab; label: string }[] = [
  { id: "review", label: "To review" },
  { id: "approved", label: "Approved" },
  { id: "deleted", label: "Deleted" },
];

/** A tab with nothing on it. */
export const EMPTY_TAB_TEXT: Record<SheetTab, string> = {
  review: "Nothing is waiting for review.",
  approved: "No files have been approved yet.",
  deleted: "Nothing has been deleted.",
};

/** "To check" is on and no company has a file that needs a person. */
export const NOTHING_TO_CHECK_TEXT = "Nothing needs a check.";

/** "New" is on and no file is New any more. */
export const NOTHING_NEW_TEXT = "No files arrived in the last 24 hours.";

/**
 * The sheet's filters (2026-11-12): all files, only those to check, or only
 * the New ones. One at a time; the queries take onlyToCheck and onlyNew.
 */
export type SheetFilter = "all" | "check" | "new";

/** "52 new", the pill before a band's "N files" (Paper Files 2 and 3). */
export function newCountText(count: number): string {
  return `${formatCount(count)} new`;
}

/**
 * The line that closes the sheet with New on, for the companies it does not
 * list (Paper Files 2): "The other 6 companies have no new files." Null when
 * every company is listed.
 */
export function otherCompaniesText(others: number): string | null {
  if (others <= 0) return null;
  return others === 1
    ? "The other company has no new files."
    : `The other ${formatCount(others)} companies have no new files.`;
}

/** The band key for files with no company yet, and what it is called. */
export const NO_COMPANY_KEY = "";
export const NO_COMPANY_NAME = "No company yet";

/** The sections of an open company, in the order they show. */
export const CATEGORY_ORDER: readonly ImportCategory[] = [
  "final_pd",
  "draft",
  "review_copy",
  "transcript",
  "supporting",
  "company_file",
  "unknown",
];

/** A section's label (drawn in small capitals). */
export const CATEGORY_LABELS: Record<ImportCategory, string> = {
  final_pd: "Final PDs",
  draft: "Drafts",
  review_copy: "Review copies",
  transcript: "Transcripts",
  supporting: "Supporting files",
  company_file: "Company files",
  // 2026-11-12 (Paper Files 2): files still being read wait here too, until
  // reading puts each in its category; files of no known kind stay.
  unknown: "Not sorted yet",
};

/** What one file of a section is called, singular then plural. */
const CATEGORY_NOUNS: Record<ImportCategory, readonly [string, string]> = {
  final_pd: ["final PD", "final PDs"],
  draft: ["draft", "drafts"],
  review_copy: ["review copy", "review copies"],
  transcript: ["transcript", "transcripts"],
  supporting: ["supporting file", "supporting files"],
  company_file: ["company file", "company files"],
  unknown: ["unsorted file", "unsorted files"],
};

/** "1,204" */
export function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

/** "1 file", "223 files". */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : pluralForm}`;
}

/** "556 files from 7 companies", beside the page title; null for an empty tab. */
export function filesFromCompaniesText(totals: Pick<SheetTotals, "files" | "companies" | "complete">): string | null {
  if (totals.files <= 0) return null;
  const files = plural(totals.files, "file");
  const text = totals.companies > 0 ? `${files} from ${plural(totals.companies, "company", "companies")}` : files;
  // More bands than the totals read: the numbers are a floor.
  return totals.complete ? text : `More than ${text}`;
}

// ─── Company bands ──────────────────────────────────────────────────────────

/** What a band is called: the folder's company name, or "No company yet". */
export function bandName(band: Pick<SheetBand, "companyKey" | "displayName">): string {
  if (band.companyKey === NO_COMPANY_KEY) return NO_COMPANY_NAME;
  return band.displayName.trim() || band.companyKey;
}

export type StatusWord = { text: string; tone: "muted" | "amber" };

/**
 * The status words at a band's right ("38 being read", "77 ready", "12 to
 * check"), on the review tab. A zero is left out; only "to check" is amber.
 * On Approved (2026-11-17): "3 for Brain check", the final PDs waiting for
 * a person to read their Brain copy.
 */
export function bandStatusWords(
  band: Pick<SheetBand, "beingRead" | "ready" | "needsCheck"> & { brainCheck?: number },
  tab: SheetTab
): StatusWord[] {
  if (tab === "approved") {
    const waiting = band.brainCheck ?? 0;
    return waiting > 0 ? [{ text: `${formatCount(waiting)} for Brain check`, tone: "muted" }] : [];
  }
  if (tab !== "review") return [];
  const words: StatusWord[] = [];
  if (band.beingRead > 0) words.push({ text: `${formatCount(band.beingRead)} being read`, tone: "muted" });
  if (band.ready > 0) words.push({ text: `${formatCount(band.ready)} ready`, tone: "muted" });
  if (band.needsCheck > 0) words.push({ text: `${formatCount(band.needsCheck)} to check`, tone: "amber" });
  return words;
}

export type SectionSummary = {
  category: ImportCategory;
  label: string;
  /** The files the section lists: all of them, or only those to check. */
  count: number;
  counts: CategoryCounts;
};

/**
 * An open company's sections in their fixed order. A section with no files
 * is left out, and so is Not sorted yet unless it has files. With "To
 * check" on, a section counts and lists only its files that need a check;
 * with "New" on (2026-11-12), only its New files.
 */
export function bandSections(band: Pick<SheetBand, "categories">, onlyToCheck: boolean, onlyNew = false): SectionSummary[] {
  const sections: SectionSummary[] = [];
  for (const category of CATEGORY_ORDER) {
    const counts = band.categories[category];
    if (!counts) continue;
    const count = onlyNew ? (counts.newFiles ?? 0) : onlyToCheck ? counts.needsCheck : counts.total;
    if (count <= 0) continue;
    sections.push({ category, label: CATEGORY_LABELS[category], count, counts });
  }
  return sections;
}

/** The fiscal year bucket the counts use for files with no year end. */
const NO_FISCAL_YEAR = "none";

/**
 * A section's per-year split in faint words: "13 in FY 2025, 11 in FY 2024",
 * newest first, then "2 with no fiscal year". A section where no file has a
 * year (company files) says "No fiscal year".
 */
export function yearSplitText(fiscalYears: Record<string, number>): string {
  const years = Object.entries(fiscalYears)
    .filter(([year, count]) => year !== NO_FISCAL_YEAR && count > 0)
    .sort(([a], [b]) => Number(b) - Number(a));
  if (years.length === 0) return "No fiscal year";
  const parts = years.map(([year, count]) => `${formatCount(count)} in FY ${year}`);
  const none = fiscalYears[NO_FISCAL_YEAR] ?? 0;
  if (none > 0) parts.push(`${formatCount(none)} with no fiscal year`);
  return parts.join(", ");
}

/**
 * The order reasons are named in a section's note, and how. A file with no
 * writer and one whose initials give none because they could be more than
 * one person (2026-11-16) both "need a writer": a file has one or the
 * other, never both.
 */
const REASON_WORDS: readonly [readonly CheckReason[], string, string][] = [
  [["could_not_read"], "could not be read", "could not be read"],
  [["no_text"], "with no text", "with no text"],
  [["no_company"], "needs a company", "need a company"],
  [["unknown_category"], "needs a category", "need a category"],
  [["no_fiscal_year"], "needs a fiscal year", "need a fiscal year"],
  [["no_writer", "unmatched_initials"], "needs a writer", "need a writer"],
  [["no_science_code"], "needs a science code", "need a science code"],
];

/**
 * The amber note for a section's checks: "9 need a writer, 4 need a science
 * code", "3 could not be read", "3 with no text" (read, but no text came out,
 * such as a scan). One file can need more than one thing. Empty when nothing
 * needs a check.
 */
export function reasonSummary(counts: Partial<Record<CheckReason, number>>): string {
  return REASON_WORDS.map(([reasons, one, many]) => {
    const count = reasons.reduce((sum, reason) => sum + (counts[reason] ?? 0), 0);
    return count > 0 ? `${formatCount(count)} ${count === 1 ? one : many}` : "";
  })
    .filter(Boolean)
    .join(", ");
}

/** "4 to check", the note when the band has no usable reasons. */
export function toCheckText(count: number): string {
  return `${formatCount(count)} to check`;
}

/**
 * A section's amber note, from its band's counts: the reasons ("9 need a
 * writer, 4 need a science code"), or "4 to check" when the reasons are
 * missing or do not add up (a band row from before the reasons were counted,
 * until the repair runs). Every file to check has at least one reason and no
 * reason has more files than need a check. Null when nothing needs a check.
 */
export function sectionNote(counts: Pick<CategoryCounts, "needsCheck" | "checkReasons">): string | null {
  const needsCheck = counts.needsCheck;
  if (needsCheck <= 0) return null;
  const reasons = counts.checkReasons ?? {};
  const values = Object.values(reasons);
  const sum = values.reduce((total, count) => total + count, 0);
  const addsUp = sum >= needsCheck && values.every((count) => count >= 0 && count <= needsCheck);
  return (addsUp && reasonSummary(reasons)) || toCheckText(needsCheck);
}

/**
 * The faint note of the Not sorted yet section (Paper Files 2), which holds
 * the files still being read and those whose kind is still unknown after
 * reading. `beingRead`: how many of the section's files are being read (all
 * of a band's files being read are in this section). The second kind also
 * gets the amber "2 need a category" note.
 */
export function notSortedNote(sectionCount: number, beingRead: number): string {
  if (beingRead <= 0) return "Banhall could not tell what these files are";
  if (beingRead >= sectionCount) return "Each file moves to its category once Banhall has read it";
  return "Files being read move to their category once Banhall has read them";
}

/** How many files an open section lists before "Show more". */
export function firstPageSize(category: ImportCategory, count: number): number {
  const base = category === "final_pd" ? 5 : 3;
  // "Show 1 more" or "Show 2 more" is not worth a row: list them.
  return count <= base + 2 ? Math.max(1, count) : base;
}

/** How many more files "Show more" lists each time. */
export const SHOW_MORE_STEP = 25;

/** The most a page of sheetCompanies or sheetFiles returns (convex/ingestion.ts). */
export const COMPANIES_PAGE_MAX = 100;
export const FILES_PAGE_MAX = 200;

/**
 * The first page a list asks for when "To check" changes what it reads: as
 * many as it lists now, so loaded rows are not lost, but never fewer than
 * its usual first page or more than the server sends at once.
 */
export function reloadSize(listed: number, firstPage: number, max: number): number {
  return Math.min(max, Math.max(firstPage, listed));
}

/**
 * The "Show more" row under a section's files: "Show 19 more final PDs", or
 * when more are left than one step loads, "Show 25 of 99 more supporting
 * files". A section shows the row only while its count says some are left
 * (ImportCategorySection), so it always has a number; "Show more drafts" is
 * only for a caller with no count.
 */
export function showMoreText(category: ImportCategory, remaining: number, step = SHOW_MORE_STEP): string {
  // Not sorted yet holds files of every kind: "Show 18 more" (Paper Files 2).
  if (category === "unknown") {
    if (remaining <= 0) return "Show more";
    if (remaining <= step) return `Show ${formatCount(remaining)} more`;
    return `Show ${formatCount(step)} of ${formatCount(remaining)} more`;
  }
  const [one, many] = CATEGORY_NOUNS[category];
  if (remaining <= 0) return `Show more ${many}`;
  if (remaining <= step) return `Show ${formatCount(remaining)} more ${remaining === 1 ? one : many}`;
  return `Show ${formatCount(step)} of ${formatCount(remaining)} more ${many}`;
}

/** "Show 45" at the right of a closed section. */
export function showSectionText(count: number): string {
  return `Show ${formatCount(count)}`;
}

// ─── File rows ──────────────────────────────────────────────────────────────

type Status = SheetFileRow["status"];

/** Still being fetched or read. */
export function isBeingRead(status: Status): boolean {
  return status === "discovered" || status === "fetched";
}

/**
 * What a file row is called: "PD 4" (muted) and the PD's title for a file
 * named like a PD, otherwise the file name.
 */
export function fileDisplayName(row: Pick<SheetFileRow, "name" | "pdNumber" | "pdTitle">): {
  prefix: string | null;
  title: string;
} {
  const number = row.pdNumber?.trim();
  if (!number) return { prefix: null, title: row.name };
  const title = row.pdTitle?.trim();
  return { prefix: `PD ${number}`, title: title || row.name };
}

/** "Mar 31, 2025", read in UTC: a year end is a UTC midnight. */
export function yearEndDate(fiscalYearEnd: number): string {
  return new Date(fiscalYearEnd).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "2025": the fiscal year takes the year of its end date. */
export function fiscalYearText(fiscalYearEnd: number | undefined): string | null {
  if (fiscalYearEnd === undefined || !Number.isFinite(fiscalYearEnd)) return null;
  return String(new Date(fiscalYearEnd).getUTCFullYear());
}

/**
 * The tooltip on a fiscal year cell: "Year ended Mar 31, 2025", or when the
 * folder name gave only the year and the date was assumed, says so.
 */
export function fiscalYearTooltip(fiscalYearEnd: number | undefined, assumed: boolean | undefined): string | null {
  if (fiscalYearEnd === undefined || !Number.isFinite(fiscalYearEnd)) return null;
  const date = yearEndDate(fiscalYearEnd);
  return assumed ? `Year end not in the folder name. Using ${date} for now.` : `Year ended ${date}`;
}

/** "T2", "R3", "S"; null when the name gave no version. */
export function versionText(code: SheetFileRow["versionCode"], number: number | undefined): string | null {
  if (code === undefined && number === undefined) return null;
  return `${code ?? ""}${number ?? ""}`;
}

export type Tone = "ink" | "muted" | "amber";
export type CellText = { text: string; tone: Tone };

/**
 * The Writer cell (2026-11-12, 2026-11-16): the writer's label (ink: a team
 * member's name, a past writer's name, or initials such as "DW" for a
 * writer with no login), the file name's initials when they give no writer
 * because they could be more than one person (amber on a final PD, which
 * needs a writer, where the row shows "Choose writer"; muted on a draft or
 * review copy), or amber "No writer". `initials` are the file name's;
 * `remembered` is a writer that came from them (no AI mark: the file name
 * and the firm's people).
 */
export type WriterCell = CellText & { initials: string | null; remembered: boolean };

/**
 * The Reviewer cell (2026-11-17): the reviewer's label (ink: a team member's
 * name, a past writer's name or initials such as "PN"), with `remembered`
 * when it came from the file name's reviewer initials; or, with no reviewer
 * (initials that could be more than one person, or none), `missing`, which
 * an editable cell shows as the quiet "Choose reviewer" and a read only one
 * as the initials, muted, or nothing. Never amber: a reviewer is never
 * required.
 */
export type ReviewerCell = CellText & { initials: string | null; remembered: boolean; missing: boolean };

export type FileCells = {
  /** New (2026-11-12): the green label after the name, on To review. */
  isNew: boolean;
  prefix: string | null;
  title: string;
  /** Words after the name: "Being read" (muted), "Could not be read" or "No text could be read" (amber). */
  state: CellText | null;
  fiscalYear: (CellText & { tooltip: string | null }) | null;
  version: string | null;
  writer: WriterCell | null;
  /** Final PDs, drafts and review copies only (2026-11-17). */
  reviewer: ReviewerCell | null;
  /** "Reviewed by CRA" (2026-11-17): a final PD an Admin marked. */
  craReviewed: boolean;
  scienceCode:
    | { kind: "code"; code: string; title: string | null; fromDocument: boolean }
    | { kind: "missing"; text: string }
    | null;
};

/**
 * Everything a file row shows. A file still being read shows "Being read"
 * and empty cells. Amber marks only what a person must fill in (the row's
 * check reasons): never a value that does not apply.
 *
 * Live QA fixes (2026-11-11): a cell whose label the file's category does
 * not take is empty, even when a value is stored (categoryTakes in
 * shared/importSheetRules.ts): version and writer on final PDs, drafts and
 * review copies only, the science code on final PDs only. The stored value
 * stays, so moving the file back shows it again. A company file's fiscal
 * year cell is empty too: its section already says "No fiscal year".
 */
export function fileCells(
  row: Pick<
    SheetFileRow,
    | "name"
    | "category"
    | "status"
    | "pdNumber"
    | "pdTitle"
    | "fiscalYearEnd"
    | "fiscalYearEndAssumed"
    | "versionCode"
    | "versionNumber"
    | "writerName"
    | "writerNameSource"
    | "writerInitials"
    | "reviewerName"
    | "reviewerSource"
    | "reviewerInitials"
    | "craReviewed"
    | "scienceCode"
    | "scienceCodeSource"
    | "checkReasons"
    | "isNew"
  >
): FileCells {
  const { prefix, title } = fileDisplayName(row);
  const isNew = row.isNew === true;
  if (isBeingRead(row.status)) {
    return {
      isNew,
      prefix,
      title,
      state: { text: "Being read", tone: "muted" },
      fiscalYear: null,
      version: null,
      writer: null,
      reviewer: null,
      craReviewed: false,
      scienceCode: null,
    };
  }
  const reasons = new Set(row.checkReasons);

  const year = fiscalYearText(row.fiscalYearEnd);
  const fiscalYear = year
    ? { text: year, tone: "ink" as const, tooltip: fiscalYearTooltip(row.fiscalYearEnd, row.fiscalYearEndAssumed) }
    : reasons.has("no_fiscal_year")
      ? { text: "No fiscal year", tone: "amber" as const, tooltip: null }
      : null;

  const writerName = row.writerName?.trim();
  const initials = writerInitialsKey(row.writerInitials);
  const writer: WriterCell | null = !categoryTakes("writerName", row.category)
    ? null
    : writerName
      ? { text: writerName, tone: "ink", initials, remembered: row.writerNameSource === "initials" || row.writerNameSource === "pick" }
      : initials
        ? { text: initials, tone: reasons.has("unmatched_initials") ? "amber" : "muted", initials, remembered: false }
        : reasons.has("no_writer")
          ? { text: "No writer", tone: "amber", initials: null, remembered: false }
          : null;

  const reviewerName = row.reviewerName?.trim();
  const reviewerInitials = writerInitialsKey(row.reviewerInitials);
  const reviewer: ReviewerCell | null = !categoryTakes("writerName", row.category)
    ? null
    : reviewerName
      ? {
          text: reviewerName,
          tone: "ink",
          initials: reviewerInitials,
          remembered: row.reviewerSource === "initials" || row.reviewerSource === "pick",
          missing: false,
        }
      : { text: reviewerInitials ?? "", tone: "muted", initials: reviewerInitials, remembered: false, missing: true };

  const code = row.scienceCode?.trim();
  const display = code ? scienceCodeDisplay(code) : null;
  const scienceCode: FileCells["scienceCode"] = !categoryTakes("scienceCode", row.category)
    ? null
    : code
      ? {
          kind: "code",
          code,
          title: display && display.label !== code ? display.label : null,
          fromDocument: row.scienceCodeSource === "document",
        }
      : reasons.has("no_science_code")
        ? { kind: "missing", text: "No science code" }
        : null;

  return {
    isNew,
    prefix,
    title,
    state:
      row.status === "failed"
        ? { text: "Could not be read", tone: "amber" }
        : reasons.has("no_text")
          ? { text: "No text could be read", tone: "amber" }
          : null,
    fiscalYear,
    version: categoryTakes("version", row.category) ? versionText(row.versionCode, row.versionNumber) : null,
    writer,
    reviewer,
    craReviewed: row.category === "final_pd" && row.craReviewed === true,
    scienceCode,
  };
}

// ─── Search ─────────────────────────────────────────────────────────────────

/** A search runs from this many characters. */
export const SEARCH_MIN_CHARS = 2;

/** The text to search for, or null while it is too short. */
export function searchText(input: string): string | null {
  const text = input.trim();
  return text.length >= SEARCH_MIN_CHARS ? text : null;
}

/** What a search found, in one line over its results. */
export function searchFoundText(result: Pick<SheetSearchResult, "files" | "companies">): string {
  const parts: string[] = [];
  if (result.companies.length > 0) parts.push(plural(result.companies.length, "company", "companies"));
  if (result.files.length > 0) parts.push(plural(result.files.length, "file"));
  return parts.join(" and ");
}
