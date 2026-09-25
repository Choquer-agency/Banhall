import { describe, expect, it } from "vitest";
import { randomComparePair } from "./model";
import { CANDIDATE_MODELS } from "../../shared/generationModels";

describe("randomComparePair", () => {
  it("never draws a model that rejects forced tool calls", () => {
    const drawn = new Set<string>();
    for (let i = 0; i < 400; i += 1) {
      for (const model of randomComparePair(CANDIDATE_MODELS)) drawn.add(model.id);
    }
    expect(drawn.has("claude-opus-5-5")).toBe(false);
    expect(drawn.has("claude-fable-5-1")).toBe(false);
    expect([...drawn].sort()).toEqual(
      ["claude-haiku-4-5-20251001", "claude-opus-4-8", "claude-sonnet-5"].sort()
    );
  });

  it("still returns two distinct Anthropic models", () => {
    const pair = randomComparePair(CANDIDATE_MODELS);
    expect(pair).toHaveLength(2);
    expect(pair[0]!.id).not.toBe(pair[1]!.id);
    expect(pair.every((model) => model.gateway === "anthropic")).toBe(true);
  });
});
