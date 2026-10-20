import { describe, expect, it } from "vitest";
import { turnPhaseFields } from "./turnContracts";

describe("turnPhaseFields (Phase A listTurns fields)", () => {
  it("reads progress, continuation and historyStartOrder", () => {
    expect(turnPhaseFields({
      _id: "turn-1",
      status: "running",
      progress: { phase: "tool", tool: "deviationInventory", section: "244", step: 2, since: 1000 },
      continuation: { reason: "lines_left", nextSection: "246", remaining: 7 },
      historyStartOrder: 12,
    })).toEqual({
      progress: { phase: "tool", tool: "deviationInventory", section: "244", step: 2, since: 1000 },
      continuation: { reason: "lines_left", nextSection: "246", remaining: 7 },
      historyStartOrder: 12,
    });
  });

  it("returns nothing for a turn written before the fields existed", () => {
    expect(turnPhaseFields({ _id: "turn-1", status: "completed", stepCount: 1 })).toEqual({});
    expect(turnPhaseFields(null)).toEqual({});
    expect(turnPhaseFields("turn")).toEqual({});
  });

  it("drops malformed values instead of guessing", () => {
    expect(turnPhaseFields({
      progress: { phase: "dreaming", step: 1, since: 1 },
      continuation: { reason: "because" },
      historyStartOrder: "12",
    })).toEqual({});
    expect(turnPhaseFields({ progress: { phase: "thinking", step: 1 } })).toEqual({});
    expect(turnPhaseFields({
      progress: { phase: "thinking", step: 1, since: 5, section: "999", tool: "" },
      continuation: { reason: "cut_off", nextSection: "100", remaining: Number.NaN },
    })).toEqual({
      progress: { phase: "thinking", step: 1, since: 5 },
      continuation: { reason: "cut_off" },
    });
  });
});
