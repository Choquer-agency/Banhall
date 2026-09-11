import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient } from "./providers";
import type { AnthropicCapability } from "../lib/providerConfig";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

export type UsageEvent = {
  projectId?: Id<"projects">;
  generationId?: Id<"generations">;
  candidateRunId?: Id<"generationCandidateRuns">;
  durationMs?: number;
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

/** Attribution carried only by provider calls owned by a generation. */
export type GenerationAttribution = {
  generationId: Id<"generations">;
  /** Present only for calls made by a generationCandidateRuns row. */
  candidateRunId?: Id<"generationCandidateRuns">;
  /** Exact nonblank learned-digest content included in this call's payload. */
  learningDigestIds?: Id<"learningDigests">[];
};

// ─── AD-27: named generation call slots ─────────────────────────────────────

/**
 * Every label a generation-owned provider call may carry, after the
 * `generation:` prefix. Fixed slots run once per generation or candidate;
 * per-section slots carry the T661 line. Any other `generation:*` label is a
 * programming error (assertGenerationCallSite).
 */
export const GENERATION_CALL_SLOTS = [
  "analyzer",
  "retrieval_brief",
  "condense",
  "brief",
  "consistency",
  "qa",
  "chronology",
  "post_qa",
  "post_chronology",
  "section:242",
  "section:244",
  "section:246",
  "selfCheck:242",
  "selfCheck:244",
  "selfCheck:246",
  "repair:242",
  "repair:244",
  "repair:246",
  "compression:242",
  "compression:244",
  "compression:246",
] as const;
export type GenerationCallSlot = (typeof GENERATION_CALL_SLOTS)[number];

const GENERATION_PREFIX = "generation:";
const SLOT_SET: ReadonlySet<string> = new Set(GENERATION_CALL_SLOTS);

/**
 * Per-candidate allowance by slot family (AD-27). Slots without an entry are
 * unbounded here. Recorded, never enforced: `summarizeSlotUsage` flags an
 * overrun; nothing refuses a call (Q12).
 */
export const GENERATION_SLOT_ALLOWANCES: Readonly<Record<string, number>> = {
  brief: 1,
  consistency: 1,
  section: 1,
  selfCheck: 1,
  repair: 1,
  compression: 2,
};

/** Throws on a `generation:*` label that is not a declared slot. */
export function assertGenerationCallSite(callSite: string): void {
  if (!callSite.startsWith(GENERATION_PREFIX)) return;
  const slot = callSite.slice(GENERATION_PREFIX.length);
  if (!SLOT_SET.has(slot)) {
    throw new Error(`Unknown generation call slot: ${callSite}`);
  }
}

/** The slot a label names (text after the first colon), or null. */
export function generationSlotOf(label: string): string | null {
  const slot = label.startsWith(GENERATION_PREFIX)
    ? label.slice(GENERATION_PREFIX.length)
    : label;
  return SLOT_SET.has(slot) ? slot : null;
}

/**
 * Per-slot call counts plus every slot over its allowance. Accepts labels
 * with or without the `generation:` prefix; unknown labels are counted under
 * their own key and never flagged. Pure.
 */
export function summarizeSlotUsage(counts: Readonly<Record<string, number>>): {
  counts: Record<string, number>;
  overrun: string[];
} {
  const merged: Record<string, number> = {};
  for (const [label, count] of Object.entries(counts)) {
    if (!Number.isFinite(count) || count <= 0) continue;
    const slot = generationSlotOf(label) ?? label;
    merged[slot] = (merged[slot] ?? 0) + count;
  }
  const overrun = Object.keys(merged)
    .filter((slot) => {
      const allowance = GENERATION_SLOT_ALLOWANCES[slot.split(":")[0]];
      return allowance !== undefined && merged[slot] > allowance;
    })
    .sort();
  return { counts: merged, overrun };
}

/** Sum per-slot count maps (section rows plus the finalize action's own). */
export function mergeSlotCounts(
  ...maps: ReadonlyArray<Readonly<Record<string, number>>>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const map of maps) {
    for (const [slot, count] of Object.entries(map)) {
      if (Number.isFinite(count) && count > 0) out[slot] = (out[slot] ?? 0) + count;
    }
  }
  return out;
}

export type ProviderCallMeta = {
  callSite: string;
  projectId?: Id<"projects">;
  userId?: string;
  attribution?: GenerationAttribution;
};

/**
 * Last application boundary before a generation-owned payload reaches a
 * provider. This must be awaited: provenance is part of the handoff contract,
 * not best-effort telemetry.
 */
