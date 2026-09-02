import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAnthropicClient,
  normalizeProviderError,
  ANTHROPIC_MAX_RETRIES,
  ANTHROPIC_TIMEOUT_MS,
  SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE,
  RESERVED_NON_REQUEST_MS,
  CONVEX_ACTION_LIMIT_MS,
} from "./providers";

describe("normalizeProviderError", () => {
  it("keeps bounded raw text for an unclassified provider failure", () => {
    const result = normalizeProviderError(new Error("upstream overloaded unexpectedly"));
    expect(result.code).toBe("unknown");
    expect(result.message).toContain("upstream overloaded unexpectedly");
  });
});

// CAP-6: the normative requirement is the budget inequality evaluated over the
// IMPORTED configuration, never over numbers copied into this file. The only
// literals below are the two exact-value pins and the spec floor for the
// reserve; they exist so a silent policy change fails loudly.
describe("CAP-6 provider retry budget", () => {
  const attempts = ANTHROPIC_MAX_RETRIES + 1;

  it("pins one retry (two attempts total)", () => {
    expect(ANTHROPIC_MAX_RETRIES).toBe(1);
  });

  it("pins the 4-minute per-attempt timeout", () => {
    expect(ANTHROPIC_TIMEOUT_MS).toBe(240_000);
  });

  it("keeps the named reserve at or above the 60 s spec floor", () => {
    expect(RESERVED_NON_REQUEST_MS).toBeGreaterThanOrEqual(60_000);
  });

  it("fits one provider-call slot, every attempt plus the reserve, inside the action limit", () => {
    const slotBudget = attempts * ANTHROPIC_TIMEOUT_MS + RESERVED_NON_REQUEST_MS;
    expect(slotBudget).toBeLessThan(CONVEX_ACTION_LIMIT_MS);
    // A single hung attempt can never consume the whole action either.
    expect(ANTHROPIC_TIMEOUT_MS).toBeLessThan(CONVEX_ACTION_LIMIT_MS);
  });

  /**
   * CAP-6 deviation: chain requires workflow split.
   *
   * The spec's target configuration assumed generateCandidate makes ONE
   * sequential provider call (assumption A-2). Planning verified against
   * pipeline.ts that it makes FIVE in sequence (analyzer, section drafts, two
   * compression passes, QA + chronology). Fitting all five inside the action
   * limit would need a per-attempt timeout near 54 s, below the real duration
   * of the analyzer call on a large transcript, so the timeout was not
   * lowered that far. The full chain therefore still exceeds the action limit
   * and is bounded today only by the 30-minute stale-generation reaper
   * (convex/crons.ts: failStaleGenerations), not by the provider budget.
   *
   * This test pins that gap numerically rather than hiding it. When the chain
   * is split into workflow steps that each own an action budget, the
   * sequential-call constant drops and this assertion flips; delete it then
   * and replace it with the full-chain inequality
   *   calls * (maxRetries + 1) * timeoutMs + reservedNonRequestMs < actionLimitMs.
   */
  it("records the known deviation: the full generateCandidate chain still exceeds the action limit (CAP-6 deviation: chain requires workflow split)", () => {
    const chainWorstCaseMs =
      SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE * attempts * ANTHROPIC_TIMEOUT_MS;
    // Five slots today; the derivation lives next to the constant.
    expect(SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE).toBe(5);
    expect(chainWorstCaseMs).toBeGreaterThan(CONVEX_ACTION_LIMIT_MS);
    expect(chainWorstCaseMs + RESERVED_NON_REQUEST_MS).toBeGreaterThan(
      CONVEX_ACTION_LIMIT_MS
    );
  });
});

describe("createAnthropicClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("constructs the client with the pinned retry count and timeout", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const client = createAnthropicClient("generation");
    expect(client.maxRetries).toBe(ANTHROPIC_MAX_RETRIES);
    expect(client.timeout).toBe(ANTHROPIC_TIMEOUT_MS);
  });
});
