/**
 * Central model configuration for all AI agents.
 *
 * Change the model in ONE place here — every agent (report generation,
 * chat, QA, chronology, financial) imports `MODEL` from this file.
 *
 * Current Claude model ids (as of 2026):
 *   - Opus 4.8:    "claude-opus-4-8"            (highest quality, ~5x Sonnet cost)
 *   - Sonnet 4.6:  "claude-sonnet-4-6"          (balanced — current default)
 *   - Haiku 4.5:   "claude-haiku-4-5-20251001"  (cheapest/fastest)
 */
export const MODEL = "claude-sonnet-4-6";

/**
 * Candidate models for A/B testing (BNH-15). Compare mode runs the full
 * pipeline once per configured model; single mode runs only the first/default
 * Sonnet model. Edit this list to change which models compete.
 */
export const CANDIDATE_MODELS = [
  { id: MODEL, label: "Sonnet 4.6" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
] as const;

export type CandidateMode = "compare" | "single";

const SINGLE_CANDIDATE_MODELS = [CANDIDATE_MODELS[0]] as const;

export function candidateModelsForMode(mode: CandidateMode) {
  return mode === "single" ? SINGLE_CANDIDATE_MODELS : CANDIDATE_MODELS;
}
