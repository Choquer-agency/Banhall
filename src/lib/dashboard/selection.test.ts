import { describe, expect, it } from "vitest";

type Row = { _id: string; title: string };

function toggleSelectedRows(rows: Row[], row: Row) {
  return rows.some((existing) => existing._id === row._id)
    ? rows.filter((existing) => existing._id !== row._id)
    : [...rows, row];
}

describe("dashboard selection retention", () => {
  it("retains selected row data after the active page changes", () => {
    const groupedRow = { _id: "grouped", title: "Grouped project" };
    const selected = toggleSelectedRows([], groupedRow);
    const activeFlatPage = [{ _id: "other", title: "Other project" }];
    expect(activeFlatPage).not.toContainEqual(groupedRow);
    expect(selected).toEqual([groupedRow]);
  });
});
