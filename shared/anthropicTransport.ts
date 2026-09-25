/**
 * Where Anthropic-gateway requests go (owner decision 30, 2026-09-25).
 *
 * `gateway: "anthropic"` still means the Anthropic Messages protocol and
 * every policy keyed on it (budgets, citations, compare pools, frozen
 * entries, prompt versions). The transport only picks the HTTP endpoint:
 *
 * - `direct` (the default, and the rollback): api.anthropic.com with
 *   ANTHROPIC_API_KEY, exactly as before the switch existed.
 * - `openrouter`: OpenRouter's Anthropic-compatible Messages endpoint
 *   (https://openrouter.ai/api/v1/messages), billed to OpenRouter credits.
 *   Only the endpoint, the key, the model id on the wire and one added
 *   `provider` field change: the pin below keeps every request on
 *   Anthropic's own endpoint, with no fallback to any other host.
 *
 * The report chat assistant (convex/ai/chatAgentV2.ts) does not use this
 * transport yet: it streams through the AI SDK straight to Anthropic.
 *
 * Pure: no Convex runtime imports.
 */

export const ANTHROPIC_TRANSPORTS = ["direct", "openrouter"] as const;
export type AnthropicTransport = (typeof ANTHROPIC_TRANSPORTS)[number];

/**
 * The transport an ANTHROPIC_TRANSPORT value names. Unset or blank means
 * `direct`; any other value is null, which callers treat as a
 * configuration error rather than guessing a route.
 */
export function parseAnthropicTransport(raw: string | undefined): AnthropicTransport | null {
  const value = raw?.trim().toLowerCase() ?? "";
  if (value === "") return "direct";
  return (ANTHROPIC_TRANSPORTS as readonly string[]).includes(value) ? (value as AnthropicTransport) : null;
}

/** The Anthropic SDK's base URL for OpenRouter (it appends `/v1/messages`). */
export const OPENROUTER_ANTHROPIC_BASE_URL = "https://openrouter.ai/api";

/**
 * First-party Anthropic only, no fallback to Bedrock, Vertex, Azure or
 * Claude on AWS. Never add `zdr: true`: OpenRouter's ZDR routing removes
 * the first-party Anthropic endpoint.
 */
export const OPENROUTER_ANTHROPIC_PROVIDER = {
  only: ["anthropic"],
  allow_fallbacks: false,
} as const;

/** The same app attribution headers the OpenRouter chat transport sends. */
export const OPENROUTER_APP_HEADERS = {
  "HTTP-Referer": "https://banhall.app",
  "X-Title": "Banhall",
} as const;

/**
 * App model id to OpenRouter request id, read from OpenRouter's model list
 * on 2026-09-25. The undated ids name one fixed snapshot each (the moving
 * aliases are the `~anthropic/...-latest` ids, never used here). Older ids
 * are kept so a retried legacy generation still routes. Claude Mythos 5.1
 * has no OpenRouter listing, so it has no entry.
 */
export const OPENROUTER_ANTHROPIC_REQUEST_IDS: Readonly<Record<string, string>> = {
  "claude-sonnet-5": "anthropic/claude-sonnet-5",
  "claude-opus-5-5": "anthropic/claude-opus-5.5",
  "claude-opus-4-8": "anthropic/claude-opus-4.8",
  "claude-haiku-4-5-20251001": "anthropic/claude-haiku-4.5",
  "claude-fable-5-1": "anthropic/claude-fable-5.1",
  "claude-sonnet-4-6": "anthropic/claude-sonnet-4.6",
  "claude-opus-5": "anthropic/claude-opus-5",
  "claude-haiku-4-5": "anthropic/claude-haiku-4.5",
};

/** The OpenRouter request id for an app model id, or undefined if unmapped. */
export function openRouterAnthropicRequestId(appModelId: string): string | undefined {
  return Object.hasOwn(OPENROUTER_ANTHROPIC_REQUEST_IDS, appModelId)
    ? OPENROUTER_ANTHROPIC_REQUEST_IDS[appModelId]
    : undefined;
}

/**
 * The request body OpenRouter receives: the direct body with only the model
 * id replaced and the provider pin added. Everything else (`cache_control`
 * and its TTL, `thinking`, `output_config`, `tool_choice`, `system` blocks,
 * citations documents) passes through unchanged. Returns null for an
 * unmapped model id so the caller can fail before sending.
 */
export function openRouterAnthropicBody(
  body: Readonly<Record<string, unknown>>
): Record<string, unknown> | null {
  const requestId = typeof body.model === "string" ? openRouterAnthropicRequestId(body.model) : undefined;
  if (!requestId) return null;
  return { ...body, model: requestId, provider: OPENROUTER_ANTHROPIC_PROVIDER };
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * What OpenRouter adds to an Anthropic-shaped response: the exact charge and
 * the provider that served the call.
 *
 * `usage.cost` is the amount charged to the OpenRouter credits. With BYOK
 * (not in use; decision 30 bills credits) it is only OpenRouter's fee and
 * the provider charge is `cost_details.upstream_inference_cost`, so the two
 * are added; a BYOK answer without the upstream figure reports no native
 * cost and the usage row falls back to the price-table estimate.
 */
export function openRouterAnthropicCharge(response: unknown): {
  costUsd?: number;
  servedProvider?: string;
} {
  if (!response || typeof response !== "object") return {};
  const record = response as Record<string, unknown>;
  const servedProvider =
    typeof record.provider === "string" && record.provider.trim() ? record.provider.trim() : undefined;
  const usage = record.usage && typeof record.usage === "object" ? (record.usage as Record<string, unknown>) : {};
  let costUsd = finiteNonNegative(usage.cost);
  if (costUsd !== undefined && usage.is_byok === true) {
    const details =
      usage.cost_details && typeof usage.cost_details === "object"
        ? (usage.cost_details as Record<string, unknown>)
        : {};
    const upstream = finiteNonNegative(details.upstream_inference_cost);
    costUsd = upstream === undefined ? undefined : costUsd + upstream;
  }
  return {
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(servedProvider ? { servedProvider } : {}),
  };
}

/** Errors from a request sent through OpenRouter (see markOpenRouterError). */
const openRouterErrors = new WeakSet<object>();

/**
 * Marks an error thrown by a request sent through OpenRouter, so
 * normalizeProviderError can read OpenRouter's routing answers (a 404 when
 * the provider pin matches no endpoint, a 403 from a key guardrail) as the
 * routing or configuration faults they are, not as model faults.
 */
export function markOpenRouterError<E>(error: E): E {
  if (error && typeof error === "object") openRouterErrors.add(error);
  return error;
}

export function isOpenRouterError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && openRouterErrors.has(error));
}
