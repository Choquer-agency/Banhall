/**
 * Canonical UTC calendar-day helpers for `fiscalYearEnd`.
 *
 * A fiscal year-end is a calendar day (no clock time), stored as a UTC
 * midnight timestamp. Reading and writing in UTC ensures the chosen day never
 * shifts across browser time zones (e.g. Vancouver vs. Toronto vs. UTC).
 */

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a YYYY-MM-DD string into a UTC midnight timestamp, or null if invalid. */
export function parseCalendarDateUtc(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = ISO_DATE_RE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ts = Date.UTC(year, month - 1, day);
  const check = new Date(ts);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return ts;
}

/** Format a timestamp as YYYY-MM-DD in UTC (matching DatePicker value format). */
export function toCalendarDateInputUtc(timestamp: number | null | undefined): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Calendar year of a fiscal year-end timestamp in UTC. */
export function fiscalYearFromTimestampUtc(timestamp: number): number {
  return new Date(timestamp).getUTCFullYear();
}

/** Format a fiscal year-end timestamp as a readable calendar date in UTC. */
export function formatFiscalYearEndUtc(timestamp: number, locale = "en-US"): string {
  return new Date(timestamp).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
