import { describe, expect, test } from "vitest";
import {
  applyRawSearchFloor,
  formatBrainExemplars,
  type BrainExemplar,
} from "./retrieve";

function exemplar(overrides: Partial<BrainExemplar> = {}): BrainExemplar {
  return {
    text: "The limitations to standard practice were unknown thermal tolerances.",
    score: 0.9,
    searchScore: 0.9,
    entryId: "entry-1",
    ...overrides,
  };
}

describe("applyRawSearchFloor", () => {
  test("drops the weak tail of a non-reranked slate, preserving order", () => {
    const candidates = [
      exemplar({ entryId: "a", searchScore: 1.0 }),
      exemplar({ entryId: "b", searchScore: 0.5 }),
      exemplar({ entryId: "c", searchScore: 0.24 }),
      exemplar({ entryId: "d", searchScore: 0.1 }),
    ];
    const floored = applyRawSearchFloor(candidates);
    expect(floored.map((c) => c.entryId)).toEqual(["a", "b"]);
  });

  test("keeps everything at or above the floor", () => {
    const candidates = [
      exemplar({ entryId: "a", searchScore: 0.25 }),
      exemplar({ entryId: "b", searchScore: 0.26 }),
    ];
    expect(applyRawSearchFloor(candidates)).toHaveLength(2);
  });

  test("an empty slate stays empty", () => {
    expect(applyRawSearchFloor([])).toEqual([]);
  });
});

describe("formatBrainExemplars", () => {
  test("renders nothing for zero exemplars", () => {
    expect(formatBrainExemplars([])).toBe("");
  });

  test("caps a pathological over-long exemplar", () => {
    const short = exemplar({ entryId: "short", text: "Short passage." });
    const long = exemplar({ entryId: "long", text: "x".repeat(50_000) });
    const block = formatBrainExemplars([short, long]);
    expect(block).toContain("Short passage.");
    expect(block).toContain("[… exemplar truncated]");
    // The rendered block is bounded even when the source chunk was not.
    expect(block.length).toBeLessThan(10_000);
  });

  test("leaves a normal-length exemplar untouched", () => {
    const text = "y".repeat(3000);
    const block = formatBrainExemplars([exemplar({ text })]);
    expect(block).toContain(text);
    expect(block).not.toContain("truncated");
  });
});
