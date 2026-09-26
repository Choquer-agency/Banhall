/**
 * "Reading the interview" (board F2) copy and pace. The pill's fill is a
 * time-based estimate from recent Briefs (decision 57), held at 95% until
 * the Brief has really landed; the count is the facts found so far.
 */

/** Percent of the pill filled: elapsed over expected, at most 95 until done. */
export function readingPercent(now: number, startedAt: number, expectedMs: number, done: boolean): number {
  if (done) return 100;
  if (!(expectedMs > 0)) return 0;
  const elapsed = Math.max(0, now - startedAt);
  return Math.min(95, Math.max(0, (elapsed / expectedMs) * 100));
}

/** "Looking for facts", "1 fact found so far", "6 facts found so far"; the phone says "6 facts". */
export function factCountText(count: number, compact = false): string {
  if (count <= 0) return compact ? "Looking for facts" : "Looking for facts";
  if (compact) return `${count} ${count === 1 ? "fact" : "facts"}`;
  return `${count} ${count === 1 ? "fact" : "facts"} found so far`;
}

/**
 * Opacity of the newest to the oldest card on screen, which also sets how
 * many show: three on the desktop (F2) and the phone (H4), two on a tablet
 * (H3). The phone and tablet boards fade to 55% and 25%.
 */
export function factOpacities(layout: "desktop" | "tablet" | "phone"): readonly number[] {
  if (layout === "phone") return [1, 0.55, 0.25];
  if (layout === "tablet") return [1, 0.55];
  return [1, 0.6, 0.3];
}
