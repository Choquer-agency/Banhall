import { describe, expect, it } from "vitest";
import { groupProjectsByFiscalYear, projectNumberKey } from "./fiscalYearGroups";

const row = (id: string, year: number | null, projectNumber?: string, updatedAt = 1) => ({
  _id: id,
  title: id,
  ...(projectNumber ? { projectNumber } : {}),
  ...(year ? { fiscalYearEnd: Date.UTC(year, 11, 31) } : {}),
  createdAt: updatedAt,
  updatedAt,
});

describe("fiscal-year repository grouping", () => {
  it("orders fiscal years newest first and keeps unrecorded last", () => {
    const groups = groupProjectsByFiscalYear([
      row("old", 2024),
      row("unknown", null),
      row("new", 2026),
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      "Fiscal 2026",
      "Fiscal 2024",
      "Fiscal year not set",
    ]);
  });

  it("uses natural project-number order by default", () => {
    const groups = groupProjectsByFiscalYear([
      row("ten", 2025, "10"),
      row("letter", 2025, "A"),
      row("two-a", 2025, "2A"),
      row("two", 2025, "2"),
      row("none", 2025),
    ]);
    expect(groups[0]?.rows.map((project) => project._id)).toEqual([
      "two",
      "two-a",
      "ten",
      "letter",
      "none",
    ]);
    expect(projectNumberKey("2A").localeCompare(projectNumberKey("10"), "en-CA")).toBeLessThan(0);
  });

  it("supports recently created and recently updated within each year", () => {
    const rows = [row("first", 2025, "1", 1), row("latest", 2025, "2", 9)];
    expect(groupProjectsByFiscalYear(rows, "created")[0]?.rows[0]?._id).toBe("latest");
    expect(groupProjectsByFiscalYear(rows, "updated")[0]?.rows[0]?._id).toBe("latest");
  });
});
