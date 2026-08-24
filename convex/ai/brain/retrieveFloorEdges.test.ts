/**
 * Boundary cases retrieve.test.ts leaves open: a slate entirely below the raw
 * search floor, and the exact exemplar-cap boundary (6000 chars fits, 6001
 * truncates).
 */
import { describe, expect, test } from "vitest";
import {
  applyRawSearchFloor,
  formatBrainExemplars,
  type BrainExemplar,
} from "./retrieve";

function exemplar(overrides: Partial<BrainExemplar> = {}): BrainExemplar {
  return {
    text: "Baseline exemplar text.",
    score: 0.9,
    searchScore: 0.9,
    entryId: "entry-1",
    ...overrides,
  };
}

describe("applyRawSearchFloor boundaries", () => {
  test("a slate entirely below the floor empties out", () => {
    const candidates = [
      exemplar({ entryId: "a", searchScore: 0.249 }),
      exemplar({ entryId: "b", searchScore: 0.01 }),
    ];
    expect(applyRawSearchFloor(candidates)).toEqual([]);
  });
});

describe("formatBrainExemplars cap boundary", () => {
  test("an exemplar exactly at the 6000-char cap is not truncated", () => {
    const block = formatBrainExemplars([exemplar({ text: "z".repeat(6000) })]);
    expect(block).not.toContain("truncated");
    expect(block).toContain("z".repeat(6000));
  });

  test("one char over the cap truncates", () => {
    const block = formatBrainExemplars([exemplar({ text: "z".repeat(6001) })]);
    expect(block).toContain("[… exemplar truncated]");
    expect(block).not.toContain("z".repeat(6001));
  });
});
