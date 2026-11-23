/**
 * Writer weights (2026-11-18, extended 2026-11-23): how much a writer's
 * imported final PDs count when the AI looks for past examples in the Brain.
 *
 * Resolution priority:
 * 1. An explicit custom weight set by an Admin (`pdWriters.tier`, 0 to 1)
 * 2. The default weight of the person's PD staff role (`pdWriters.staffRole`):
 *    - Technical Manager: 0.8
 *    - Technical Writer: 0.5
 *    - Junior Technical Writer: 0.2
 *    - Financial: unweighted (falls back to DEFAULT_WRITER_WEIGHT if ever used)
 * 3. DEFAULT_WRITER_WEIGHT (0.7) when neither a custom weight nor a technical
 *    staff role is set.
 *
 * Only imported PDs follow writer weights: nominations, writer feedback and
 * curated imports keep the weight they were stored with.
 *
 * Shared by the server (the Brain copy, the re-tier job, the Brain check
 * order) and Team's weight and staff-role dialogs.
 */

export const WRITER_STAFF_ROLES = [
  "technical_manager",
  "technical_writer",
  "junior_technical_writer",
  "financial",
] as const;

export type WriterStaffRole = (typeof WRITER_STAFF_ROLES)[number];

export const WRITER_STAFF_ROLE_LABELS: Record<WriterStaffRole, string> = {
  technical_manager: "Technical Manager",
  technical_writer: "Technical Writer",
  junior_technical_writer: "Junior Technical Writer",
  financial: "Financial",
};

/** Default quality weight for each technical PD staff role; Financial is unweighted (null). */
export const WRITER_STAFF_ROLE_DEFAULT_WEIGHTS: Record<WriterStaffRole, number | null> = {
  technical_manager: 0.8,
  technical_writer: 0.5,
  junior_technical_writer: 0.2,
  financial: null,
};

/** The weight of a writer with no custom weight and no technical staff role (owner, 2026-11-18). */
export const DEFAULT_WRITER_WEIGHT = 0.7;

/**
 * A weight holds at most this many decimal places: the Brain check order
 * ranks weights in thousandths, and Team shows a weight exactly as saved, so
 * opening the dialog and saving again never changes it.
 */
export const WRITER_WEIGHT_DECIMALS = 3;

/** The refusal for a weight that is not a number from 0 to 1 with at most 3 decimal places. */
export const WRITER_WEIGHT_RULE = "Weight must be a number from 0 to 1, with at most 3 decimal places.";

/** Whether a string is one of the 4 Banhall PD staff roles. */
export function isWriterStaffRole(value: string | null | undefined): value is WriterStaffRole {
  return value !== null && value !== undefined && (WRITER_STAFF_ROLES as readonly string[]).includes(value);
}

/** The default weight implied by a PD staff role, or DEFAULT_WRITER_WEIGHT when unweighted/unset. */
export function defaultWeightForStaffRole(staffRole: WriterStaffRole | null | undefined): number {
  if (staffRole && isWriterStaffRole(staffRole)) {
    const roleDefault = WRITER_STAFF_ROLE_DEFAULT_WEIGHTS[staffRole];
    if (roleDefault !== null) return roleDefault;
  }
  return DEFAULT_WRITER_WEIGHT;
}

/**
 * A writer's effective weight as used by the Brain and Brain check:
 * explicit custom `tier` (0..1) wins, else the staff role default, else DEFAULT_WRITER_WEIGHT.
 */
export function writerWeight(
  tier: number | null | undefined,
  staffRole?: WriterStaffRole | null
): number {
  if (typeof tier === "number" && Number.isFinite(tier)) {
    return Math.max(0, Math.min(1, tier));
  }
  return defaultWeightForStaffRole(staffRole);
}

/** The custom weight an Admin set, or null when the writer uses their role/global default. */
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
 * role/global default), a number from 0 to 1, or "invalid". A comma is read as a
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
 * the effective weight times 1000, rounded, so the index lists the highest weight
 * first. A whole number, so two weights a hair apart never split a tie.
 */
export function brainCheckWriterRank(
  tier: number | null | undefined,
  staffRole?: WriterStaffRole | null
): number {
  return -Math.round(writerWeight(tier, staffRole) * 1000);
}
