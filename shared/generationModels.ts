export const MODEL = "claude-sonnet-5";

// Provider logomarks served from static/ (no external favicon dependency).
export const PROVIDER_LOGOS = {
  Anthropic: "/images/icons/Anthropic.svg",
  OpenAI: "/images/icons/OpenAI.svg",
  Google: "/images/icons/Google.svg",
} as const;

export type ModelProvider = keyof typeof PROVIDER_LOGOS;

// Kept for any straggler import; prefer PROVIDER_LOGOS[provider].
export const PROVIDER_LOGO_URL = PROVIDER_LOGOS.Anthropic;

/**
 * gateway routes the API call: "anthropic" = direct Anthropic SDK (native
 * prompt caching + existing instrumentation), "openrouter" = OpenRouter
 * chat-completions (OpenAI/Google models). Explicit per entry — never inferred
 * from the id shape.
 *
 * reasoning marks models that spend reasoning tokens out of the same output
 * budget as the answer under our current request settings (see
 * maxTokensWithReasoningHeadroom); maxCompletionTokens is that model's hard
 * output cap, used to clamp the headroom. Both are explicit per entry too.
 * Some providers allow reasoning to be disabled per-request; until we do so
 * deliberately, these models must be budgeted as if it is always on.
 *
 * forcedToolChoice: false marks a model whose API answers a forced tool call
 * (`tool_choice` `tool` or `any`) with a 400 (Opus 5.5, Fable 5.1; see
 * acceptsForcedToolChoice). Both gateways then send it `auto` plus one
 * system line instead (toolRequestForModel).
 */
export const CANDIDATE_MODELS = [
  {
    id: MODEL,
    label: "Sonnet 5",
    provider: "Anthropic",
    gateway: "anthropic",
    description: "Balanced default — near-Opus quality writing at a mid price point.",
  },
  {
    id: "claude-opus-5-5",
    label: "Opus 5.5",
    provider: "Anthropic",
    gateway: "anthropic",
    description: "Newest Opus - deep reasoning at a lower price than Opus 4.8.",
    forcedToolChoice: false,
  },
  {
    id: "claude-opus-4-8",
    label: "Opus 4.8",
    provider: "Anthropic",
    gateway: "anthropic",
    description: "Most capable — deepest reasoning for dense technical claims.",
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Haiku 4.5",
    provider: "Anthropic",
    gateway: "anthropic",
    description: "Fastest and cheapest — good for quick comparison baselines.",
  },
  {
    id: "openai/gpt-6-sol",
    label: "GPT-6 Sol",
    provider: "OpenAI",
    gateway: "openrouter",
    description: "OpenAI's newest flagship - strong reasoning at a mid price point.",
    reasoning: true,
    maxCompletionTokens: 128000,
  },
  {
    id: "openai/gpt-6-luna",
    label: "GPT-6 Luna",
    provider: "OpenAI",
    gateway: "openrouter",
    description: "OpenAI's newest fast tier - quick drafts at a very low price.",
    reasoning: true,
    maxCompletionTokens: 128000,
  },
  {
    id: "openai/gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    provider: "OpenAI",
    gateway: "openrouter",
    description: "OpenAI's flagship — strong reasoning, familiar ChatGPT voice.",
    reasoning: true,
    maxCompletionTokens: 128000,
  },
  {
    id: "openai/gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    provider: "OpenAI",
    gateway: "openrouter",
    description: "OpenAI's fast tier — quick drafts at a low price point.",
    reasoning: true,
    maxCompletionTokens: 128000,
  },
  {
    id: "google/gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    provider: "Google",
    gateway: "openrouter",
    description: "Google's frontier reasoning model — long-context strength.",
    reasoning: true,
    maxCompletionTokens: 65536,
  },
  {
    id: "google/gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    provider: "Google",
    gateway: "openrouter",
    description: "Google's fast tier — near-Pro quality at Flash speed and cost.",
    reasoning: true,
    maxCompletionTokens: 65536,
  },
] as const;

export type CandidateModelId = (typeof CANDIDATE_MODELS)[number]["id"];
export type ModelGateway = (typeof CANDIDATE_MODELS)[number]["gateway"];

