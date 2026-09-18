import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
import {
  createAnthropicClient,
  normalizeProviderError,
  ANTHROPIC_MAX_RETRIES,
  ANTHROPIC_TIMEOUT_MS,
  SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE,
  RESERVED_NON_REQUEST_MS,
  CONVEX_ACTION_LIMIT_MS,
  seedClientForModel,
  SEED_PROVIDER_MAX_RETRIES,
  SEED_PROVIDER_TIMEOUT_MS,
} from "./providers";
import { ORDERED_SECTION_ACTION_SLOTS } from "./providers";
import { COMPRESSION_REQUEST } from "./promptDefinitions";

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

  it("supports the seed-only timeout and zero-retry policy without changing defaults", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const seed = createAnthropicClient("generation", {
      maxRetries: SEED_PROVIDER_MAX_RETRIES,
      timeout: SEED_PROVIDER_TIMEOUT_MS,
    });
    const ordinary = createAnthropicClient("generation");
    expect(seed.maxRetries).toBe(0);
    expect(seed.timeout).toBe(90_000);
    expect(ordinary.maxRetries).toBe(ANTHROPIC_MAX_RETRIES);
    expect(ordinary.timeout).toBe(ANTHROPIC_TIMEOUT_MS);
  });
});

function providerTestContext(): ActionCtx {
  return {
    scheduler: { runAfter: vi.fn(async () => {}) },
    runMutation: vi.fn(async () => {}),
  } as unknown as ActionCtx;
}

const seedRequest = {
  model: "claude-opus-4-8",
  max_tokens: 1200,
  system: "Seed policy.",
  messages: [{ role: "user" as const, content: "Frozen seed context." }],
};

describe("seed provider HTTP policy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("crosses the direct Anthropic request boundary once on a retryable response", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ type: "error", error: { message: "busy" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = seedClientForModel(providerTestContext(), "claude-opus-4-8", {
      callSite: "generation:seeds:company_context",
    });

    await expect(client.messages.create(seedRequest)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("crosses the OpenRouter request boundary with 90 seconds and no transport retry", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    const timeoutSignal = new AbortController().signal;
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeoutSignal);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "busy" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = seedClientForModel(
      providerTestContext(),
      "openai/gpt-5.6-luna",
      { callSite: "generation:seedFeedback:company_context" }
    );

    await expect(
      client.messages.create({ ...seedRequest, model: "openai/gpt-5.6-luna" })
    ).rejects.toThrow(/status 500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(SEED_PROVIDER_TIMEOUT_MS);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      model: "openai/gpt-5.6-luna",
      max_tokens: 1200,
    });
  });
});

// Story 2 (AD-24): single/compare sections run as separate scheduled actions;
// each one's worst case must stay inside the same five-slot bound, and the
// per-slot budget arithmetic above is unchanged by the split.
describe("ordered section action budget (AD-24/AD-27)", () => {
  it("worst case is one draft + the compression squeezes + one Self-check + one repair", () => {
    expect(ORDERED_SECTION_ACTION_SLOTS).toEqual({
      section: 1,
      compression: COMPRESSION_REQUEST.squeezes.length,
      selfCheck: 1,
      repair: 1,
    });
    const worstCase =
      ORDERED_SECTION_ACTION_SLOTS.section +
      ORDERED_SECTION_ACTION_SLOTS.compression +
      ORDERED_SECTION_ACTION_SLOTS.selfCheck +
      ORDERED_SECTION_ACTION_SLOTS.repair;
    expect(worstCase).toBe(1 + COMPRESSION_REQUEST.squeezes.length + 1 + 1);
    expect(worstCase).toBe(SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE);
  });

  it("keeps the per-action slot arithmetic: one slot, every attempt plus the reserve, fits the action", () => {
    const attempts = ANTHROPIC_MAX_RETRIES + 1;
    expect(attempts * ANTHROPIC_TIMEOUT_MS + RESERVED_NON_REQUEST_MS).toBeLessThan(
      CONVEX_ACTION_LIMIT_MS
    );
  });
});
