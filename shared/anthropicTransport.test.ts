import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/openrouter-models-2026-09-24.json";
import {
  OPENROUTER_ANTHROPIC_PROVIDER,
  OPENROUTER_ANTHROPIC_REQUEST_IDS,
  isOpenRouterError,
  isOpenRouterInFlightBudget,
  markOpenRouterError,
  openRouterAnthropicBody,
  openRouterAnthropicCharge,
  openRouterAnthropicRequestId,
  parseAnthropicTransport,
} from "./anthropicTransport";
import { CANDIDATE_MODELS } from "./generationModels";

const catalogIds = new Set((fixture as { data: Array<{ id: string }> }).data.map((model) => model.id));

describe("parseAnthropicTransport", () => {
  it("defaults to direct when unset or blank", () => {
    expect(parseAnthropicTransport(undefined)).toBe("direct");
    expect(parseAnthropicTransport("")).toBe("direct");
    expect(parseAnthropicTransport("  ")).toBe("direct");
  });

  it("reads the two values, ignoring case and surrounding space", () => {
    expect(parseAnthropicTransport("direct")).toBe("direct");
    expect(parseAnthropicTransport("openrouter")).toBe("openrouter");
    expect(parseAnthropicTransport(" OpenRouter ")).toBe("openrouter");
  });

  it("refuses anything else instead of guessing a route", () => {
    expect(parseAnthropicTransport("open-router")).toBeNull();
    expect(parseAnthropicTransport("anthropic")).toBeNull();
    expect(parseAnthropicTransport("true")).toBeNull();
  });
});

describe("OpenRouter model ids", () => {
  it("maps every Anthropic-gateway seed model to an id in OpenRouter's catalog", () => {
    const anthropicSeeds = CANDIDATE_MODELS.filter((model) => model.gateway === "anthropic").map((model) => model.id);
    expect(anthropicSeeds.length).toBeGreaterThan(0);
    for (const id of anthropicSeeds) {
      const requestId = openRouterAnthropicRequestId(id);
      expect(requestId, id).toBeDefined();
      expect(catalogIds.has(requestId!), `${id} -> ${requestId}`).toBe(true);
    }
  });

  it("maps the older app ids a retried legacy generation may carry to ids OpenRouter lists", () => {
    // Anthropic ids in OpenRouter's public model list (GET /api/v1/models),
    // read 2026-09-25. The 2026-09-24 fixture predates three of them.
    const listed20260925 = new Set([
      "anthropic/claude-opus-5.5", "anthropic/claude-fable-5.1", "anthropic/claude-opus-5",
      "anthropic/claude-sonnet-5", "anthropic/claude-fable-5", "anthropic/claude-opus-4.8",
      "anthropic/claude-opus-4.7", "anthropic/claude-sonnet-4.6", "anthropic/claude-opus-4.6",
      "anthropic/claude-opus-4.5", "anthropic/claude-haiku-4.5", "anthropic/claude-sonnet-4.5",
      "anthropic/claude-opus-4.1", "anthropic/claude-sonnet-4", "anthropic/claude-3-haiku",
    ]);
    const legacy = {
      "claude-fable-5-1": "anthropic/claude-fable-5.1",
      "claude-sonnet-4-6": "anthropic/claude-sonnet-4.6",
      "claude-opus-5": "anthropic/claude-opus-5",
      "claude-haiku-4-5": "anthropic/claude-haiku-4.5",
    };
    for (const [appId, requestId] of Object.entries(legacy)) {
      expect(openRouterAnthropicRequestId(appId), appId).toBe(requestId);
      expect(listed20260925.has(requestId) || catalogIds.has(requestId), requestId).toBe(true);
    }
    // Never mapped: OpenRouter lists no such snapshot, so it fails as configuration.
    expect(openRouterAnthropicRequestId("claude-sonnet-4-20250514")).toBeUndefined();
  });

  it("follows OpenRouter's naming for every mapping: no date suffix, version digits joined by a dot", () => {
    for (const [appId, requestId] of Object.entries(OPENROUTER_ANTHROPIC_REQUEST_IDS)) {
      const expected = `anthropic/${appId.replace(/-\d{8}$/, "").replace(/(\d)-(\d)/g, "$1.$2")}`;
      expect(requestId, appId).toBe(expected);
    }
  });

  it("uses undated anthropic/ ids and never a moving alias", () => {
    for (const requestId of Object.values(OPENROUTER_ANTHROPIC_REQUEST_IDS)) {
      expect(requestId).toMatch(/^anthropic\/claude-[a-z0-9.-]+$/);
      expect(requestId).not.toMatch(/latest|~|:/);
    }
  });

  it("has no id for a model OpenRouter does not list, and ignores prototype keys", () => {
    expect(openRouterAnthropicRequestId("claude-mythos-5-1")).toBeUndefined();
    expect(openRouterAnthropicRequestId("toString")).toBeUndefined();
    expect(openRouterAnthropicRequestId("anthropic/claude-sonnet-5")).toBeUndefined();
  });
});

