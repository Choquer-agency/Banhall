import { describe, expect, test } from "bun:test";
import { estimateCostUsd } from "../convex/aiUsage";
import { voyageTokenCount } from "../convex/ai/providers";

describe("AI usage pricing", () => {
  test("prices Claude base, five-minute cache creation, and cache reads separately", () => {
    expect(
      estimateCostUsd(
        "claude-sonnet-4-6",
        1_000_000,
        1_000_000,
        1_000_000,
        1_000_000
      )
    ).toBeCloseTo(22.05, 10);
  });

  test("prices Voyage corpus/query embeddings and reranking by processed tokens", () => {
    expect(estimateCostUsd("voyage-3-large", 1_000_000, 0)).toBeCloseTo(
      0.18,
      10
    );
    expect(estimateCostUsd("rerank-2.5", 1_000_000, 0)).toBeCloseTo(
      0.05,
      10
    );
  });

  test("reads exact Voyage billed usage and rejects malformed provider bodies", () => {
    expect(voyageTokenCount({ usage: { total_tokens: 12_345 } })).toBe(12_345);
    expect(voyageTokenCount({ usage: { total_tokens: -1 } })).toBeNull();
    expect(voyageTokenCount({ usage: {} })).toBeNull();
    expect(voyageTokenCount(null)).toBeNull();
  });
});
