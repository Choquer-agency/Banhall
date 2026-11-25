// Reads who wrote a PD out of its text, without AI (2026-11-16, writers from
// initials, docs/product-domain.md). Pure: used by the import's extraction
// (convex/ingestionSync.ts) and the names backfill (convex/ingestion.ts) on
// a file's full extracted text, and by convex/lib/teamRoster.ts to match a
// name to a file's writer initials.
//
// We have only seen made-up PDs, so it is strict: no clear name, no name. A
// name counts only right after a writer cue ("Prepared by", "Written by",
// "Authored by", "Author:", "Writer:"), and only when it is 2 to 4 words that
// each start with a capital letter. "Reviewed by" is not a writer cue.
//
// Word files are read as mammoth's plain text (convex/ai/fileReader.ts),
// which puts a blank line between paragraphs and between table cells and
// keeps tabs: a cover table's "Prepared by: | Dana Whitlock" comes out as
// "Prepared by:\n\nDana Whitlock", and "Written by Priya Nair<tab>Date" keeps
// its tab, which ends the name.

/** Names one file keeps, at most. */
export const MAX_DOCUMENT_WRITER_NAMES = 5;
/** The longest name kept (the writer name rule, convex/lib/ingestionSheet.ts). */
const MAX_NAME_LENGTH = 120;
const MIN_WORDS = 2;
const MAX_WORDS = 4;

/**
 * The writer cues, any case. Not part of a longer word ("Authorized by",
 * "Co-authored by", "Ghostwriter:"). What follows (a colon, the name) is
 * read by writerNamesFromText.
 */
const CUE = /(?<![\p{L}\p{N}_-])(?:(prepared|written|authored)[ \t\u00A0]+by|author|writer)(?![\p{L}\p{N}_])/giu;

/** A title before the name, skipped: "Prepared by Dr. Dana Whitlock". */
const TITLE = /^(?:Dr|Mr|Mrs|Ms|Mx|Prof)\.?[ \u00A0]+/u;

/**
 * One word of a name: a capital letter, then letters, with hyphen or
 * apostrophe parts ("Mary-Jo", "O'Neil", "McDonald", "Núñez").
 */
