/**
 * Typed readers for optional DTO fields that the backend adds in the same
 * build (be-workflow): outline rows gain `approvedAt`, provenance citations
 * gain `speaker` and `line`. Until those fields are on every DTO the readers
 * return null, so the plan compiles and renders honestly either way.
 */
import type { SeedCardData, SeedOutlineRow } from "./types";

export type SeedCitation = SeedCardData["provenance"][number];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/** When the step was last approved, even if a later change reopened it. */
export function rowApprovedAt(row: SeedOutlineRow | null | undefined): number | null {
  const value = record(row)?.approvedAt;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The speaker of a quoted transcript line, when the transcript names one. */
export function citationSpeaker(citation: SeedCitation): string | null {
  const value = record(citation)?.speaker;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The transcript line number of a quote, when the transcript gives one. */
export function citationLine(citation: SeedCitation): number | null {
  const value = record(citation)?.line;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** "Priya, line 18", "Priya", "Line 18", or null. */
export function citationSpeakerLine(citation: SeedCitation): string | null {
  const speaker = citationSpeaker(citation);
  const line = citationLine(citation);
  if (speaker && line !== null) return `${speaker}, line ${line}`;
  if (speaker) return speaker;
  if (line !== null) return `Line ${line}`;
  return null;
}
