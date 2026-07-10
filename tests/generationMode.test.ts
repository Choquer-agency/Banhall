import { describe, expect, test } from "bun:test";
import {
  CANDIDATE_MODELS,
  MODEL,
  candidateModelsForMode,
} from "../convex/ai/model";

describe("generation candidate mode", () => {
  test("single mode schedules only the default report model", () => {
    const models = candidateModelsForMode("single");

    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe(MODEL);
  });

  test("compare mode schedules every distinct candidate model", () => {
    const models = candidateModelsForMode("compare");

    expect(models).toEqual(CANDIDATE_MODELS);
    expect(new Set(models.map((model) => model.id)).size).toBe(models.length);
    expect(models.length).toBeGreaterThan(1);
  });
});
