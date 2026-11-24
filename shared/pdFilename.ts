/**
 * The firm's PD file-naming scheme (writer request, 2026-09-09):
 *
 *   03 3GAMarine 2025-12-31 R1.LR.mo MarineBatteryElectricalandThermalBehaviourAdvancements.docx
 *   ── ───────── ────────── ──────── ────────────────────────────────────────────────────────
 *   #  Client    FYE        Rev.W.R  Project title (CamelCase, spaces removed)
 *
 * The version token starts with a letter (2026-11-11, from the client's
 * naming): T is to be submitted (the final copy), S is submitted, R is in
 * review (the most common). The number after the letter counts versions,
 * from 0 ("T0"). A name may end in a version with no initials
 * ("… 2025-12-31 T1.docx").
 *
 * The firm's real names (2026-11-17 dry run, confirmed by client walkthrough
 * 2026-11-23) also have a client part of two or more words
 * ("01 Cedarline Systems 2025-03-31 …"), a title of hyphenated CamelCase words
 * ("LabelVision-ColdChain"), WIP versions ("W0"), and up to four dot-separated
 * initials groups in positional order:
 *   1. Preparer / writer
 *   2. Technical reviewer (lowercase such as ".mo" means review in progress)
 *   3. Client (accepted edits)
 *   4. Financial reviewer
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

/** The version letter: W work in progress, R in review, T to be submitted, S submitted. */
export type PdVersionCode = "W" | "R" | "T" | "S";

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
  /** Slot 2 (technical reviewer), upper-cased. */
  reviewerInitials?: string;
  /** True when the raw technical reviewer initials were all lowercase (e.g. ".mo": review in progress). */
  reviewerInProgress?: boolean;
  /** Slot 3 (client accepted edits), upper-cased. */
  clientInitials?: string;
  /** Slot 4 (financial reviewer), upper-cased. */
  financialInitials?: string;
  /**
   * Every initials group, upper-cased, of a version token with three or four
   * groups ("T0.DW.PN.KT" -> ["DW", "PN", "KT"]). Kept alongside the unpacked
   * positional fields for audit and slot reassignment. Absent with one or two.
   */
  initialsGroups?: string[];
  /** Remaining tokens, CamelCase split; lowercase runs are left as typed. */
  title?: string;
};

