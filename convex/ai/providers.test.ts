import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAnthropicClient,
  normalizeProviderError,
  ANTHROPIC_MAX_RETRIES,
  ANTHROPIC_TIMEOUT_MS,
} from "./providers";

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

  it("pins retry count and a timeout below the Convex action limit", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const client = createAnthropicClient("generation");
    expect(client.maxRetries).toBe(ANTHROPIC_MAX_RETRIES);
    expect(client.timeout).toBe(ANTHROPIC_TIMEOUT_MS);
    // The action budget is 10 minutes; a hung call must fail inside it.
    expect(ANTHROPIC_TIMEOUT_MS).toBeLessThan(10 * 60 * 1000);
  });
});
