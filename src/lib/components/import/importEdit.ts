/**
 * Changing, selecting, deleting and putting back files on the Import sheet
 * (/admin/import, 2026-11-11 phase 3b, boards ao4, ao5 and ao6). Pure: no
 * Svelte, no Convex client. What a row may do on each tab, the year end
 * date the calendar works in, the batches the bar sends, and the words of
 * the bar's confirm lines and toasts.
 */
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";
import {
  canDelete,
  CHOOSE_REVIEWER,
  CHOOSE_WRITER,
  craReviewedApplies,
  CRA_REVIEWED,
  isBeingRead as statusIsBeingRead,
  labelApplies,
  reviewerApplies,
  type BatchSkipReason,
  type ImportLabel,
} from "../../../../shared/importSheetRules";
import { CATEGORY_LABELS, formatCount, plural, yearEndDate, type ImportCategory, type SheetFileRow, type SheetTab } from "./importFormat";

// ─── What a row may do ──────────────────────────────────────────────────────

/**
 * What a file row may do on a tab, and which labels a file can take: the
 * rule in shared/importSheetRules.ts, which setSheetLabels, removeItems and
 * restoreItems follow too, so the page never offers what the server skips.
 */
export { rowAbilities, type RowAbilities } from "../../../../shared/importSheetRules";

/** Select applies to every tab: on Approved (2026-11-17) for Send back to review. */
export function canSelect(tab: SheetTab): boolean {
  return tab === "review" || tab === "approved" || tab === "deleted";
}

// ─── Labels a person can pick ───────────────────────────────────────────────

/** The six categories a file can be moved to (Unsorted is not a choice), as the boards name one file of each. */
export const MOVE_CATEGORIES: readonly { category: ImportCategory; label: string }[] = [
  { category: "final_pd", label: "Final PD" },
  { category: "draft", label: "Draft" },
  { category: "review_copy", label: "Review copy" },
  { category: "transcript", label: "Transcript" },
  { category: "supporting", label: "Supporting file" },
  { category: "company_file", label: "Company file" },
];

export type VersionCode = "W" | "R" | "T" | "S";

/** The version letters in words, in Banhall's lifecycle order (W -> R -> T -> S). */
export const VERSION_CODES: readonly { code: VersionCode; label: string }[] = [
  { code: "W", label: "W - work in progress" },
  { code: "R", label: "R - in review" },
  { code: "T", label: "T - to be submitted" },
  { code: "S", label: "S - submitted" },
];

/** The version numbers the menu offers (0 to 9, including S0 for original submitted). */
export const VERSION_NUMBERS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** The quick picks under the year end calendar, as on a project's Details. */
export const YEAR_END_QUICK_PICKS = [
  { label: "Mar 31", month: 3, day: 31 },
  { label: "Jun 30", month: 6, day: 30 },
  { label: "Sep 30", month: 9, day: 30 },
  { label: "Dec 31", month: 12, day: 31 },
] as const;

export const YEAR_END_HELPER = "The fiscal year takes the year of its end date.";

// ─── The year end date ──────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The UTC midnight of a picked calendar day ("2025-03-31"), the year end
 * setSheetLabels stores; null for anything else. Read as UTC, so the day
 * picked is the day stored wherever the person is.
 */
export function utcDayFromDateInput(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const timestamp = Date.UTC(year, month - 1, day);
  const back = new Date(timestamp);
  // "2025-02-30" is not a day.
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return timestamp;
}

