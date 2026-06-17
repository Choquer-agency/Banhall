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
