import { extractReportSections } from "./tiptapReport";

/**
 * AD-29 (story 6): the one canonical plain-text rule for a Paired Comparison.
 *
 * `draftTextMatches` compares the pinned revision against the plain-text strip
 * the judge actually read. The blinding step (measurement-protocol.md) hands
 * the judge identically formatted plain text with the tool-specific headings
 * removed, so byte equality is hopeless — whitespace-and-heading-insensitive
 * equality is the honest test.
 *
 * `extractReportSections` already accepts both Tiptap JSON and legacy
 * plaintext and strips the `Line 242 / 244 / 246` headings into their three
 * section bodies, so the same function is used for BOTH sides of the
 * comparison: the stored revision and the pasted strip. One function, so the
 * rule cannot drift between the two sides.
 *
 * Normalization after extraction: CRLF → LF, trim each line, collapse internal
 * whitespace runs to a single space, drop empty lines, join with "\n".
 */
export function comparisonPlainText(raw: string): string {
  const sections = extractReportSections(raw);
  const joined = [sections.s242, sections.s244, sections.s246].join("\n");
  return joined
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter((line) => line.length > 0)
    .join("\n");
}
