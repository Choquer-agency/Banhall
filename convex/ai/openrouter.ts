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
import {
  recordGenerationHandoff,
  scheduleUsage,
  type GenerationAttribution,
  type UsageTap,
} from "./instrument";
import { modelById } from "../../shared/generationModels";
import { estimateCostFromTable } from "../../shared/modelPricing";
import {
  toChatCompletions,
  fromChatCompletions,
  openRouterUsage,
  requestCacheWriteTtl,
  shouldRetryStatus,
  retryDelayMs,
  isAbortLikeError,
  OPENROUTER_MAX_RETRIES,
  type ChatCompletionsResponse,
  type GenerationClient,
} from "./openrouterCore";

export type { GenerationClient } from "./openrouterCore";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Generation calls complete well inside 3 minutes; a hung gateway fetch must
// fail long before the 10-minute Convex action budget. Research overrides this
// via timeoutMs (its providers stream internally for up to 8 minutes).
const DEFAULT_TIMEOUT_MS = 180_000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One attempt's signal: its own timeout, and the caller's abort if given. */
function attemptSignal(timeoutMs: number, caller: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!caller) return timeout;
  const combined = new AbortController();
  const abort = (source: AbortSignal) => () => combined.abort(source.reason);
  if (caller.aborted) combined.abort(caller.reason);
  caller.addEventListener("abort", abort(caller), { once: true });
  timeout.addEventListener("abort", abort(timeout), { once: true });
  return combined.signal;
}

/**
 * The request was aborted by its caller (a fact extraction past its time
 * limit, or one whose sibling window failed). Named AbortError, so outcome
 * recording counts nothing against the model.
 */
function callerAbortError(): OpenRouterError {
  const error = new OpenRouterError("OpenRouter request aborted by the caller");
  error.name = "AbortError";
  return error;
}

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
    attribution?: GenerationAttribution;
    headers?: Record<string, string>;
    /** Per-attempt fetch timeout. Defaults to DEFAULT_TIMEOUT_MS. */
    timeoutMs?: number;
    /** Transport retries. Defaults to the shared generation policy. */
    maxRetries?: number;
    onUsage?: UsageTap;
    /** App ids of fallback models sent in the body's `models` array. */
    fallbackModels?: readonly string[];
    /**
     * Aborts the request (and every retry) when the caller gives up, such
     * as a fact extraction past its time limit (2026-09-25).
     */
    signal?: AbortSignal;
  }
): Promise<ChatCompletionsResponse> {
  const apiKey = requireOpenRouterConfigured();
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = (input.maxRetries ?? OPENROUTER_MAX_RETRIES) + 1;
  await recordGenerationHandoff(ctx, input.attribution);
  const startedAt = Date.now();
  let response!: Response;
  let text!: string;
  // Bounded retry with backoff for transient gateway failures (429/5xx/
  // network). Retry decisions and delays are pure functions in
  // openrouterCore.ts; this loop only executes them.
  for (let attempt = 0; ; attempt += 1) {
    // A caller that gave up is never sent a (re)try (review 2026-09-25, P3-b).
    if (input.signal?.aborted) throw callerAbortError();
    try {
      response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://banhall.app",
          "X-Title": "Banhall",
          ...(input.headers ?? {}),
        },
        body: JSON.stringify(input.body),
        signal: attemptSignal(timeoutMs, input.signal),
      });
    } catch (error) {
      // A timed-out attempt already spent its full time budget — retrying it
      // would overrun the action limit, so only pre-response network failures
      // are retried.
      // The caller's own abort is reported as such, never as a timeout, and
      // never retried; only this attempt's own timer is a timeout.
      if (input.signal?.aborted) throw callerAbortError();
      if (isAbortLikeError(error)) {
        throw new OpenRouterError(
          `OpenRouter request timed out after ${timeoutMs}ms`
        );
      }
      if (attempt + 1 >= maxAttempts) throw error;
      const delay = retryDelayMs(attempt, null, Math.random);
      console.warn(
        `OpenRouter fetch failed (attempt ${attempt + 1}/${maxAttempts}), retrying in ${delay}ms:`,
        error instanceof Error ? error.message : String(error)
      );
      await sleep(delay);
      continue;
    }
    // Read as text first: gateway errors are not always JSON (HTML error
    // pages, plaintext proxy failures), and discarding that body left
    // status-only errors that were impossible to diagnose.
    text = await response.text();
    if (
      response.ok ||
      attempt + 1 >= maxAttempts ||
      !shouldRetryStatus(response.status)
    ) {
      break;
    }
    const delay = retryDelayMs(
      attempt,
      response.headers.get("retry-after"),
      Math.random
    );
    console.warn(
      `OpenRouter returned ${response.status} (attempt ${attempt + 1}/${maxAttempts}), retrying in ${delay}ms`
    );
    await sleep(delay);
  }
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  const body = (raw ?? {}) as ChatCompletionsResponse;
  if (!response.ok) {
    const detail = body.error?.message ?? text.trim().slice(0, 300);
    throw new OpenRouterError(
      `OpenRouter request failed with status ${response.status}${
        detail ? `: ${detail}` : ""
      }`,
      response.status
    );
  }
  // Mirrors instrumentedAnthropic: a successful response is never turned into
  // an app failure by usage logging.
  const usage = openRouterUsage(body, {
    cacheWriteTtl: requestCacheWriteTtl(input.body),
  });
  // After a fallback the answer came from another model: bill that model.
  const usageModel = servingModelId(input.model, input.fallbackModels, body.model);
  if (usage) {
    input.onUsage?.({
      model: usageModel,
      costUsd: usage.costUsd ?? estimateCostFromTable(usageModel, usage),
      ...(usage.costUsd !== undefined ? { nativeCostUsd: usage.costUsd } : {}),
      tokens: usage,
    });
    await scheduleUsage(ctx, {
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.attribution
        ? {
            generationId: input.attribution.generationId,
            ...(input.attribution.candidateRunId
              ? { candidateRunId: input.attribution.candidateRunId }
              : {}),
            durationMs: Math.max(0, Date.now() - startedAt),
          }
        : {}),
      callSite: input.callSite,
      model: usageModel,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      ...(usage.cacheCreationInputTokens !== undefined
        ? { cacheCreationInputTokens: usage.cacheCreationInputTokens }
        : {}),
      ...(usage.cacheCreation1hInputTokens !== undefined
        ? { cacheCreation1hInputTokens: usage.cacheCreation1hInputTokens }
        : {}),
      ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
    });
  }
  return body;
}

