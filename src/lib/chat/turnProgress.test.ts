import { describe, expect, it } from "vitest";
import {
  contextBoundaryOrder,
  continueLabel,
  continueMessage,
  formatTurnSummary,
  holdLabel,
  progressLabel,
  thinkingHint,
  THINKING_HINT,
  type NormalizedTurn,
  type TurnTiming,
} from "./turnParts";

const emptyTurn: NormalizedTurn = { nodes: [], text: "", traceNodes: [], proposalNodes: [], toolCount: 0, hasReasoning: false };

describe("progressLabel (Phase A, task 5)", () => {
  it("names each phase from turn state and fixed tool fields", () => {
    expect(progressLabel(undefined)).toBe("Working…");
    expect(progressLabel({ phase: "reading", step: 0, since: 0 })).toBe("Reading the report…");
    expect(progressLabel({ phase: "thinking", step: 1, since: 0 })).toBe("Thinking…");
    expect(progressLabel({ phase: "writing", step: 3, since: 0 })).toBe("Writing the reply…");
    expect(progressLabel({ phase: "retrying", step: 3, since: 0 })).toBe("Trying again…");
  });

  it("names the tool and its Line", () => {
    expect(progressLabel({ phase: "tool", tool: "deviationInventory", section: "244", step: 1, since: 0 }))
      .toBe("Listing the deviations in Line 244…");
    expect(progressLabel({ phase: "tool", tool: "deviationInventory", step: 1, since: 0 }))
      .toBe("Listing the deviations…");
    expect(progressLabel({ phase: "tool", tool: "proposeBulkEdits", section: "246", step: 2, since: 0 }))
      .toBe("Writing suggestions for Line 246…");
    expect(progressLabel({ phase: "tool", tool: "compareReferencePd", section: "242", step: 2, since: 0 }))
      .toBe("Comparing Line 242 with the reference PD…");
    expect(progressLabel({ phase: "tool", tool: "searchBrain", step: 2, since: 0 })).toBe("Searching The Brain…");
    // An unknown tool never shows its internal name.
    expect(progressLabel({ phase: "tool", tool: "internalHelper", step: 2, since: 0 })).toBe("Working…");
  });

  it("feeds the live summary, with the turn's elapsed time", () => {
    const timing: TurnTiming = {
      status: "running", startedAt: 1_000, stepCount: 1,
      progress: { phase: "tool", tool: "deviationInventory", section: "244", step: 1, since: 4_000 },
    };
    expect(formatTurnSummary(emptyTurn, timing, "streaming", 49_000)).toBe("Listing the deviations in Line 244… · 48s");
    expect(formatTurnSummary(emptyTurn, { status: "running", startedAt: 1_000, stepCount: 0 }, "streaming", 6_000))
      .toBe("Working… · 5s");
    expect(formatTurnSummary(emptyTurn, { ...timing, status: "queued" }, undefined, 6_000)).toBe("Starting…");
  });
});

describe("thinkingHint", () => {
  const thinking = (since: number): TurnTiming => ({
    status: "running", startedAt: 0, stepCount: 1, progress: { phase: "thinking", step: 1, since },
  });

  it("appears a minute after the browser first saw the thinking phase", () => {
    expect(thinkingHint(thinking(0), 59_999, 0)).toBeNull();
    expect(thinkingHint(thinking(0), 60_000, 0)).toBe(THINKING_HINT);
    expect(THINKING_HINT).toBe("Big requests can take a few minutes. You can stop and ask for one Line at a time.");
  });

  it("ignores the server clock, however far it is skewed", () => {
    // Server ten minutes ahead, or an hour behind: only the browser's minute counts.
    expect(thinkingHint(thinking(10 * 60_000), 30_000, 0)).toBeNull();
    expect(thinkingHint(thinking(10 * 60_000), 60_000, 0)).toBe(THINKING_HINT);
    expect(thinkingHint(thinking(-3_600_000), 30_000, 0)).toBeNull();
  });

  it("stays away outside a running thinking phase, or before the phase was seen", () => {
    expect(thinkingHint(thinking(0), 90_000, undefined)).toBeNull();
    expect(thinkingHint({ ...thinking(0), progress: { phase: "tool", tool: "deviationInventory", step: 1, since: 0 } }, 90_000, 0)).toBeNull();
    expect(thinkingHint({ ...thinking(0), status: "completed" }, 90_000, 0)).toBeNull();
    expect(thinkingHint(undefined, 90_000, 0)).toBeNull();
  });
});

describe("holdLabel", () => {
  it("shows the first label at once and holds each for 1.5 s", () => {
    const first = holdLabel(null, "Reading the report…", 0);
    expect(first).toEqual({ held: { shown: "Reading the report…", shownAt: 0 }, waitMs: 0 });
    const early = holdLabel(first.held, "Thinking…", 400);
    expect(early).toEqual({ held: first.held, waitMs: 1100 });
    const late = holdLabel(first.held, "Thinking…", 1500);
    expect(late).toEqual({ held: { shown: "Thinking…", shownAt: 1500 }, waitMs: 0 });
    expect(holdLabel(late.held, "Thinking…", 1600)).toEqual({ held: late.held, waitMs: 0 });
  });
});

describe("Continue offer", () => {
  it("names the next Line, or just continues", () => {
    expect(continueLabel({ reason: "lines_left", nextSection: "244", remaining: 6 })).toBe("Continue with Line 244");
    expect(continueMessage({ reason: "lines_left", nextSection: "244" })).toBe("Continue with Line 244.");
    expect(continueLabel({ reason: "cut_off" })).toBe("Continue");
    expect(continueMessage({ reason: "step_limit" })).toBe("Continue.");
    expect(continueLabel(undefined)).toBeNull();
    expect(continueMessage(undefined)).toBeNull();
  });
});

describe("contextBoundaryOrder (Phase A, task 8)", () => {
  it("marks the first message the model still reads when older ones are left out", () => {
    const turns = [{ order: 10, historyStartOrder: 2 }, { order: 30, historyStartOrder: 15 }, { order: 31 }];
    expect(contextBoundaryOrder(turns, [1, 2, 10, 15, 16, 30, 31], false)).toBe(15);
    // The loaded page starts after the start, but older pages exist: the
    // first loaded message is still read, so no divider is drawn inside it.
    expect(contextBoundaryOrder(turns, [20, 30, 31], true)).toBeNull();
    // Older pages exist and the start is inside the loaded window.
    expect(contextBoundaryOrder(turns, [15, 16, 30], true)).toBe(15);
  });

  it("draws nothing when the whole thread is read", () => {
    expect(contextBoundaryOrder([{ order: 3 }], [0, 1, 2, 3], false)).toBeNull();
    expect(contextBoundaryOrder([{ order: 3, historyStartOrder: 0 }], [0, 1, 2, 3], false)).toBeNull();
    expect(contextBoundaryOrder([], [0, 1], true)).toBeNull();
  });
});