/**
 * One runnable model, whatever its source. `CANDIDATE_MODELS` above is the
 * seed the model catalog starts from (convex `modelCatalog` table); models
 * the catalog adds later reach the runtime through `registerModelEntries`.
 *
 * `requestId` is the id sent to the gateway when it differs from `id` (an
 * OpenRouter rename keeps `id`, the app-facing identity stored on
 * generations and usage rows, stable).
 */
export type ModelEntry = {
  id: string;
  label: string;
  provider: string;
  gateway: ModelGateway;
  description?: string;
  reasoning?: boolean;
  maxCompletionTokens?: number;
  requestId?: string;
  /** OpenRouter `provider.max_price`, USD per million tokens. */
  maxPrice?: { prompt: number; completion: number };
  /** False when the model rejects a forced tool call (see above). */
  forcedToolChoice?: boolean;
};

/**
 * Catalog entries registered at runtime, by id. Actions register the entries
 * frozen on the generation they serve (or the entry a role resolved to)
 * before any provider call, so routing, output budgets and labels below stay
 * synchronous. Seed entries need no registration.
 *
 * Only actions register. Queries and mutations must resolve entries from the
 * catalog table instead (convex/lib/modelRoles.ts): module state is not part
 * of their deterministic inputs.
 */
const runtimeEntries = new Map<string, ModelEntry>();

export function registerModelEntries(entries: readonly ModelEntry[]): void {
  for (const entry of entries) runtimeEntries.set(entry.id, entry);
}

/** Test seam: forget every runtime registration. */
export function resetRegisteredModelEntries(): void {
  runtimeEntries.clear();
}

/** Whether `id` resolves without a catalog read (seed or registered). */
export function isKnownModel(id: string): boolean {
  return runtimeEntries.has(id) || CANDIDATE_MODELS.some((model) => model.id === id);
}

export const UNKNOWN_MODEL_GATEWAY: ModelGateway = "anthropic";
export const RANDOM_COMPARISON_GATEWAY: ModelGateway = "anthropic";
export const SECTION_ANSWER_TOKEN_BUDGETS = {
  anthropic: 8192,
  openrouter: 4096,
} as const;

/**
 * Every OpenRouter model must declare `reasoning` and `maxCompletionTokens`.
 *
 * Every current frontier model on that gateway spends reasoning tokens out of
 * the same output budget as the answer, so a section agent's 4096 budget is
 * exhausted before any text is emitted and the provider returns
 * `finish_reason: "length"`. That took out seven consecutive generations before
 * `maxTokensWithReasoningHeadroom` existed — and the clamp only applies to
 * models that declare the fields, so forgetting them silently reintroduces the
 * bug. This makes the omission a type error instead.
 *
 * A genuinely non-reasoning OpenRouter model still opts out explicitly with
 * `reasoning: false`, which is a deliberate, reviewable statement.
 */
type OpenRouterEntry = Extract<
  (typeof CANDIDATE_MODELS)[number],
  { gateway: "openrouter" }
>;
type AssertOpenRouterDeclaresReasoning = OpenRouterEntry extends {
  reasoning: boolean;
  maxCompletionTokens: number;
}
  ? true
  : ["an OpenRouter model is missing `reasoning` / `maxCompletionTokens`"];
const _openRouterModelsDeclareReasoning: AssertOpenRouterDeclaresReasoning = true;
void _openRouterModelsDeclareReasoning;

/**
 * Labels for built-in models taken out of the seed list, so older
 * generations and role history still name them. Label only: these ids are
 * not selectable and do not resolve through modelById.
 */
export const RETIRED_SEED_LABELS: Readonly<Record<string, string>> = {
  "claude-fable-5-1": "Fable 5.1",
};

export function modelById(id: string): ModelEntry | undefined {
  return (
    runtimeEntries.get(id) ??
    (CANDIDATE_MODELS.find((model) => model.id === id) as ModelEntry | undefined)
  );
}

/**
 * Seed lookup only, ignoring runtime registrations. Queries and mutations
 * use this (through convex/lib/modelRoles.ts) so their result never depends
 * on what an earlier action in the same isolate registered.
 */