/** The calendar day ("2025-03-31") of a stored year end, read in UTC; "" when there is none. */
export function dateInputFromUtcDay(timestamp: number | undefined | null): string {
  if (timestamp === undefined || timestamp === null || !Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * The day ("2025-03-31") the year end calendar opens on while nothing is
 * picked (live QA fixes, 2026-11-11), so its quick picks ("Dec 31") land in
 * that year: the newest of these year ends (one file's own, or those of the
 * selected files listed on screen), else Dec 31 of last year, the last year
 * end that has surely passed. Imported files are past work, so the calendar
 * never starts in the current year on its own.
 */
export function yearEndCalendarStart(yearEnds: readonly (number | null | undefined)[], now: Date = new Date()): string {
  let newest: number | null = null;
  for (const end of yearEnds) {
    if (typeof end === "number" && Number.isFinite(end) && (newest === null || end > newest)) newest = end;
  }
  return newest !== null ? dateInputFromUtcDay(newest) : `${now.getFullYear() - 1}-12-31`;
}

// ─── Batches ────────────────────────────────────────────────────────────────

/** The most files one setSheetLabels, removeItems or restoreItems call takes. */
export const BATCH_MAX = 100;

/** `items` in runs of at most `size`. */
export function chunks<T>(items: readonly T[], size = BATCH_MAX): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size));
  return out;
}

/** What one setSheetLabels, removeItems or restoreItems call did. */
export type BatchResult = FunctionReturnType<typeof api.ingestion.setSheetLabels>;
export type FileId = SheetFileRow["_id"];
export type Skipped = BatchResult["skipped"][number];

export type ChunkRun = {
  /** The ids of the calls that went through. */
  sent: FileId[];
  /** Exactly the files those calls changed. */
  changedIds: FileId[];
  /** The files those calls left as they were, and why. */
  skipped: Skipped[];
  /** Why the run stopped, or null when every call went through. */
  error: unknown;
};

/**
 * Sends `ids` in runs of at most 100, one call after another, stopping at
 * the first call that fails. Each call is its own transaction, so the runs
 * before it stand; their changed and skipped files are kept.
 */
export async function runInChunks(
  ids: readonly FileId[],
  call: (part: FileId[]) => Promise<BatchResult>,
  size = BATCH_MAX
): Promise<ChunkRun> {
  const run: ChunkRun = { sent: [], changedIds: [], skipped: [], error: null };
  for (const part of chunks(ids, size)) {
    try {
      const result = await call(part);
      run.sent.push(...part);
      run.changedIds.push(...result.changedIds);
      run.skipped.push(...result.skipped);
    } catch (error) {
      run.error = error;
      return run;
    }
  }
  return run;
}

/** Skip reasons that mean the file is not on the tab any more: it leaves the selection. */
const GONE: ReadonlySet<BatchSkipReason> = new Set(["missing", "not_on_tab", "approved", "already_deleted", "removed_in_onedrive"]);

/** The files a run changed, or found gone from the tab: the ones to drop from the selection. */
export function settledIds(run: Pick<ChunkRun, "changedIds" | "skipped">): FileId[] {
  return [...run.changedIds, ...run.skipped.filter((entry) => GONE.has(entry.reason)).map((entry) => entry.id)];
}

// ─── Which selected files a bar action takes ───────────────────────────────

/** The label each bar change sets through setSheetLabels (the reviewer and the CRA mark have their own calls). */
const CHANGE_LABEL: Record<LabelChange["kind"], ImportLabel> = {
  category: "category",
  fiscalYearEnd: "fiscalYearEnd",
  company: "company",
  writer: "writerName",
  pdNumber: "pdNumber",
  scienceCode: "scienceCode",
};

/** Whether a bar change takes a file: the shared rule the server follows too. */
function changeTakes(kind: BarChange["kind"], row: Candidate): boolean {
  if (kind === "reviewer") return reviewerApplies(row);
  if (kind === "craReviewed") return craReviewedApplies(row);
  return labelApplies(CHANGE_LABEL[kind], row);
}

type Candidate = { _id: FileId; status: SheetFileRow["status"]; category: ImportCategory };

/** Why a selected file cannot take a change: the words after "were left out:". */
export type LeftOutWhy =
  | "being_read"
  | "could_not_read"
  | "final_pd_only"
  | "numbered_only"
  | "pd_number_only"
  | "reviewer_numbered_only"
  | "cra_final_pd_only"
  | "not_here";

