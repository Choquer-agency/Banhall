import { extractReportSections } from "./tiptapReport";

/**
 * AD-29 (story 6): the one canonical plain-text rule for a Paired Comparison.
 *
 * `draftTextMatches` compares the pinned revision against the plain-text strip
 * the judge actually read. The blinding step (measurement-protocol.md) hands
 * the judge identically formatted plain text with the tool-specific headings
 * removed, so byte equality is hopeless — whitespace-insensitive prose
 * equality is the honest test.
 *
 * `extractReportSections` already accepts both Tiptap JSON and legacy
 * plaintext and strips the `Line 242 / 244 / 246` headings into their three
 * section bodies, so the same function is used for BOTH sides of the
 * comparison: the stored revision and the pasted strip. One function, so the
 * rule cannot drift between the two sides.
 *
 * THE RULE (applied identically to both sides): take the three section bodies
 * in 242/244/246 order, and collapse every run of whitespace — spaces, tabs,
 * CR, LF, blank lines, the joins between sections — to a single space, then
 * trim. Within those extracted bodies, indentation, CRLF, soft line wraps,
 * and paragraph separators normalize to the same string. Heading recognition
 * follows extractReportSections: plaintext labels must occupy one line. The
 * blinding protocol removes headings; retaining a wrapped heading can leave
 * label text in the extracted prose and therefore produce a mismatch.
 *
 * Line wrapping is the reason the rule collapses newlines rather than
 * preserving them. A Tiptap revision emits one line per paragraph while a
 * pasted strip is often hard-wrapped at some column, so any rule that kept
 * line breaks would report unchanged prose as a mismatch — destroying the
 * evidentiary value of the flag it computes.
 */
export function comparisonPlainText(raw: string): string {
  const sections = extractReportSections(raw);
  return [sections.s242, sections.s244, sections.s246]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
