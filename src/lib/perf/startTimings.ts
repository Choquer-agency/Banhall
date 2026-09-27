/**
 * Cheap timing marks for the Step-by-step start (decision 65, stage 2):
 * the writer confirms the start dialog (F1), the generation is reserved,
 * and the first ideas are on screen. They are User Timing entries, so they
 * cost nothing unless read, and survive the page change to the project.
 *
 * To measure, start a run from New project and, on the project page, run
 * `performance.getEntriesByType("measure").filter((m) => m.name.startsWith("banhall:"))`
 * in the browser console, or read the Timings track of a DevTools
 * Performance recording. `banhall:confirm-to-reservation` and
 * `banhall:confirm-to-first-seeds` are the two spans; each confirm starts
 * a new pair.
 */
export const START_MARKS = {
  confirmed: "banhall:start-confirmed",
  reserved: "banhall:start-reserved",
  firstSeeds: "banhall:first-seeds",
} as const;

export const START_MEASURES = {
  toReservation: "banhall:confirm-to-reservation",
  toFirstSeeds: "banhall:confirm-to-first-seeds",
} as const;

function timeline(): Performance | null {
  return typeof performance !== "undefined" && typeof performance.mark === "function" ? performance : null;
}

function has(name: string): boolean {
  return (timeline()?.getEntriesByName(name, "mark").length ?? 0) > 0;
}

/** The writer confirmed the start dialog: a new pair of spans begins. */
export function markStartConfirmed(): void {
  const perf = timeline();
  if (!perf) return;
  for (const name of Object.values(START_MARKS)) perf.clearMarks(name);
  perf.mark(START_MARKS.confirmed);
}

/** The generation was reserved. */
export function markStartReserved(): void {
  const perf = timeline();
  if (!perf || !has(START_MARKS.confirmed) || has(START_MARKS.reserved)) return;
  perf.mark(START_MARKS.reserved);
  perf.measure(START_MEASURES.toReservation, START_MARKS.confirmed, START_MARKS.reserved);
}

/** The first ideas are on screen (once per confirm). */
export function markFirstSeeds(): void {
  const perf = timeline();
  if (!perf || !has(START_MARKS.confirmed) || has(START_MARKS.firstSeeds)) return;
  perf.mark(START_MARKS.firstSeeds);
  perf.measure(START_MEASURES.toFirstSeeds, START_MARKS.confirmed, START_MARKS.firstSeeds);
}
