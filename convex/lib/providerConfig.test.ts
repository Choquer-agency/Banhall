import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  anthropicConfiguration,
  anthropicTransport,
  anthropicTransportIsDirect,
  requireAnthropicClientConfig,
  requireAnthropicConfigured,
} from "./providerConfig";

afterEach(() => {
  vi.unstubAllEnvs();
});

function keys(values: { anthropic?: string; openrouter?: string; dedicated?: string; transport?: string }) {
  vi.stubEnv("ANTHROPIC_API_KEY", values.anthropic ?? "");
  vi.stubEnv("OPENROUTER_API_KEY", values.openrouter ?? "");
  vi.stubEnv("OPENROUTER_ANTHROPIC_API_KEY", values.dedicated ?? "");
  vi.stubEnv("ANTHROPIC_TRANSPORT", values.transport ?? "");
}

function configError(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexError);
    const data = (error as ConvexError<{ code: string; message: string }>).data;
    expect(data.code).toBe("PROVIDER_NOT_CONFIGURED");
    return data.message;
  }
  throw new Error("expected a configuration error");
}

describe("direct transport (unset or \"direct\")", () => {
  it.each(["", "direct"])("uses ANTHROPIC_API_KEY exactly as before (ANTHROPIC_TRANSPORT=%j)", (transport) => {
    keys({ anthropic: "direct-key", openrouter: "or-key", transport });
    expect(anthropicTransport()).toBe("direct");
    expect(anthropicTransportIsDirect()).toBe(true);
    expect(requireAnthropicClientConfig("generation")).toEqual({ transport: "direct", apiKey: "direct-key" });
    expect(requireAnthropicConfigured("generation")).toBe("direct-key");
    expect(requireAnthropicConfigured("chat")).toBe("direct-key");
    expect(anthropicConfiguration()).toEqual({
      state: "configured",
      message: "Configured; billing, quota, network access, and model entitlement are verified only by a live request.",
    });
  });

  it("keeps the old message and failure without ANTHROPIC_API_KEY, even with an OpenRouter key", () => {
    keys({ openrouter: "or-key" });
    expect(configError(() => requireAnthropicConfigured("generation"))).toBe("Anthropic is not configured for generation");
    expect(anthropicConfiguration()).toEqual({
      state: "unconfigured",
      message: "Anthropic is not configured for this deployment.",
    });
  });
});

describe("openrouter transport", () => {
  it("sends the OpenRouter key and never needs ANTHROPIC_API_KEY for generation, review or financial", () => {
    keys({ openrouter: "or-key", transport: "openrouter" });
    expect(anthropicTransportIsDirect()).toBe(false);
    for (const capability of ["generation", "review", "financial"] as const) {
      expect(requireAnthropicClientConfig(capability)).toEqual({ transport: "openrouter", authToken: "or-key" });
      expect(requireAnthropicConfigured(capability)).toBe("or-key");
    }
    expect(anthropicConfiguration().state).toBe("configured");
  });

  it("prefers the dedicated key", () => {
    keys({ openrouter: "or-key", dedicated: "dedicated-key", transport: "openrouter" });
    expect(requireAnthropicClientConfig("generation")).toEqual({ transport: "openrouter", authToken: "dedicated-key" });
  });

  it("marks Anthropic models unavailable and stops reservation without an OpenRouter key", () => {
    keys({ anthropic: "direct-key", transport: "openrouter" });
    expect(anthropicConfiguration()).toMatchObject({ state: "unconfigured" });
    expect(anthropicConfiguration().message).toContain("OPENROUTER_API_KEY");
    expect(configError(() => requireAnthropicConfigured("generation"))).toContain("OpenRouter is not configured for generation");
  });

  it("keeps chat on the direct key: chat needs ANTHROPIC_API_KEY as well as the OpenRouter key", () => {
    keys({ openrouter: "or-key", transport: "openrouter" });
    expect(anthropicConfiguration("chat")).toMatchObject({ state: "unconfigured" });
    expect(configError(() => requireAnthropicConfigured("chat"))).toContain("calls Anthropic directly");
    keys({ anthropic: "direct-key", openrouter: "or-key", transport: "openrouter" });
    expect(anthropicConfiguration("chat").state).toBe("configured");
    expect(requireAnthropicConfigured("chat")).toBe("direct-key");
  });
});

describe("an unknown transport value", () => {
  it("is a configuration error, never a guess", () => {
    keys({ anthropic: "direct-key", openrouter: "or-key", transport: "open-router" });
    expect(anthropicTransportIsDirect()).toBe(false);
    expect(configError(() => anthropicTransport())).toContain("ANTHROPIC_TRANSPORT must be");
    expect(configError(() => requireAnthropicConfigured("generation"))).toContain("ANTHROPIC_TRANSPORT must be");
    expect(anthropicConfiguration()).toMatchObject({ state: "unconfigured" });
  });
});
