import { describe, expect, test } from "vitest";
import {
  billedTokens,
  floorForPassRate,
  passRate,
  pickSpread,
  probeQueryFrom,
  summarizeScores,
} from "./brainCalibration";

describe("the calibration numbers", () => {
  test("a summary of scores, and of none", () => {
    expect(summarizeScores([0.5, 0.1, 0.9, 0.3, 0.7])).toEqual({
      count: 5, min: 0.1, p10: 0.1, p25: 0.3, p50: 0.5, p75: 0.7, p90: 0.9, max: 0.9,
    });
    expect(summarizeScores([])).toMatchObject({ count: 0, p50: null });
  });

  test("the pass rate at a floor", () => {
    expect(passRate([0.2, 0.3, 0.4, 0.5], 0.3)).toBe(0.75);
    expect(passRate([], 0.3)).toBe(0);
  });

  test("the floor that keeps the same share through", () => {
    const scores = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2];
    expect(floorForPassRate(scores, 0.5)).toBe(0.6);
    expect(passRate(scores, floorForPassRate(scores, 0.5)!)).toBe(0.5);
    expect(floorForPassRate(scores, 1)).toBe(0);
    expect(floorForPassRate(scores, 0)).toBe(0.901);
    expect(floorForPassRate([], 0.5)).toBeNull();
  });

  test("a probe query is a passage from a third of the way in, cut at spaces", () => {
    const words = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
    const query = probeQueryFrom(words, 100);
    expect(query.length).toBeLessThanOrEqual(100);
    expect(query.startsWith("word")).toBe(true);
    expect(words.includes(query)).toBe(true);
    expect(words.indexOf(query)).toBeGreaterThan(words.length / 4);
    expect(probeQueryFrom("  short   text ")).toBe("short text");
  });

  test("probes spread over groups before taking a second from any", () => {
    const items = ["a1", "a2", "a3", "b1", "c1", "c2"];
    expect(pickSpread(items, 4, (item) => item[0])).toEqual(["a1", "b1", "c1", "a2"]);
    expect(pickSpread(items, 10, (item) => item[0])).toHaveLength(6);
  });

  test("billed tokens from a raw Voyage body", () => {
    expect(billedTokens({ usage: { total_tokens: 12 } })).toBe(12);
    expect(billedTokens({})).toBe(0);
    expect(billedTokens(null)).toBe(0);
  });
});
