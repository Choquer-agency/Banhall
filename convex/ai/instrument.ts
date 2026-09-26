import Anthropic from "@anthropic-ai/sdk";
import {
  ANTHROPIC_MAX_RETRIES,
  ANTHROPIC_TIMEOUT_MS,
  createAnthropicClient,
} from "./providers";
import {
  ActionTimeBudgetError,
  MAX_SDK_RETRY_BACKOFF_MS,
  actionDeadline,
  anthropicRetryDelayMs,
  isErrorOf,
  markStoppedByDeadline,
  requestBudget,
  retryFitsDeadline,
  retryWaitFitsAnyAction,
} from "./actionDeadline";
import { COMPRESSION_REQUEST } from "./promptDefinitions";
import { domainError } from "../lib/contracts";
import {
  TRANSPORT_CONFIGURATION,
  anthropicTransport,
  type AnthropicCapability,
} from "../lib/providerConfig";
import {
  isOpenRouterInFlightBudget,
  markOpenRouterError,
  openRouterAnthropicBody,
  openRouterAnthropicCharge,
} from "../../shared/anthropicTransport";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { PD_SUBSECTIONS } from "../../shared/pdSubsections";
import { estimateCostFromTable, type BilledTokens } from "../../shared/modelPricing";
import {
  acceptsForcedToolChoice,
  alwaysThinkingMaxTokens,
  toolRequestForModel,
} from "../../shared/generationModels";

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
  /** The part of cacheCreationInputTokens written with the 1-hour TTL. */
  cacheCreation1hInputTokens?: number;
  cacheReadInputTokens?: number;
  /**
   * Provider-reported exact cost: OpenRouter's `usage.cost`, on its chat
   * gateway and on the Anthropic gateway's `openrouter` transport. The
   * direct Anthropic transport never sets it.
   */
  costUsd?: number;
  /**
   * Set only when an Anthropic-gateway call went through OpenRouter
   * (owner decision 30); absent means direct to Anthropic.
   */
  transport?: "openrouter";
  /** The provider OpenRouter reports serving the call (expected "Anthropic"). */
  servedProvider?: string;
  /**
   * The provider's stop reason as reported: Anthropic `stop_reason`,
   * OpenRouter `finish_reason`. "max_tokens" or "length" marks an answer cut
   * off at the output limit.
   */
  stopReason?: string;
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
  // 2026-09-24 (transcript method): fact extraction inside a generation, at
  // most once per transcript text and FACTS_VERSION.
  "facts",
  "brief",
  // Story 3 (CAP-8): the settings-document style classifier, at most once
  // per (projectId, contentHash); a cache hit makes no call.
  "settings",
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
  ...PD_SUBSECTIONS.flatMap(({ roleId }) => [
    `seeds:${roleId}` as const,
    `seedFeedback:${roleId}` as const,
  ]),
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
  settings: 1,
  consistency: 1,
  section: 1,
  selfCheck: 1,
  repair: 1,
  compression: COMPRESSION_REQUEST.squeezes.length,
  seeds: 2,
  seedFeedback: 2,
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

/**
 * One billed response, for callers that meter their own spend (evals).
 * `nativeCostUsd` is the provider's own charge when it reported one;
 * `costUsd` is that charge or the static price-table estimate; `tokens`
 * lets the caller re-price the response at the prices it froze.
 */
export type UsageTap = (usage: {
  model: string;
  costUsd: number;
  nativeCostUsd?: number;
  tokens: BilledTokens;
}) => void;

export type ProviderCallMeta = {
  callSite: string;
  projectId?: Id<"projects">;
  userId?: string;
  attribution?: GenerationAttribution;
  onUsage?: UsageTap;
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

/**
 * Tokens written with the 1-hour TTL, from Anthropic's `usage.cache_creation`
 * breakdown (`ephemeral_1h_input_tokens`). Null when the breakdown is absent,
 * which prices every write at the 5-minute rate. Shared by the SDK path below
 * and the chat agent's usage handler (the AI SDK passes the raw usage
 * through as `providerMetadata.anthropic.usage`).
 */
export function anthropicCacheWrite1hTokens(usage: unknown): number | null {
  if (!usage || typeof usage !== "object" || !("cache_creation" in usage)) {
    return null;
  }
  const breakdown = usage.cache_creation;
  if (!breakdown || typeof breakdown !== "object") return null;
  return "ephemeral_1h_input_tokens" in breakdown
    ? tokenCount(breakdown.ephemeral_1h_input_tokens)
    : null;
}

function anthropicUsage(response: unknown): {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheCreation1hInputTokens?: number;
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
  const cacheCreation1hInputTokens = anthropicCacheWrite1hTokens(usage);
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    ...(cacheCreationInputTokens !== null
      ? { cacheCreationInputTokens }
      : {}),
    ...(cacheCreation1hInputTokens
      ? { cacheCreation1hInputTokens }
      : {}),
    ...(cacheReadInputTokens !== null ? { cacheReadInputTokens } : {}),
  };
}

