import { describe, expect, it } from "vitest";
import { mostRecentYearEnd, yearEndParts } from "./usualYearEnd";

const on = (year: number, month: number, day: number) => new Date(year, month - 1, day, 15, 30);

describe("mostRecentYearEnd", () => {
  it("takes this year's date when it has passed", () => {
    expect(mostRecentYearEnd(6, 30, on(2026, 10, 14))).toBe("2026-06-30");
  });

  it("takes last year's date when this year's is still ahead", () => {
    expect(mostRecentYearEnd(12, 31, on(2026, 10, 14))).toBe("2025-12-31");
  });

  it("counts today as past", () => {
    expect(mostRecentYearEnd(10, 14, on(2026, 10, 14))).toBe("2026-10-14");
    expect(mostRecentYearEnd(10, 15, on(2026, 10, 14))).toBe("2025-10-15");
  });

  it("falls back to February 28 in a year without February 29", () => {
    expect(mostRecentYearEnd(2, 29, on(2026, 10, 14))).toBe("2026-02-28");
    expect(mostRecentYearEnd(2, 29, on(2026, 1, 10))).toBe("2025-02-28");
  });

  it("keeps February 29 in a leap year", () => {
    expect(mostRecentYearEnd(2, 29, on(2028, 3, 1))).toBe("2028-02-29");
    // Feb 28 of a leap year: the 29th is still ahead, so last year's 28th.
    expect(mostRecentYearEnd(2, 29, on(2028, 2, 28))).toBe("2027-02-28");
  });

  it("clamps a day past the month's end", () => {
    expect(mostRecentYearEnd(4, 31, on(2026, 10, 14))).toBe("2026-04-30");
  });

  it("refuses a month or day out of range", () => {
    expect(mostRecentYearEnd(0, 10, on(2026, 10, 14))).toBeNull();
    expect(mostRecentYearEnd(13, 10, on(2026, 10, 14))).toBeNull();
    expect(mostRecentYearEnd(6, 0, on(2026, 10, 14))).toBeNull();
    expect(mostRecentYearEnd(6, 32, on(2026, 10, 14))).toBeNull();
    expect(mostRecentYearEnd(6.5, 10, on(2026, 10, 14))).toBeNull();
  });
});

describe("yearEndParts", () => {
  it("reads the month and day of a date", () => {
    expect(yearEndParts("2026-06-30")).toEqual({ month: 6, day: 30 });
    expect(yearEndParts("2025-02-28")).toEqual({ month: 2, day: 28 });
  });

  it("returns null for anything else", () => {
    expect(yearEndParts("")).toBeNull();
    expect(yearEndParts("2026-6-30")).toBeNull();
    expect(yearEndParts("2026-13-01")).toBeNull();
  });
});
