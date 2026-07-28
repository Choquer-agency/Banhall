import { describe, expect, it } from "vitest";
import { normalizeProviderError } from "./providers";

describe("normalizeProviderError", () => {
  it("keeps bounded raw text for an unclassified provider failure", () => {
    const result = normalizeProviderError(new Error("upstream overloaded unexpectedly"));
    expect(result.code).toBe("unknown");
    expect(result.message).toContain("upstream overloaded unexpectedly");
  });
});
