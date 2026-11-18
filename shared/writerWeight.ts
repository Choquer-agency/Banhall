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

/** The refusal for a weight that is not a number from 0 to 1 (the words `brain.reweightSource` uses). */
export const WRITER_WEIGHT_RULE = "Weight must be a number from 0 to 1.";

/** A stored weight as it is used: finite and within 0 to 1, else the default. */
export function writerWeight(tier: number | null | undefined): number {
  return typeof tier === "number" && Number.isFinite(tier) ? Math.max(0, Math.min(1, tier)) : DEFAULT_WRITER_WEIGHT;
}

/** The weight an Admin set, or null when the writer uses the default. */
export function storedWriterWeight(tier: number | null | undefined): number | null {
  return typeof tier === "number" && Number.isFinite(tier) ? Math.max(0, Math.min(1, tier)) : null;
}

/** Whether a weight a person typed may be saved as it is: a number from 0 to 1, never clamped. */
export function isWriterWeight(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * The weight typed in Team's dialog: null for an empty box (back to the
 * default), a number from 0 to 1, or "invalid". A comma is read as a
 * decimal point ("0,8").
 */
export function parseWriterWeight(text: string): number | null | "invalid" {
  const typed = text.trim().replace(",", ".");
  if (typed === "") return null;
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(typed)) return "invalid";
  const value = Number(typed);
  return isWriterWeight(value) ? value : "invalid";
}

/** A weight as Team shows it: "1", "0.7", "0.85". */
export function writerWeightText(weight: number): string {
  return String(Math.round(weight * 1000) / 1000);
}