function whyLeftOut(kind: BarChange["kind"] | "delete", row: Candidate): LeftOutWhy {
  if (statusIsBeingRead(row.status)) return "being_read";
  if (kind === "delete") return "not_here";
  if (row.status === "failed") return "could_not_read";
  if (kind === "scienceCode") return "final_pd_only";
  if (kind === "writer") return "numbered_only";
  if (kind === "pdNumber") return "pd_number_only";
  if (kind === "reviewer") return "reviewer_numbered_only";
  if (kind === "craReviewed") return "cra_final_pd_only";
  return "not_here";
}

export type LeftOutGroup = { why: LeftOutWhy; count: number; category: ImportCategory | null };

/** The selected files a change takes, and those it leaves out by why. */
export type ChangeSplit<R> = { taken: R[]; leftOut: LeftOutGroup[] };

/**
 * Splits the selected files into those a bar change (or a delete) takes,
 * by the shared rule (labelApplies, canDelete), and those it leaves out,
 * grouped by why, with the category they share (or null when they differ).
 */
export function splitForChange<R extends Candidate>(
  kind: BarChange["kind"] | "delete",
  rows: readonly R[]
): ChangeSplit<R> {
  const taken: R[] = [];
  const groups = new Map<LeftOutWhy, LeftOutGroup>();
  for (const row of rows) {
    const takes = kind === "delete" ? canDelete(row.status) : changeTakes(kind, row);
    if (takes) {
      taken.push(row);
      continue;
    }
    const why = whyLeftOut(kind, row);
    const group = groups.get(why);
    if (!group) groups.set(why, { why, count: 1, category: row.category });
    else {
      group.count += 1;
      if (group.category !== row.category) group.category = null;
    }
  }
  return { taken, leftOut: WHY_ORDER.flatMap((why) => groups.get(why) ?? []) };
}

/** The order the left-out reasons are said in: what the change is for first, then the files' state. */
const WHY_ORDER: readonly LeftOutWhy[] = [
  "final_pd_only",
  "numbered_only",
  "pd_number_only",
  "reviewer_numbered_only",
  "cra_final_pd_only",
  "not_here",
  "being_read",
  "could_not_read",
];

/** What one file of a category is called, singular then plural, for the left-out words. */
const NOUNS: Record<ImportCategory, readonly [string, string]> = {
  final_pd: ["final PD", "final PDs"],
  draft: ["draft", "drafts"],
  review_copy: ["review copy", "review copies"],
  transcript: ["transcript", "transcripts"],
  supporting: ["supporting file", "supporting files"],
  company_file: ["company file", "company files"],
  unknown: ["unsorted file", "unsorted files"],
};

const WHY_WORDS: Record<LeftOutWhy, readonly [string, string]> = {
  being_read: ["it is still being read", "they are still being read"],
  could_not_read: ["it could not be read", "they could not be read"],
  final_pd_only: ["a science code only goes on a final PD", "a science code only goes on a final PD"],
  numbered_only: [
    "a writer only goes on a final PD, draft or review copy",
    "a writer only goes on a final PD, draft or review copy",
  ],
  pd_number_only: [
    "a PD number only goes on a final PD, draft or review copy",
    "a PD number only goes on a final PD, draft or review copy",
  ],
  reviewer_numbered_only: [
    "a reviewer only goes on a final PD, draft or review copy",
    "a reviewer only goes on a final PD, draft or review copy",
  ],
  cra_final_pd_only: ["only a final PD is marked as reviewed by CRA", "only a final PD is marked as reviewed by CRA"],
  not_here: ["it cannot take this change", "they cannot take this change"],
};

/**
 * Why some selected files are left out of a change, one sentence a reason:
 * "3 transcripts were left out: a science code only goes on a final PD."
 * "1 file was left out: it is still being read." Empty when none are.
 */
