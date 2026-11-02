import { describe, expect, it } from "vitest";
import { draftTimingText, formatDuration } from "./draftTiming";

const MIN = 60_000;

describe("formatDuration", () => {
  it("words short, minute, hour and day spans plainly", () => {
    expect(formatDuration(20_000)).toBe("under 1 min");
    expect(formatDuration(MIN)).toBe("1 min");
    expect(formatDuration(12 * MIN + 20_000)).toBe("12 min");
    expect(formatDuration(59 * MIN + 40_000)).toBe("1 h");
    expect(formatDuration(65 * MIN)).toBe("1 h 5 min");
    expect(formatDuration(120 * MIN)).toBe("2 h");
    expect(formatDuration(27 * 60 * MIN)).toBe("1 day 3 h");
    expect(formatDuration(48 * 60 * MIN)).toBe("2 days");
  });

  it("says nothing for a missing or impossible span", () => {
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(-5)).toBe("");
    expect(formatDuration(Number.NaN)).toBe("");
  });

  it("uses only plain hyphens and no dashes", () => {
    for (const ms of [1, MIN, 90 * MIN, 30 * 60 * MIN]) {
      expect(formatDuration(ms)).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

describe("draftTimingText", () => {
  it("names a single or compare draft's time", () => {
    expect(draftTimingText({ draftMs: 12 * MIN, stepByStepMs: null })).toBe("Drafted in 12 min");
  });

  it("names both parts of a Step by step draft", () => {
    expect(draftTimingText({ draftMs: 9 * MIN, stepByStepMs: 65 * MIN })).toBe(
      "Step by step took 1 h 5 min, then 9 min to draft"
    );
  });

  it("shows the known part alone", () => {
    expect(draftTimingText({ draftMs: null, stepByStepMs: 40 * MIN })).toBe("Step by step took 40 min");
  });

  it("shows nothing for old rows without stamps", () => {
    expect(draftTimingText(null)).toBe("");
    expect(draftTimingText(undefined)).toBe("");
    expect(draftTimingText({ draftMs: null, stepByStepMs: null })).toBe("");
  });
});
