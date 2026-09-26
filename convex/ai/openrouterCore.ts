/**
 * Pure conversion + parsing layer for the OpenRouter gateway — no Convex
 * imports so it unit-tests without a deployment. The instrumented client
 * lives in convex/ai/openrouter.ts.
 *
 * Shape contract: the generation agents are written against Anthropic's
 * `{ messages: { create } }` client. This module converts that request shape
 * to OpenRouter chat-completions and the response back to Anthropic-shaped
 * content blocks, so the agents run unchanged on either gateway.
 */
import {
  acceptsForcedToolChoice,
  maxTokensWithReasoningHeadroom,
  modelById,
  requestModelId,
  toolRequestForModel,
} from "../../shared/generationModels";
import {
  openRouterProviderPreferences,
  type MaxPrice,
  type OpenRouterProviderPreferences,
} from "../../shared/modelCatalog";
import { isAnthropicOpenRouterModel } from "../../shared/anthropicTransport";

export type GenerationContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

export interface GenerationResponse {
  content: GenerationContentBlock[];
  /** Anthropic/OpenRouter completion reason, when the gateway provides one. */
  stop_reason?: string | null;
  /** The app model id that answered, when an OpenRouter fallback did. */
  servedModel?: string;
  /**
   * Forced-tool calls only: record this request's outcome once the caller
   * has validated the tool output (set by providers.ts withOutcomeRecording).
   */
  settleOutcome?: (result: { ok: true } | { ok: false; code: string }) => Promise<void>;
}

/** JSON Schema for a tool input (matches Anthropic.Tool.InputSchema). */
export type ToolInputSchema = { type: "object"; [key: string]: unknown };

/** Anthropic prompt-cache breakpoint (cost phase 1). */
export type GenerationCacheControl = { type: "ephemeral"; ttl?: "5m" | "1h" };

/**
 * One text block of a message. A message sent as blocks carries a cache
 * breakpoint after its shared prefix: the direct Anthropic SDK sends the
 * blocks as they are, and the OpenRouter conversion keeps the breakpoint for
 * Anthropic models and joins the text for every other provider, whose
 * caching is automatic on an identical prefix.
 */
export type GenerationTextBlock = {
  type: "text";
  text: string;
  cache_control?: GenerationCacheControl;
};

export type GenerationMessageContent = string | GenerationTextBlock[];

/** A message's text as one string, whatever its shape. */
export function messageText(content: GenerationMessageContent): string {
  return typeof content === "string"
    ? content
    : content.map((block) => block.text).join("");
}

export interface GenerationMessageParams {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: GenerationMessageContent }>;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema: ToolInputSchema;
  }>;
  tool_choice?: { type: "tool"; name: string };
  /** Direct Anthropic control; OpenRouter conversion intentionally ignores it. */
  thinking?: { type: "disabled" };
}

/**
 * Round 2 (F2, decision 57): what a streamed request reports while it runs.
 * `onToolInput` receives the tool input JSON written so far (the whole text,
 * not a delta); an empty string means the request started again.
 */
export type GenerationStreamHandlers = { onToolInput?: (snapshot: string) => void };

export interface GenerationClient {
  messages: {
    create(params: GenerationMessageParams): Promise<GenerationResponse>;
    /**
     * The same request streamed (the Anthropic Messages API's server-sent
     * events), resolving to the same response `create` would return. Only
     * clients that can stream implement it; callers fall back to `create`.
     */
    createStreaming?(
      params: GenerationMessageParams,
      handlers: GenerationStreamHandlers
    ): Promise<GenerationResponse>;
  };
}

/**
 * Folds an Anthropic Messages event stream into the message `create` would
 * have returned: content blocks (a tool_use block's input parsed from its
 * `input_json_delta` pieces), the stop reason from `message_delta`, and the
 * usage of `message_start` updated by `message_delta` (output tokens and any
 * provider extras, such as OpenRouter's cost). A value that is not an event
 * stream is returned as it is (a test double that answers with a message).
 */
