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
} from "./instrument";
import {
  toChatCompletions,
  fromChatCompletions,
  openRouterUsage,
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
  }
): Promise<ChatCompletionsResponse> {
  const apiKey = requireOpenRouterConfigured();
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = OPENROUTER_MAX_RETRIES + 1;
  await recordGenerationHandoff(ctx, input.attribution);
  const startedAt = Date.now();
  let response!: Response;
  let text!: string;
  // Bounded retry with backoff for transient gateway failures (429/5xx/
  // network). Retry decisions and delays are pure functions in
  // openrouterCore.ts; this loop only executes them.
  for (let attempt = 0; ; attempt += 1) {
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
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // A timed-out attempt already spent its full time budget — retrying it
      // would overrun the action limit, so only pre-response network failures
      // are retried.
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
  const usage = openRouterUsage(body);
  if (usage) {
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
      model: input.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
    });
  }
  return body;
}

export function instrumentedOpenRouter(
  ctx: ActionCtx,
  meta: {
    callSite: string;
    projectId?: Id<"projects">;
    userId?: string;
    attribution?: GenerationAttribution;
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
