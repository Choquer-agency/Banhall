/**
 * H3 consumer defense (2026-08-06 correction): exact per-client stageCounts
 * are trusted ONLY when they are internally consistent with the maintained
 * projectCount. An empty record on a row that still counts projects, or any
 * sum mismatch, is treated as not-backfilled/unavailable — the surface then
 * fails honest (loaded-only counts, nothing hidden) instead of presenting a
 * divergent record as exact truth.
 */
export function verifiedStageCounts(
  stageCounts: Record<string, number> | undefined,
  projectCount: number
): Record<string, number> | undefined {
  if (stageCounts === undefined) return undefined;
  const sum = Object.values(stageCounts).reduce((total, count) => total + count, 0);
  if (sum !== projectCount) return undefined;
  return stageCounts;
}
