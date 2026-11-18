/**
 * Pure helpers for the Brain's floor calibration (2026-11-18 (fourth), the
 * Brain moves to Voyage 4). `brain:calibrateSearchIndexes` runs probes
 * against both search indexes and both rerankers; these turn the scores into
 * the plain numbers it reports. No imports, so a unit test needs no runtime.
 */

/** Off-topic probe queries: nothing in an SR&ED project description should match them well. */
export const CALIBRATION_OFF_TOPIC_QUERIES = [
  "A recipe for banana bread with walnuts and brown sugar",
  "The rules of a cricket match and how a batter is out",
  "How to plan a beach wedding on a small budget",
  "Tips for repotting a houseplant in the spring",
  "The history of the Roman calendar and leap years",
] as const;

export type ScoreSummary = {
  count: number;
  min: number | null;
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  max: number | null;
};

const round = (n: number) => Math.round(n * 1000) / 1000;

/** The value at fraction `q` (0 to 1) of sorted scores, by nearest rank. */
function quantile(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}

/** Count, min, p10, p25, p50, p75, p90 and max of a list of scores, to 3 places. */
export function summarizeScores(scores: number[]): ScoreSummary {
  const sorted = scores.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { count: 0, min: null, p10: null, p25: null, p50: null, p75: null, p90: null, max: null };
  }
  return {
    count: sorted.length,
    min: round(sorted[0]),
    p10: round(quantile(sorted, 0.1)),
    p25: round(quantile(sorted, 0.25)),
    p50: round(quantile(sorted, 0.5)),
    p75: round(quantile(sorted, 0.75)),
    p90: round(quantile(sorted, 0.9)),
    max: round(sorted[sorted.length - 1]),
  };
}

/** The share of scores at or above a floor (0 for no scores). */
export function passRate(scores: number[], floor: number): number {
  if (scores.length === 0) return 0;
  return scores.filter((score) => score >= floor).length / scores.length;
}

/**
 * The floor that lets the same share of `scores` through as `rate`: the
 * lowest score still inside the top `rate` share. Null with no scores; 0
 * when every score should pass; just above the top score when none should.
 */
export function floorForPassRate(scores: number[], rate: number): number | null {
  const sorted = scores.filter(Number.isFinite).sort((a, b) => b - a);
  if (sorted.length === 0) return null;
  const keep = Math.round(rate * sorted.length);
  if (keep >= sorted.length) return 0;
  if (keep <= 0) return round(sorted[0] + 0.001);
  return round(sorted[keep - 1]);
}

/**
 * A probe query made from a source's own text: about 500 characters from
 * a third of the way in, cut at spaces, so it reads like a passage of the
 * PD and not its title page. Whitespace is collapsed.
 */
export function probeQueryFrom(content: string, length = 500): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (text.length <= length) return text;
  let start = Math.floor(text.length / 3);
  const space = text.indexOf(" ", start);
  if (space !== -1 && space - start < 50) start = space + 1;
  let end = Math.min(text.length, start + length);
  const back = text.lastIndexOf(" ", end);
  if (back > start + length / 2) end = back;
  return text.slice(start, end).trim();
}

/**
 * Up to `n` items spread over groups (industry and science code): one from
 * each group in turn, in the order given, until `n` are picked.
 */
export function pickSpread<T>(items: T[], n: number, groupOf: (item: T) => string): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = groupOf(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  const out: T[] = [];
  const queues = [...groups.values()];
  for (let round = 0; out.length < n && queues.some((q) => q.length > round); round += 1) {
    for (const queue of queues) {
      if (out.length >= n) break;
      if (queue.length > round) out.push(queue[round]);
    }
  }
  return out;
}

/** Voyage's billed tokens from a raw response body (`usage.total_tokens`), 0 when absent. */
export function billedTokens(body: unknown): number {
  if (!body || typeof body !== "object" || !("usage" in body)) return 0;
  const usage = (body as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object" || !("total_tokens" in usage)) return 0;
  const tokens = (usage as { total_tokens?: unknown }).total_tokens;
  return typeof tokens === "number" && Number.isFinite(tokens) ? tokens : 0;
}
