import { describe, expect, it } from "vitest";
import { modelFaultCode, normalizeProviderError } from "./providers";

// As an action saw it on the F5 stress run (2026-10-27).
const REFUSED = new Error(
  '{"code":"TooManyWrites","message":"Too many writes per second. Your deployment is limited to 4 MiB bytes written per second. Reduce your write rate or upgrade to a larger deployment."}'
);

describe("a write the database refused for its write rate (owner, 2026-10-28)", () => {
  it("is stored as the database's refusal, not the AI provider's", () => {
    const normalized = normalizeProviderError(REFUSED);
    expect(normalized.code).toBe("unknown");
    expect(normalized.message).toMatch(/^The database refused a write for its write rate, not the AI provider: /);
    expect(normalized.message).not.toMatch(/AI provider rejected/);
  });

  it("never counts against the model", () => {
    expect(modelFaultCode(REFUSED)).toBeNull();
    // An unclassified failure still counts, as before.
    expect(modelFaultCode(new Error("something nobody classified"))).toBe("unknown");
  });
});
