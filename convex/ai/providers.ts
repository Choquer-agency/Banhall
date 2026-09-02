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


// ─── Provider time budget (CAP-6) ────────────────────────────────────────────
// Pinned explicitly rather than trusting SDK defaults: the SDK's default
// 10-minute timeout equals the Convex action limit, so a hung call would
// consume the entire action budget. providers.test.ts proves the budget
// arithmetic over these exact exports; change them together.

/** Convex terminates an action after 10 minutes of wall time. */
export const CONVEX_ACTION_LIMIT_MS = 600_000;

/**
 * One retry (two attempts total). Between attempts the SDK sleeps for its own
 * backoff (0.5 s on the first retry, doubling to an 8 s cap, with jitter) or
 * for whatever a provider Retry-After header asks; that sleep is charged to
 * RESERVED_NON_REQUEST_MS, never to the timeout.
 */
export const ANTHROPIC_MAX_RETRIES = 1;

/**
 * Per-attempt timeout. Sized so ONE provider-call slot fits the action limit
 * together with the reserve: (1 + 1) * 240 s + 60 s = 540 s < 600 s.
 *
 * It is deliberately NOT sized for the whole generateCandidate chain (see
 * SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE). Fitting 5 slots x 2 attempts in
 * 10 minutes would need about 54 s per attempt, which is below the real
 * duration of the analyzer call on a large transcript; that would replace a
 * theoretical bound with real timeouts. Until the chain is split into
 * workflow steps, a generation whose chain overruns the action is recovered
 * by the stale-generation reaper (convex/crons.ts: failStaleGenerations,
 * 30 minutes).
 */
export const ANTHROPIC_TIMEOUT_MS = 240_000;

/**
 * Worst-case count of provider calls that run one after another in wall time
 * inside a single generateCandidate action (pipeline.ts, runPipelineForModel).
 * Calls that run in parallel share a slot because their wall time overlaps:
 *   1. analyzer
 *   2. section drafts 242 / 244 / 246 (Promise.all: one slot)
 *   3. compression pass 1 (compressToFit, parallel across sections: one slot)
 *   4. compression pass 2 (the 0.85 squeeze, parallel across sections: one slot)
 *   5. QA scorecard + chronology (Promise.allSettled: one slot)
 * Slots 3 and 4 only run for sections still over the CRA form limit, so the
 * typical chain is shorter; the budget must hold for the worst case.
 */
export const SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE = 5;

/**
 * Named reserve for every part of the action that is not a provider request
 * in flight: SDK retry backoff (at most 8 s per retry by default, more only
 * if the provider sends Retry-After), the claim and frozen-input reads before
 * the first call, banned-word scrubs and section metrics between calls, and
 * claim hashing plus the provenance and candidate writes after the last one.
 * 60 s is the spec floor and is conservative against that work.
 */
export const RESERVED_NON_REQUEST_MS = 60_000;

export function createAnthropicClient(
  capability: AnthropicCapability
): Anthropic {
  return new Anthropic({
    apiKey: requireAnthropicConfigured(capability),
    maxRetries: ANTHROPIC_MAX_RETRIES,
    timeout: ANTHROPIC_TIMEOUT_MS,
  });
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
  code:
    | "billing"
    | "rate_limited"
    | "authentication"
    | "model_access"
    | "output_limit"
    | "network"
    | "unknown";
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
  // Thrown locally by fromChatCompletions, not by the provider: the model hit
  // max_tokens before finishing. Distinct code so it is not mistaken for a
  // provider outage — the fix is budget/model, not provider status.
  if (message.includes("truncated at the max_tokens limit")) {
    return {
      code: "output_limit",
      message: "The model ran out of output budget before finishing this step. Retry, or use a different model for this draft.",
    };
  }
  if (message.includes("network") || message.includes("fetch")) {
    return {
      code: "network",
      message: "The AI provider could not be reached from this deployment.",
    };
  }
  // Unclassified: keep the raw message. Replacing it with generic advice made
  // real failures undiagnosable in the generation progress log.
  return {
    code: "unknown",
    message: rawMessage
      ? `The AI provider rejected the request: ${rawMessage.slice(0, 300)}`
      : "The AI provider rejected the request. An administrator should inspect provider status.",
  };
}