export function leftOutText(groups: readonly LeftOutGroup[]): string {
  return groups
    .map(({ why, count, category }) => {
      const [one, many] = category ? NOUNS[category] : ["file", "files"];
      const what = `${formatCount(count)} ${count === 1 ? one : many}`;
      return `${what} ${count === 1 ? "was" : "were"} left out: ${WHY_WORDS[why][count === 1 ? 0 : 1]}.`;
    })
    .join(" ");
}

/** Skip reasons in words, for one file and for many ("is" and "are"). */
function skipWords(reason: BatchSkipReason, tab: SheetTab): readonly [string, string] {
  switch (reason) {
    case "missing":
      return ["is no longer in Import", "are no longer in Import"];
    case "not_on_tab":
      return tab === "deleted"
        ? ["is no longer on Deleted", "are no longer on Deleted"]
        : ["is no longer on To review", "are no longer on To review"];
    case "being_read":
      return ["is still being read, so it cannot be deleted yet", "are still being read, so they cannot be deleted yet"];
    case "approved":
      return ["is already approved", "are already approved"];
    case "already_deleted":
      return ["was already deleted", "were already deleted"];
    case "does_not_apply":
      return ["can no longer take this change", "can no longer take this change"];
    case "removed_in_onedrive":
      return ["was removed in OneDrive, so it stays on Deleted", "were removed in OneDrive, so they stay on Deleted"];
  }
}

/**
 * The files a call left as they were, in plain words by reason: "2 files
 * are no longer on To review. 1 file is still being read, so it cannot be
 * deleted yet." Empty when none were.
 */
export function skippedText(skipped: readonly Skipped[], tab: SheetTab): string {
  const counts = new Map<BatchSkipReason, number>();
  for (const entry of skipped) counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  return [...counts]
    .map(([reason, count]) => `${plural(count, "file")} ${skipWords(reason, tab)[count === 1 ? 0 : 1]}.`)
    .join(" ");
}

// ─── Selection ──────────────────────────────────────────────────────────────

export type CheckState = "all" | "some" | "none";

/** A company's or section's checkbox: every loaded file selected, some, or none. */
export function checkState(ids: readonly string[], isSelected: (id: string) => boolean): CheckState {
  let selected = 0;
  for (const id of ids) if (isSelected(id)) selected += 1;
  if (selected === 0) return "none";
  return selected === ids.length ? "all" : "some";
}

// ─── Words ──────────────────────────────────────────────────────────────────

const files = (count: number) => plural(count, "file");

/** A writer a person chose on Import (2026-11-16): a team member, a writer by id, or a typed name. */
export type WriterChoice = NonNullable<FunctionArgs<typeof api.ingestion.matchWriterInitials>["writer"]>;

/** The bar's changes that go through setSheetLabels. */
export type LabelChange =
  | { kind: "category"; category: ImportCategory }
  | { kind: "fiscalYearEnd"; fiscalYearEnd: number }
  | { kind: "company"; company: string }
  | { kind: "writer"; writer: WriterChoice; writerName: string }
  | { kind: "pdNumber"; pdNumber: string }
  | { kind: "scienceCode"; scienceCode: string };

/**
 * What the bar can do to the selected files, and the value picked (a writer
 * or reviewer with its label). The reviewer (2026-11-17) goes through
 * setFileReviewers and the CRA mark through setCraReviewed.
 */
export type BarChange =
  | LabelChange
  | { kind: "reviewer"; reviewer: WriterChoice; reviewerName: string }
  | { kind: "craReviewed"; reviewed: boolean };

/** The setSheetLabels patch for a label change. */
export function changePatch(change: LabelChange) {
  switch (change.kind) {
    case "category":
      return { category: change.category };
    case "fiscalYearEnd":
      return { fiscalYearEnd: change.fiscalYearEnd };
    case "company":
      return { company: change.company };
    case "writer":
      return { writer: change.writer };
    case "pdNumber":
      return { pdNumber: change.pdNumber };
    case "scienceCode":
      return { scienceCode: change.scienceCode };
  }
}

