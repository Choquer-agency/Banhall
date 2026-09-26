/**
 * The first line of every previous-year report's stored text, naming the
 * fiscal year it covers. The new-project wizard writes it above each uploaded
 * previous-year file, and a duplicate that brings the original's report along
 * as last year's report (owner decision 35, 2026-09-25) writes it on the
 * server.
 *
 * Keep these bytes exactly: `LEGACY_PY_PREFIX_RE` in shared/documentStatus.ts
 * matches the line byte for byte, dash included. Changing the wording is a
 * separate change that must update that pattern too.
 */
export function previousYearReportHeader(year: number): string {
  return `[Previous-year report — fiscal ${year}]\n`;
}

/**
 * Decision 42 (2026-09-25): a draft is never built from last year's report
 * alone. A file in this category (an uploaded previous-year report, a PD
 * ported in, or the original's report brought along by a duplicate) does not
 * count as a current-year source. The server refuses such a generation with
 * `PREVIOUS_YEAR_ONLY_REASON`, and the wizard shows the same message.
 */
export const PREVIOUS_YEAR_CATEGORY = "previous_pd";

export const PREVIOUS_YEAR_ONLY_REASON = "PREVIOUS_YEAR_ONLY_SOURCES";

export const PREVIOUS_YEAR_ONLY_MESSAGE =
  "Add a transcript or a current file. Last year's report alone can't be the source for this year's report.";

/**
 * Decision 42, lead note of 2026-09-25: on a duplicate whose fiscal year is
 * later than the original's, the transcripts copied from the original are
 * last year's too. The same reason, with wording that names them.
 */
export const PREVIOUS_YEAR_TRANSCRIPTS_ONLY_MESSAGE =
  "Add a new transcript or a current file. Last year's transcripts and report can't be the only sources for this year's report.";

export function isPreviousYearDocument(document: { category?: string | null }): boolean {
  return document.category === PREVIOUS_YEAR_CATEGORY;
}
