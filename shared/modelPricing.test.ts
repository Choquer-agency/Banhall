import { describe, expect, test } from "vitest";
import { CANDIDATE_MODELS } from "./generationModels";
import {
  FALLBACK_MODEL_PRICING,
  MODEL_PRICING,
  estimateCostFromTable,
  pricingFor,
} from "./modelPricing";

const MTOK = 1_000_000;

describe("model price table", () => {
  test("prices every model the app can select, dated ids included", () => {
    for (const model of CANDIDATE_MODELS) {
      expect(pricingFor(model.id), model.id).not.toBeNull();
    }
    expect(pricingFor("claude-haiku-4-5-20251001")).toBe(
      MODEL_PRICING["claude-haiku-4-5"]
    );
    expect(pricingFor("claude-opus-5-5")).not.toBeNull();
    expect(pricingFor("claude-sonnet-4-6")).not.toBeNull();
    expect(pricingFor("claude-unknown-9")).toBeNull();
  });

  test("uses the published Anthropic rates (2026-09-24)", () => {
    const one = (model: string) =>
      estimateCostFromTable(model, { inputTokens: MTOK, outputTokens: MTOK });
    expect(one("claude-sonnet-5")).toBeCloseTo(2 + 10, 10);
    expect(one("claude-sonnet-4-6")).toBeCloseTo(3 + 15, 10);
    expect(one("claude-opus-4-8")).toBeCloseTo(5 + 25, 10);
    expect(one("claude-opus-5-5")).toBeCloseTo(4 + 20, 10);
    expect(one("claude-fable-5-1")).toBeCloseTo(10 + 50, 10);
    expect(one("claude-haiku-4-5-20251001")).toBeCloseTo(1 + 5, 10);
  });

  test("Fable 5.1 reads cost $0.25 (0.025x); its writes follow the Anthropic rule", () => {
    const read = estimateCostFromTable("claude-fable-5-1", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: MTOK,
    });
    expect(read).toBeCloseTo(0.25, 10);
    const written = estimateCostFromTable("claude-fable-5-1", {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: MTOK,
      cacheCreation1hInputTokens: 400_000,
    });
    expect(written).toBeCloseTo(0.6 * 10 * 1.25 + 0.4 * 10 * 2, 10);
  });

  test("prices GPT-6 Sol and Luna at OpenRouter's listed rates as fallbacks", () => {
    const one = (model: string) =>
      estimateCostFromTable(model, { inputTokens: MTOK, outputTokens: MTOK });
    expect(one("openai/gpt-6-sol")).toBeCloseTo(2 + 10, 10);
    expect(one("openai/gpt-6-luna")).toBeCloseTo(0.1 + 0.5, 10);
    // OpenRouter fallbacks bill no separate cache writes; reads are 0.1x.
    expect(MODEL_PRICING["openai/gpt-6-sol"]).toMatchObject({
      cacheWrite5mMultiplier: 0,
      cacheWrite1hMultiplier: 0,
      cacheReadMultiplier: 0.1,
    });
    expect(
      estimateCostFromTable("openai/gpt-6-luna", {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: MTOK,
      })
    ).toBeCloseTo(0.01, 10);
  });

  test("prices 5-minute writes at 1.25x, 1-hour writes at 2x and reads at 0.1x", () => {
    // Sonnet 5, $2 input: 1M uncached + 1M written (400k of it 1-hour)
    // + 1M read.
    const cost = estimateCostFromTable("claude-sonnet-5", {
      inputTokens: MTOK,
      outputTokens: 0,
      cacheCreationInputTokens: MTOK,
      cacheCreation1hInputTokens: 400_000,
      cacheReadInputTokens: MTOK,
    });
    expect(cost).toBeCloseTo(2 + 0.6 * 2 * 1.25 + 0.4 * 2 * 2 + 2 * 0.1, 10);
  });

  test("Opus 5.5 reads cost 0.05x input", () => {
    expect(
      estimateCostFromTable("claude-opus-5-5", {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: MTOK,
      })
    ).toBeCloseTo(0.2, 10);
  });

  test("clamps 1-hour writes to the total and ignores malformed counts", () => {
    const clamped = estimateCostFromTable("claude-haiku-4-5", {
      inputTokens: -5,
      outputTokens: Number.NaN,
      cacheCreationInputTokens: 100,
      cacheCreation1hInputTokens: 1_000,
    });
    expect(clamped).toBeCloseTo((100 * 1 * 2) / MTOK, 12);
  });

  test("an unknown model falls back to the default model's rates", () => {
    expect(pricingFor("vendor/new-model") ?? FALLBACK_MODEL_PRICING).toBe(
      MODEL_PRICING["claude-sonnet-5"]
    );
    expect(
      estimateCostFromTable("vendor/new-model", { inputTokens: MTOK, outputTokens: 0 })
    ).toBeCloseTo(2, 10);
  });
});

describe("Anthropic models through OpenRouter without a native cost", () => {
  test("price cache writes at Anthropic's 5-minute and 1-hour rates", () => {
    // 100k Sonnet 5 tokens written: $0.25 at 5 minutes, $0.40 at 1 hour.
    expect(
      estimateCostFromTable("anthropic/claude-sonnet-5", {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 100_000,
      })
    ).toBeCloseTo(0.25, 10);
    expect(
      estimateCostFromTable("anthropic/claude-sonnet-5", {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 100_000,
        cacheCreation1hInputTokens: 100_000,
      })
    ).toBeCloseTo(0.4, 10);
  });

  test("resolve other anthropic/ ids to the direct Anthropic entry", () => {
    expect(pricingFor("anthropic/claude-opus-4.8")).toBe(MODEL_PRICING["claude-opus-4-8"]);
    expect(pricingFor("anthropic/claude-haiku-4.5")).toBe(MODEL_PRICING["claude-haiku-4-5"]);
    expect(pricingFor("anthropic/claude-opus-5.5")).toBe(MODEL_PRICING["claude-opus-5-5"]);
    expect(pricingFor("anthropic/claude-fable-5.1")).toBe(MODEL_PRICING["claude-fable-5-1"]);
    expect(pricingFor("anthropic/claude-unknown")).toBeNull();
  });
});
