import { describe, expect, it } from "vitest";
import {
  bulkMutationArgs,
  bulkResultMessage,
  changeSentences,
  changedFieldsLabel,
  currentSummary,
  reviewCountSentence,
  reviewRows,
  skipNote,
  summarizeValues,
  utcDateFromInput,
  type BulkEditRow,
} from "./bulkEdit";

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const DASHES = /[\u2010-\u2015\u00b7]/;

const ROWS: BulkEditRow[] = [
  { _id: "p1", title: "Coil frost sensing", projectNumber: "1", clientName: "Cedarline Systems", fiscalYearEnd: day("2025-03-31"), industry: "manufacturing", ownerId: "u-1" },
  { _id: "p4", title: "Cold storage controls", projectNumber: "4", clientName: "Cedarline Systems", fiscalYearEnd: day("2026-09-30"), industry: "manufacturing", scienceCode: "2.03.01", ownerId: "u-2" },
  { _id: "p6", title: "Defrost prediction", clientName: "Cedarline Systems", fiscalYearEnd: day("2026-09-30"), industry: "manufacturing", scienceCode: "2.03.01", ownerId: "u-1" },
];

describe("Now: summaries", () => {
  it("names one shared value alone, counts mixed values most common first, and says not set", () => {
    expect(currentSummary(ROWS, "clientName")).toBe("Cedarline Systems");
    expect(currentSummary(ROWS, "fiscalYearEnd")).toBe(
      "FY 2026 ended September 30, 2026 (2), FY 2025 ended March 31, 2025 (1)"
    );
    expect(currentSummary(ROWS, "scienceCode")).toMatch(/^2\.03\.01 .+ \(2\), not set \(1\)$/);
    expect(currentSummary([ROWS[0]], "scienceCode")).toBe("not set");
    expect(currentSummary(ROWS, "industry")).toBe("Manufacturing");
  });

  it("caps the list at four values", () => {
    expect(summarizeValues(["a", "b", "c", "d", "e", "f"])).toBe("a (1), b (1), c (1), d (1), +2 more");
    expect(summarizeValues([])).toBe("not set");
  });
});

describe("changes and review", () => {
  it("counts changed fields", () => {
    expect(changedFieldsLabel(0)).toBe("No changes yet");
    expect(changedFieldsLabel(1)).toBe("1 field changed");
    expect(changedFieldsLabel(2)).toBe("2 fields changed");
  });

  it("says one sentence per changed field", () => {
    expect(changeSentences({ fiscalYearEnd: day("2026-09-30"), industry: null })).toEqual([
      "Fiscal year end set to September 30, 2026.",
      "Industry cleared.",
    ]);
    expect(changeSentences({ clientName: "Acuity Insights" })).toEqual(["Client set to Acuity Insights."]);
  });

  it("lists only changed fields, with No change where a project already matches", () => {
    const rows = reviewRows(ROWS, { fiscalYearEnd: day("2026-09-30") }, { _id: "u-1", role: "manager" });
    expect(rows.map((row) => [row.id, row.status, row.cells])).toEqual([
      ["p1", "change", [{ field: "fiscalYearEnd", now: "FY 2025, March 31, 2025", after: "FY 2026, September 30, 2026" }]],
      ["p4", "match", [{ field: "fiscalYearEnd", now: "FY 2026, September 30, 2026", after: null }]],
      ["p6", "match", [{ field: "fiscalYearEnd", now: "FY 2026, September 30, 2026", after: null }]],
    ]);
    expect(reviewCountSentence(rows)).toBe("1 project will change, 2 already match.");
    expect(skipNote(rows)).toBeNull();
  });

  it("tells a writer which selected projects are not theirs", () => {
    const rows = reviewRows(ROWS, { industry: null }, { _id: "u-1", role: "writer" });
    expect(rows.map((row) => row.status)).toEqual(["change", "skipped", "change"]);
    expect(skipNote(rows)).toBe("You can only change projects you own. 1 of these is not yours and will be skipped.");
    expect(reviewCountSentence(rows)).toBe("2 projects will change.");
  });

  it("builds one bulkUpdateProjects call with only the changed fields", () => {
    expect(bulkMutationArgs(["p1", "p4"], { clientName: " Acuity Insights ", fiscalYearEnd: null })).toEqual({
      projectIds: ["p1", "p4"],
      clientName: "Acuity Insights",
      fiscalYearEnd: null,
    });
    expect(bulkMutationArgs(["p1"], { scienceCode: "2.03.01" })).toEqual({ projectIds: ["p1"], scienceCode: "2.03.01" });
  });

  it("reads Set date as UTC midnight", () => {
    expect(utcDateFromInput("2026-09-30")).toBe(day("2026-09-30"));
    expect(utcDateFromInput("")).toBeNull();
  });
});

describe("result toast", () => {
  it("says how many were updated, and how many a writer does not own", () => {
    expect(bulkResultMessage({ updated: 3, skipped: 0 }, { _id: "u", role: "manager" })).toBe("Updated 3 projects.");
    expect(bulkResultMessage({ updated: 1, skipped: 0 }, { _id: "u", role: "writer" })).toBe("Updated 1 project.");
    expect(bulkResultMessage({ updated: 2, skipped: 1 }, { _id: "u", role: "writer" })).toBe(
      "Updated 2 projects, skipped 1 you don't own."
    );
    const all = [
      bulkResultMessage({ updated: 2, skipped: 1 }, { _id: "u", role: "admin" }),
      ...changeSentences({ fiscalYearEnd: day("2026-09-30"), clientName: "A", industry: "x", scienceCode: null }),
      currentSummary(ROWS, "fiscalYearEnd"),
    ].join(" ");
    expect(all).not.toMatch(DASHES);
    expect(all.toLowerCase()).not.toContain("undo");
  });
});