export async function recordGenerationHandoff(
  ctx: ActionCtx,
  attribution: GenerationAttribution | undefined
): Promise<void> {
  if (!attribution?.learningDigestIds?.length) return;
  await ctx.runMutation(internal.generations.unionLearningDigestIds, {
    generationId: attribution.generationId,
    digestIds: attribution.learningDigestIds,
  });
}

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

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function anthropicUsage(response: unknown): {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
} | null {
  if (!response || typeof response !== "object" || !("usage" in response)) {
    return null;
  }
  const usage = response.usage;
  if (!usage || typeof usage !== "object") return null;
  const inputTokens =
    "input_tokens" in usage ? tokenCount(usage.input_tokens) : null;
  const outputTokens =
    "output_tokens" in usage ? tokenCount(usage.output_tokens) : null;
  const cacheCreationInputTokens =
    "cache_creation_input_tokens" in usage
      ? tokenCount(usage.cache_creation_input_tokens)
      : null;
  const cacheReadInputTokens =
    "cache_read_input_tokens" in usage
      ? tokenCount(usage.cache_read_input_tokens)
      : null;
  // Anthropic always reports both primary counters; an object carrying only
  // cache counters (or neither) is malformed, matching openRouterUsage.
  if (inputTokens === null && outputTokens === null) {
    return null;
  }
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    ...(cacheCreationInputTokens !== null
      ? { cacheCreationInputTokens }
      : {}),
    ...(cacheReadInputTokens !== null ? { cacheReadInputTokens } : {}),
  };
}

function hasCacheControl(value: unknown): boolean {
  return value !== null && typeof value === "object" && "cache_control" in value;
}

/**
 * Cache the stable generation prefix without changing the agents' portable
 * string request shape. Explicit cache policies belong to their caller: leave
 * those requests intact rather than risk exceeding the four-breakpoint limit
 * or mixing TTLs. Only the first user message can extend the shared prefix.
 */
function cacheGenerationPrefix(params: unknown): unknown {
  if (!params || typeof params !== "object" || hasCacheControl(params)) {
    return params;
  }
  const system = "system" in params ? params.system : undefined;
  const messages = "messages" in params ? params.messages : undefined;
  const tools = "tools" in params ? params.tools : undefined;
  if (
    (Array.isArray(system) && system.some(hasCacheControl)) ||
    (Array.isArray(tools) && tools.some(hasCacheControl)) ||
    (Array.isArray(messages) && messages.some((message: unknown) => {
      if (!message || typeof message !== "object") return false;
      return hasCacheControl(message) || (
        "content" in message && Array.isArray(message.content) &&
        message.content.some(hasCacheControl)
      );
    }))
  ) {
    return params;
  }

  const cachedText = (text: string) => [{
    type: "text",
    text,
    cache_control: { type: "ephemeral" },
  }];
  let sawUser = false;
  return {
    ...params,
    ...(typeof system === "string" && system.length > 0
      ? { system: cachedText(system) }
      : {}),
    ...(Array.isArray(messages) ? {
      messages: messages.map((message: unknown) => {
        if (!message || typeof message !== "object" ||
          !("role" in message) || message.role !== "user" || sawUser) {
          return message;
        }
        sawUser = true;
        return "content" in message && typeof message.content === "string" && message.content.length > 0
          ? { ...message, content: cachedText(message.content) }
          : message;
      }),
    } : {}),
  };
}

/** Anthropic client that durably records billed usage after every response. */
export function instrumentedAnthropic(
  ctx: ActionCtx,
  meta: ProviderCallMeta & {
    brainSourceId?: Id<"brainSources">;
    capability?: AnthropicCapability;
  }
): Anthropic {
  assertGenerationCallSite(meta.callSite);
  const client = createAnthropicClient(meta.capability ?? "generation");
  const messages = client.messages;
  const originalCreate = messages.create.bind(messages);
  const instrumentedMessages = new Proxy(messages, {
    get(target, property, receiver) {
      if (property !== "create") return Reflect.get(target, property, receiver);
      return async (...args: unknown[]) => {
        await recordGenerationHandoff(ctx, meta.attribution);
        const startedAt = Date.now();
        const response: unknown = await Reflect.apply(
          originalCreate,
          target,
          meta.attribution
            ? [cacheGenerationPrefix(args[0]), ...args.slice(1)]
            : args
        );
        const durationMs = Math.max(0, Date.now() - startedAt);
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
            ...(meta.attribution
              ? {
                  generationId: meta.attribution.generationId,
                  ...(meta.attribution.candidateRunId
                    ? { candidateRunId: meta.attribution.candidateRunId }
                    : {}),
                  durationMs,
                }
              : {}),
            ...(meta.userId ? { userId: meta.userId } : {}),
            ...(meta.brainSourceId
              ? { brainSourceId: meta.brainSourceId }
              : {}),
            callSite: meta.callSite,
            model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            ...(usage.cacheCreationInputTokens !== undefined
              ? {
                  cacheCreationInputTokens:
                    usage.cacheCreationInputTokens,
                }
              : {}),
            ...(usage.cacheReadInputTokens !== undefined
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
