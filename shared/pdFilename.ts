/**
 * The firm's PD file-naming scheme (writer request, 2026-09-09):
 *
 *   03 3GAMarine 2025-12-31 R1.LR.mo MarineBatteryElectricalandThermalBehaviourAdvancements.docx
 *   ── ───────── ────────── ──────── ────────────────────────────────────────────────────────
 *   #  Client    FYE        Rev.W.R  Project title (CamelCase, spaces removed)
 *
 * Pure and framework-free so the create-project page can prefill from a
 * dropped file and tests can pin the grammar. Parsing is positional and
 * tolerant: the project number and client are the anchor; every later token
 * is optional and whatever follows the recognised prefix becomes the title.
 * Initials are returned as data only — callers must never turn them into an
 * Owner or writer (ownership is never inferred from metadata).
 */

export type ParsedPdFilename = {
  /** Leading zero stripped: "03" → "3", "12a" → "12a". */
  projectNumber?: string;
  /** CamelCase split into words: "3GAMarine" → "3GA Marine". */
  clientName?: string;
  /** Calendar-valid yyyy-mm-dd. */
  fiscalYearEnd?: string;
  /** The revision number without its R: "R1.LR.mo" → "1". */
  revision?: string;
  /** Upper-cased: "lr" → "LR". */
  writerInitials?: string;
  reviewerInitials?: string;
  /** Remaining tokens, CamelCase split; lowercase runs are left as typed. */
  title?: string;
};

const PROJECT_NUMBER = /^(\d{1,2})([A-Za-z])?$/;
const CLIENT_TOKEN = /^[A-Za-z0-9][A-Za-z0-9&'-]*$/;
const FISCAL_YEAR_END = /^(\d{4})-(\d{2})-(\d{2})$/;
const REVISION = /^[Rr](\d+)\.([A-Za-z]{2,3})(?:\.([A-Za-z]{2,3}))?$/;

/** True for a real calendar date (rejects 2025-02-30, 2025-13-01). */
function isCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Re-insert the spaces the naming scheme removed. Splits on lower→Upper
 * boundaries, keeps acronym runs together ("3GAMarine" → "3GA Marine"), and
 * separates a digit run that follows a lowercase word ("Client2024" →
 * "Client 2024") or precedes a capitalised one ("2024Report" → "2024 Report").
 * Lowercase runs are never dictionary-split: "Electricaland" stays as typed.
 */
export function splitCamelCase(token: string): string {
  return token
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Z][a-z])/g, "$1 $2");
}

/**
 * Strip a short extension such as `.docx`, `.pdf` or `.txt`. A name with no
 * extension whose last token is the revision ("… R1.LR.mo") keeps it: the
 * dotted initials are scheme fields, not an extension.
 */
function stripExtension(fileName: string): string {
  const trimmed = fileName.trim();
  const last = trimmed.split(/\s+/).at(-1) ?? "";
  if (REVISION.test(last)) return trimmed;
  return trimmed.replace(/\.[A-Za-z0-9]{1,8}$/, "");
}

/** Numbered projects are capped at 20 per company (convex/projects.ts). */
const MAX_PROJECT_NUMBER = 20;

/**
 * Parse a PD file name into its scheme fields, or null when the name is not
 * scheme-named. "<number> <client>" alone is too weak an anchor ("3 Notes.docx"
 * would prefill a client called Notes), so at least one corroborating token,
 * a calendar-valid fiscal year-end or a revision token, must follow the
 * client. Later fields are consumed in scheme order only while they match;
 * the rest is the title. A number above the per-company cap is dropped so the
 * page never prefills a value the server will reject.
 */
export function parsePdFilename(fileName: string): ParsedPdFilename | null {
  const tokens = stripExtension(fileName).split(/\s+/).filter(Boolean);
  const [first, second] = tokens;
  if (!first || !second) return null;
  const numberMatch = PROJECT_NUMBER.exec(first);
  if (!numberMatch) return null;
  const number = Number.parseInt(numberMatch[1], 10);
  if (number === 0) return null;
  if (!CLIENT_TOKEN.test(second) || FISCAL_YEAR_END.test(second) || REVISION.test(second)) {
    return null;
  }
  const parsed: ParsedPdFilename = {};
  if (number <= MAX_PROJECT_NUMBER) {
    parsed.projectNumber = `${number}${numberMatch[2] ?? ""}`;
  }
  parsed.clientName = splitCamelCase(second);

  let index = 2;
  const fye = tokens[index] ? FISCAL_YEAR_END.exec(tokens[index]) : null;
  if (fye) {
    // A date-shaped token is consumed either way; only a real calendar date
    // becomes the fiscal year-end (a typo'd date is dropped, not titled).
    const [, year, month, day] = fye;
    if (isCalendarDate(Number(year), Number(month), Number(day))) {
      parsed.fiscalYearEnd = `${year}-${month}-${day}`;
    }
    index += 1;
  }
  const revision = tokens[index] ? REVISION.exec(tokens[index]) : null;
  if (revision) {
    parsed.revision = String(Number.parseInt(revision[1], 10));
    parsed.writerInitials = revision[2].toUpperCase();
    if (revision[3]) parsed.reviewerInitials = revision[3].toUpperCase();
    index += 1;
  }
  if (!parsed.fiscalYearEnd && !parsed.revision) return null;
  const title = tokens.slice(index).map(splitCamelCase).join(" ").trim();
  if (title) parsed.title = title;
  return parsed;
}