export function seedModelById(id: string): ModelEntry | undefined {
  return CANDIDATE_MODELS.find((model) => model.id === id) as ModelEntry | undefined;
}

/**
 * Claude models whose thinking is always on: Opus 5.5, Fable 5.1 and Mythos
 * 5.1, by direct Anthropic id and by OpenRouter id. Their API answers a
 * forced tool call (`tool_choice` `tool` or `any`) and, on the direct
 * gateway, `thinking: {type: "disabled"}` with a 400. A fixed rule, because
 * OpenRouter's catalog lists `tool_choice` for them and cannot tell.
 */
export const FORCED_TOOL_CHOICE_REJECTED_IDS: ReadonlySet<string> = new Set([
  "claude-opus-5-5",
  "claude-fable-5-1",
  "claude-mythos-5-1",
  "anthropic/claude-opus-5.5",
  "anthropic/claude-fable-5.1",
  "anthropic/claude-mythos-5.1",
]);

/**
 * Whether `id` accepts a forced tool call: false for the fixed rule above
 * and for any entry (seed, or registered from a frozen catalog entry) that
 * declares `forcedToolChoice: false`.
 */
export function acceptsForcedToolChoice(id: string): boolean {
  return !FORCED_TOOL_CHOICE_REJECTED_IDS.has(id) && modelById(id)?.forcedToolChoice !== false;
}

/**
 * Models that reject a forced tool call but may still be drawn for a Random
 * compare slot (owner decision 34, 2026-09-25). Opus 5.5 ran a full real
 * Step-by-step on the unforced path; Fable 5.1 and Mythos 5.1 stay out.
 */
const RANDOM_DRAW_APPROVED_IDS: ReadonlySet<string> = new Set(["claude-opus-5-5"]);

/**
 * Whether a Random compare slot may draw `model`. Anthropic models only: a
 * surprise pick must never need the OpenRouter key or change the cost
 * profile. Models that reject a forced tool call need explicit approval above.
 */
export function eligibleForRandomDraw(
  model: Pick<ModelEntry, "id" | "gateway" | "forcedToolChoice">
): boolean {
  if (model.gateway !== RANDOM_COMPARISON_GATEWAY) return false;
  if (RANDOM_DRAW_APPROVED_IDS.has(model.id)) return true;
  return model.forcedToolChoice !== false && acceptsForcedToolChoice(model.id);
}

/** The one system line that replaces a forced tool call. */
export function toolOnlyReplyLine(toolName: string | undefined): string {
  return toolName
    ? `Reply only by calling the ${toolName} tool, exactly once. A tool call is the only valid reply.`
    : "Reply only by calling one of the provided tools, exactly once. A tool call is the only valid reply.";
}

type ToolChoiceSetting = { type: string; name?: string; disable_parallel_tool_use?: boolean };

/**
 * The tool setting a request sends to `model`, decided in one place for both
 * gateways. A model that accepts forced tool calls, and any request that
 * does not force one, is returned unchanged (same objects). A model that
 * rejects them gets `auto` with at most one call, and the system prompt
 * gains toolOnlyReplyLine; a caller that validates the output (as
 * generateStructured does) treats a missing tool call as a failed attempt
 * and spends its repair on it.
 */
export function toolRequestForModel<S>(
  model: string,
  toolChoice: ToolChoiceSetting | undefined,
  system: S
): { toolChoice: ToolChoiceSetting | undefined; system: S | string | unknown[] } {
  if (!toolChoice || (toolChoice.type !== "tool" && toolChoice.type !== "any")) {
    return { toolChoice, system };
  }
  if (acceptsForcedToolChoice(model)) return { toolChoice, system };
  const line = toolOnlyReplyLine(toolChoice.type === "tool" ? toolChoice.name : undefined);
  return {
    toolChoice: { type: "auto", disable_parallel_tool_use: true },
    system:
      typeof system === "string" && system.length > 0
        ? `${system}\n\n${line}`
        : Array.isArray(system)
          ? [...system, { type: "text", text: line }]
          : line,
  };
}

/** The id to send to the gateway for `id` (an OpenRouter rename moves it). */
export function requestModelId(id: string): string {
  return modelById(id)?.requestId ?? id;
}

