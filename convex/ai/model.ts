import {
  acceptsForcedToolChoice,
  CANDIDATE_MODELS,
  MODEL,
  RANDOM_COMPARISON_GATEWAY,
  modelById,
  type CandidateModelId,
  type ModelEntry,
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

type CandidateModel = ModelEntry;

/**
 * The roster a legacy in-flight compare generation (no persisted pair) ran
 * before pairs were persisted: the three Anthropic models of that time.
 * Pinned by id, so an Anthropic model added to the seed later never joins it.
 */
export const LEGACY_COMPARE_MODEL_IDS = [
  MODEL,
  "claude-opus-4-8",
  "claude-haiku-4-5-20251001",
] as const;

/**
 * Resolve a persisted compare pair to model entries: filters to known ids
 * (seed, or registered from the generation's frozen catalog entries) and
 * dedupes. Returns the two entries when exactly 2 distinct valid ids remain;
 * otherwise undefined (caller decides fallback). `lookup` lets a mutation
 * resolve against the catalog table instead of the runtime registry.
 */
export function resolveCompareModels(
  compareModelIds?: string[],
  lookup: (id: string) => CandidateModel | undefined = modelById
): CandidateModel[] | undefined {
  if (!compareModelIds) return undefined;
  const valid = [...new Set(compareModelIds)]
    .map((id) => lookup(id))
    .filter((model): model is CandidateModel => model !== undefined);
  return valid.length === CANDIDATE_MODE_ROUTING.compare.explicitSelectionCount
    ? valid
    : undefined;
}

/**
 * Two distinct random entries, Anthropic models only. A random draw must
 * never silently require the OpenRouter key or pick up a different cost
 * profile; OpenAI/Google models are always an explicit writer choice. The
 * pool is the models a writer may pick today (the catalog's enabled set).
 */
export function randomComparePair(
  pool: readonly CandidateModel[] = CANDIDATE_MODELS
): CandidateModel[] {
  // Models that reject a forced tool call stay an explicit choice: they
  // run structured steps without the forced call.
  const shuffled = pool.filter(
    (model) =>
      model.gateway === CANDIDATE_MODE_ROUTING.compare.randomPoolGateway &&
      acceptsForcedToolChoice(model.id)
  );
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, 2);
}

export function candidateModelsForMode(
  mode: CandidateMode,
  singleModelId?: string,
  compareModelIds?: string[]
) {
  if (mode === "compare") {
    // Legacy in-flight generations (no persisted pair) still run the original
    // 3 Anthropic models, NOT the full roster, which now includes OpenRouter
    // models that would multiply the run and require a second key, and newer
    // Anthropic models. New requests always persist exactly 2 ids.
    return (
      resolveCompareModels(compareModelIds) ??
      (CANDIDATE_MODELS as readonly CandidateModel[]).filter(
        (model) =>
          model.gateway === CANDIDATE_MODE_ROUTING.compare.legacyFallbackGateway &&
          (LEGACY_COMPARE_MODEL_IDS as readonly string[]).includes(model.id)
      )
    );
  }
  // "single" and "iterative" both run exactly one model.
  const routing =
    mode === "iterative"
      ? CANDIDATE_MODE_ROUTING.iterative
      : CANDIDATE_MODE_ROUTING.single;
  // The selected id resolves through the registry, so a catalog model
  // frozen on the generation (registered by the action) is honoured.
  const selected = singleModelId ? modelById(singleModelId) : undefined;
  return [
    selected ??
      modelById(routing.fallbackModelId) ??
      (CANDIDATE_MODELS[0] as CandidateModel),
  ];
}
