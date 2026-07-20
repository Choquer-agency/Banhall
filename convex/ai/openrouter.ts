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
class OpenRouterError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export function instrumentedOpenRouter(
  ctx: ActionCtx,
  meta: {
    callSite: string;
    projectId?: Id<"projects">;
    userId?: string;
  }
): GenerationClient {
  const apiKey = requireOpenRouterConfigured();
  return {
    messages: {
      create: async (params) => {
        const response = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://banhall.app",
            "X-Title": "Banhall",
          },
          body: JSON.stringify(toChatCompletions(params)),
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
        // Mirrors instrumentedAnthropic: a successful response is never
        // turned into an app failure by usage logging.
        const usage = openRouterUsage(body);
        await scheduleUsage(ctx, {
          ...(meta.projectId ? { projectId: meta.projectId } : {}),
          ...(meta.userId ? { userId: meta.userId } : {}),
          callSite: meta.callSite,
          model: params.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadInputTokens: usage.cacheReadInputTokens,
          ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
        });
        return fromChatCompletions(body);
      },
    },
  };
}
