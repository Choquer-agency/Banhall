import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAnthropicClient,
  normalizeProviderError,
  ANTHROPIC_MAX_RETRIES,
  ANTHROPIC_TIMEOUT_MS,
} from "./providers";

// Convex kills an action after 10 minutes; every budget below is measured
// against this single figure.
const CONVEX_ACTION_LIMIT_MS = 10 * 60 * 1000;

describe("normalizeProviderError", () => {
  it("keeps bounded raw text for an unclassified provider failure", () => {
    const result = normalizeProviderError(new Error("upstream overloaded unexpectedly"));
    expect(result.code).toBe("unknown");
    expect(result.message).toContain("upstream overloaded unexpectedly");
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
    // Literal values are the acceptance criteria for CAP-6; a silent retune
    // of either constant must fail here as well as in the budget test.
    expect(client.maxRetries).toBe(1);
    expect(client.timeout).toBe(240_000);
  });

  it("keeps the whole retry budget (attempts x timeout) under the Convex action limit", () => {
    // The SDK makes (maxRetries + 1) attempts, each bounded by the timeout.
    const worstCaseMs = ANTHROPIC_TIMEOUT_MS * (ANTHROPIC_MAX_RETRIES + 1);
    expect(worstCaseMs).toBeLessThan(CONVEX_ACTION_LIMIT_MS);
  });
});
