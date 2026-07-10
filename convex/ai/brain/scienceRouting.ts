import type { CraScienceCode } from "../../../shared/craScienceCodes";

/** Max chunks from one source PD in a result set (MMR-lite source diversity). */
const PER_ENTRY_CAP = 2;

type ScienceRoutable = {
  entryId: string;
  scienceCode?: CraScienceCode;
};

/**
 * Prefer exact CRA science-code exemplars without making the Brain brittle.
 * Exact-code candidates keep their relevance order and form the first group;
 * cross-code and legacy unclassified candidates then fill any remaining slots.
 * With no project code, retrieval remains relevance-ordered as before.
 */
export function pickScienceRouted<T extends ScienceRoutable>(
  relevanceSorted: T[],
  k: number,
  scienceCode?: CraScienceCode
): T[] {
  let exactMatches: T[] | undefined;
  let fallback: T[] | undefined;
  if (scienceCode) {
    exactMatches = [];
    fallback = [];
    for (const candidate of relevanceSorted) {
      (candidate.scienceCode === scienceCode ? exactMatches : fallback).push(
        candidate
      );
    }
  }
  const groups = exactMatches && fallback
    ? [exactMatches, fallback]
    : [relevanceSorted];
  const perEntry = new Map<string, number>();
  const picked: T[] = [];
  for (const group of groups) {
    for (const candidate of group) {
      const count = perEntry.get(candidate.entryId) ?? 0;
      if (count >= PER_ENTRY_CAP) continue;
      perEntry.set(candidate.entryId, count + 1);
      picked.push(candidate);
      if (picked.length >= k) return picked;
    }
  }
  return picked;
}
