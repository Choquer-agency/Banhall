export const MODEL = "claude-sonnet-4-6";

export const CANDIDATE_MODELS = [
  { id: MODEL, label: "Sonnet 4.6" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
] as const;

export type CandidateModelId = (typeof CANDIDATE_MODELS)[number]["id"];

export const SINGLE_MODEL_ITEMS = [
  { value: "", label: `Default (${CANDIDATE_MODELS[0].label})` },
  ...CANDIDATE_MODELS.map((model) => ({ value: model.id, label: model.label })),
];
