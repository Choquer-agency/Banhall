/**
 * Price table for every model the app calls, in USD per million tokens.
 *
 * Shared (not under convex/) so the aiUsage writer and the read-only
 * `scripts/ai-usage-report.mjs` analysis price rows with the same numbers.
 * Keep this module free of imports: the script loads it with Node's type
 * stripping, outside any bundler.
 *
 * Sources, read 2026-09-24:
 * - Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
 *   (model table, prompt caching multipliers). Sonnet 5's $2/$10 was
 *   introductory until 2026-08-31 and is now the standard price; the
 *   scheduled rise to $3/$15 was cancelled, so the old $3/$15 estimate
 *   overstated every Sonnet 5 row by half.
 *   Cache writes cost 1.25x base input for the 5-minute TTL and 2x for the
 *   1-hour TTL. Cache reads cost 0.1x, except Opus 5.5 (0.05x).
 * - Voyage (voyage-3-large $0.18, rerank-2.5 $0.05, input only): kept from
 *   the earlier table, not re-read on this date.
 * - OpenRouter models: FALLBACKS ONLY. OpenRouter returns the exact charge in
 *   `usage.cost`, which is recorded as a native cost and always wins. These
 *   rows price only a response that carried no cost, and are kept from the
 *   earlier table unverified; a row priced from them is marked estimated.
 */

export type ModelPricing = {
  input: number;
  output: number;
  /** Multiplier on `input` for tokens written to the 5-minute cache. */
  cacheWrite5mMultiplier: number;
  /** Multiplier on `input` for tokens written to the 1-hour cache. */
  cacheWrite1hMultiplier: number;
  /** Multiplier on `input` for tokens read from the cache. */
  cacheReadMultiplier: number;
};

/** Where a stored cost figure came from. */
export type CostSource = "native" | "estimated";

const anthropic = (
  input: number,
  output: number,
  cacheReadMultiplier = 0.1
): ModelPricing => ({
  input,
  output,
  cacheWrite5mMultiplier: 1.25,
  cacheWrite1hMultiplier: 2,
  cacheReadMultiplier,
});

const inputOnly = (input: number): ModelPricing => ({
  input,
  output: 0,
  cacheWrite5mMultiplier: 0,
  cacheWrite1hMultiplier: 0,
  cacheReadMultiplier: 0,
});

/** OpenRouter fallback: no separate cache-write billing on this path. */
const gateway = (
  input: number,
  output: number,
  cacheReadMultiplier: number
): ModelPricing => ({
  input,
  output,
  cacheWrite5mMultiplier: 0,
  cacheWrite1hMultiplier: 0,
  cacheReadMultiplier,
});

export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  // Anthropic direct.
  "claude-opus-5-5": anthropic(4, 20, 0.05),
  "claude-opus-5": anthropic(5, 25),
  "claude-opus-4-8": anthropic(5, 25),
  "claude-sonnet-5": anthropic(2, 10),
  // Historical rows only; no longer in the picker.
  "claude-sonnet-4-6": anthropic(3, 15),
  "claude-haiku-4-5": anthropic(1, 5),
  // Voyage embeddings and reranking bill processed tokens as input.
  "voyage-3-large": inputOnly(0.18),
  "rerank-2.5": inputOnly(0.05),
  // OpenRouter fallbacks (native usage.cost wins).
  "openai/gpt-5.6-sol": gateway(5, 30, 0.25),
  "openai/gpt-5.6-luna": gateway(1, 6, 0.25),
  "google/gemini-3.1-pro-preview": gateway(2, 12, 0.25),
  "google/gemini-3.5-flash": gateway(1.5, 9, 0.25),
  "perplexity/sonar-deep-research": gateway(2, 8, 0),
  // Anthropic models through OpenRouter bill at Anthropic's list prices,
  // cache writes included (review finding: this row once had zero write
  // multipliers). Other anthropic/ ids resolve through pricingFor.
  "anthropic/claude-sonnet-5": anthropic(2, 10),
};

