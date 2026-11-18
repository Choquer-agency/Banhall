/**
 * The final PD progress line on the Import page and its breakdown
 * (2026-11-17, docs/product-domain.md): words and numbers only, so the
 * components stay thin and these rules are tested on their own.
 *
 * What "all" means: the staged count is the final PDs added to Import so
 * far (To review and Approved, never Deleted), not every PD the firm has.
 * It grows as more files are added, so nothing here shows a share of the
 * firm's PDs.
 */
import { formatCount } from "./importFormat";

/** finalPdProgress. */
export type FinalPdProgress = { approved: number; staged: number };

/** One row of the breakdown: final PDs approved of those staged so far. */
export type FinalPdRow = { key: string; approved: number; staged: number };

/** A writer's row, under the writer's label as it is now. */
export type FinalPdWriterRow = FinalPdRow & { label: string; noLogin: boolean };

/** finalPdBreakdown. */
export type FinalPdBreakdown = {
  years: FinalPdRow[];
  writers: FinalPdWriterRow[];
  noWriter: FinalPdRow | null;
  unsorted: FinalPdRow | null;
  complete: boolean;
};

/** The fiscal year bucket the server uses for final PDs with no year end. */
const NO_FISCAL_YEAR = "none";

/** "312 of 1,040 final PDs approved", or "No final PDs added yet". */
export function progressText(progress: FinalPdProgress): string {
  if (progress.staged <= 0) return "No final PDs added yet";
  const noun = progress.staged === 1 ? "final PD" : "final PDs";
  return `${formatCount(progress.approved)} of ${formatCount(progress.staged)} ${noun} approved`;
}

/** The note beside it: the total is only what has been added so far. */
export const PROGRESS_NOTE = "Out of the final PDs added so far. The total grows as more files are added.";

/** "312 of 1,040": a row's figure. */
export function rowFigure(row: FinalPdRow): string {
  return `${formatCount(row.approved)} of ${formatCount(row.staged)}`;
}

/** Every staged final PD in the row is approved. */
export function allApproved(row: FinalPdRow): boolean {
  return row.staged > 0 && row.approved >= row.staged;
}

/**
 * How much of the bar is filled, 0 to 1, of the row's own staged count.
 * A row with some approved never reads as empty, and one with some left
 * never reads as full, so a glance tells "a few" from "none" and "almost"
 * from "all".
 */
export function filledShare(row: FinalPdRow): number {
  if (row.staged <= 0 || row.approved <= 0) return 0;
  if (row.approved >= row.staged) return 1;
  return Math.min(0.98, Math.max(0.02, row.approved / row.staged));
}

/** A fiscal year row's name: "2025", or "No fiscal year". */
export function yearLabel(key: string): string {
  return key === NO_FISCAL_YEAR ? "No fiscal year" : key;
}

/** What a row says to a screen reader: "2025: 40 of 52 approved". */
export function rowSummary(label: string, row: FinalPdRow): string {
  return `${label}: ${rowFigure(row)} approved`;
}
