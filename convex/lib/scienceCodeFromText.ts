// Reads a CRA field of science or technology code out of a document's text,
// without AI (2026-11-11, Import sheet phase 2). Pure: used by the import's
// extraction (convex/ingestionSync.ts) on a file's full extracted text, and
// on a stored text preview (convex/lib/ingestionSheet.ts previewScienceCode).
//
// A wrong code is worse than none, so it is strict: a code counts only where
// the text says it is the field of science or technology, and anything that
// could be a version, a section number or part of a longer number is left out.

import { isCraScienceCode, type CraScienceCode } from "../../shared/craScienceCodes";

/**
 * A code-shaped token: one digit, then two groups of two ("2.02.09"). Not
 * part of a longer number or dotted run ("12.02.09", "2.02.09.1", "v2.02.09",
 * "10.2.02.09"), and so never a two-part version number such as 1.02.
 */
const CODE_SHAPE = /(?<![\w.])(\d\.\d{2}\.\d{2})(?![\w]|\.\d)/g;

/** Words that name the field: "Field of science or technology", "Line 206". */
const FIELD_WORDS = /field\s+of\s+(?:science|technology)|science\s+(?:or|and)\s+technology|\bline\s*206\b/gi;

/**
 * How far after the field words a code on the same line may start. A file
 * whose text came out as one long line (some PDFs) would otherwise let any
 * code anywhere after the words count.
 */
const FIELD_REACH = 160;
/** Characters after a code that its lookahead reads. */
const CODE_TAIL = 10;

/**
 * A word right before a number that makes it a version, a section or a
 * reference, not a code: "version 1.02.01", "v. 2.02.09", "Firmware 2.02.01",
 * "Section 4.04.01", "Table 1.02.01", "§ 2.02.09". Matched against a few
 * characters before the number only, so each code costs the same however
 * long the line is.
 */
const NOT_A_CODE_BEFORE =
  /(?:^|[^a-z])(?:version|ver|v|revision|rev|release|build|firmware|fw|section|sec|step|figure|fig|table|clause)\.?\s{0,8}[:#-]?\s{0,8}$|§\s{0,8}$/i;
/** Longer than any match of NOT_A_CODE_BEFORE, so a window this long sees all of it. */
const BEFORE_WINDOW = 32;

/** The next line may hold the code when it is this short. */
const NEXT_LINE_MAX = 60;

/** A line that starts with a code-shaped token, after optional punctuation. */
const CODE_FIRST = /^[\s\p{P}]*?(?<![\w.])(\d\.\d{2}\.\d{2})(?![\w]|\.\d)/u;

/**
 * The real codes that start on `line` at `from` or later and before `to`,
 * leaving out version and section numbers. Reads only that stretch (plus the
 * few characters around it that the checks need), never the rest of the line.
 */
function codesBetween(line: string, from: number, to: number): CraScienceCode[] {
  const start = Math.max(0, from - BEFORE_WINDOW);
  const stretch = line.slice(start, to + CODE_TAIL);
  const codes: CraScienceCode[] = [];
  for (const match of stretch.matchAll(CODE_SHAPE)) {
    const at = start + match.index;
    if (at < from || at >= to) continue;
    const before = stretch.slice(Math.max(0, match.index - BEFORE_WINDOW), match.index);
    if (NOT_A_CODE_BEFORE.test(before)) continue;
    if (isCraScienceCode(match[1])) codes.push(match[1]);
  }
  return codes;
}

/**
 * The one CRA science code the text gives, or undefined. A code counts only
 * when it is a real code (shared/craScienceCodes.ts) and it sits either
 *
 * - on a line that names the field of science or technology, after those
 *   words and starting within 160 characters of them (so a numbered heading
 *   such as "1.02.01 Field of science" does not count), or
 * - on the next non-empty line after such a line, when that line is short
 *   (60 characters at most) and the code is its first token after optional
 *   punctuation ("Field of science or technology" then "2.02.09 Industrial
 *   biotechnology"), unless the field line ends in a word like "version".
 *
 * A number right after a word such as version, v, rev, build, firmware,
 * section, step, figure, table or clause is never a code. When two different
 * codes qualify, it gives nothing, so a person picks. Linear in the text's
 * length: each line is read once, and each mention of the field reads a
 * fixed stretch after it.
 */
export function scienceCodeFromText(text: string): CraScienceCode | undefined {
  const found = new Set<CraScienceCode>();
  let afterFieldLine = false;
  for (const line of text.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (afterFieldLine && trimmed.length <= NEXT_LINE_MAX) {
      const first = CODE_FIRST.exec(trimmed)?.[1];
      if (first !== undefined && isCraScienceCode(first)) found.add(first);
    }
    afterFieldLine = false;
    for (const field of line.matchAll(FIELD_WORDS)) {
      afterFieldLine = true;
      const end = field.index + field[0].length;
      for (const code of codesBetween(line, end, end + FIELD_REACH)) found.add(code);
    }
    if (afterFieldLine && NOT_A_CODE_BEFORE.test(trimmed.slice(-BEFORE_WINDOW))) afterFieldLine = false;
    if (found.size > 1) return undefined;
  }
  return found.size === 1 ? [...found][0] : undefined;
}