const PROJECT_NUMBER = /^(\d{1,2})([A-Za-z])?$/;
// Client words allow legal-suffix dots/commas ("Inc.", "Ltd.") and balanced
// capitalized parenthesized DBA names ("1234567 Ontario (Cedar-Labs)") while
// still rejecting lowercase OS copy markers like "(copy)".
const CLIENT_WORD = /^[A-Za-z0-9][A-Za-z0-9&'.,-]*$/;
const CLIENT_PAREN_SINGLE = /^\([A-Z][A-Za-z0-9&'.,-]*\)$/;
const CLIENT_PAREN_OPEN = /^\([A-Z][A-Za-z0-9&'.,-]*$/;
const CLIENT_PAREN_CLOSE = /^[A-Za-z0-9][A-Za-z0-9&'.,-]*\)$/;
const FISCAL_YEAR_END = /^(\d{4})-(\d{2})-(\d{2})$/;
// Version letter (either case: W, R, T, S), version number (or capital "O"
// typed for zero, e.g. "TO.DW.PN.KT"), then one to four positional initials
// groups: writer, technical reviewer, client, financial.
const REVISION = /^([WwRrSsTt])(\d+|O)((?:\.[A-Za-z]{2,3}){1,4})$/;
// Writers occasionally type a stray space after the version dot
// ("T0. DW.PN.KT"). Collapse it before extension stripping so trailing initials
// are not mistaken for an extension.
const SPACED_VERSION_DOT =
  /(?<=\s)([WwRrSsTt])(\d+|O)\.\s+(?=(?:[A-Za-z]{2,3}(?:\.[A-Za-z]{2,3}){1,3}|[A-Z]{2,3})(?=\s|\.[A-Za-z0-9]{1,8}$|$))/g;
/** The most words a client part may have before the date or version. */
const MAX_CLIENT_WORDS = 6;
// A version with no initials ("T1", "W0"). Read only as the last token, right
// before a document extension ("… T1.doc"); see parsePdFilename.
const BARE_VERSION = /^([WwRrSsTt])(\d+)$/;

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
 * File extensions as short as initials that are always an extension, never
 * an initials group (2026-11-17: with up to four groups, "T1.DW.PN.msg"
 * would otherwise read MSG as a third group). Extensions longer than three
 * letters can never be initials, so they need no list.
 */
const SHORT_FILE_EXTENSIONS = new Set([
  ...DOCUMENT_EXTENSIONS,
  "dot",
  "msg",
  "eml",
  "rtf",
  "odt",
  "ods",
  "odp",
  "xls",
  "csv",
  "ppt",
  "png",
  "jpg",
  "gif",
  "bmp",
  "tif",
  "zip",
  "htm",
  "xml",
  "mp3",
  "mp4",
  "m4a",
  "wav",
]);

/**
 * Strip a short extension such as `.docx`, `.pdf` or `.txt`. A name with no
 * extension whose last token is the revision ("… R1.LR.mo") keeps it: the
 * dotted initials are scheme fields, not an extension. A known file
 * extension, or one longer than three letters, is always stripped, even
 * where it looks like initials: "T1.DW.doc" is version T1 by DW in a .doc
 * file, never reviewer DOC, and "T1.DW.PN.msg" is writer DW and reviewer
 * PN in a .msg file.
 */
function stripExtension(fileName: string): { stem: string; documentExtension: boolean } {
  const trimmed = fileName.trim().replace(SPACED_VERSION_DOT, "$1$2.");
  const extension = /\.([A-Za-z0-9]{1,8})$/.exec(trimmed);
  const ext = extension?.[1].toLowerCase() ?? "";
  const documentExtension = extension !== null && DOCUMENT_EXTENSIONS.has(ext);
  const alwaysExtension = SHORT_FILE_EXTENSIONS.has(ext) || ext.length > 3;
  const last = trimmed.split(/\s+/).at(-1) ?? "";
  if (!extension || (!alwaysExtension && REVISION.test(last))) {
    return { stem: trimmed, documentExtension: false };
  }
  return { stem: trimmed.slice(0, extension.index), documentExtension };
}

/** Numbered projects are 2-digit zero-padded up to 99 per company (Banhall naming spec). */
const MAX_PROJECT_NUMBER = 99;

/**
 * Parse a PD file name into its scheme fields, or null when the name is not
 * scheme-named. "<number> <client>" alone is too weak an anchor ("3 Notes.docx"
 * would prefill a client called Notes), so at least one corroborating token,
 * a calendar-valid fiscal year-end or a revision token, must follow the
 * client. The client is every word from the second up to that token (at
 * most six: "Cedarline Systems"). Later fields are consumed in scheme order
 * only while they match; the rest is the title. A number above the
 * per-company cap is dropped so the page never prefills a value the server
 * will reject.
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
  /** A version with no initials, read only as the last token before a document extension. */
  const bareVersionAt = (at: number) =>
    documentExtension && at === tokens.length - 1 ? BARE_VERSION.exec(tokens[at]) : null;
  const anchorAt = (at: number) =>
    at < tokens.length && (FISCAL_YEAR_END.test(tokens[at]) || REVISION.test(tokens[at]) || bareVersionAt(at) !== null);

  let index = 1;
  let inParen = false;
  while (index < tokens.length && index <= MAX_CLIENT_WORDS && !anchorAt(index)) {
    const token = tokens[index];
    if (inParen) {
      if (CLIENT_PAREN_CLOSE.test(token)) {
        inParen = false;
      } else if (!CLIENT_WORD.test(token)) {
        break;
      }
    } else if (CLIENT_WORD.test(token) || CLIENT_PAREN_SINGLE.test(token)) {
      // Valid standalone client word or single-token parenthesized DBA.
    } else if (CLIENT_PAREN_OPEN.test(token)) {
      inParen = true;
    } else {
      break;
    }
    index += 1;
  }
  // No client words, unclosed DBA parenthesis, or no date/version right after: not a scheme name.
  if (index === 1 || inParen || !anchorAt(index)) return null;

  const parsed: ParsedPdFilename = {};
  if (number <= MAX_PROJECT_NUMBER) {
    parsed.projectNumber = `${number}${numberMatch[2] ?? ""}`;
  }
  parsed.clientName = tokens.slice(1, index).map(splitCamelCase).join(" ");

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
    const versionDigits = revision[2] === "O" ? "0" : revision[2];
    parsed.revision = String(Number.parseInt(versionDigits, 10));
    const rawGroups = revision[3].split(".").filter(Boolean);
    const groups = rawGroups.map((group) => group.toUpperCase());
    if (groups[0]) parsed.writerInitials = groups[0];
    if (groups[1]) {
      parsed.reviewerInitials = groups[1];
      if (rawGroups[1] && rawGroups[1] === rawGroups[1].toLowerCase()) {
        parsed.reviewerInProgress = true;
      }
    }
    if (groups[2]) parsed.clientInitials = groups[2];
    if (groups[3]) parsed.financialInitials = groups[3];
    if (groups.length >= 3) {
      parsed.initialsGroups = groups;
    }
    index += 1;
  } else {
    // "… 2025-12-31 T1.doc": a version with no initials, with nothing after
    // it but the extension. Anywhere else a bare "T1" stays title text.
    const bare = tokens[index] ? bareVersionAt(index) : null;
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
