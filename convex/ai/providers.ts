"use node";

// Multi-provider routing (Jul 20): Anthropic models call the direct SDK
// (native prompt caching + existing instrumentation); OpenAI/Google models
// route through OpenRouter (convex/ai/openrouter.ts). Both gateways log into
// the same aiUsage table. clientForModel below is the single routing point —
// candidate-path call sites pick their client through it; auxiliary call
// sites (brain, learning, financial, review) stay on instrumentedAnthropic.

import Anthropic from "@anthropic-ai/sdk";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  requireAnthropicConfigured,
  type AnthropicCapability,
} from "../lib/providerConfig";
import { gatewayForModel } from "../../shared/generationModels";
import { instrumentedAnthropic } from "./instrument";
import { instrumentedOpenRouter } from "./openrouter";
import type { GenerationClient } from "./openrouterCore";


export function createAnthropicClient(
  capability: AnthropicCapability
): Anthropic {
  return new Anthropic({ apiKey: requireAnthropicConfigured(capability) });
}

/**
 * The client for a candidate model, routed by its gateway. Anthropic's SDK
 * client satisfies GenerationClient structurally, so agents typed against it
 * accept both.
 */
export function clientForModel(
  ctx: ActionCtx,
  modelId: string,
  meta: {
    callSite: string;
    projectId?: Id<"projects">;
    userId?: string;
  }
): GenerationClient {
  if (gatewayForModel(modelId) === "openrouter") {
    return instrumentedOpenRouter(ctx, meta);
  }
  // Anthropic's response is a superset of GenerationResponse (extra block
  // variants like thinking) — safe to narrow: agents only read text/tool_use.
  return instrumentedAnthropic(ctx, {
    ...meta,
    capability: "generation",
  }) as unknown as GenerationClient;
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
  // 402 = OpenRouter insufficient credits; message checks cover both gateways.
  if (
    status === 402 ||
    message.includes("credit balance") ||
    message.includes("insufficient credits") ||
    message.includes("billing")
  ) {
    return {
      code: "billing",
      message: "The AI provider account cannot accept this request because billing or credits need attention.",
    };
  }
  if (message.includes("moderation") || message.includes("flagged")) {
    return {
      code: "model_access",
      message: "The AI provider declined this request (content moderation). Try again or use a different model.",
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
