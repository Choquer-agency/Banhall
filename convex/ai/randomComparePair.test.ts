import { describe, expect, it } from "vitest";
import { randomComparePair } from "./model";
import { CANDIDATE_MODELS, comparePairFromSlots } from "../../shared/generationModels";

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

describe("comparePairFromSlots with one model and Random", () => {
  it("never fills the Random slot with a model that rejects forced tool calls", () => {
    const filled = new Set<string>();
    for (let i = 0; i < 400; i += 1) {
      const pair = comparePairFromSlots("claude-sonnet-5", "", CANDIDATE_MODELS);
      expect(pair?.[0]).toBe("claude-sonnet-5");
      filled.add(pair![1]!);
    }
    expect([...filled].sort()).toEqual(["claude-haiku-4-5-20251001", "claude-opus-4-8"].sort());
  });

  it("keeps an explicit pick of a flagged model", () => {
    expect(comparePairFromSlots("claude-opus-5-5", "claude-sonnet-5", CANDIDATE_MODELS)).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5",
    ]);
  });

  it("filters picker models that carry no flag by the fixed id rule", () => {
    const pickerLike = CANDIDATE_MODELS.map(({ id, gateway }) => ({ id, gateway }));
    for (let i = 0; i < 200; i += 1) {
      const pair = comparePairFromSlots("claude-sonnet-5", "", pickerLike);
      expect(["claude-opus-5-5", "claude-fable-5-1"]).not.toContain(pair![1]);
    }
  });
});
