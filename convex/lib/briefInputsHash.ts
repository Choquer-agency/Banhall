import { sha256 } from "./contracts";
import type { Doc } from "../_generated/dataModel";
import { readsFactPacks } from "./seedFacts";
import { FACTS_VERSION } from "./transcriptFacts";

/**
 * Compute the input hash for a Brief, using the contentHash of every frozen
 * generationSources row EXCEPT kinds `writer_storyline`, `transcript_digest` and `transcript_facts`.
 *
 * This is the sole place the hash is computed. Identical inputs (same project,
 * same set of frozen sources with the same content) produce the same hash,
 * enabling Brief reuse across generations.
 *
 * The exclusions mean:
 * - `writer_storyline` rows don't affect the hash (writer input is separate)
 * - `transcript_digest` rows don't affect it (condensed form doesn't impact
 *   the Brief's input set — the full transcript is the input)
 * - `transcript_facts` rows (2026-09-24) are excluded for the same reason:
 *   a fact pack is derived from the frozen transcript row.
 *
 * A generation that reads fact packs (every transcript has one) adds a
 * marker with FACTS_VERSION (review 2026-09-25, P3-4): its Brief reads the
 * packs and cites only verified client spans, so it is never reused for a
 * draft that reads the transcripts, nor the other way round. Without packs
 * the hash is exactly what it was.
 */
export async function briefInputsHash(
  sources: Array<Omit<Doc<"generationSources">, "_id" | "_creationTime">>
): Promise<string> {
  // Filter to only the kinds that matter for input matching
  const relevantSources = sources.filter(
    (s) =>
      s.kind !== "writer_storyline" &&
      s.kind !== "transcript_digest" &&
      s.kind !== "transcript_facts"
  );

  // Sort by sourceId to ensure deterministic ordering
  const sorted = relevantSources.sort((a, b) => {
    const aId = JSON.stringify(a);
    const bId = JSON.stringify(b);
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });

  // Concatenate all content hashes
  const concatenated =
    sorted.map((s) => s.contentHash).join("|") +
    (readsFactPacks(sources) ? `|facts:${FACTS_VERSION}` : "");

  // Return the hash of the concatenated hashes
  return await sha256(concatenated);
}
