import { describe, expect, test } from "vitest";
import {
  CREDIT_LATCH_COOLDOWN_MS,
  CREDIT_PROBE_CLAIM_MS,
  creditRoute,
  isAnthropicCreditAnswer,
  isAnthropicCreditError,
} from "./anthropicCreditFallback";

const envelope = (type: string, message: string, extra: Record<string, unknown> = {}) => ({
  type: "error",
  error: { type, message, ...extra },
  request_id: "req_synthetic",
});

describe("isAnthropicCreditAnswer", () => {
  test("402 billing_error, and a 402 without a readable body, are out of credit", () => {
    expect(isAnthropicCreditAnswer(402, envelope("billing_error", "There's an issue with your billing or payment information."))).toBe(true);
    expect(isAnthropicCreditAnswer(402, null)).toBe(true);
  });

  test("the older 400 empty-balance message is out of credit", () => {
    const body = envelope(
      "invalid_request_error",
      "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."
    );
    expect(isAnthropicCreditAnswer(400, body)).toBe(true);
    // The SDK's message text is used when the body is gone.
    expect(isAnthropicCreditAnswer(400, undefined, "400 Your credit balance is too low to access the Anthropic API.")).toBe(true);
  });

  test.each([
    [429, envelope("rate_limit_error", "Rate limited")],
    [429, envelope("rate_limit_error", "You have reached your API usage limits", { details: { error_code: "enforced_spend_limit_reached" } })],
    [529, envelope("overloaded_error", "Overloaded")],
    [401, envelope("authentication_error", "invalid x-api-key")],
    [403, envelope("permission_error", "No permission")],
    [400, envelope("invalid_request_error", "messages: field required")],
    [400, envelope("invalid_request_error", "You have reached your specified API usage limits.")],
    [402, envelope("rate_limit_error", "Not a billing answer")],
    [500, envelope("api_error", "credit balance is too low")],
  ])("%i %j is not out of credit", (status, body) => {
    expect(isAnthropicCreditAnswer(status, body)).toBe(false);
  });
});

describe("isAnthropicCreditError", () => {
  test("reads the SDK error's status, parsed body and message", () => {
    expect(isAnthropicCreditError({ status: 402, error: envelope("billing_error", "Billing"), message: "402 Billing" })).toBe(true);
    expect(isAnthropicCreditError({ status: 429, error: envelope("rate_limit_error", "Rate"), message: "429 Rate" })).toBe(false);
    expect(isAnthropicCreditError(new Error("Your credit balance is too low"))).toBe(false);
    expect(isAnthropicCreditError(null)).toBe(false);
  });
});

describe("creditRoute", () => {
  const latchedAt = 1_000_000;
  test("no latch goes direct; a fresh latch goes to OpenRouter", () => {
    expect(creditRoute(null, latchedAt)).toBe("direct");
    expect(creditRoute({ latchedAt }, latchedAt + CREDIT_LATCH_COOLDOWN_MS - 1)).toBe("openrouter");
  });

  test("after the cool-down one probe; a claimed probe blocks others until it goes stale", () => {
    const after = latchedAt + CREDIT_LATCH_COOLDOWN_MS;
    expect(creditRoute({ latchedAt }, after)).toBe("probe");
    expect(creditRoute({ latchedAt, probeStartedAt: after }, after + 1)).toBe("openrouter");
    expect(creditRoute({ latchedAt, probeStartedAt: after }, after + CREDIT_PROBE_CLAIM_MS)).toBe("probe");
  });
});
