export const MODEL = "claude-sonnet-4-6";

// Provider logomark served from static/ (no external favicon dependency).
export const PROVIDER_LOGO_URL = "/images/icons/Anthropic.svg";

export const CANDIDATE_MODELS = [
  {
    id: MODEL,
    label: "Sonnet 4.6",
    provider: "Anthropic",
    description: "Balanced default — strong technical writing at a mid price point.",
  },
  {
    id: "claude-opus-4-8",
    label: "Opus 4.8",
    provider: "Anthropic",
    description: "Most capable — deepest reasoning for dense technical claims.",
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Haiku 4.5",
    provider: "Anthropic",
    description: "Fastest and cheapest — good for quick comparison baselines.",
  },
] as const;

export type CandidateModelId = (typeof CANDIDATE_MODELS)[number]["id"];

export const SINGLE_MODEL_ITEMS = [
  { value: "", label: `Default (${CANDIDATE_MODELS[0].label})` },
  ...CANDIDATE_MODELS.map((model) => ({ value: model.id, label: model.label })),
];

// Compare-mode picker slots: each slot holds a model id or "" (Random).
// Both Random → undefined (server draws the pair at reserve time). One model
// + Random → fill the open slot here so the pair persists for retries.
export function comparePairFromSlots(
  slotA: string,
  slotB: string
): string[] | undefined {
  const picked = [slotA, slotB].filter(Boolean);
  if (picked.length === 0) return undefined;
  if (picked.length === 2) return picked;
  const rest = CANDIDATE_MODELS.filter((m) => m.id !== picked[0]);
  return [picked[0], rest[Math.floor(Math.random() * rest.length)].id];
}

/** Human summary of the current slots, e.g. "Sonnet 4.6 vs Random". */
export function comparePairLabel(slotA: string, slotB: string): string {
  const name = (id: string) =>
    CANDIDATE_MODELS.find((m) => m.id === id)?.label ?? "Random";
  return slotA || slotB ? `${name(slotA)} vs ${name(slotB)}` : "Random pair";
}