/** The confirm line under a bar menu: "Move 6 files to Transcripts". */
export function confirmLine(change: BarChange, count: number): string {
  switch (change.kind) {
    case "category":
      return `Move ${files(count)} to ${CATEGORY_LABELS[change.category]}`;
    case "fiscalYearEnd":
      return `Set the year end to ${yearEndDate(change.fiscalYearEnd)} for ${files(count)}`;
    case "company":
      return `Move ${files(count)} to ${change.company}`;
    case "writer":
      return `Set the writer to ${change.writerName} for ${files(count)}`;
    case "pdNumber":
      return `Set the PD number to ${change.pdNumber} for ${files(count)}`;
    case "reviewer":
      return `Set the reviewer to ${change.reviewerName} for ${files(count)}`;
    case "craReviewed":
      return change.reviewed ? `Mark ${files(count)} as reviewed by CRA` : `Clear "${CRA_REVIEWED}" on ${files(count)}`;
    case "scienceCode":
      return `Set the science code to ${change.scienceCode} for ${files(count)}`;
  }
}

/** The toast once a change is made: "6 files moved to Transcripts". */
export function changedText(change: BarChange, count: number): string {
  switch (change.kind) {
    case "category":
      return `${files(count)} moved to ${CATEGORY_LABELS[change.category]}`;
    case "fiscalYearEnd":
      return `Year end set to ${yearEndDate(change.fiscalYearEnd)} for ${files(count)}`;
    case "company":
      return `${files(count)} moved to ${change.company}`;
    case "writer":
      return `Writer set to ${change.writerName} for ${files(count)}`;
    case "pdNumber":
      return `PD number set to ${change.pdNumber} for ${files(count)}`;
    case "reviewer":
      return `Reviewer set to ${change.reviewerName} for ${files(count)}`;
    case "craReviewed":
      return change.reviewed
        ? `${files(count)} marked as reviewed by CRA`
        : `Cleared "${CRA_REVIEWED}" on ${files(count)}`;
    case "scienceCode":
      return `Science code set to ${change.scienceCode} for ${files(count)}`;
  }
}

/** A move: the setSheetLabels patch for a new category or company. */
export type MovePatch = { category: ImportCategory } | { company: string };

/** The toast once one file is moved from its menu: "Moved to Drafts", "Moved to Halden Foods". */
export function movedText(patch: MovePatch): string {
  return "category" in patch ? `Moved to ${CATEGORY_LABELS[patch.category]}` : `Moved to ${patch.company}`;
}

/** Files to set back to one value, for a move's Undo. */
export type MoveBackGroup = { patch: MovePatch; ids: FileId[] };

/**
 * A move's Undo (live QA fixes, 2026-11-11): the moved files grouped by the
 * category or company each had before, in the order first seen. Null when
 * any file's value is not known, or is "No company yet", which a change
 * cannot set back: then the toast offers no Undo.
 */
export function moveBackGroups(
  kind: "category" | "company",
  files: readonly { _id: FileId; before: ImportCategory | string | null | undefined }[]
): MoveBackGroup[] | null {
  const groups = new Map<string, MoveBackGroup>();
  for (const file of files) {
    const before = file.before;
    if (before === null || before === undefined || before === "") return null;
    const group = groups.get(before);
    if (group) group.ids.push(file._id);
    else {
      const patch: MovePatch = kind === "category" ? { category: before as ImportCategory } : { company: before };
      groups.set(before, { patch, ids: [file._id] });
    }
  }
  return [...groups.values()];
}

/**
 * The toast once a person says who some initials are (2026-11-12): "KT is
 * Kim Tran on 9 files", or "KT is Kim Tran" when no file changed. While more
 * files are still to follow, "on 100 files so far".
 */
export function writerMatchedText(initials: string, writerName: string, changed: number, more: boolean): string {
  if (changed <= 0) return `${initials} is ${writerName}`;
  return `${initials} is ${writerName} on ${files(changed)}${more ? " so far" : ""}`;
}

/** Said under that toast while more files are still to follow. */
export const WRITER_MATCH_MORE = "The other files with these initials follow in a moment.";

