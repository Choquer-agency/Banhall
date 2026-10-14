/**
 * Fiscal year groups for one client on the Projects page (2026-10-14
 * amendment, Paper W1). Projects group by fiscal year (the UTC year of the
 * fiscal year end, as `dashboardFiscalYear`), newest first. When one fiscal
 * year holds two or more year-end dates, each date gets its own group,
 * newest date first, and every group but the earliest one in that fiscal
 * year carries a "Short year" tag with the whole months since the previous
 * year end. Projects without a fiscal year end come last.
 *
 * Pure helpers only: no `$app` imports, so unit tests can load this module.
 */
import { dashboardFiscalYear } from "../../../shared/dashboardProjection";
import { projectNumberKey } from "$lib/workspace/fiscalYearGroups";

export type FiscalGroupSource = {
  _id: string;
  title: string;
  projectNumber?: string;
  fiscalYearEnd?: number;
};

export type ProjectFiscalGroup<T extends FiscalGroupSource> = {
  /** Stable key: `fy-2026-2026-09-30`, or `none` for the no fiscal year group. */
  key: string;
  fiscalYear: number | null;
  /** UTC midnight of the year-end date; null for the no fiscal year group. */
  yearEnd: number | null;
  /** Whole months since the previous year end in the same fiscal year, or null. */
  shortYearMonths: number | null;
  rows: T[];
};

function utcDay(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function dayKey(day: number) {
  return new Date(day).toISOString().slice(0, 10);
}

/**
 * Whole months from `earlier` to `later` (both UTC dates). A later date on
 * the last day of its month counts the month in full, so Mar 31 to Sep 30
 * is 6 months.
 */
export function wholeMonthsBetween(earlier: number, later: number): number {
  const a = new Date(earlier);
  const b = new Date(later);
  let months =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  const lastDayOfLaterMonth = new Date(
    Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 0)
  ).getUTCDate();
  if (b.getUTCDate() < a.getUTCDate() && b.getUTCDate() !== lastDayOfLaterMonth) months -= 1;
  return Math.max(0, months);
}

function byProjectNumber<T extends FiscalGroupSource>(a: T, b: T) {
  const byNumber = projectNumberKey(a.projectNumber).localeCompare(
    projectNumberKey(b.projectNumber),
    "en-CA"
  );
  if (byNumber) return byNumber;
  return a.title.localeCompare(b.title, "en-CA", { sensitivity: "base" });
}

export function groupProjectsByFiscalYear<T extends FiscalGroupSource>(
  rows: readonly T[]
): ProjectFiscalGroup<T>[] {
  const years = new Map<number, Map<number, T[]>>();
  const noYear: T[] = [];
  for (const row of rows) {
    const year =
      row.fiscalYearEnd === undefined || !Number.isFinite(row.fiscalYearEnd)
        ? null
        : dashboardFiscalYear(row.fiscalYearEnd);
    if (year === null || row.fiscalYearEnd === undefined) {
      noYear.push(row);
      continue;
    }
    const day = utcDay(row.fiscalYearEnd);
    const dates = years.get(year) ?? new Map<number, T[]>();
    dates.set(day, [...(dates.get(day) ?? []), row]);
    years.set(year, dates);
  }

  const groups: ProjectFiscalGroup<T>[] = [];
  for (const year of [...years.keys()].sort((a, b) => b - a)) {
    const dates = years.get(year)!;
    const days = [...dates.keys()].sort((a, b) => b - a);
    days.forEach((day, index) => {
      const previous = days[index + 1];
      groups.push({
        key: `fy-${year}-${dayKey(day)}`,
        fiscalYear: year,
        yearEnd: day,
        shortYearMonths: previous === undefined ? null : wholeMonthsBetween(previous, day),
        rows: [...dates.get(day)!].sort(byProjectNumber),
      });
    });
  }
  if (noYear.length > 0) {
    groups.push({
      key: "none",
      fiscalYear: null,
      yearEnd: null,
      shortYearMonths: null,
      rows: [...noYear].sort(byProjectNumber),
    });
  }
  return groups;
}

/** "Sep 30, 2026" (UTC, so a stored midnight never shifts a day). */
export function formatYearEnd(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function shortYearLabel(months: number): string {
  if (months < 1) return "Short year, under a month";
  return `Short year, ${months} ${months === 1 ? "month" : "months"}`;
}

/** "1 project", "3 projects", or "3+ projects" while more can load. */
export function projectCountLabel(count: number, more = false): string {
  return `${count}${more ? "+" : ""} ${count === 1 && !more ? "project" : "projects"}`;
}
