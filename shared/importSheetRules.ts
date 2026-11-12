/**
 * What a file on the Import sheet may have changed, deleted or put back
 * (2026-11-11, phase 3b fixes). Pure: no database, no Svelte. The page
 * (src/lib/components/import/importEdit.ts, a file's own cells and the
 * selection bar) and the server (convex/ingestion.ts setSheetLabels,
 * removeItems and restoreItems) both import these rules, so what the page
 * offers and what the server changes cannot drift apart.
 */

export type ImportItemStatus =
  | "discovered"
  | "fetched"
  | "pending_review"
  | "approved"
  | "rejected"
  | "failed"
  | "deleted";

export type ImportCategory =
  | "final_pd"
  | "draft"
  | "review_copy"
  | "transcript"
  | "supporting"
  | "company_file"
  | "unknown";

export type ImportTab = "review" | "approved" | "deleted";

/** The labels a person can set on a file (ingestion.setSheetLabels patch keys). */
export type ImportLabel =
  | "company"
  | "category"
  | "fiscalYearEnd"
  | "pdNumber"
  | "version"
  | "writerName"
  | "scienceCode";

/** Why a file is on the Deleted tab. */
export type DeletedReason = "deleted" | "removed_in_onedrive" | "rejected";

/**
 * Why a batch call (setSheetLabels, removeItems, restoreItems) left a file
 * as it was:
 * - missing: the file is no longer in Import.
 * - not_on_tab: it is no longer on the tab the call works on (To review for
 *   a change, Deleted for a put back).
 * - being_read: it is still being read, so it cannot be deleted yet.
 * - approved: it is already approved into the Brain.
 * - already_deleted: it was already deleted.
 * - does_not_apply: none of the change's labels can go on it (see labelApplies).
 * - removed_in_onedrive: it was removed in OneDrive, so it is not put back.
 */
export type BatchSkipReason =
  | "missing"
  | "not_on_tab"
  | "being_read"
  | "approved"
  | "already_deleted"
  | "does_not_apply"
  | "removed_in_onedrive";

/** The review note markDriveItemRemoved leaves on a file removed in OneDrive. */
export const DELETED_IN_ONEDRIVE_NOTE = "Deleted in OneDrive";

/** The tab a status shows on. */
export function tabForStatus(status: ImportItemStatus): ImportTab {
  if (status === "approved") return "approved";
  if (status === "rejected" || status === "deleted") return "deleted";
  return "review"; // discovered, fetched, pending_review, failed
}

/** True while the file is still being fetched or read. */
export function isBeingRead(status: ImportItemStatus): boolean {
  return status === "discovered" || status === "fetched";
}

/** Categories whose files carry a PD number, a version and a writer. */
const NUMBERED: ReadonlySet<ImportCategory> = new Set(["final_pd", "draft", "review_copy"]);

/**
 * Whether a file of this category takes a label at all, whatever its status
 * or tab: pdNumber, version and writerName go on final PDs, drafts and
 * review copies, scienceCode on final PDs, the rest on every file. The sheet
 * shows a value only where its category takes it (live QA fixes,
 * 2026-11-11): a final PD moved to Drafts keeps its stored science code, so
 * moving it back brings the code back, but a draft shows no code.
 */
export function categoryTakes(label: ImportLabel, category: ImportCategory): boolean {
  if (label === "scienceCode") return category === "final_pd";
  if (label === "pdNumber" || label === "version" || label === "writerName") return NUMBERED.has(category);
  return true;
}

/**
 * Whether one label can be set on a file. The rule, the same on the page
 * and the server:
 * - Only a file on To review (not approved, rejected or deleted).
 * - company and category (moving the file): any file on To review, read,
 *   still being read or that could not be read.
 * - fiscalYearEnd: a file that has been read (waiting for review).
 * - pdNumber, version and writerName: a read final PD, draft or review copy.
 * - scienceCode: a read final PD.
 * The category is the one the file has after the change (`categoryAfter`),
 * so one change that moves a draft to Final PDs can also set its code.
 */
export function labelApplies(
  label: ImportLabel,
  row: { status: ImportItemStatus; category: ImportCategory },
  categoryAfter: ImportCategory = row.category
): boolean {
  if (tabForStatus(row.status) !== "review") return false;
  if (label === "company" || label === "category") return true;
  if (row.status !== "pending_review") return false;
  return categoryTakes(label, categoryAfter); // fiscalYearEnd on any category
}

/**
 * Why a file is on the Deleted tab: removed in OneDrive (its review note
 * says so, whether or not a person deleted it after), deleted by a person,
 * or rejected on the old review page. Undefined on the other tabs.
 */
export function deletedReasonFor(row: { status: ImportItemStatus; reviewNote?: string }): DeletedReason | undefined {
  if (row.status !== "deleted" && row.status !== "rejected") return undefined;
  if (row.reviewNote === DELETED_IN_ONEDRIVE_NOTE) return "removed_in_onedrive";
  return row.status === "deleted" ? "deleted" : "rejected";
}

/** A file a person can delete: read, could not be read, or rejected (removeItem's rule). */
export function canDelete(status: ImportItemStatus): boolean {
  return status === "pending_review" || status === "failed" || status === "rejected";
}

/** A file "Put back" returns to To review: one a person deleted or rejected, never one removed in OneDrive. */
export function canPutBack(row: { status: ImportItemStatus; deletedReason?: DeletedReason }): boolean {
  return (row.status === "deleted" || row.status === "rejected") && row.deletedReason !== "removed_in_onedrive";
}

export type RowAbilities = {
  /** The fiscal year cell opens its calendar (any category). */
  edit: boolean;
  version: boolean;
  writer: boolean;
  scienceCode: boolean;
  /** The "..." menu: move to another category or company, delete. */
  menu: boolean;
  /** Delete in that menu (a file still being read cannot be deleted yet). */
  remove: boolean;
  /** "Put back" at the row's end (Deleted tab). */
  putBack: boolean;
  /** A checkbox when Select is on. */
  select: boolean;
};

/**
 * What a file row may do on a tab: its label cells follow labelApplies, its
 * menu (a move) is on every file on To review, delete follows canDelete and
 * "Put back" follows canPutBack. Approved is read only.
 */
export function rowAbilities(
  row: { status: ImportItemStatus; category: ImportCategory; deletedReason?: DeletedReason },
  tab: ImportTab
): RowAbilities {
  const review = tab === "review" && tabForStatus(row.status) === "review";
  const putBack = tab === "deleted" && canPutBack(row);
  return {
    edit: review && labelApplies("fiscalYearEnd", row),
    version: review && labelApplies("version", row),
    writer: review && labelApplies("writerName", row),
    scienceCode: review && labelApplies("scienceCode", row),
    menu: review,
    remove: review && canDelete(row.status),
    putBack,
    select: review || putBack,
  };
}

/** Looks like an email address, which is never saved as a writer's name. */
export function looksLikeEmail(value: string): boolean {
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(value);
}

/** The roster's label when a person has no name or email (convex/lib/teamRoster.ts). */
export const UNKNOWN_TEAM_MEMBER = "Unknown team member";

/**
 * A roster entry's name, when it is a real name a writer can be saved as:
 * not empty, not the email address the roster falls back to, and not
 * "Unknown team member". Null otherwise.
 */
export function rosterWriterName(person: { name: string; email?: string | null }): string | null {
  const name = person.name.trim().replace(/\s+/g, " ");
  if (!name || name === UNKNOWN_TEAM_MEMBER || looksLikeEmail(name)) return null;
  if (person.email && name.toLowerCase() === person.email.trim().toLowerCase()) return null;
  return name;
}