describe("openRouterAnthropicBody", () => {
  it("changes only the model id and adds the Anthropic-only pin", () => {
    const body = {
      model: "claude-sonnet-5",
      max_tokens: 10,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: [{ type: "text", text: "x", cache_control: { type: "ephemeral", ttl: "1h" } }] }],
    };
    const wire = openRouterAnthropicBody(body);
    expect(wire).toEqual({ ...body, model: "anthropic/claude-sonnet-5", provider: { only: ["anthropic"], allow_fallbacks: false } });
    // The model keeps its position; the pin is the only new key, last.
    expect(Object.keys(wire!)).toEqual([...Object.keys(body), "provider"]);
    expect(body.model).toBe("claude-sonnet-5");
  });

  it("returns null for an unmapped or missing model", () => {
    expect(openRouterAnthropicBody({ model: "claude-mythos-5-1" })).toBeNull();
    expect(openRouterAnthropicBody({})).toBeNull();
  });

  it("pins first-party Anthropic with fallbacks off and never asks for ZDR routing", () => {
    expect(OPENROUTER_ANTHROPIC_PROVIDER).toEqual({ only: ["anthropic"], allow_fallbacks: false });
    expect(OPENROUTER_ANTHROPIC_PROVIDER).not.toHaveProperty("zdr");
    expect(OPENROUTER_ANTHROPIC_PROVIDER).not.toHaveProperty("order");
  });
});

describe("openRouterAnthropicCharge", () => {
  it("reads the exact credit charge and the serving provider", () => {
    expect(openRouterAnthropicCharge({ provider: "Anthropic", usage: { cost: 0.0123, is_byok: false } })).toEqual({
      costUsd: 0.0123,
      servedProvider: "Anthropic",
    });
  });

  it("adds the upstream charge to the fee for a BYOK answer", () => {
    expect(
      openRouterAnthropicCharge({ usage: { cost: 0.001, is_byok: true, cost_details: { upstream_inference_cost: 0.02 } } })
    ).toEqual({ costUsd: 0.021 });
  });

  it("reports no native cost when BYOK lacks the upstream figure, or cost is missing or invalid", () => {
    expect(openRouterAnthropicCharge({ usage: { cost: 0, is_byok: true } })).toEqual({});
    expect(openRouterAnthropicCharge({ usage: { input_tokens: 1 } })).toEqual({});
    expect(openRouterAnthropicCharge({ usage: { cost: -1 } })).toEqual({});
    expect(openRouterAnthropicCharge({ usage: { cost: "0.1" } })).toEqual({});
    expect(openRouterAnthropicCharge(null)).toEqual({});
  });

  it("keeps a zero charge", () => {
    expect(openRouterAnthropicCharge({ usage: { cost: 0 } })).toEqual({ costUsd: 0 });
  });
});

describe("markOpenRouterError", () => {
  it("marks the same error object and ignores primitives", () => {
    const error = new Error("x");
    expect(markOpenRouterError(error)).toBe(error);
    expect(isOpenRouterError(error)).toBe(true);
    expect(isOpenRouterError(new Error("y"))).toBe(false);
    expect(markOpenRouterError("text")).toBe("text");
    expect(isOpenRouterError("text")).toBe(false);
  });
});

describe("isOpenRouterInFlightBudget", () => {
  const withHeaders = (values: Record<string, string>) => new Headers(values);
  const messagesEnvelope = (message: string, extra: Record<string, unknown> = {}) => ({
    type: "error",
    error: { type: "billing_error", message, error_type: "payment_required" },
    request_id: null,
    ...extra,
  });

  it("recognises a 402 with Retry-After, whatever the body says", () => {
    expect(isOpenRouterInFlightBudget({
      status: 402,
      headers: withHeaders({ "retry-after": "3" }),
      error: messagesEnvelope("Payment required"),
    })).toBe(true);
  });

  it("recognises the documented message in the Messages envelope without the header", () => {
    expect(isOpenRouterInFlightBudget({
      status: 402,
      headers: withHeaders({}),
      error: messagesEnvelope("This request would exceed your available credits given your current in-flight requests."),
    })).toBe(true);
  });

  it("recognises the chat-completions limit_source", () => {
    expect(isOpenRouterInFlightBudget({
      status: 402,
      error: { error: { code: 402, message: "Payment required", metadata: { limit_source: "openrouter_in_flight_budget" } } },
    })).toBe(true);
  });

  it("never treats one request larger than the whole budget, or plain lack of credits, as temporary", () => {
    expect(isOpenRouterInFlightBudget({
      status: 402,
      headers: withHeaders({ "retry-after": "3" }),
      error: messagesEnvelope("Exceeds your in-flight budget", { metadata: { reason: "weight_exceeds_budget" } }),
    })).toBe(false);
    expect(isOpenRouterInFlightBudget({
      status: 402,
      error: { error: { code: 402, message: "in-flight", metadata: { limit_source: "openrouter_credits" } } },
    })).toBe(false);
    expect(isOpenRouterInFlightBudget({ status: 402, headers: withHeaders({}), error: messagesEnvelope("Insufficient credits") })).toBe(false);
  });

  it("is false for any other status or value", () => {
    expect(isOpenRouterInFlightBudget({ status: 429, headers: withHeaders({ "retry-after": "3" }) })).toBe(false);
    expect(isOpenRouterInFlightBudget(null)).toBe(false);
    expect(isOpenRouterInFlightBudget("402 in-flight")).toBe(false);
  });
});
