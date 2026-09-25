import { describe, expect, test } from "vitest";
import {
  CANDIDATE_MODELS,
  LEGACY_COMPARE_MODEL_IDS,
  MODEL,
  candidateModelsForMode,
} from "../convex/ai/model";

describe("generation candidate mode", () => {
  test("single mode defaults to the report model", () => {
    const models = candidateModelsForMode("single");

    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe(MODEL);
  });

  test("single mode schedules the explicitly selected model", () => {
    const models = candidateModelsForMode("single", "claude-haiku-4-5-20251001");
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe("claude-haiku-4-5-20251001");
  });

  test("iterative mode runs one model with single-mode semantics", () => {
    expect(candidateModelsForMode("iterative")).toHaveLength(1);
    expect(candidateModelsForMode("iterative")[0]?.id).toBe(MODEL);
    const explicit = candidateModelsForMode(
      "iterative",
      "claude-haiku-4-5-20251001"
    );
    expect(explicit).toHaveLength(1);
    expect(explicit[0]?.id).toBe("claude-haiku-4-5-20251001");
  });

  test("compare mode legacy fallback runs the original three Anthropic models only", () => {
    const models = candidateModelsForMode("compare");

    expect(models.map((model) => model.id)).toEqual([
      "claude-sonnet-5",
      "claude-opus-4-8",
      "claude-haiku-4-5-20251001",
    ]);
    expect(models).toEqual(
      CANDIDATE_MODELS.filter((model) =>
        (LEGACY_COMPARE_MODEL_IDS as readonly string[]).includes(model.id)
      )
    );
    // Anthropic models added to the seed later never join the legacy roster.
    const anthropic = CANDIDATE_MODELS.filter((model) => model.gateway === "anthropic");
    expect(anthropic.map((model) => model.id)).toContain("claude-opus-5-5");
    // Fable 5.1 was taken out of the selectable list (owner, 2026-09-25).
    expect(anthropic.map((model) => model.id)).not.toContain("claude-fable-5-1");
    expect(models.some((model) => model.id === "claude-opus-5-5")).toBe(false);
    expect(models.some((model) => model.id === "claude-fable-5-1")).toBe(false);
  });
});
