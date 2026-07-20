import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient } from "./providers";
import type { AnthropicCapability } from "../lib/providerConfig";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

export type UsageEvent = {
  projectId?: Id<"projects">;
  userId?: string;
  agentThreadId?: string;
  brainSourceId?: Id<"brainSources">;
  callSite: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  /** Provider-reported exact cost (OpenRouter). Anthropic path never sets it. */
  costUsd?: number;
  createdAt?: number;
};

/**
 * Queue usage as a scheduled mutation so a successful provider response is
 * never turned into an application failure. Scheduled mutations are durable;
 * the direct mutation is only a fallback if the scheduling call itself fails.
 */
export async function scheduleUsage(
  ctx: ActionCtx,
  event: UsageEvent
): Promise<void> {
  const usage = {
    ...event,
    createdAt: event.createdAt ?? Date.now(),
  };
  try {
    await ctx.scheduler.runAfter(0, internal.aiUsage.logUsage, usage);
  } catch (scheduleError) {
    try {
      await ctx.runMutation(internal.aiUsage.logUsage, usage);
    } catch (mutationError) {
      console.error("aiUsage logging could not be scheduled or written", {
        scheduleError,
        mutationError,
      });
    }
  }
}

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function anthropicUsage(response: unknown): {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
} | null {
  if (!response || typeof response !== "object" || !("usage" in response)) {
    return null;
  }
  const usage = response.usage;
  if (!usage || typeof usage !== "object") return null;
  return {
    inputTokens:
      "input_tokens" in usage ? tokenCount(usage.input_tokens) : 0,
    outputTokens:
      "output_tokens" in usage ? tokenCount(usage.output_tokens) : 0,
    cacheCreationInputTokens:
      "cache_creation_input_tokens" in usage
        ? tokenCount(usage.cache_creation_input_tokens)
        : 0,
    cacheReadInputTokens:
      "cache_read_input_tokens" in usage
        ? tokenCount(usage.cache_read_input_tokens)
        : 0,
  };
}

/** Anthropic client that durably records billed usage after every response. */
export function instrumentedAnthropic(
  ctx: ActionCtx,
  meta: {
    callSite: string;
    projectId?: Id<"projects">;
    userId?: string;
    brainSourceId?: Id<"brainSources">;
    capability?: AnthropicCapability;
  }
): Anthropic {
  const client = createAnthropicClient(meta.capability ?? "generation");
  const messages = client.messages;
  const originalCreate = messages.create.bind(messages);
  const instrumentedMessages = new Proxy(messages, {
    get(target, property, receiver) {
      if (property !== "create") return Reflect.get(target, property, receiver);
      return async (...args: unknown[]) => {
        const response: unknown = await Reflect.apply(
          originalCreate,
          target,
          args
        );
        const usage = anthropicUsage(response);
        const params = args[0];
        const model =
          params &&
          typeof params === "object" &&
          "model" in params &&
          typeof params.model === "string"
            ? params.model
            : "unknown";
        if (usage) {
          await scheduleUsage(ctx, {
            ...(meta.projectId ? { projectId: meta.projectId } : {}),
            ...(meta.userId ? { userId: meta.userId } : {}),
            ...(meta.brainSourceId
              ? { brainSourceId: meta.brainSourceId }
              : {}),
            callSite: meta.callSite,
            model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            ...(usage.cacheCreationInputTokens
              ? {
                  cacheCreationInputTokens:
                    usage.cacheCreationInputTokens,
                }
              : {}),
            ...(usage.cacheReadInputTokens
              ? { cacheReadInputTokens: usage.cacheReadInputTokens }
              : {}),
          });
        }
        return response;
      };
    },
  });
  Object.defineProperty(client, "messages", { value: instrumentedMessages });
  return client;
}
