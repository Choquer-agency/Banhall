import { describe, expect, test } from "vitest";
import {
  activeTimeMs,
  halfOpenContains,
  summarizeDistribution,
} from "./seedLearningHealth";

describe("seed learning-health calculations", () => {
  test("uses a half-open reporting interval", () => {
    expect(halfOpenContains(100, 200, 99)).toBe(false);
    expect(halfOpenContains(100, 200, 100)).toBe(true);
    expect(halfOpenContains(100, 200, 199)).toBe(true);
    expect(halfOpenContains(100, 200, 200)).toBe(false);
  });

  test("reports midpoint median and nearest-rank p95", () => {
    expect(summarizeDistribution([])).toEqual({
      samples: 0,
      median: null,
      p95: null,
      min: null,
      max: null,
    });
    expect(summarizeDistribution([10, 1, 8, 7])).toEqual({
      samples: 4,
      median: 7.5,
      p95: 10,
      min: 1,
      max: 10,
    });
  });

  test("sums only consecutive event gaps shorter than ten minutes", () => {
    const minute = 60_000;
    const result = activeTimeMs(
      [
        { at: 0, _creationTime: 1 },
        { at: minute, _creationTime: 2 },
        { at: 11 * minute, _creationTime: 3 },
        { at: 12 * minute, _creationTime: 4 },
        { at: 13 * minute, _creationTime: 5 },
      ],
      12 * minute,
    );
    expect(result).toEqual({ activeMs: 2 * minute, elapsedMs: 12 * minute });
  });

  test("orders equal-time events by creation time without adding effort", () => {
    expect(
      activeTimeMs(
        [
          { at: 100, _creationTime: 3 },
          { at: 100, _creationTime: 1 },
          { at: 200, _creationTime: 2 },
        ],
        200,
      ),
    ).toEqual({ activeMs: 100, elapsedMs: 100 });
  });
});
