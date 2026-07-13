import {
  CANDIDATE_MODELS,
  MODEL,
  type CandidateModelId,
} from "../../shared/generationModels";

export { CANDIDATE_MODELS, MODEL };

/**
 * Candidate models for generation comparison (BNH-15). Compare mode runs the full
 * pipeline once per configured model; single mode runs one explicitly selected
 * model, falling back to Sonnet when no selection is supplied.
 */
export type { CandidateModelId };
export type CandidateMode = "compare" | "single";

export function candidateModelsForMode(
  mode: CandidateMode,
  singleModelId?: CandidateModelId
) {
  if (mode === "compare") return CANDIDATE_MODELS;
  const selected = singleModelId
    ? CANDIDATE_MODELS.find((model) => model.id === singleModelId)
    : undefined;
  return [selected ?? CANDIDATE_MODELS[0]];
}