export async function collectMessageStream(
  stream: unknown,
  handlers: GenerationStreamHandlers = {}
): Promise<unknown> {
  if (!stream || typeof stream !== "object" || !(Symbol.asyncIterator in stream)) return stream;
  type Block = { type: string; [key: string]: unknown; partial?: string };
  let message: Record<string, unknown> = {};
  const blocks: Block[] = [];
  let usage: Record<string, unknown> = {};
  handlers.onToolInput?.("");
  for await (const raw of stream as AsyncIterable<Record<string, unknown>>) {
    const event = raw ?? {};
    switch (event.type) {
      case "message_start": {
        message = { ...((event.message as Record<string, unknown>) ?? {}) };
        usage = { ...((message.usage as Record<string, unknown>) ?? {}) };
        break;
      }
      case "content_block_start": {
        const block = { ...((event.content_block as Block) ?? { type: "text" }) };
        if (block.type === "tool_use") block.partial = "";
        if (block.type === "text" && typeof block.text !== "string") block.text = "";
        blocks[Number(event.index ?? blocks.length)] = block;
        break;
      }
      case "content_block_delta": {
        const block = blocks[Number(event.index ?? blocks.length - 1)];
        const delta = (event.delta ?? {}) as Record<string, unknown>;
        if (!block) break;
        if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
          block.partial = (block.partial ?? "") + delta.partial_json;
          handlers.onToolInput?.(block.partial);
        } else if (delta.type === "text_delta" && typeof delta.text === "string") {
          block.text = `${typeof block.text === "string" ? block.text : ""}${delta.text}`;
        }
        break;
      }
      case "message_delta": {
        const delta = (event.delta ?? {}) as Record<string, unknown>;
        if ("stop_reason" in delta) message.stop_reason = delta.stop_reason;
        if ("stop_sequence" in delta) message.stop_sequence = delta.stop_sequence;
        if (event.usage && typeof event.usage === "object") usage = { ...usage, ...(event.usage as Record<string, unknown>) };
        break;
      }
      case "error": {
        const error = (event.error ?? {}) as { message?: string };
        throw new Error(error.message ?? "The provider stream failed");
      }
      default:
        break;
    }
  }
  const content = blocks.filter(Boolean).map((block) => {
    if (block.type !== "tool_use") return block;
    const { partial, ...rest } = block;
    let input: unknown = rest.input ?? {};
    if (partial && partial.trim()) {
      try {
        input = JSON.parse(partial);
      } catch {
        // A tool input cut off mid-object: the stop reason says why, and the
        // caller treats the answer as cut off (structured.ts).
        input = {};
      }
    }
    return { ...rest, input };
  });
  return { ...message, content, usage };
}

export type ChatCompletionsBody = {
  model: string;
  max_tokens: number;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string | GenerationTextBlock[];
  }>;
  usage: { include: true };
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description?: string;
      parameters: Record<string, unknown>;
    };
  }>;
  /** "auto" only for a model that rejects a forced tool call. */
  tool_choice?: { type: "function"; function: { name: string } } | "auto";
  /** Provider routing: require_parameters on tool calls, max_price. */
  provider?: OpenRouterProviderPreferences;
  /** Fallback models, tried in order after `model` (helper roles only). */
  models?: string[];
};

export const OPENROUTER_CONVERSION = {
  systemRole: "system",
  systemPosition: "before-user-messages",
  systemInclusion: "truthy-string",
  originalMessageOrder: "preserve",
  toolType: "function",
  toolNameSource: "name",
  toolDescriptionSource: "description-if-nonblank",
  toolSchemaSource: "input_schema-to-parameters",
  toolChoiceType: "function",
  usageRequest: { include: true },
  thinkingRule: "omit-anthropic-thinking-control",
  maxTokensRule: "apply-registered-model-reasoning-headroom",
  // Cost phase 1: block content keeps its cache breakpoints only for
  // Anthropic models (OpenRouter passes cache_control through to them);
  // other providers cache an identical prefix automatically, so their
  // blocks are joined into the same single string as before.
  cacheControlRule: "keep-text-blocks-for-anthropic-models-else-join",
  cacheControlModelPrefix: "anthropic/",
  // Model catalog (2026-09-24): the gateway id comes from the registered
  // entry (an OpenRouter rename moves it), tool calls require every
  // parameter they send, the price ceiling is the frozen or role cap, and
  // fallbacks are only ever sent for helper roles, never for a frozen
  // generation model.
  modelIdRule: "registered-request-id-else-model",
  providerRequireParametersRule: "tool-calls",
  maxPriceRule: "registered-entry-max-price",
  fallbackModelsRule: "explicit-helper-role-fallbacks-only",
} as const;

