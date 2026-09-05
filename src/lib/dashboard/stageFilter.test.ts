import { describe, expect, it } from "vitest";
import { LEGACY_STAGE_FILTER, stageFilterItemsFromCounts } from "./stageFilter";

// Server-shaped facet counts, as `dashboard` hands them to AllProjectsView and
// ProjectsTableView: one bucket per occupied stage plus the legacy bucket.
const counts = { drafting: 2, on_hold: 1, [LEGACY_STAGE_FILTER]: 1 };
const total = 4;

describe("stageFilterItemsFromCounts", () => {
  it("offers only stages the counts actually populate", () => {
    const values = stageFilterItemsFromCounts(counts, total).map((item) => item.value);
    expect(values).toEqual(["all", "drafting", "on_hold", LEGACY_STAGE_FILTER]);
    expect(values).not.toContain("internal_review");
    expect(stageFilterItemsFromCounts({}, 0).map((item) => item.value)).toEqual(["all"]);
  });

  it("isolates stage-less compatibility rows in a labelled legacy bucket", () => {
    const legacy = stageFilterItemsFromCounts(counts, total).find(
      (item) => item.value === LEGACY_STAGE_FILTER
    );
    expect(legacy?.label).toBe("Legacy status (1)");
    expect(
      stageFilterItemsFromCounts({ drafting: 2 }, 2).some(
        (item) => item.value === LEGACY_STAGE_FILTER
      )
    ).toBe(false);
  });

  it("totals every project once and qualifies the count while the facets are truncated", () => {
    expect(stageFilterItemsFromCounts(counts, total).map((item) => item.label)).toEqual([
      "All stages (4)",
      "Drafting (2)",
      "On hold (1)",
      "Legacy status (1)",
    ]);
    expect(stageFilterItemsFromCounts(counts, total, true)[0].label).toBe("All stages (4+)");
  });
});
