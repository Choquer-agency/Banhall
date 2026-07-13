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

  test("compare mode schedules every distinct candidate model", () => {
    const models = candidateModelsForMode("compare");

    expect(models).toEqual(CANDIDATE_MODELS);
    expect(new Set(models.map((model) => model.id)).size).toBe(models.length);
    expect(models.length).toBeGreaterThan(1);
  });
});
