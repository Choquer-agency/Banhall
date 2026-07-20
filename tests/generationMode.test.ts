import { describe, expect, test } from "bun:test";
import {
  CANDIDATE_MODELS,
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

  test("compare mode legacy fallback runs the Anthropic roster only", () => {
    const models = candidateModelsForMode("compare");

    expect(models).toEqual(
      CANDIDATE_MODELS.filter((model) => model.gateway === "anthropic")
    );
    expect(new Set(models.map((model) => model.id)).size).toBe(models.length);
    expect(models.length).toBeGreaterThan(1);
  });
});