/**
 * The amber control on a file whose writer a person still has to choose
 * (2026-11-16): "Choose writer", with no initials in it, whether the file
 * name gave initials that could be more than one person or none at all.
 */
export { CHOOSE_WRITER };

/** The quiet words in an editable Reviewer cell with no reviewer, and the CRA tag (2026-11-17). */
export { CHOOSE_REVIEWER, CRA_REVIEWED };

/** "Delete 6 files" */
export function deleteLine(count: number): string {
  return `Delete ${files(count)}`;
}

/** "6 files deleted", the toast with Undo. */
export function deletedText(count: number): string {
  return `${files(count)} deleted`;
}

/** "Put back 6 files" */
export function putBackLine(count: number): string {
  return `Put back ${files(count)}`;
}

/** "6 files put back" */
export function putBackText(count: number): string {
  return `${files(count)} put back`;
}

/** Said once, quietly, where a delete is confirmed. */
export const DELETE_NOTE = "Deleting only takes a file out of Import. Nothing changes on anyone's computer or in OneDrive.";

const PAST: Record<"Changed" | "Deleted" | "Put back" | "Sent", string> = {
  Changed: "changed",
  Deleted: "deleted",
  "Put back": "put back",
  // 2026-11-17: files sent to be approved.
  Sent: "sent",
};

/**
 * When a run stopped part way: how many it changed, what happened to the
 * rest, then the reason. With `stillSelected` (the bar, where the rest stay
 * selected): "Changed 100 of 250 files. 150 are still selected. ..."
 * Without it (a row's menu, an Undo, where nothing stays selected): "Put
 * back 100 of 250 files. The other 150 were not put back. ..." With none
 * changed, only the reason.
 */
export function stoppedText(
  verb: "Changed" | "Deleted" | "Put back" | "Sent",
  done: number,
  total: number,
  reason: string,
  stillSelected: number | null = null
): string {
  if (done <= 0) return reason;
  const rest = total - done;
  const after =
    stillSelected !== null
      ? stillSelected > 0
        ? ` ${formatCount(stillSelected)} ${stillSelected === 1 ? "is" : "are"} still selected.`
        : ""
      : rest > 0
        ? ` The other ${formatCount(rest)} ${rest === 1 ? "was" : "were"} not ${PAST[verb]}.`
        : "";
  return `${verb} ${formatCount(done)} of ${files(total)}.${after} ${reason}`;
}

/** Said when a change went through but changed nothing (every file already had it, or was skipped). */
export const NOTHING_CHANGED = "No files were changed.";

/** A fallback when a call fails without the server's words. */
export const TRY_AGAIN = "Something went wrong. Try again.";

// ─── Names for screen readers ───────────────────────────────────────────────

/** "in Cedarline Systems", or "with no company yet" for the files that have none. */
function companyPhrase(company: string | null): string {
  return company ? `in ${company}` : "with no company yet";
}

/** A section's checkbox: "Select Final PDs in Cedarline Systems". */
export function sectionSelectLabel(sectionLabel: string, company: string | null): string {
  return `Select ${sectionLabel} ${companyPhrase(company)}`;
}

/**
 * A file's checkbox, with its file name and company: "Select Site notes.pdf
 * in Cedarline Systems", or with the PD's title first when the row shows
 * one: "Select PD 4 Label vision check (04 Cedarline.docx) in Cedarline Systems".
 */
export function fileSelectLabel(shown: string, fileName: string, company: string | null): string {
  const what = shown === fileName ? fileName : `${shown} (${fileName})`;
  return `Select ${what} ${companyPhrase(company)}`;
}

/** Why a file is on the Deleted tab, in muted words after its name. */
export function deletedReasonText(reason: SheetFileRow["deletedReason"]): string | null {
  if (reason === "deleted") return "Deleted in Import";
  if (reason === "removed_in_onedrive") return "Removed in OneDrive";
  if (reason === "rejected") return "Rejected";
  return null;
}
