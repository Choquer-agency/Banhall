/**
 * Writer weights (2026-11-18 (second), docs/product-domain.md): how much a
 * writer's imported final PDs count when the AI looks for past examples in
 * the Brain. A weight is a number from 0 to 1 on the writer (`pdWriters.tier`),
 * set by an Admin on Team, one weight per person (a member's own writer row
 * and the past writer an Admin linked to them carry the same value). A
 * writer with no weight uses DEFAULT_WRITER_WEIGHT. Only imported PDs follow
 * writer weights: nominations, writer feedback and curated imports keep the
 * weight they were stored with (owner, 2026-11-18).
 *
 * Shared by the server (the Brain copy, the re-tier job, the Brain check
 * order) and Team's weight dialog.
 */

/** The weight of a writer an Admin has given none (owner, 2026-11-18: everyone but Tracy is 0.7). */
export const DEFAULT_WRITER_WEIGHT = 0.7;

/**
 * A weight holds at most this many decimal places: the Brain check order
 * ranks weights in thousandths, and Team shows a weight exactly as saved, so
 * opening the dialog and saving again never changes it.
 */
export const WRITER_WEIGHT_DECIMALS = 3;

/** The refusal for a weight that is not a number from 0 to 1 with at most 3 decimal places. */
export const WRITER_WEIGHT_RULE = "Weight must be a number from 0 to 1, with at most 3 decimal places.";

/** A stored weight as it is used: finite and within 0 to 1, else the default. */
export function writerWeight(tier: number | null | undefined): number {
  return typeof tier === "number" && Number.isFinite(tier) ? Math.max(0, Math.min(1, tier)) : DEFAULT_WRITER_WEIGHT;
}

/** The weight an Admin set, or null when the writer uses the default. */
export function storedWriterWeight(tier: number | null | undefined): number | null {
  return typeof tier === "number" && Number.isFinite(tier) ? Math.max(0, Math.min(1, tier)) : null;
}

/**
 * Whether a weight a person typed may be saved as it is: a number from 0 to
 * 1 with at most 3 decimal places, never clamped or rounded.
 */
export function isWriterWeight(value: number): boolean {
  if (!Number.isFinite(value) || value < 0 || value > 1) return false;
  const scale = 10 ** WRITER_WEIGHT_DECIMALS;
  return Math.abs(Math.round(value * scale) / scale - value) < 1e-12;
}

/**
 * The weight typed in Team's dialog: null for an empty box (back to the
 * default), a number from 0 to 1, or "invalid". A comma is read as a
 * decimal point ("0,8").
 */
export function parseWriterWeight(text: string): number | null | "invalid" {
  const typed = text.trim().replace(",", ".");
  if (typed === "") return null;
  if (!/^(\d+(\.\d{0,3})?|\.\d{1,3})$/.test(typed)) return "invalid";
  const value = Number(typed);
  return isWriterWeight(value) ? value : "invalid";
}

/**
 * A weight as Team shows it: "1", "0.7", "0.85". Exact for every weight
 * isWriterWeight accepts (at most 3 decimal places).
 */
export function writerWeightText(weight: number): string {
  const scale = 10 ** WRITER_WEIGHT_DECIMALS;
  return String(Math.round(weight * scale) / scale);
}


/**
 * The Brain check's writer rank for a weight (2026-11-18 (second)): minus
 * the weight times 1000, rounded, so the index lists the highest weight
 * first. A whole number, so two weights a hair apart never split a tie.
 */
export function brainCheckWriterRank(tier: number | null | undefined): number {
  return -Math.round(writerWeight(tier) * 1000);
}
