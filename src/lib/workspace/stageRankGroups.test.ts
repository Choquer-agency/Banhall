import { describe, expect, it } from "vitest";
import { verifiedStageCounts } from "./stageRankGroups";

describe("verifiedStageCounts", () => {
  it("passes through an internally consistent record", () => {
    expect(verifiedStageCounts({ intake: 1, drafting: 2 }, 3)).toEqual({ intake: 1, drafting: 2 });
    expect(verifiedStageCounts(undefined, 3)).toBeUndefined();
  });

  it("rejects an empty record on a row that still counts projects, and any sum mismatch (H3)", () => {
    expect(verifiedStageCounts({}, 2)).toBeUndefined();
    expect(verifiedStageCounts({ intake: 1 }, 2)).toBeUndefined();
    expect(verifiedStageCounts({ intake: 3 }, 2)).toBeUndefined();
    // Genuinely empty rows cannot occur (deleted at projectCount 0), but the
    // degenerate pair is still consistent.
    expect(verifiedStageCounts({}, 0)).toEqual({});
  });
});