/**
 * The app model id that answered: the requested model, or the fallback
 * whose id (or request id) OpenRouter reports in the response.
 */
export function servingModelId(
  requested: string,
  fallbacks: readonly string[] | undefined,
  answered: unknown
): string {
  if (!fallbacks?.length || typeof answered !== "string") return requested;
  return (
    [requested, ...fallbacks].find(
      (id) => id === answered || modelById(id)?.requestId === answered
    ) ?? requested
  );
}

export function instrumentedOpenRouter(
  ctx: ActionCtx,
  meta: {
    callSite: string;
    projectId?: Id<"projects">;
    userId?: string;
    attribution?: GenerationAttribution;
    onUsage?: UsageTap;
  },
  options: {
    timeoutMs?: number;
    maxRetries?: number;
    preserveMaxTokens?: boolean;
    /** Helper roles only: models to fall back to, in order. */
    fallbackModels?: readonly string[];
    /** Aborts every request of this client (see openRouterChatCompletion). */
    signal?: AbortSignal;
  } = {}
): GenerationClient {
  return {
    messages: {
      create: async (params) => {
        const body = await openRouterChatCompletion(ctx, {
          body: toChatCompletions(params, {
            preserveMaxTokens: options.preserveMaxTokens,
            ...(options.fallbackModels ? { fallbackModels: options.fallbackModels } : {}),
          }),
          model: params.model,
          ...options,
          ...meta,
        });
        // Outcomes are attributed to the model that actually answered.
        const served = servingModelId(params.model, options.fallbackModels, body.model);
        try {
          const response = fromChatCompletions(body);
          return served === params.model ? response : { ...response, servedModel: served };
        } catch (error) {
          if (served !== params.model && error instanceof Error) {
            Object.assign(error, { servedModel: served });
          }
          throw error;
        }
      },
    },
  };
}
