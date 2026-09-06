import { describe, expect, it } from "vitest";
import { stageFilterItemsFromCounts } from "./stageFilter";

// Supplied aggregates deliberately use reverse pipeline key order and a total
// that differs from the bucket sum. This helper formats, rather than classifies.
const counts = { legacy: 1, on_hold: 1, delivered: 3, drafting: 2 };
const total = 12;

describe("stageFilterItemsFromCounts", () => {
  it("formats populated buckets in pipeline order and preserves the supplied total", () => {
    expect(stageFilterItemsFromCounts(counts, total)).toEqual([
      { value: "all", label: "All stages (12)" },
      { value: "drafting", label: "Drafting (2)" },
      { value: "delivered", label: "Delivered (3)" },
      { value: "on_hold", label: "On hold (1)" },
      { value: "legacy", label: "Legacy status (1)" },
    ]);
  });

  it("labels supplied legacy counts and omits absent or explicit zero buckets", () => {
    expect(stageFilterItemsFromCounts({ legacy: 1 }, 1)).toEqual([
      { value: "all", label: "All stages (1)" },
      { value: "legacy", label: "Legacy status (1)" },
    ]);
    expect(stageFilterItemsFromCounts({ drafting: 2, intake: 0, legacy: 0 }, 2)).toEqual([
      { value: "all", label: "All stages (2)" },
      { value: "drafting", label: "Drafting (2)" },
    ]);
    expect(stageFilterItemsFromCounts({}, 0)).toEqual([
      { value: "all", label: "All stages (0)" },
    ]);
  });

  it("qualifies every supplied count while facets are truncated", () => {
    expect(stageFilterItemsFromCounts(counts, total, true)).toEqual([
      { value: "all", label: "All stages (12+)" },
      { value: "drafting", label: "Drafting (2+)" },
      { value: "delivered", label: "Delivered (3+)" },
      { value: "on_hold", label: "On hold (1+)" },
      { value: "legacy", label: "Legacy status (1+)" },
    ]);
  });
});
