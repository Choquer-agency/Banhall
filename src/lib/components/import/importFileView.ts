/**
 * The file view on the Import page (2026-11-17): a side panel that shows one
 * file's labels and text, read only, so nobody approves a file blind. The
 * page holds the panel and gives every row a way to open it (Svelte
 * context): a click on the file's name, or Open in the row's menu.
 */
import { getContext, setContext } from "svelte";
import type { CheckReason, ImportCategory, SheetFileRow } from "./importFormat";

const KEY = Symbol("import-file-view");

export type FileView = {
  /** Opens the panel on a file; focus goes back where it was when the panel closes. */
  open: (id: SheetFileRow["_id"]) => void;
};

export function provideFileView(view: FileView): void {
  setContext(KEY, view);
}

/** The page's file view, or null outside the page (a row tested on its own). */
export function useFileView(): FileView | null {
  return getContext<FileView | undefined>(KEY) ?? null;
}

/** What a file is, as the panel says it. */
export const CATEGORY_NAMES: Record<ImportCategory, string> = {
  final_pd: "Final PD",
  draft: "Draft",
  review_copy: "Review copy",
  transcript: "Transcript",
  supporting: "Supporting file",
  company_file: "Company file",
  unknown: "Not sorted yet",
};

const CHECK_WORDS: Record<CheckReason, string> = {
  no_company: "Needs a company",
  unknown_category: "Needs a category",
  could_not_read: "Could not be read",
  no_text: "No text could be read from it",
  no_fiscal_year: "Needs a fiscal year",
  no_science_code: "Needs a science code",
  no_writer: "Needs a writer",
  unmatched_initials: "Needs a writer: its initials could be more than one person",
};

/** What a file still needs before it can be approved, one line each. */
export function checkLines(reasons: readonly CheckReason[]): string[] {
  return [...new Set(reasons)].map((reason) => CHECK_WORDS[reason]);
}

/** Where a file is: its tab, or that it is still being read. */
export function fileStateText(row: Pick<SheetFileRow, "status">): string {
  switch (row.status) {
    case "discovered":
    case "fetched":
      return "Being read";
    case "failed":
      return "Could not be read";
    case "pending_review":
      return "To review";
    case "approved":
      return "Approved";
    default:
      return "Deleted";
  }
}

/** The pages of a file's text the panel reads, at most this many characters in all. */
export const FILE_VIEW_MAX_CHARS = 200_000;

/** The note under a file's text: where it came from, and how much of it shows. */
export function textNote(page: {
  shown: number;
  total: number;
  source: "full" | "preview" | "none";
  cutAtImport: boolean;
}): string | null {
  if (page.source === "none") return null;
  const notes: string[] = [];
  if (page.source === "preview") notes.push("Only the first part of this file was kept when it was read.");
  if (page.cutAtImport) notes.push("This file's text was cut when it was read, because it is very long.");
  if (page.shown < page.total) {
    notes.push(`Showing ${page.shown.toLocaleString("en-US")} of ${page.total.toLocaleString("en-US")} characters.`);
  }
  return notes.length > 0 ? notes.join(" ") : null;
}