/**
 * An unknown model is priced like the default chat and generation model, so
 * a new id still gets a plausible figure. Such a row is marked estimated like
 * every other table-priced row; the analysis script lists unknown models.
 */
export const FALLBACK_MODEL_PRICING: ModelPricing = MODEL_PRICING["claude-sonnet-5"];

const ANTHROPIC_GATEWAY_PREFIX = "anthropic/";

/**
 * The table entry for `model`: the exact id, else the id without a trailing
 * `-YYYYMMDD` snapshot date (`claude-haiku-4-5-20251001` prices as
 * `claude-haiku-4-5`), else, for an `anthropic/` OpenRouter id, the direct
 * Anthropic entry. Null when none is known.
 */
export function pricingFor(model: string): ModelPricing | null {
  const exact = MODEL_PRICING[model];
  if (exact) return exact;
  const undated = model.replace(/-\d{8}$/, "");
  if (undated !== model && MODEL_PRICING[undated]) return MODEL_PRICING[undated];
  // An Anthropic model through OpenRouter ("anthropic/claude-opus-4.8")
  // prices as the direct id ("claude-opus-4-8").
  if (model.startsWith(ANTHROPIC_GATEWAY_PREFIX)) {
    const direct = model.slice(ANTHROPIC_GATEWAY_PREFIX.length).replace(/\./g, "-");
    return pricingFor(direct);
  }
  return null;
}


function billable(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

export type BilledTokens = {
  /** Uncached input tokens, billed at the base rate. */
  inputTokens: number;
  outputTokens: number;
  /** Every token written to the cache, whatever its TTL. */
  cacheCreationInputTokens?: number;
  /** The part of `cacheCreationInputTokens` written with the 1-hour TTL. */
  cacheCreation1hInputTokens?: number;
  cacheReadInputTokens?: number;
};

/**
 * Pricing from per-million-token prices, as the model catalog stores them
 * (convex `modelCatalog`). Prices a model the table above does not list,
 * such as one the catalog discovered after this file was last edited.
 */
export function pricingFromPerMillion(prices: {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheWrite1h?: number;
}): ModelPricing {
  const ratio = (value: number | undefined) =>
    value !== undefined && prices.input > 0 ? value / prices.input : 0;
  return {
    input: prices.input,
    output: prices.output,
    cacheWrite5mMultiplier: ratio(prices.cacheWrite),
    cacheWrite1hMultiplier: ratio(prices.cacheWrite1h),
    cacheReadMultiplier: ratio(prices.cacheRead),
  };
}

/**
 * Estimated USD cost of one response from the price table. Cache writes are
 * split by TTL: `cacheCreation1hInputTokens` (clamped to the total) at the
 * 1-hour multiplier, the rest at the 5-minute one. `override` prices a model
 * the table does not list (the catalog's row for it).
 */
export function estimateCostFromTable(
  model: string,
  tokens: BilledTokens,
  override?: ModelPricing
): number {
  return estimateCostWithPricing(
    pricingFor(model) ?? override ?? FALLBACK_MODEL_PRICING,
    tokens
  );
}

/** Estimated USD cost of one response at exactly `pricing`. */
export function estimateCostWithPricing(pricing: ModelPricing, tokens: BilledTokens): number {
  const cacheWrite = billable(tokens.cacheCreationInputTokens);
  const cacheWrite1h = Math.min(billable(tokens.cacheCreation1hInputTokens), cacheWrite);
  const cacheWrite5m = cacheWrite - cacheWrite1h;
  const inputCost =
    billable(tokens.inputTokens) * pricing.input +
    cacheWrite5m * pricing.input * pricing.cacheWrite5mMultiplier +
    cacheWrite1h * pricing.input * pricing.cacheWrite1hMultiplier +
    billable(tokens.cacheReadInputTokens) * pricing.input * pricing.cacheReadMultiplier;
  const outputCost = billable(tokens.outputTokens) * pricing.output;
  return (inputCost + outputCost) / 1_000_000;
}