/** The response's stop reason, when it is a non-empty string. */
export function responseStopReason(response: unknown): string | undefined {
  if (!response || typeof response !== "object" || !("stop_reason" in response)) {
    return undefined;
  }
  const reason = response.stop_reason;
  return typeof reason === "string" && reason.length > 0 ? reason : undefined;
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

/**
 * Adapts the two request shapes a model that rejects forced tool calls
 * answers with a 400, at the one direct Anthropic boundary, so every caller
 * (generations, helpers, evaluations) keeps its portable request. On this
 * gateway such a model is a Claude model whose thinking is always on (Opus
 * 5.5, Fable 5.1), the cause of both rejections:
 * - A forced `tool_choice` becomes `auto` plus one system line
 *   (toolRequestForModel, shared with the OpenRouter conversion).
 * - `thinking: {type: "disabled"}` (the section drafts) is dropped and the
 *   effort set to "low", the closest the API allows to no thinking; an
 *   explicit budget (`{type: "enabled"}`) is dropped and adaptive runs.
 * - `max_tokens` gains room for the thinking (2026-09-25, cutoff review
 *   P2-1): thinking is billed from the same output budget as the answer, so
 *   a 4,096-token judge answer (QA, Self-check, consistency, chronology) was
 *   cut off before it finished. The answer budget is multiplied like an
 *   OpenRouter reasoning model's, within the model's output cap
 *   (alwaysThinkingMaxTokens). The caller's answer limits are unchanged.
 * Every other model's request passes through as the same object. Runs
 * before cacheGenerationPrefix, so the system line is part of the cached
 * prefix.
 */
export function adaptAnthropicRequest(params: unknown): unknown {
  if (!params || typeof params !== "object") return params;
  const request = params as Record<string, unknown>;
  if (typeof request.model !== "string" || acceptsForcedToolChoice(request.model)) return params;
  const adapted: Record<string, unknown> = { ...request };
  if (typeof adapted.max_tokens === "number") {
    adapted.max_tokens = alwaysThinkingMaxTokens(request.model, adapted.max_tokens);
  }
  const thinking = adapted.thinking;
  if (thinking && typeof thinking === "object" && "type" in thinking && thinking.type !== "adaptive") {
    delete adapted.thinking;
    const config =
      adapted.output_config && typeof adapted.output_config === "object"
        ? (adapted.output_config as Record<string, unknown>)
        : {};
    if (thinking.type === "disabled" && config.effort === undefined) {
      adapted.output_config = { ...config, effort: "low" };
    }
  }
  const choice = adapted.tool_choice;
  if (choice && typeof choice === "object" && "type" in choice && typeof choice.type === "string") {
    const tools = toolRequestForModel(
      request.model,
      choice as { type: string; name?: string },
      adapted.system
    );
    adapted.tool_choice = tools.toolChoice;
    adapted.system = tools.system;
  }
  return adapted;
}

/**
 * Whether the SDK would retry this failed attempt: a connection error or a
 * timeout, or an answer the provider marks retryable (`x-should-retry`) or
 * sends as 408, 409, 429 or 5xx (529 overloaded included). A caller's own
 * abort is never retried.
 */
export function isRetryableAnthropicError(error: unknown): boolean {
  if (isErrorOf(error, Anthropic.APIUserAbortError)) return false;
  if (isErrorOf(error, Anthropic.APIConnectionError)) return true;
  if (!isErrorOf(error, Anthropic.APIError)) return false;
  const apiError = error as InstanceType<typeof Anthropic.APIError>;
  const header = apiError.headers?.get("x-should-retry");
  if (header === "true") return true;
  if (header === "false") return false;
  const status = apiError.status;
  return status === 408 || status === 409 || status === 429 || (typeof status === "number" && status >= 500);
}

/**
 * One request under the action's deadline (actionDeadline.ts, review
 * 2026-09-25 P2-2). The SDK is sent `maxRetries: 0` and this loop retries
 * as the SDK would, deciding each retry when the failure happens: it is
 * sent only when a useful attempt still fits after its wait, and each
 * attempt's timeout is cut to the time left. A caller's own lower timeout
 * or retry count wins. The request body is the same on every attempt.
 */
async function createWithinDeadline(
  send: (options: Record<string, unknown>) => Promise<unknown>,
  options: unknown,
  deadline: number,
  defaults: { timeoutMs: number; maxRetries: number }
): Promise<unknown> {
  const own = options && typeof options === "object" ? (options as Record<string, unknown>) : {};
  const timeoutMs = typeof own.timeout === "number" ? Math.min(own.timeout, defaults.timeoutMs) : defaults.timeoutMs;
  const retries =
    typeof own.maxRetries === "number" ? Math.min(own.maxRetries, defaults.maxRetries) : defaults.maxRetries;
  for (let attempt = 0; ; attempt += 1) {
    const budget = requestBudget({ deadline, now: Date.now(), timeoutMs, maxRetries: 0 });
    try {
      return await send({ ...own, timeout: budget.timeoutMs, maxRetries: 0 });
    } catch (error) {
      // A timeout the deadline cut short says the action ran out of time,
      // not that the model failed.
      if (budget.shortened && isErrorOf(error, Anthropic.APIConnectionTimeoutError)) {
        throw new ActionTimeBudgetError();
      }
      if (attempt >= retries || !isRetryableAnthropicError(error)) throw error;
      const headers = isErrorOf(error, Anthropic.APIError)
        ? (error as InstanceType<typeof Anthropic.APIError>).headers
        : undefined;
      const delay = anthropicRetryDelayMs(headers, attempt, Date.now(), Math.random);
      // The time ran out before the retry: not counted against the model,
      // unless the provider asked for a wait no action could fit.
      if (!retryFitsDeadline(deadline, Date.now(), delay)) {
        throw retryWaitFitsAnyAction(delay) ? markStoppedByDeadline(error) : error;
      }
      console.warn(`Anthropic request failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${Math.round(delay)}ms`);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * The longest Retry-After wait the `openrouter` transport honours before
 * retrying an in-flight spending budget 402 (sendViaOpenRouter). A longer
 * wait fails at once with the rate-limit error.
 */
export const OPENROUTER_IN_FLIGHT_MAX_WAIT_MS = 60_000;

/**
 * One request on the `openrouter` transport. Its errors are marked as
 * OpenRouter's, for normalizeProviderError. An in-flight spending budget
 * 402 (isOpenRouterInFlightBudget) is temporary, and the SDK never retries
 * a 402, so it is retried here once: after OpenRouter's Retry-After wait
 * (MAX_SDK_RETRY_BACKOFF_MS when none was sent), only when that wait is at
 * most OPENROUTER_IN_FLIGHT_MAX_WAIT_MS and still leaves a useful attempt
 * before the action's deadline (retryFitsDeadline). Otherwise, or when the
 * retry is refused again, it fails with the rate-limit error. Neither
 * counts against the model. The retry sends the same body.
 */
async function sendViaOpenRouter(
  send: () => Promise<unknown>,
  deadline: number | undefined
): Promise<unknown> {
  try {
    return await send();
  } catch (error) {
    markOpenRouterError(error);
    if (!isOpenRouterInFlightBudget(error)) throw error;
    const headers = isErrorOf(error, Anthropic.APIError)
      ? (error as InstanceType<typeof Anthropic.APIError>).headers
      : undefined;
    const delay =
      headers?.get("retry-after") || headers?.get("retry-after-ms")
        ? anthropicRetryDelayMs(headers, 0, Date.now(), Math.random)
        : MAX_SDK_RETRY_BACKOFF_MS;
    if (delay > OPENROUTER_IN_FLIGHT_MAX_WAIT_MS || !retryFitsDeadline(deadline, Date.now(), delay)) {
      throw error;
    }
    console.warn(`OpenRouter in-flight spending budget is full (402), retrying once in ${Math.round(delay)}ms`);
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }
  try {
    return await send();
  } catch (error) {
    throw markOpenRouterError(error);
  }
}

/**
 * The body sent on the `openrouter` transport: the direct body with the
 * OpenRouter model id and the Anthropic-only provider pin. An app model id
 * without an OpenRouter mapping fails here, before anything is sent.
 */
function openRouterWireBody(body: unknown): unknown {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const wire = openRouterAnthropicBody(record);
  if (!wire) {
    domainError(
      "PROVIDER_NOT_CONFIGURED",
      `Anthropic model ${String(record.model)} has no OpenRouter id (shared/anthropicTransport.ts), so it cannot run with ANTHROPIC_TRANSPORT=openrouter`,
      TRANSPORT_CONFIGURATION
    );
  }
  return wire;
}

/**
 * Anthropic client that durably records billed usage after every response.
 * On the `openrouter` transport (owner decision 30) the request is the same
 * apart from the model id on the wire and the provider pin; the usage row
 * keeps the app model id and adds OpenRouter's exact charge, the transport
 * and the provider that served it.
 */
export function instrumentedAnthropic(
  ctx: ActionCtx,
  meta: ProviderCallMeta & {
    brainSourceId?: Id<"brainSources">;
    capability?: AnthropicCapability;
    clientOptions?: {
      maxRetries?: number;
      timeout?: number;
    };
  }
): Anthropic {
  assertGenerationCallSite(meta.callSite);
  const viaOpenRouter = anthropicTransport() === "openrouter";
  const client = createAnthropicClient(
    meta.capability ?? "generation",
    meta.clientOptions
  );
  const messages = client.messages;
  const originalCreate = messages.create.bind(messages);
  const instrumentedMessages = new Proxy(messages, {
    get(target, property, receiver) {
      if (property !== "create") return Reflect.get(target, property, receiver);
      return async (...args: unknown[]) => {
        // The action's deadline (actionDeadline.ts): throws before sending
        // when too little time is left; otherwise each attempt's timeout is
        // cut to the time left and each retry is decided when it happens
        // (createWithinDeadline). Transport options only.
        const deadline = actionDeadline(ctx);
        const defaults =
          deadline === undefined
            ? undefined
            : {
                timeoutMs: meta.clientOptions?.timeout ?? ANTHROPIC_TIMEOUT_MS,
                maxRetries: meta.clientOptions?.maxRetries ?? ANTHROPIC_MAX_RETRIES,
              };
        if (deadline !== undefined && defaults) requestBudget({ deadline, now: Date.now(), ...defaults });
        await recordGenerationHandoff(ctx, meta.attribution);
        const startedAt = Date.now();
        const request = adaptAnthropicRequest(args[0]);
        const prefixed = meta.attribution ? cacheGenerationPrefix(request) : request;
        const body = viaOpenRouter ? openRouterWireBody(prefixed) : prefixed;
        const rest = args.slice(2);
        const sendRequest = async (): Promise<unknown> =>
          deadline === undefined || !defaults
            ? await Reflect.apply(originalCreate, target, [body, ...args.slice(1)])
            : await createWithinDeadline(
                (options) => Reflect.apply(originalCreate, target, [body, options, ...rest]),
                args[1],
                deadline,
                defaults
              );
        const response: unknown = viaOpenRouter
          ? await sendViaOpenRouter(sendRequest, deadline)
          : await sendRequest();
        const durationMs = Math.max(0, Date.now() - startedAt);
        const usage = anthropicUsage(response);
        const charge = viaOpenRouter ? openRouterAnthropicCharge(response) : {};
        const stopReason = responseStopReason(response);
        const params = args[0];
        const model =
          params &&
          typeof params === "object" &&
          "model" in params &&
          typeof params.model === "string"
            ? params.model
            : "unknown";
        // The pin should make this impossible; if OpenRouter reports another
        // host, say so, so a relaxed pin or account setting is visible.
        if (charge.servedProvider && charge.servedProvider.toLowerCase() !== "anthropic") {
          console.warn(
            `Anthropic model ${model} was served by ${charge.servedProvider} through OpenRouter, not Anthropic; check the provider pin and the OpenRouter account's provider settings`
          );
        }
        if (usage) {
          meta.onUsage?.({
            model,
            costUsd: charge.costUsd ?? estimateCostFromTable(model, usage),
            ...(charge.costUsd !== undefined ? { nativeCostUsd: charge.costUsd } : {}),
            tokens: usage,
          });
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
            ...(usage.cacheCreation1hInputTokens !== undefined
              ? {
                  cacheCreation1hInputTokens:
                    usage.cacheCreation1hInputTokens,
                }
              : {}),
            ...(usage.cacheReadInputTokens !== undefined
              ? { cacheReadInputTokens: usage.cacheReadInputTokens }
              : {}),
            ...(stopReason ? { stopReason } : {}),
            ...(viaOpenRouter ? { transport: "openrouter" as const } : {}),
            ...(charge.costUsd !== undefined ? { costUsd: charge.costUsd } : {}),
            ...(charge.servedProvider ? { servedProvider: charge.servedProvider } : {}),
          });
        }
        return response;
      };
    },
  });
  Object.defineProperty(client, "messages", { value: instrumentedMessages });
  return client;
}
