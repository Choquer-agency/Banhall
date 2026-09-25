import { describe, expect, it } from "vitest";
import { randomComparePair } from "./model";
import { CANDIDATE_MODELS, comparePairFromSlots } from "../../shared/generationModels";

describe("randomComparePair", () => {
  it("draws Opus 5.5 but no other model that rejects forced tool calls", () => {
    const drawn = new Set<string>();
    for (let i = 0; i < 400; i += 1) {
      for (const model of randomComparePair(CANDIDATE_MODELS)) drawn.add(model.id);
    }
    expect([...drawn].sort()).toEqual(
      ["claude-haiku-4-5-20251001", "claude-opus-4-8", "claude-opus-5-5", "claude-sonnet-5"].sort()
    );
  });

  it("keeps Fable 5.1 and Mythos 5.1 out even when the catalog enables them", () => {
    const flagged = (id: string) => ({
      ...CANDIDATE_MODELS.find((model) => model.id === "claude-opus-5-5")!,
      id,
    });
    const pool = [...CANDIDATE_MODELS, flagged("claude-fable-5-1"), flagged("claude-mythos-5-1")];
    for (let i = 0; i < 400; i += 1) {
      for (const model of randomComparePair(pool)) {
        expect(["claude-fable-5-1", "claude-mythos-5-1"]).not.toContain(model.id);
      }
    }
  });

  it("still returns two distinct Anthropic models", () => {
    const pair = randomComparePair(CANDIDATE_MODELS);
    expect(pair).toHaveLength(2);
    expect(pair[0]!.id).not.toBe(pair[1]!.id);
    expect(pair.every((model) => model.gateway === "anthropic")).toBe(true);
  });
});

describe("comparePairFromSlots with one model and Random", () => {
  it("fills the Random slot from the same pool as the server draw", () => {
    const filled = new Set<string>();
    for (let i = 0; i < 400; i += 1) {
      const pair = comparePairFromSlots("claude-sonnet-5", "", CANDIDATE_MODELS);
      expect(pair?.[0]).toBe("claude-sonnet-5");
      filled.add(pair![1]!);
    }
    expect([...filled].sort()).toEqual(
      ["claude-haiku-4-5-20251001", "claude-opus-4-8", "claude-opus-5-5"].sort()
    );
  });

  it("keeps an explicit pick of a flagged model", () => {
    expect(comparePairFromSlots("claude-opus-5-5", "claude-sonnet-5", CANDIDATE_MODELS)).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5",
    ]);
  });

  it("filters picker models that carry no flag by the fixed id rule", () => {
    const pickerLike = [
      ...CANDIDATE_MODELS.map(({ id, gateway }) => ({ id, gateway })),
      { id: "claude-fable-5-1", gateway: "anthropic" as const },
      { id: "claude-mythos-5-1", gateway: "anthropic" as const },
    ];
    const filled = new Set<string>();
    for (let i = 0; i < 400; i += 1) filled.add(comparePairFromSlots("claude-sonnet-5", "", pickerLike)![1]!);
    expect(filled.has("claude-opus-5-5")).toBe(true);
    expect(filled.has("claude-fable-5-1")).toBe(false);
    expect(filled.has("claude-mythos-5-1")).toBe(false);
  });
});
