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
 * - approved: it is already approved (since 2026-11-17 it is on its company's page).
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

/**
 * Why Approve (2026-11-17) left a file on To review:
 * - missing: the file is no longer in Import.
 * - not_on_review: it is no longer on To review (deleted, rejected).
 * - being_read: it is still being read.
 * - needs_check: it has a check reason (no company, no fiscal year, no text,
 *   no writer, no science code, an unknown kind, could not be read).
 * - no_industry: a final PD whose company has no industry, and none was
 *   picked on the sheet for a new company: its Brain copy needs one.
 * - company_merged: its company was merged into another one.
 * - company_unclear: more than one company has its name, so Approve does
 *   not guess (D7: never merge or pick on its own).
 * - left_company: in a company's "Approve N ready", the file was moved to
 *   another company before its turn came.
 * - not_saved: something went wrong while it was approved.
 * A file that is already approved is not a refusal: Approve counts it and
 * makes nothing again.
 */
export type ApproveRefusal =
  | "missing"
  | "not_on_review"
  | "being_read"
  | "needs_check"
  | "no_industry"
  | "company_merged"
  | "company_unclear"
  | "left_company"
  | "not_saved";

/**
 * The refusals Approve can tell from the row alone (the page's selection
 * bar leaves these out before it sends, and the server checks them again),
 * or null when only the server can tell (the company, its industry).
 */
export function approveRefusalFor(row: {
  status: ImportItemStatus;
  needsCheck?: boolean;
  checkReasons?: readonly string[];
}): ApproveRefusal | null {
  if (row.status === "approved") return null;
  if (tabForStatus(row.status) !== "review") return "not_on_review";
  if (isBeingRead(row.status)) return "being_read";
  if (row.needsCheck === true || (row.checkReasons ?? []).length > 0 || row.status !== "pending_review") return "needs_check";
  return null;
}

/** A refusal in plain words, for one file and for many ("is" and "are"). */
export function approveRefusalWords(reason: ApproveRefusal): readonly [string, string] {
  switch (reason) {
    case "missing":
      return ["is no longer in Import", "are no longer in Import"];
    case "not_on_review":
      return ["is no longer on To review", "are no longer on To review"];
    case "being_read":
      return ["is still being read", "are still being read"];
    case "needs_check":
      return ["still needs a check", "still need a check"];
    case "no_industry":
      return ["is a final PD whose company has no industry yet", "are final PDs whose company has no industry yet"];
    case "company_merged":
      return ["belongs to a company that was merged into another one", "belong to a company that was merged into another one"];
    case "company_unclear":
      return ["has a company name that more than one company has", "have a company name that more than one company has"];
    case "left_company":
      return ["is no longer in this company", "are no longer in this company"];
    case "not_saved":
      return ["could not be approved because something went wrong", "could not be approved because something went wrong"];
  }
}

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

/** Numbered projects are capped at 20 per company, as in shared/pdFilename.ts. */
export const MAX_PD_NUMBER = 20;

/** The words for a PD number that is not one, the same on the page and from the server. */
export const PD_NUMBER_RULE = `A PD number is 1 to ${MAX_PD_NUMBER}, with an optional letter, for example 4 or 12a.`;

/**
 * A PD number as it is stored (setSheetLabels): "04" -> "4", "12a" -> "12a";
 * null when it is not a PD number from 1 to 20 with an optional letter.
 */
export function normalizePdNumber(value: string): string | null {
  const match = /^(\d{1,3})([A-Za-z])?$/.exec(value.trim());
  if (!match) return null;
  const number = Number.parseInt(match[1]!, 10);
  if (number < 1 || number > MAX_PD_NUMBER) return null;
  return `${number}${match[2] ?? ""}`;
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

/**
 * Whether a file's reviewer can be set (2026-11-17): a read final PD, draft
 * or review copy on To review, or one of those on Deleted. Approved files
 * are read only. The page's Reviewer cell and bar, and the server's
 * setFileReviewers, follow this.
 */
export function reviewerApplies(row: { status: ImportItemStatus; category: ImportCategory }): boolean {
  if (!categoryTakes("writerName", row.category)) return false;
  const tab = tabForStatus(row.status);
  if (tab === "review") return row.status === "pending_review";
  return tab === "deleted";
}

/**
 * Whether "Reviewed by CRA" can be set or cleared on a file (2026-11-17,
 * by hand only): a final PD, where its reviewer can be set (reviewerApplies).
 */
export function craReviewedApplies(row: { status: ImportItemStatus; category: ImportCategory }): boolean {
  return row.category === "final_pd" && reviewerApplies(row);
}

export type RowAbilities = {
  /** The fiscal year cell opens its calendar (any category). */
  edit: boolean;
  /** "Set the PD number" in the row's menu (final PDs, drafts and review copies). */
  pdNumber: boolean;
  version: boolean;
  writer: boolean;
  /** The Reviewer cell opens its picker (2026-11-17: To review and Deleted). */
  reviewer: boolean;
  /** "Reviewed by CRA" can be set or cleared (2026-11-17: final PDs, To review and Deleted). */
  craReviewed: boolean;
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
    pdNumber: review && labelApplies("pdNumber", row),
    version: review && labelApplies("version", row),
    writer: review && labelApplies("writerName", row),
    reviewer: tab !== "approved" && tabForStatus(row.status) === tab && reviewerApplies(row),
    craReviewed: tab !== "approved" && tabForStatus(row.status) === tab && craReviewedApplies(row),
    scienceCode: review && labelApplies("scienceCode", row),
    menu: review,
    remove: review && canDelete(row.status),
    putBack,
    select: review || putBack,
  };
}

/**
 * The initials a file name gave, as writers and reviewers are matched by (2026-11-16):
 * trimmed and upper case, two or three letters as the naming scheme has them
 * (shared/pdFilename.ts); null for anything else. A team member matches only
 * when their saved initials are exactly these (savedInitials).
 */
export function writerInitialsKey(initials: string | undefined | null): string | null {
  const key = initials?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2,3}$/.test(key) ? key : null;
}

