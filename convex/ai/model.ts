import {
  CANDIDATE_MODELS,
  MODEL,
  RANDOM_COMPARISON_GATEWAY,
  type CandidateModelId,
} from "../../shared/generationModels";

export { CANDIDATE_MODELS, MODEL };

/**
 * Candidate models for generation comparison (BNH-15). Compare mode runs the
 * pipeline once per model in the writer's chosen pair (2 models); single mode
 * runs one explicitly selected model, falling back to Sonnet when no selection
 * is supplied. Iterative mode (section-by-section) uses single-model
 * semantics: one explicitly selected model, defaulting to Sonnet.
 */
export type { CandidateModelId };
export type CandidateMode = "compare" | "single" | "iterative";

export const CANDIDATE_MODE_ROUTING = {
  compare: {
    selectionRule: "exactly-two-distinct-registered-model-ids",
    explicitSelectionCount: 2,
    legacyFallbackGateway: "anthropic",
    randomPoolGateway: RANDOM_COMPARISON_GATEWAY,
  },
  single: {
    selectionRule: "one-valid-registered-model-id",
    selectionCount: 1,
    fallbackModelId: MODEL,
  },
  iterative: {
    resolvesAs: "single",
    selectionRule: "one-valid-registered-model-id",
    selectionCount: 1,
    fallbackModelId: MODEL,
  },
} as const;

type CandidateModel = (typeof CANDIDATE_MODELS)[number];

/**
 * Resolve a persisted compare pair to model entries: filters to known
 * CANDIDATE_MODELS ids and dedupes. Returns the two entries when exactly 2
 * distinct valid ids remain; otherwise undefined (caller decides fallback).
 */
export function resolveCompareModels(
  compareModelIds?: string[]
): CandidateModel[] | undefined {
  if (!compareModelIds) return undefined;
  const valid = [...new Set(compareModelIds)]
    .map((id) => CANDIDATE_MODELS.find((model) => model.id === id))
    .filter((model): model is CandidateModel => model !== undefined);
  return valid.length === CANDIDATE_MODE_ROUTING.compare.explicitSelectionCount
    ? valid
    : undefined;
}

/**
 * Two distinct random entries — Anthropic models only. A random draw must
 * never silently require the OpenRouter key or pick up a different cost
 * profile; OpenAI/Google models are always an explicit writer choice.
 */
export function randomComparePair(): CandidateModel[] {
  const shuffled = CANDIDATE_MODELS.filter(
    (model) =>
      model.gateway === CANDIDATE_MODE_ROUTING.compare.randomPoolGateway
  );
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, 2);
}

export function candidateModelsForMode(
  mode: CandidateMode,
  singleModelId?: CandidateModelId,
  compareModelIds?: string[]
) {
  if (mode === "compare") {
    // Legacy in-flight generations (no persisted pair) still run the original
    // 3 Anthropic models — NOT the full roster, which now includes OpenRouter
    // models that would 7x the run and require a second key. New requests
    // always persist exactly 2 ids.
    return (
      resolveCompareModels(compareModelIds) ??
      CANDIDATE_MODELS.filter(
        (model) =>
          model.gateway === CANDIDATE_MODE_ROUTING.compare.legacyFallbackGateway
      )
    );
  }
  // "single" and "iterative" both run exactly one model.
  const routing =
    mode === "iterative"
      ? CANDIDATE_MODE_ROUTING.iterative
      : CANDIDATE_MODE_ROUTING.single;
  const selected = singleModelId
    ? CANDIDATE_MODELS.find((model) => model.id === singleModelId)
    : undefined;
  return [
    selected ??
      CANDIDATE_MODELS.find(
        (model) => model.id === routing.fallbackModelId
      ) ??
      CANDIDATE_MODELS[0],
  ];
}
