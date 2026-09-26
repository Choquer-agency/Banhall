import { describe, expect, it } from "vitest";
import { compactSource, factCountText, readingPercent } from "./readingProgress";

describe("readingPercent", () => {
  it("fills with time, holds at 95 until the Brief lands, then shows 100", () => {
    expect(readingPercent(1_000, 1_000, 40_000, false)).toBe(0);
    expect(readingPercent(21_000, 1_000, 40_000, false)).toBe(50);
    expect(readingPercent(200_000, 1_000, 40_000, false)).toBe(95);
    expect(readingPercent(5_000, 1_000, 40_000, true)).toBe(100);
    expect(readingPercent(5_000, 1_000, 0, false)).toBe(0);
  });
});

describe("factCountText", () => {
  it("counts in plain words", () => {
    expect(factCountText(0)).toBe("Looking for facts");
    expect(factCountText(1)).toBe("1 fact found so far");
    expect(factCountText(6)).toBe("6 facts found so far");
    expect(factCountText(6, true)).toBe("6 facts");
    expect(factCountText(1, true)).toBe("1 fact");
  });
});

describe("compactSource", () => {
  it("keeps the first word and the line", () => {
    expect(compactSource("Priya Raman, line 18")).toBe("Priya, line 18");
    expect(compactSource("Call with Dana, line 12")).toBe("Call, line 12");
    expect(compactSource("Cedarline FY 2025 report, R4.pdf")).toBe("Cedarline FY 2025 repor...");
  });
});