function convertContent(
  model: string,
  content: GenerationMessageContent
): string | GenerationTextBlock[] {
  if (typeof content === "string") return content;
  return model.startsWith(OPENROUTER_CONVERSION.cacheControlModelPrefix)
    ? content.map((block) => ({ ...block }))
    : messageText(content);
}

export function toChatCompletions(
  params: GenerationMessageParams,
  options: {
    preserveMaxTokens?: boolean;
    /** Overrides the registered entry's price ceiling. */
    maxPrice?: MaxPrice;
    /** App model ids to fall back to, in order. */
    fallbackModels?: readonly string[];
  } = {}
): ChatCompletionsBody {
  // A model that rejects a forced tool call (Opus 5.5 and Fable 5.1 on
  // OpenRouter) gets `auto` plus one system line; everything else is
  // unchanged (shared/generationModels.ts toolRequestForModel).
  const toolRequest = toolRequestForModel(params.model, params.tool_choice, params.system);
  const system = toolRequest.system as string | undefined;
  const body: ChatCompletionsBody = {
    model: requestModelId(params.model),
    // Agents budget max_tokens for the answer alone (the Anthropic-correct
    // number). On OpenRouter, a reasoning model's thinking tokens come out of
    // the same budget, so scale it here rather than inflating every agent's
    // maxTokens for one gateway.
    max_tokens: options.preserveMaxTokens
      ? params.max_tokens
      : maxTokensWithReasoningHeadroom(params.model, params.max_tokens),
    messages: [
      ...(OPENROUTER_CONVERSION.systemInclusion === "truthy-string" &&
      system
        ? [{ role: OPENROUTER_CONVERSION.systemRole, content: system }]
        : []),
      ...params.messages.map((message) => ({
        role: message.role,
        content: convertContent(params.model, message.content),
      })),
    ],
    usage: OPENROUTER_CONVERSION.usageRequest,
  };
  if (params.tools?.length) {
    body.tools = params.tools.map((tool) => ({
      type: OPENROUTER_CONVERSION.toolType,
      function: {
        name: tool.name,
        ...(OPENROUTER_CONVERSION.toolDescriptionSource ===
          "description-if-nonblank" && tool.description
          ? { description: tool.description }
          : {}),
        parameters: tool.input_schema as Record<string, unknown>,
      },
    }));
  }
  if (toolRequest.toolChoice?.type === "auto") {
    body.tool_choice = "auto";
  } else if (params.tool_choice) {
    body.tool_choice = {
      type: OPENROUTER_CONVERSION.toolChoiceType,
      function: { name: params.tool_choice.name },
    };
  }
  // An Anthropic model is pinned to Anthropic's own endpoint (decision 30).
  // OpenRouter applies provider preferences to every model on the request,
  // so a fallback on the other side of that pin is not sent: under the pin
  // it could never be served, and without it an Anthropic fallback would
  // run unpinned.
  const anthropicModel = isAnthropicOpenRouterModel(body.model);
  const provider = openRouterProviderPreferences({
    usesTools: Boolean(params.tools?.length),
    maxPrice: options.maxPrice ?? modelById(params.model)?.maxPrice,
    anthropicModel,
  });
  if (provider) body.provider = provider;
  // A forced tool call is sent to every model on the request, so a fallback
  // that rejects one (Opus 5.5 and the like) would only answer with a 400;
  // it is left out (models review P3-4).
  const forcedTool = typeof body.tool_choice === "object";
  const fallbacks = (options.fallbackModels ?? [])
    .filter((id) => id !== params.model)
    .filter((id) => !forcedTool || acceptsForcedToolChoice(id))
    .map(requestModelId)
    .filter((id) => isAnthropicOpenRouterModel(id) === anthropicModel);
  if (fallbacks.length > 0) body.models = [body.model, ...fallbacks];
  return body;
}

