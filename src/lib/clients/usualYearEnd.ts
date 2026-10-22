/**
 * A client's usual fiscal year end is a month and a day with no year
 * (2026-10-14 amendment, "Usual fiscal year end"). New project turns it into
 * a date: the most recent occurrence on or before today. February 29 falls
 * back to February 28 in a year that has no February 29.
 */

const pad = (value: number) => String(value).padStart(2, "0");

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** `yyyy-mm-dd` for that month and day in `year`, clamped to the month's last day. */
function dateInYear(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month)))}`;
}

/**
 * The most recent past occurrence (today counts) of `month`/`day` as
 * `yyyy-mm-dd`, read from the local calendar date of `today`. Returns null
 * for a month outside 1 to 12 or a day outside 1 to 31.
 */
export function mostRecentYearEnd(month: number, day: number, today: Date = new Date()): string | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const thisYear = dateInYear(today.getFullYear(), month, day);
  return thisYear <= todayKey ? thisYear : dateInYear(today.getFullYear() - 1, month, day);
}

/** The month and day of a `yyyy-mm-dd` date, or null for anything else. */
export function yearEndParts(value: string): { month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}
