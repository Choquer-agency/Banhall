/**
 * The firm's PD file-naming scheme (writer request, 2026-09-09):
 *
 *   03 3GAMarine 2025-12-31 R1.LR.mo MarineBatteryElectricalandThermalBehaviourAdvancements.docx
 *   ── ───────── ────────── ──────── ────────────────────────────────────────────────────────
 *   #  Client    FYE        Rev.W.R  Project title (CamelCase, spaces removed)
 *
 * The version token starts with a letter (2026-11-11, from the client's
 * naming): T is to be submitted (the final copy), S is submitted, R is in
 * review (the most common). The number after the letter counts versions.
 * A name may end in a version with no initials ("… 2025-12-31 T1.docx").
 *
 * Pure and framework-free so the create-project page can prefill from a
 * dropped file and tests can pin the grammar. Parsing is positional and
 * tolerant: the project number and client are the anchor; every later token
 * is optional and whatever follows the recognised prefix becomes the title.
 * Initials are returned as data only: callers must never turn them into an
 * Owner (ownership is never inferred from metadata). Only the Import sheet
 * turns them into a writer (docs/product-domain.md, 2026-11-16, writers from
 * initials): the one team member whose saved initials they are, else a
 * writer with no login made from them, and never a guess between two.
 */

/** The version letter: T to be submitted, S submitted, R in review. */
export type PdVersionCode = "T" | "S" | "R";

export type ParsedPdFilename = {
  /** Leading zero stripped: "03" → "3", "12a" → "12a". */
  projectNumber?: string;
  /** CamelCase split into words: "3GAMarine" → "3GA Marine". */
  clientName?: string;
  /** Calendar-valid yyyy-mm-dd. */
  fiscalYearEnd?: string;
  /** The version letter, upper-cased: "t1.LR" → "T". Set with `revision`. */
  versionCode?: PdVersionCode;
  /** The version number without its letter: "R1.LR.mo" → "1", "T2.LR" → "2". */
  revision?: string;
  /**
   * Upper-cased: "lr" → "LR". Set with `revision`, except for a version with
   * no initials right before the extension ("… T1.docx").
   */
  writerInitials?: string;
  reviewerInitials?: string;
  /** Remaining tokens, CamelCase split; lowercase runs are left as typed. */
  title?: string;
};

const PROJECT_NUMBER = /^(\d{1,2})([A-Za-z])?$/;
const CLIENT_TOKEN = /^[A-Za-z0-9][A-Za-z0-9&'-]*$/;
const FISCAL_YEAR_END = /^(\d{4})-(\d{2})-(\d{2})$/;
// Version letter (either case), version number, writer, optional reviewer.
const REVISION = /^([RrSsTt])(\d+)\.([A-Za-z]{2,3})(?:\.([A-Za-z]{2,3}))?$/;
// A version with no initials ("T1"). Read only as the last token, right
// before a document extension ("… T1.doc"); see parsePdFilename.
const BARE_VERSION = /^([RrSsTt])(\d+)$/;

/**
 * The extensions a PD file can have (the file types ingestion stages, in
 * convex/lib/ingestionClassify.ts). doc, pdf, txt and vtt are as short as
 * initials, so "T1.doc" would otherwise read as writer DOC.
 */
const DOCUMENT_EXTENSIONS = new Set(["doc", "docx", "pdf", "txt", "vtt"]);

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
 * dotted initials are scheme fields, not an extension. A document extension
 * is always stripped, even where it looks like initials: "T1.DW.doc" is
 * version T1 by DW in a .doc file, never reviewer DOC.
 */
function stripExtension(fileName: string): { stem: string; documentExtension: boolean } {
  const trimmed = fileName.trim();
  const extension = /\.([A-Za-z0-9]{1,8})$/.exec(trimmed);
  const documentExtension =
    extension !== null && DOCUMENT_EXTENSIONS.has(extension[1].toLowerCase());
  const last = trimmed.split(/\s+/).at(-1) ?? "";
  if (!extension || (!documentExtension && REVISION.test(last))) {
    return { stem: trimmed, documentExtension: false };
  }
  return { stem: trimmed.slice(0, extension.index), documentExtension };
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
  const { stem, documentExtension } = stripExtension(fileName);
  const tokens = stem.split(/\s+/).filter(Boolean);
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
    parsed.versionCode = revision[1].toUpperCase() as PdVersionCode;
    parsed.revision = String(Number.parseInt(revision[2], 10));
    parsed.writerInitials = revision[3].toUpperCase();
    if (revision[4]) parsed.reviewerInitials = revision[4].toUpperCase();
    index += 1;
  } else if (documentExtension && index === tokens.length - 1) {
    // "… 2025-12-31 T1.doc": a version with no initials, with nothing after
    // it but the extension. Anywhere else a bare "T1" stays title text.
    const bare = BARE_VERSION.exec(tokens[index]);
    if (bare) {
      parsed.versionCode = bare[1].toUpperCase() as PdVersionCode;
      parsed.revision = String(Number.parseInt(bare[2], 10));
      index += 1;
    }
  }
  if (!parsed.fiscalYearEnd && !parsed.revision) return null;
  const title = tokens.slice(index).map(splitCamelCase).join(" ").trim();
  if (title) parsed.title = title;
  return parsed;
}
