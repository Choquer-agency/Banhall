import { describe, expect, it } from "vitest";
import { seedProgress, seedProgressLine } from "./seedProgress";

describe("seedProgress", () => {
  it("waits while the batch is queued", () => {
    expect(seedProgress(10_000, { status: "queued", queuedAt: 1_000 }, 20_000)).toEqual({
      percent: 0,
      secondsLeft: null,
      phrase: "Waiting to start.",
    });
    expect(seedProgress(10_000, null, 20_000).phrase).toBe("Waiting to start.");
  });

  it("counts down from the estimate in fives", () => {
    const running = { status: "running" as const, queuedAt: 0, startedAt: 0 };
    expect(seedProgress(5_000, running, 20_000)).toEqual({ percent: 25, secondsLeft: 15, phrase: "About 15 seconds left." });
    expect(seedProgress(1_000, running, 20_000).secondsLeft).toBe(20);
    expect(seedProgress(16_000, running, 20_000).secondsLeft).toBe(5);
  });

  it("holds at 95% and says Almost ready once past the estimate", () => {
    const running = { status: "running" as const, queuedAt: 0, startedAt: 0 };
    expect(seedProgress(19_000, running, 20_000)).toEqual({ percent: 95, secondsLeft: null, phrase: "Almost ready." });
    expect(seedProgress(90_000, running, 20_000).percent).toBe(95);
  });

  it("uses 20 seconds when there is no estimate", () => {
    expect(seedProgress(10_000, { status: "running", queuedAt: 0, startedAt: 0 }, 0).percent).toBe(50);
  });
});

describe("seedProgressLine", () => {
  it("says what the ideas come from", () => {
    const progress = { percent: 25, secondsLeft: 15, phrase: "About 15 seconds left." };
    expect(seedProgressLine(progress, false)).toBe("Writing ideas from the interview. About 15 seconds left.");
    expect(seedProgressLine(progress, true)).toBe(
      "Writing ideas from the interview and your picks so far. About 15 seconds left."
    );
  });
});