/** Unknown ids route to Anthropic — preserves behavior for legacy rows. */
export function gatewayForModel(id: string): ModelGateway {
  return modelById(id)?.gateway ?? UNKNOWN_MODEL_GATEWAY;
}

/**
 * Headroom multiplier for models with mandatory reasoning. Gemini on
 * OpenRouter cannot disable reasoning (`reasoning: {enabled: false}` is a 400)
 * and OpenRouter counts reasoning tokens against max_tokens, so an agent's
 * 4096-token answer budget was being spent entirely on reasoning (measured
 * 5-6k reasoning tokens on a 68k-char transcript) and the call came back
 * `finish_reason: "length"` with no answer. 4x is the empirically validated
 * factor — the whole pipeline completes with room to spare at that budget.
 */
export const REASONING_TOKEN_MULTIPLIER = 4;

/**
 * The output budget to actually send for `id`, given the agent's answer
 * budget. Non-reasoning models (and unknown ids) pass through untouched.
 */
/**
 * Direct Anthropic reasoning models can spend part of the response budget
 * before emitting the final section. Keep OpenRouter agents at their existing
 * answer budget because the gateway adapter applies its own larger multiplier.
 */
export function sectionAnswerTokenBudget(id: string): number {
  return SECTION_ANSWER_TOKEN_BUDGETS[gatewayForModel(id)];
}

export function maxTokensWithReasoningHeadroom(
  id: string,
  maxTokens: number
): number {
  const model = modelById(id);
  if (!model?.reasoning) return maxTokens;
  const scaled = maxTokens * REASONING_TOKEN_MULTIPLIER;
  return model.maxCompletionTokens
    ? Math.min(scaled, model.maxCompletionTokens)
    : scaled;
}

/**
 * Items for the single-model picker: "Default (<current default>)" first,
 * then every selectable model. The default label comes from the live
 * writing-role assignment (providerReadiness.getCapabilities), never from
 * registry order, so an automatic switch shows up here.
 */
export function singleModelItems(
  models: readonly Pick<ModelEntry, "id" | "label">[],
  defaultModelId: string | undefined
): Array<{ value: string; label: string }> {
  const defaultLabel =
    models.find((model) => model.id === defaultModelId)?.label ??
    modelById(defaultModelId ?? "")?.label ??
    defaultModelId;
  return [
    { value: "", label: defaultLabel ? `Default (${defaultLabel})` : "Default" },
    ...models.map((model) => ({ value: model.id, label: model.label })),
  ];
}

// Compare-mode picker slots: each slot holds a model id or "" (Random).
// Both Random → undefined (server draws the pair at reserve time). One model
// + Random → fill the open slot here so the pair persists for retries.
// Random fills use the same pool as the server's random draw
// (eligibleForRandomDraw).
export function comparePairFromSlots(
  slotA: string,
  slotB: string,
  models: readonly Pick<ModelEntry, "id" | "gateway" | "forcedToolChoice">[] = CANDIDATE_MODELS
): string[] | undefined {
  const picked = [slotA, slotB].filter(Boolean);
  if (picked.length === 0) return undefined;
  if (picked.length === 2) return picked;
  const rest = models.filter((m) => m.id !== picked[0] && eligibleForRandomDraw(m));
  if (rest.length === 0) return undefined;
  return [picked[0], rest[Math.floor(Math.random() * rest.length)].id];
}

/** Human summary of the current slots, e.g. "Sonnet 4.6 vs Random". */
export function comparePairLabel(
  slotA: string,
  slotB: string,
  models: readonly Pick<ModelEntry, "id" | "label">[] = CANDIDATE_MODELS
): string {
  const name = (id: string) =>
    models.find((m) => m.id === id)?.label ?? modelById(id)?.label ?? "Random";
  return slotA || slotB ? `${name(slotA)} vs ${name(slotB)}` : "Random pair";
}

/** The provider logo for `provider`, or null for a provider without one. */
export function providerLogo(provider: string): string | null {
  return (PROVIDER_LOGOS as Record<string, string>)[provider] ?? null;
}