const WORD = /\p{Lu}\p{L}*(?:['\u2019-]\p{L}+)*/uy;
/** The one space between two words of a name: a tab, two spaces or a line end ends it. */
const GAP = /[ \u00A0](?=\S)/y;
/** A possessive ending: "Dana Whitlock's team" is Dana Whitlock. */
const POSSESSIVE = /['\u2019][sS]$/u;

/** Letters after a name that are not part of it: credentials and suffixes. */
const NOT_A_NAME_WORD = new Set(["phd", "msc", "meng", "bsc", "beng", "peng", "mba", "cpa", "jr", "sr", "ii", "iii", "iv"]);

/**
 * Words that never sit in a person's name: a name with one, or followed by
 * one ("Prepared by: Data Warehouse team"), is not a person.
 */
const NOT_A_PERSON_WORD = new Set([
  "date",
  "team",
  "department",
  "group",
  "systems",
  "inc",
  "ltd",
  "corp",
  "company",
  "services",
  "solutions",
  "technologies",
  "report",
  "project",
  "section",
  "version",
  "draft",
]);

/** A word of capitals only, of at most 3 letters, looks like initials ("DW"), not a name. */
function looksLikeInitials(word: string): boolean {
  return /^\p{Lu}{1,3}$/u.test(word);
}

/** A word's letters, without its hyphens and apostrophes. */
function letterCount(word: string): number {
  return word.replace(/['\u2019-]/g, "").length;
}

/** Whether a word, or a hyphen part of it, is one no person's name has. */
function notAPersonWord(word: string): boolean {
  return word
    .toLowerCase()
    .split("-")
    .some((part) => NOT_A_PERSON_WORD.has(part));
}

/** "DANA WHITLOCK" as "Dana Whitlock", "MARY-JO O'NEIL" as "Mary-Jo O'Neil"; a name in mixed case as it is. */
function titleCaseCapitals(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[ '\u2019-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/** Small words that end a name written in capitals ("DANA WHITLOCK FOR HALDEN FOODS"), as a lower-case word does. */
const JOINING_WORDS = new Set(["and", "at", "by", "for", "from", "in", "of", "on", "the", "to", "with"]);

/**
 * A run of capitals right after a cue ("PREPARED BY: KIM TRAN"), in title
 * case with its joining words in lower case, so it reads like a name typed
 * in mixed case; null when the run is not all capitals.
 */
function capitalsAsWords(run: string): string | null {
  if (!/\p{Lu}/u.test(run) || run !== run.toUpperCase()) return null;
  return run.replace(/\p{L}+(?:['\u2019-]\p{L}+)*/gu, (word) => {
    const lower = word.toLowerCase();
    return JOINING_WORDS.has(lower) ? lower : titleCaseCapitals(word);
  });
}

/** In a name written in capitals, a short word with no vowel ("KT", "DW") is initials, not a name. */
function initialsInCapitals(word: string): boolean {
  return letterCount(word) <= 3 && !/[aeiouy]/i.test(word);
}

/**
 * The name right at `start` of `text`, or null when there is no clear one.
 * The name ends at a tab, two spaces, a line end, punctuation, a word that
 * is not a capitalised name word, a possessive ("Whitlock's"), or after 4
 * words. Refused: one word, more than 4 capitalised words in a row (a
 * company or a heading, not a name), a word joined to digits, an @ or a dot
 * ("Whitlock2", "Dana.Whitlock@example.com"), and a word no person's name
 * has, in the name or right after it ("Data Warehouse team").
 */
function nameAt(source: string, start: number): string | null {
  // Written in capitals: read as title case (same length), and then a short
  // word with no vowel is initials ("PREPARED BY KT" gives nothing).
  const run = /^[\p{L} \u00A0'\u2019-]+/u.exec(source.slice(start, start + 200))?.[0] ?? "";
  const asWords = capitalsAsWords(run);
  const fromCapitals = asWords !== null && asWords.length === run.length;
  const text = fromCapitals ? source.slice(0, start) + asWords + source.slice(start + run.length) : source;
  let at = start;
  const title = TITLE.exec(text.slice(at, at + 12));
  if (title) at += title[0].length;
  const words: string[] = [];
  let nameEnd = at;
  let possessive = false;
  for (;;) {
    WORD.lastIndex = at;
    const match = WORD.exec(text);
    if (!match) break;
    let word = match[0];
    const end = at + word.length;
    // Joined to something that is not a name: refuse the whole name.
    const next = text.slice(end, end + 2);
    if (/^[\p{N}_@]/u.test(next) || /^[.'\u2019-][\p{L}\p{N}]/u.test(next)) return null;
    if (POSSESSIVE.test(word)) {
      word = word.slice(0, -2);
      possessive = true;
    }
    if (
      looksLikeInitials(word) ||
      (fromCapitals && initialsInCapitals(word)) ||
      letterCount(word) < 2 ||
      NOT_A_NAME_WORD.has(word.toLowerCase())
    ) {
      break;
    }
    if (notAPersonWord(word)) return null;
    words.push(word);
    if (words.length > MAX_WORDS) return null;
    at = end;
    nameEnd = end;
    if (possessive) break;
    GAP.lastIndex = at;
    if (!GAP.exec(text)) break;
    at += 1;
  }
  if (words.length < MIN_WORDS) return null;
  // The word right after the name: "Data Warehouse team" is a team.
  if (!possessive) {
    const after = /^[ \u00A0]+(\p{L}+)/u.exec(text.slice(nameEnd, nameEnd + 40));
    if (after && notAPersonWord(after[1])) return null;
  }
  const name = titleCaseCapitals(words.join(" "));
  return name.length > MAX_NAME_LENGTH ? null : name;
}

/** Spaces and tabs, then an optional colon and more of them, right after a cue. */
const AFTER_CUE = /^[ \t\u00A0]*(:?)[ \t\u00A0]*/u;
/** One line end, or one blank line, before a name on the next line. */
const NEXT_LINE = /^\r?\n(?:[ \t\u00A0]*\r?\n)?[ \t\u00A0]*/u;

/**
 * The distinct names that follow a writer cue in a document's text, in the
 * order they first appear, at most 5. Names that differ only in case are
 * one name; a name in capitals is kept in title case. The name is on the
 * cue's line, or, when the cue is alone on its line and ends with a colon
 * or "by" (a form's label, or a table's label cell), on the next line or
 * after one blank line. "Author" and "Writer" with no colon must have the
 * name on their own line.
 */
export function writerNamesFromText(text: string): string[] {
  const byKey = new Map<string, string>();
  CUE.lastIndex = 0;
  for (let cue = CUE.exec(text); cue !== null; cue = CUE.exec(text)) {
    const afterCue = cue.index + cue[0].length;
    const tail = AFTER_CUE.exec(text.slice(afterCue, afterCue + 40))!;
    let start = afterCue + tail[0].length;
    const lineEnd = /^(?:\r?\n|$)/.test(text.slice(start, start + 2));
    if (lineEnd) {
      const labelEnds = tail[1] === ":" || cue[1] !== undefined;
      const lineStart = text.lastIndexOf("\n", cue.index - 1) + 1;
      const alone = text.slice(lineStart, cue.index).trim() === "";
      const nextLine = NEXT_LINE.exec(text.slice(start, start + 80));
      if (!labelEnds || !alone || !nextLine) continue;
      start += nextLine[0].length;
    }
    const name = nameAt(text, start);
    if (name === null) continue;
    const key = name.toLowerCase();
    if (byKey.has(key) || byKey.size >= MAX_DOCUMENT_WRITER_NAMES) continue;
    byKey.set(key, name);
  }
  return [...byKey.values()];
}

/**
 * Names as a row stores them: trimmed, inner spaces collapsed, at most 5,
 * each 120 characters or less and with no @ (a guard on what a caller sends).
 */
export function cleanDocumentWriterNames(names: readonly string[]): string[] {
  const kept: string[] = [];
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, " ");
    if (!name || name.length > MAX_NAME_LENGTH || name.includes("@")) continue;
    if (kept.some((other) => sameWriterName(other, name))) continue;
    kept.push(name);
    if (kept.length >= MAX_DOCUMENT_WRITER_NAMES) break;
  }
  return kept;
}

/** Two names for the same person: equal but for case and spacing. */
export function sameWriterName(a: string, b: string): boolean {
  const key = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  return key(a) === key(b);
}

/**
 * The initials a name can stand for, upper case. The first letter of each
 * word ("Dana Whitlock" is DW, "Dana Lee Whitlock" DLW, "Mary-Jo O'Neil"
 * MO), and for a name with a hyphenated word, also the first letter of each
 * hyphen part ("Mary-Jo O'Neil" is MJO too). An apostrophe never splits a
 * word: "O'Neil" is O.
 */
export function initialsOfName(name: string): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const plain = words.map((word) => word[0]).join("").toUpperCase();
  const parts = words
    .map((word) =>
      word
        .split("-")
        .filter(Boolean)
        .map((part) => part[0])
        .join("")
    )
    .join("")
    .toUpperCase();
  return parts === plain ? [plain] : [plain, parts];
}

/** Whether a name can be the writer with these file initials (any case). */
export function nameMatchesInitials(name: string, initials: string): boolean {
  const key = initials.trim().toUpperCase();
  return key.length > 0 && initialsOfName(name).includes(key);
}

/**
 * The one name in a document that can be the writer with these initials, or
 * null when none or more than one can (a person decides then). A name that
 * is the file's company name, or part of it, never counts.
 */
export function writerNameForInitials(
  names: readonly string[] | undefined,
  initials: string | null | undefined,
  options: { companyName?: string | null } = {}
): string | null {
  if (!names || !initials) return null;
  const matches = cleanDocumentWriterNames(names).filter(
    (name) => nameMatchesInitials(name, initials) && !partOfCompanyName(name, options.companyName)
  );
  return matches.length === 1 ? matches[0] : null;
}

/** Letters and digits only, lower case, single spaces: for comparing a name with a company's. */
function comparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Whether a name is the company's name, or part of it ("Data Warehouse" in
 * "Data Warehouse Systems"): then it is not the person who wrote the PD.
 */
export function partOfCompanyName(name: string, companyName: string | null | undefined): boolean {
  if (!companyName) return false;
  const person = comparable(name);
  const company = comparable(companyName);
  return person.length > 0 && ` ${company} `.includes(` ${person} `);
}
