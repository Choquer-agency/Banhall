import type { SeedSummaryItem } from "./types";

/**
 * Typed readers for Summary item fields that the backend adds in the same
 * build (be-workflow): `edited` and `provenance`. They read the fields when
 * present and fall back safely while an older DTO lacks them, so the Summary
 * compiles and renders before and after that merge.
 */

/** A cited excerpt behind a Summary item, with its source position when known. */
export type SummaryCitation = {
  sourceId: string;
  exactExcerpt: string;
  speaker?: string;
  line?: number;
};

/** True when the writer changed the item's wording by hand. */
export function itemEdited(item: SeedSummaryItem): boolean {
  return (item as { edited?: unknown }).edited === true;
}

/** The item's cited excerpts, or none when the DTO carries no provenance. */
export function itemCitations(item: SeedSummaryItem): SummaryCitation[] {
  const provenance = (item as { provenance?: unknown }).provenance;
  if (!Array.isArray(provenance)) return [];
  const citations: SummaryCitation[] = [];
  for (const entry of provenance) {
    if (!entry || typeof entry !== "object") continue;
    const { sourceId, exactExcerpt, speaker, line } = entry as Record<string, unknown>;
    if (typeof exactExcerpt !== "string" || exactExcerpt.trim() === "") continue;
    citations.push({
      sourceId: String(sourceId ?? ""),
      exactExcerpt,
      ...(typeof speaker === "string" && speaker.trim() ? { speaker: speaker.trim() } : {}),
      ...(typeof line === "number" && Number.isFinite(line) ? { line } : {}),
    });
  }
  return citations;
}

/** "Priya, line 18" when the transcript gives both; never claims a speaker it
 * does not have. */
export function citationSourceLabel(citation: SummaryCitation): string {
  if (citation.speaker && citation.line !== undefined) return `${citation.speaker}, line ${citation.line}`;
  if (citation.speaker) return citation.speaker;
  if (citation.line !== undefined) return `Line ${citation.line}`;
  return "Cited excerpt";
}
