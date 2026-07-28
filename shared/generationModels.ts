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

export function modelById(id: string) {
  return CANDIDATE_MODELS.find((model) => model.id === id);
}

/** Unknown ids route to Anthropic — preserves behavior for legacy rows. */
export function gatewayForModel(id: string): ModelGateway {
  return modelById(id)?.gateway ?? "anthropic";
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
const REASONING_TOKEN_MULTIPLIER = 4;

/**
 * The output budget to actually send for `id`, given the agent's answer
 * budget. Non-reasoning models (and unknown ids) pass through untouched.
 */
export function maxTokensWithReasoningHeadroom(
  id: string,
  maxTokens: number
): number {
  const model = modelById(id);
  if (!model || !("reasoning" in model) || !model.reasoning) return maxTokens;
  return Math.min(
    maxTokens * REASONING_TOKEN_MULTIPLIER,
    model.maxCompletionTokens
  );
}

export const SINGLE_MODEL_ITEMS = [
  { value: "", label: `Default (${CANDIDATE_MODELS[0].label})` },
  ...CANDIDATE_MODELS.map((model) => ({ value: model.id, label: model.label })),
];

// Compare-mode picker slots: each slot holds a model id or "" (Random).
// Both Random → undefined (server draws the pair at reserve time). One model
// + Random → fill the open slot here so the pair persists for retries.
// Random fills draw from Anthropic models only: a surprise OpenRouter pick
// must never silently require the second API key or a different cost profile.
export function comparePairFromSlots(
  slotA: string,
  slotB: string
): string[] | undefined {
  const picked = [slotA, slotB].filter(Boolean);
  if (picked.length === 0) return undefined;
  if (picked.length === 2) return picked;
  const rest = CANDIDATE_MODELS.filter(
    (m) => m.id !== picked[0] && m.gateway === "anthropic"
  );
  return [picked[0], rest[Math.floor(Math.random() * rest.length)].id];
}

/** Human summary of the current slots, e.g. "Sonnet 4.6 vs Random". */
export function comparePairLabel(slotA: string, slotB: string): string {
  const name = (id: string) =>
    CANDIDATE_MODELS.find((m) => m.id === id)?.label ?? "Random";
  return slotA || slotB ? `${name(slotA)} vs ${name(slotB)}` : "Random pair";
}
