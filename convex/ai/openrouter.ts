"use node";

/**
 * OpenRouter gateway client for the non-Anthropic generation models (OpenAI,
 * Google). Pure request/response conversion lives in openrouterCore.ts (unit
 * tested); this file adds the fetch transport, error shaping, and usage
 * instrumentation.
 *
 * Usage guarantee (Jul 20): every OpenRouter response logs into the same
 * aiUsage table via the same scheduleUsage → logUsage path as Anthropic calls,
 * with OpenRouter's native usage.cost preferred over the PRICING estimate.
 */
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireOpenRouterConfigured } from "../lib/providerConfig";
import { scheduleUsage } from "./instrument";
import {
  toChatCompletions,
  fromChatCompletions,
  openRouterUsage,
  type ChatCompletionsResponse,
  type GenerationClient,
} from "./openrouterCore";

export type { GenerationClient } from "./openrouterCore";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Error shaped like the Anthropic SDK's (status + message) so
 *  normalizeProviderError classifies both gateways the same way. */
export class OpenRouterError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
  }
}

/**
 * Single OpenRouter transport: auth headers, error shaping, and the usage
 * guarantee, for ANY prebuilt chat-completions body. Callers that speak the
 * Anthropic request shape should use instrumentedOpenRouter instead; callers
 * with gateway-specific bodies (e.g. Contextual Research's web-search tools)
 * build the body themselves and post it here.
 */
export async function openRouterChatCompletion(
  ctx: ActionCtx,
  input: {
    body: Record<string, unknown>;
    /** Model for the usage row (the body's `model` field, passed explicitly). */
    model: string;
    callSite: string;
    projectId?: Id<"projects">;
    userId?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
  }
): Promise<ChatCompletionsResponse> {
  const apiKey = requireOpenRouterConfigured();
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://banhall.app",
      "X-Title": "Banhall",
      ...(input.headers ?? {}),
    },
    body: JSON.stringify(input.body),
    ...(input.timeoutMs ? { signal: AbortSignal.timeout(input.timeoutMs) } : {}),
  });
  const raw: unknown = await response.json().catch(() => null);
  const body = (raw ?? {}) as ChatCompletionsResponse;
  if (!response.ok) {
    throw new OpenRouterError(
      body.error?.message ??
        `OpenRouter request failed with status ${response.status}`,
      response.status
    );
  }
  // Mirrors instrumentedAnthropic: a successful response is never turned into
  // an app failure by usage logging.
  const usage = openRouterUsage(body);
  await scheduleUsage(ctx, {
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.userId ? { userId: input.userId } : {}),
    callSite: input.callSite,
    model: input.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
  });
  return body;
}

export function instrumentedOpenRouter(
  ctx: ActionCtx,
  meta: {
    callSite: string;
    projectId?: Id<"projects">;
    userId?: string;
  }
): GenerationClient {
  return {
    messages: {
      create: async (params) => {
        const body = await openRouterChatCompletion(ctx, {
          body: toChatCompletions(params),
          model: params.model,
          ...meta,
        });
        return fromChatCompletions(body);
      },
    },
  };
}
