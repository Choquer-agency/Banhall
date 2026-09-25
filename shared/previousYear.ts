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