// Transport retry policy — pure so the fetch loop in openrouter.ts is a thin
// caller and the decisions test without mocking fetch. 429 and 5xx are
// gateway/provider transients worth a bounded retry; every other 4xx (auth,
// billing, validation) fails identically on retry and must fail fast.
// One retry (CAP-6): OpenRouter candidates run inside the same
// generateCandidate action budget as the Anthropic client (providers.ts), so
// the attempt count matches ANTHROPIC_MAX_RETRIES.
export const OPENROUTER_MAX_RETRIES = 1; // 2 attempts total
const RETRY_BASE_DELAY_MS = 1_000;
export const RETRY_MAX_DELAY_MS = 30_000;

/** `undefined` status means the fetch itself failed (no HTTP response). */
export function shouldRetryStatus(status: number | undefined): boolean {
  if (status === undefined) return true;
  return status === 429 || status >= 500;
}

/**
 * Backoff for one retry. A numeric `Retry-After` header is the provider's own
 * estimate — honored, capped so a buggy header cannot stall the action.
 * Otherwise full jitter over an exponentially growing cap, which decorrelates
 * concurrent section agents that were rate-limited together. `random` is
 * injected (returns [0, 1)) so tests pin exact delays.
 */
export function retryDelayMs(
  attempt: number,
  retryAfterHeader: string | null | undefined,
  random: () => number
): number {
  const header = retryAfterHeader?.trim();
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, RETRY_MAX_DELAY_MS);
    }
  }
  const cap = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** attempt);
  return Math.floor(random() * cap);
}

/**
 * AbortSignal.timeout rejects fetch with a TimeoutError (AbortError on older
 * runtimes). A timed-out attempt already spent its full time budget, so the
 * transport must not retry it — retrying would overrun the action limit.
 */
export function isAbortLikeError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

/**
 * The provider answered but its output could not be decoded into content
 * blocks (truncation, malformed tool-call JSON, empty completion). A
 * per-attempt model failure, not a gateway/account failure — structured
 * generation may spend its single repair attempt on it, unlike auth/billing/
 * rate-limit errors which must keep failing fast.
 */
export class MalformedOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedOutputError";
  }
}

/**
 * The provider stopped the answer at its output token limit (Anthropic
 * `stop_reason: "max_tokens"`, OpenRouter `finish_reason: "length"`), so what
 * came back is cut off, not complete. A malformed-output failure like any
 * other: it spends the structured repair attempt and is never kept as a
 * finished answer. The message keeps the "truncated at the max_tokens limit"
 * wording normalizeProviderError classifies as `output_limit`.
 */
export class OutputLimitError extends MalformedOutputError {
  constructor(message: string) {
    super(message);
    this.name = "OutputLimitError";
  }
}

/**
 * Whether a response's stop reason says the answer was cut off at the
 * output token limit, on either gateway.
 */
export function isCutOffStopReason(reason: string | null | undefined): boolean {
  return reason === "max_tokens" || reason === "length";
}

export type ChatCompletionsResponse = {
  /** The model that actually answered (differs only after a fallback). */
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
      /** Tokens written to the provider cache (Anthropic models). */
      cache_write_tokens?: number;
    };
  };
  error?: { message?: string; code?: number };
};

export function fromChatCompletions(
  body: ChatCompletionsResponse
): GenerationResponse {
  const choice = body.choices?.[0];
  if (!choice?.message) {
    throw new Error(
      body.error?.message ?? "OpenRouter returned no completion choice"
    );
  }
  // Anthropic tool-use guarantees parsed input; chat-completions returns a
  // model-generated JSON string. A truncated response would JSON.parse-fail
  // confusingly, so surface length truncation as its own error first.
  if (choice.finish_reason === "length") {
    throw new OutputLimitError(
      "OpenRouter response was truncated at the max_tokens limit before completing"
    );
  }
  const content: GenerationContentBlock[] = [];
  for (const call of choice.message.tool_calls ?? []) {
    if (!call.function?.name) continue;
    let input: unknown;
    try {
      input = JSON.parse(call.function.arguments ?? "");
    } catch {
      throw new MalformedOutputError(
        `OpenRouter tool call "${call.function.name}" returned malformed JSON arguments`
      );
    }
    content.push({
      type: "tool_use",
      id: call.id ?? "toolcall",
      name: call.function.name,
      input,
    });
  }
  if (typeof choice.message.content === "string" && choice.message.content) {
    content.push({ type: "text", text: choice.message.content });
  }
  if (content.length === 0) {
    throw new MalformedOutputError("OpenRouter returned an empty completion");
  }
  return { content, stop_reason: choice.finish_reason ?? null };
}

