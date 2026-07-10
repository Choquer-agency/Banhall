"use node";

import Anthropic from "@anthropic-ai/sdk";
import {
  requireAnthropicConfigured,
  type AnthropicCapability,
} from "../lib/providerConfig";


export function createAnthropicClient(
  capability: AnthropicCapability
): Anthropic {
  return new Anthropic({ apiKey: requireAnthropicConfigured(capability) });
}

/** Exact billed token count returned by Voyage embedding/rerank responses. */
export function voyageTokenCount(responseBody: unknown): number | null {
  if (
    !responseBody ||
    typeof responseBody !== "object" ||
    !("usage" in responseBody)
  ) {
    return null;
  }
  const usage = responseBody.usage;
  if (!usage || typeof usage !== "object" || !("total_tokens" in usage)) {
    return null;
  }
  const tokens = usage.total_tokens;
  return typeof tokens === "number" &&
    Number.isFinite(tokens) &&
    tokens >= 0
    ? tokens
    : null;
}

export function normalizeProviderError(error: unknown): {
  code: "billing" | "rate_limited" | "authentication" | "model_access" | "network" | "unknown";
  message: string;
} {
  let status: number | undefined;
  let rawMessage = "";
  if (error instanceof Error) rawMessage = error.message;
  if (error && typeof error === "object" && "status" in error) {
    status = typeof error.status === "number" ? error.status : undefined;
  }
  const message = rawMessage.toLowerCase();
  if (message.includes("credit balance") || message.includes("billing")) {
    return {
      code: "billing",
      message: "The Anthropic account cannot accept this request because billing or credits need attention.",
    };
  }
  if (status === 429 || message.includes("rate limit")) {
    return {
      code: "rate_limited",
      message: "The AI provider is rate-limiting requests. Try again after the limit resets.",
    };
  }
  if (status === 401 || message.includes("api key") || message.includes("authentication")) {
    return {
      code: "authentication",
      message: "The AI provider credentials were rejected by the provider.",
    };
  }
  if (status === 403 || message.includes("model") && message.includes("access")) {
    return {
      code: "model_access",
      message: "The configured account does not have access to a required model.",
    };
  }
  if (message.includes("network") || message.includes("fetch")) {
    return {
      code: "network",
      message: "The AI provider could not be reached from this deployment.",
    };
  }
  return {
    code: "unknown",
    message: "The AI provider rejected the request. An administrator should inspect provider status.",
  };
}
