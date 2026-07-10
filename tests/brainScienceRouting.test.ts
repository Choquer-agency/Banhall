import { describe, expect, test } from "bun:test";
import { pickScienceRouted } from "../convex/ai/brain/scienceRouting";
import type { CraScienceCode } from "../shared/craScienceCodes";

type Candidate = {
  id: string;
  entryId: string;
  scienceCode?: CraScienceCode;
};

describe("Brain science-code routing", () => {
  test("groups exact-code candidates first, then fills from cross-code and legacy sources", () => {
    const candidates: Candidate[] = [
      { id: "cross-high", entryId: "cross", scienceCode: "1.01.02" },
      { id: "exact-high", entryId: "exact-a", scienceCode: "2.02.09" },
      { id: "legacy", entryId: "legacy" },
      { id: "exact-low", entryId: "exact-b", scienceCode: "2.02.09" },
    ];

    expect(pickScienceRouted(candidates, 3, "2.02.09").map(({ id }) => id)).toEqual([
      "exact-high",
      "exact-low",
      "cross-high",
    ]);
  });

  test("keeps legacy unclassified sources available when no exact match exists", () => {
    const candidates: Candidate[] = [
      { id: "legacy", entryId: "legacy" },
      { id: "cross", entryId: "cross", scienceCode: "1.01.02" },
    ];

    expect(pickScienceRouted(candidates, 2, "2.02.09").map(({ id }) => id)).toEqual([
      "legacy",
      "cross",
    ]);
  });

  test("retains the two-chunk per-source diversity cap across routing groups", () => {
    const candidates: Candidate[] = [
      { id: "exact-1", entryId: "same", scienceCode: "2.02.09" },
      { id: "exact-2", entryId: "same", scienceCode: "2.02.09" },
      { id: "exact-3", entryId: "same", scienceCode: "2.02.09" },
      { id: "fallback", entryId: "other" },
    ];

    expect(pickScienceRouted(candidates, 3, "2.02.09").map(({ id }) => id)).toEqual([
      "exact-1",
      "exact-2",
      "fallback",
    ]);
  });
});