/**
 * The first text block's text, or "" when there is none. A reply can open
 * with a thinking block (Opus 5.5 and Fable 5.1 always think; Sonnet 5 does
 * when thinking is left unset), so never read only content[0].
 */
export function firstResponseText(response: {
  content: ReadonlyArray<{ type: string }>;
}): string {
  for (const block of response.content) {
    if (block.type === "text" && "text" in block && typeof block.text === "string") {
      return block.text;
    }
  }
  return "";
}

/**
 * Read the first text block even when a reasoning/tool block comes first.
 * The stop reason makes the next provider failure actionable instead of an
 * undiagnosable "empty response".
 *
 * An answer cut off at the output token limit is refused the way the
 * OpenRouter adapter refuses one (OutputLimitError): a section draft that
 * stops mid-sentence is never delivered as finished text. The caller keeps
 * what it had (a repair keeps the draft it was fixing) or fails the step.
 */
export function requireTextResponse(
  response: GenerationResponse,
  label: string
): string {
  if (isCutOffStopReason(response.stop_reason)) {
    throw new OutputLimitError(
      `${label} response was truncated at the max_tokens limit before completing`
    );
  }
  const text = response.content.find(
    (block): block is Extract<GenerationContentBlock, { type: "text" }> =>
      block.type === "text"
  )?.text;
  if (!text?.trim()) {
    const reason = response.stop_reason ? ` (stop reason: ${response.stop_reason})` : "";
    throw new Error(`${label} returned an empty response${reason}`);
  }
  return text.trim();
}

/**
 * Usage extraction. Semantics note: OpenRouter's prompt_tokens INCLUDES cached
 * tokens (Anthropic's input_tokens excludes cache reads), so we subtract to
 * keep token columns consistent across gateways. Cost accuracy does not depend
 * on this split — usage.cost is the provider's exact charge.
 */
/**
 * The TTL the request asked its cache writes to use: "1h" when any breakpoint
 * in the body asks for the 1-hour TTL, "5m" when breakpoints exist but none
 * does, null when there are none. OpenRouter reports one write count with no
 * TTL split, so a request mixing both is priced as 1-hour: an upper bound,
 * never an undercount. Generation requests carry a single breakpoint.
 */
export function requestCacheWriteTtl(body: unknown): "1h" | "5m" | null {
  let found: "1h" | "5m" | null = null;
  const visit = (value: unknown): void => {
    if (found === "1h" || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    const control = record.cache_control;
    if (control && typeof control === "object") {
      found = (control as { ttl?: unknown }).ttl === "1h" ? "1h" : (found ?? "5m");
    }
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(body);
  return found;
}

export function openRouterUsage(
  body: ChatCompletionsResponse,
  options: { cacheWriteTtl?: "1h" | "5m" | null } = {}
): {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens?: number;
  cacheCreation1hInputTokens?: number;
  costUsd?: number;
} | null {
  const usage = body.usage;
  if (!usage || typeof usage !== "object") return null;
  const count = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : null;
  const promptTokens = count(usage.prompt_tokens);
  const completionTokens = count(usage.completion_tokens);
  const cachedTokens = count(usage.prompt_tokens_details?.cached_tokens);
  const cacheWriteTokens = count(
    usage.prompt_tokens_details?.cache_write_tokens
  );
  const cost = count(usage.cost);
  if (promptTokens === null && completionTokens === null) {
    return null;
  }
  const prompt = promptTokens ?? 0;
  const cached = Math.min(
    cachedTokens ?? 0,
    prompt
  );
  // Cache writes are also part of prompt_tokens (Anthropic models behind
  // OpenRouter); subtract them too so inputTokens stays the uncached count.
  const written = Math.min(cacheWriteTokens ?? 0, prompt - cached);
  return {
    inputTokens: prompt - cached - written,
    outputTokens: completionTokens ?? 0,
    cacheReadInputTokens: cached,
    ...(written > 0 ? { cacheCreationInputTokens: written } : {}),
    // TTL attribution for fallback pricing when usage.cost is missing.
    ...(written > 0 && options.cacheWriteTtl === "1h"
      ? { cacheCreation1hInputTokens: written }
      : {}),
    ...(cost !== null ? { costUsd: cost } : {}),
  };
}
