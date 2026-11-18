/**
 * The Approved tab's own actions (2026-11-17, docs/product-domain.md): Send
 * back to review and edit after approval. Pure: no Svelte, no Convex
 * client. The words of the Send back confirm and its toasts, the batches it
 * sends, and the words for edits made to an approved file.
 */
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";
import { approvedEditApplies, CRA_REVIEWED, type ApprovedEditField } from "../../../../shared/importSheetRules";
import { formatCount, plural, type SheetFileRow } from "./importFormat";

export { approvedEditApplies, CRA_REVIEWED, type ApprovedEditField };

/** The most files one Send back call takes (ingestion.SEND_BACK_MAX_FILES). */
export const SEND_BACK_BATCH = 50;

/** What Send back to review does, said before anything happens, one line each. */
export const SEND_BACK_NOTES: readonly string[] = [
  "Each file goes back to To review with its labels.",
  "It comes off its company's page. Drafts that already used it keep the text they read.",
  "A final PD's copy is removed from the Brain, unless another approved file shares it.",
  "The company stays. Approve the file again to put it back.",
];

/** The confirm button: "Send back 1 file", "Send back 6 files". */
export function sendBackLine(count: number): string {
  return `Send back ${plural(count, "file")}`;
}

export type SendBackResult = FunctionReturnType<typeof api.ingestion.sendBackToReview>;
type Refused = SendBackResult["refused"][number];

/** A refusal in plain words, for one file and for many. */
function refusedWords(reason: Refused["reason"]): readonly [string, string] {
  switch (reason) {
    case "missing":
      return ["is no longer in Import", "are no longer in Import"];
    case "not_approved":
      return ["is no longer approved", "are no longer approved"];
    case "approval_running":
      return [
        "is in a company that is still being approved. Send it back once that is done",
        "are in a company that is still being approved. Send them back once that is done",
      ];
  }
}

/** All the calls of one Send back, added up. */
export function emptySendBack(): SendBackResult {
  return { sentBack: [], refused: [], companyFileGone: [], brainKept: [], brainRevoked: [] };
}

export function addSendBack(total: SendBackResult, part: SendBackResult): SendBackResult {
  return {
    sentBack: [...total.sentBack, ...part.sentBack],
    refused: [...total.refused, ...part.refused],
    companyFileGone: [...total.companyFileGone, ...part.companyFileGone],
    brainKept: [...total.brainKept, ...part.brainKept],
    brainRevoked: [...total.brainRevoked, ...part.brainRevoked],
  };
}

/** The toast once files are sent back: "6 files sent back to To review". */
export function sentBackText(count: number): string {
  return count > 0 ? `${plural(count, "file")} sent back to To review` : "No files were sent back.";
}

/**
 * The lines under that toast: what happened beside the usual, and what was
 * left as it was. Empty when there is nothing to add.
 */
export function sentBackDetails(result: SendBackResult): string {
  const lines: string[] = [];
  const revoked = result.brainRevoked.length;
  if (revoked > 0) lines.push(`${formatCount(revoked)} ${revoked === 1 ? "copy was" : "copies were"} removed from the Brain.`);
  const kept = result.brainKept.length;
  if (kept > 0) {
    lines.push(
      kept === 1
        ? "1 Brain copy stays, because another approved file shares it."
        : `${formatCount(kept)} Brain copies stay, because other approved files share them.`
    );
  }
  const gone = result.companyFileGone.length;
  if (gone > 0) {
    lines.push(
      gone === 1
        ? "1 file was not on a company page any more, so only the file came back."
        : `${formatCount(gone)} files were not on a company page any more, so only the files came back.`
    );
  }
  const counts = new Map<Refused["reason"], number>();
  for (const entry of result.refused) counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  for (const [reason, count] of counts) lines.push(`${plural(count, "file")} ${refusedWords(reason)[count === 1 ? 0 : 1]}.`);
  return lines.join(" ");
}

// ─── Edit after approval ────────────────────────────────────────────────────

/** Said in the file view above the details an Admin can change. */
export const APPROVED_EDIT_NOTE =
  "Changing these never changes the file itself. To move it to another company, kind or fiscal year, send it back to review.";

/** The toast once one detail is saved: "Writer changed", "Marked as reviewed by CRA". */
export function editedText(field: ApprovedEditField, craReviewed?: boolean): string {
  switch (field) {
    case "writer":
      return "Writer changed";
    case "reviewer":
      return "Reviewer changed";
    case "scienceCode":
      return "Science code changed";
    case "pdTitle":
      return "PD title changed";
    case "craReviewed":
      return craReviewed ? "Marked as reviewed by CRA" : `Cleared "${CRA_REVIEWED}"`;
  }
}

/** Said under that toast when the Brain copy took the new details too. */
export const BRAIN_COPY_UPDATED = "Its Brain copy was updated too.";

/** The menu's words for the quiet "Reviewed by CRA" tag (the reviewer change's, shared/importSheetRules.ts). */
export const MARK_CRA_REVIEWED = "Mark as reviewed by CRA";
export const CLEAR_CRA_REVIEWED = `Clear "${CRA_REVIEWED}"`;

/** The most characters a PD title may have (ingestion.MAX_PD_TITLE). */
export const PD_TITLE_MAX = 200;

/** Whether a row can take each approved edit (the shared rule). */
export function approvedEdits(row: Pick<SheetFileRow, "status" | "category">): Record<ApprovedEditField, boolean> {
  return {
    writer: approvedEditApplies("writer", row),
    reviewer: approvedEditApplies("reviewer", row),
    scienceCode: approvedEditApplies("scienceCode", row),
    pdTitle: approvedEditApplies("pdTitle", row),
    craReviewed: approvedEditApplies("craReviewed", row),
  };
}
