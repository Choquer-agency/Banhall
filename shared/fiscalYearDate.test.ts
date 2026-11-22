import { afterEach, describe, expect, test } from "vitest";
import {
  fiscalYearFromTimestampUtc,
  formatFiscalYearEndUtc,
  parseCalendarDateUtc,
  toCalendarDateInputUtc,
} from "./fiscalYearDate";

describe("shared/fiscalYearDate", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  test("round-trips calendar dates at UTC midnight without shifting a day in Vancouver", () => {
    process.env.TZ = "America/Vancouver";
    const parsed = parseCalendarDateUtc("2025-12-31");
    expect(parsed).toBe(Date.UTC(2025, 11, 31));
    expect(toCalendarDateInputUtc(parsed!)).toBe("2025-12-31");
    expect(fiscalYearFromTimestampUtc(parsed!)).toBe(2025);
    expect(formatFiscalYearEndUtc(parsed!)).toBe("December 31, 2025");
  });

  test("reads June 30 stored as UTC midnight or Pacific midnight as the same day", () => {
    process.env.TZ = "America/Vancouver";
    const utcMidnight = Date.UTC(2025, 5, 30);
    const pacificMidnight = Date.UTC(2025, 5, 30, 7);
    expect(toCalendarDateInputUtc(utcMidnight)).toBe("2025-06-30");
    expect(toCalendarDateInputUtc(pacificMidnight)).toBe("2025-06-30");
    expect(formatFiscalYearEndUtc(utcMidnight)).toBe("June 30, 2025");
    expect(formatFiscalYearEndUtc(pacificMidnight)).toBe("June 30, 2025");
  });

  test("rejects impossible calendar dates", () => {
    expect(parseCalendarDateUtc("2025-02-30")).toBeNull();
    expect(parseCalendarDateUtc("2025-13-01")).toBeNull();
    expect(parseCalendarDateUtc("")).toBeNull();
    expect(parseCalendarDateUtc("not-a-date")).toBeNull();
  });
});