// ─── Writers from initials (2026-11-16) ─────────────────────────────────────

/** The amber control on a file whose writer a person still has to choose. */
export const CHOOSE_WRITER = "Choose writer";

/**
 * The quiet words in the Reviewer cell of a file with no reviewer
 * (2026-11-17): never amber, since a reviewer is never required.
 */
export const CHOOSE_REVIEWER = "Choose reviewer";

/** The quiet tag on a final PD an Admin marked as reviewed by CRA (2026-11-17). */
export const CRA_REVIEWED = "Reviewed by CRA";

/** The quiet tag on a writer who has no login (a past writer). */
export const NO_LOGIN = "No login";

/** The most letters a team member's saved initials may have. */
export const MAX_SAVED_INITIALS = 4;

/**
 * A team member's initials as they are saved (users.initials): trimmed,
 * upper case, 1 to 4 letters from A to Z. "" for an empty value, which means
 * "no initials" (they never match a file). Null when the value is not that.
 */
export function savedInitials(value: string): string | null {
  const key = value.trim().toUpperCase();
  if (key === "") return "";
  return new RegExp(`^[A-Z]{1,${MAX_SAVED_INITIALS}}$`).test(key) ? key : null;
}

/** The words a refused initials value shows. */
export const INITIALS_RULE = `Initials are 1 to ${MAX_SAVED_INITIALS} letters, such as DW.`;

/** The first letter of a name from A to Z, accents dropped ("Élodie" gives "E"); null when there is none. */
function firstLetter(name: string | undefined | null): string | null {
  const letter = (name ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").charAt(0).toUpperCase();
  return /^[A-Z]$/.test(letter) ? letter : null;
}

/**
 * The initials prefilled for a team member with a first and last name: the
 * first letter of each ("Dana Whitlock" gives "DW"). Null unless both give one.
 */
export function initialsFromName(firstName: string | undefined | null, lastName: string | undefined | null): string | null {
  const first = firstLetter(firstName);
  const last = firstLetter(lastName);
  return first && last ? `${first}${last}` : null;
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
