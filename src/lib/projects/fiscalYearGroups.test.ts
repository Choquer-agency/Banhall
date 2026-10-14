import { describe, expect, it } from "vitest";
import {
  formatYearEnd,
  groupProjectsByFiscalYear,
  projectCountLabel,
  shortYearLabel,
  wholeMonthsBetween,
  withLoadState,
} from "./fiscalYearGroups";

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

function row(id: string, fiscalYearEnd?: string, projectNumber?: string) {
  return {
    _id: id,
    title: `Project ${id}`,
    projectNumber,
    fiscalYearEnd: fiscalYearEnd ? day(fiscalYearEnd) : undefined,
  };
}

describe("groupProjectsByFiscalYear", () => {
  it("groups by fiscal year, newest first, with no fiscal year last", () => {
    const groups = groupProjectsByFiscalYear([
      row("a"),
      row("b", "2024-09-30"),
      row("c", "2026-09-30"),
      row("d", "2025-09-30"),
      row("e", "2026-09-30"),
    ]);
    expect(groups.map((group) => group.key)).toEqual([
      "fy-2026-2026-09-30",
      "fy-2025-2025-09-30",
      "fy-2024-2024-09-30",
      "none",
    ]);
    expect(groups.map((group) => group.fiscalYear)).toEqual([2026, 2025, 2024, null]);
    expect(groups[0].rows.map((r) => r._id)).toEqual(["c", "e"]);
    expect(groups.every((group) => group.shortYearMonths === null)).toBe(true);
    expect(groups[3].yearEnd).toBeNull();
  });

  it("splits two year ends in one fiscal year and tags the later one as a short year", () => {
    const groups = groupProjectsByFiscalYear([
      row("early", "2025-03-31"),
      row("late", "2025-09-30"),
      row("next", "2026-09-30"),
    ]);
    expect(groups.map((group) => [group.key, group.shortYearMonths])).toEqual([
      ["fy-2026-2026-09-30", null],
      ["fy-2025-2025-09-30", 6],
      ["fy-2025-2025-03-31", null],
    ]);
    expect(groups[1].yearEnd).toBe(day("2025-09-30"));
  });

  it("tags every year end but the earliest when a fiscal year has three", () => {
    const groups = groupProjectsByFiscalYear([
      row("a", "2025-01-31"),
      row("b", "2025-06-30"),
      row("c", "2025-12-31"),
    ]);
    expect(groups.map((group) => group.shortYearMonths)).toEqual([6, 5, null]);
  });

  it("groups by the calendar day, whatever the time of day", () => {
    const groups = groupProjectsByFiscalYear([
      { _id: "a", title: "A", fiscalYearEnd: day("2026-09-30") },
      { _id: "b", title: "B", fiscalYearEnd: day("2026-09-30") + 15 * 60 * 60 * 1000 },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
  });

  it("orders cards inside a group by project number, then title", () => {
    const groups = groupProjectsByFiscalYear([
      row("z", "2026-09-30"),
      row("six", "2026-09-30", "6"),
      row("four", "2026-09-30", "4"),
      row("letter", "2026-09-30", "A"),
    ]);
    expect(groups[0].rows.map((r) => r._id)).toEqual(["four", "six", "letter", "z"]);
  });

  it("returns nothing for no rows", () => {
    expect(groupProjectsByFiscalYear([])).toEqual([]);
  });
});

describe("wholeMonthsBetween", () => {
  it("counts a month-end to month-end span in full", () => {
    expect(wholeMonthsBetween(day("2025-03-31"), day("2025-09-30"))).toBe(6);
    expect(wholeMonthsBetween(day("2025-02-28"), day("2025-08-31"))).toBe(6);
  });

  it("counts only whole months otherwise", () => {
    expect(wholeMonthsBetween(day("2025-01-15"), day("2025-07-14"))).toBe(5);
    expect(wholeMonthsBetween(day("2025-01-15"), day("2025-07-15"))).toBe(6);
    expect(wholeMonthsBetween(day("2025-03-01"), day("2025-03-20"))).toBe(0);
  });
});

describe("labels", () => {
  it("formats the year end in UTC", () => {
    expect(formatYearEnd(day("2026-09-30"))).toBe("Sep 30, 2026");
    expect(formatYearEnd(day("2025-03-31"))).toBe("Mar 31, 2025");
  });

  it("names short years and project counts in plain words", () => {
    expect(shortYearLabel(6)).toBe("Short year, 6 months");
    expect(shortYearLabel(1)).toBe("Short year, 1 month");
    expect(shortYearLabel(0)).toBe("Short year, under a month");
    expect(projectCountLabel(1)).toBe("1 project");
    expect(projectCountLabel(3)).toBe("3 projects");
    expect(projectCountLabel(1, true)).toBe("1+ projects");
  });
});

describe("withLoadState", () => {
  const groups = groupProjectsByFiscalYear([
    row("a", "2026-09-30"),
    row("b", "2025-09-30"),
    row("c", "2025-03-31"),
    row("d"),
  ]);

  it("claims nothing more and keeps every Short year tag once everything is loaded", () => {
    const loaded = withLoadState(groups, false);
    expect(loaded.map((group) => group.more)).toEqual([false, false, false, false]);
    expect(loaded.map((group) => group.shortYearMonths)).toEqual([null, 6, null, null]);
  });

  it("marks every group of the last loaded fiscal year, and No fiscal year, while more can load", () => {
    const partial = withLoadState(groups, true);
    expect(partial.map((group) => [group.key, group.more])).toEqual([
      ["fy-2026-2026-09-30", false],
      ["fy-2025-2025-09-30", true],
      ["fy-2025-2025-03-31", true],
      ["none", true],
    ]);
    // FY 2025 may be missing a year end, so its Short year tag waits.
    expect(partial.map((group) => group.shortYearMonths)).toEqual([null, null, null, null]);
  });

  it("keeps the Short year tag of a fiscal year that is complete", () => {
    const partial = withLoadState(
      groupProjectsByFiscalYear([row("a", "2026-09-30"), row("b", "2026-03-31"), row("c", "2025-09-30")]),
      true
    );
    expect(partial.map((group) => [group.shortYearMonths, group.more])).toEqual([
      [6, false],
      [null, false],
      [null, true],
    ]);
  });
});
