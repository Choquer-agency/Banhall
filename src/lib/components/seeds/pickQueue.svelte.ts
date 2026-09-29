/**
 * One queue of seed picks per run (owner, 2026-09-28; review P2-1).
 *
 * A tick shows at once and its save is queued here, not in the pane, so a
 * pick the writer made just before opening another step still reaches the
 * server after that pane is gone. Picks go one at a time: each is sent
 * against the seed-stage version the previous answer returned (or the
 * newest version the caller knows, whichever is later), so the server's
 * decision fence is kept and rapid ticks never refuse each other.
 */
import { userErrorCode } from "$lib/errors";

type Lane = { tail: Promise<unknown>; version: number | null };

const lanes = new Map<string, Lane>();
const waiting = $state<Record<string, number>>({});

export type PickOutcome = { ok: true } | { ok: false; error: unknown };

/** Picks of this run still on their way; reactive. */
export function queuedPicks(runKey: string): number {
  return waiting[runKey] ?? 0;
}

/** Queues one pick for the run. `knownVersion` is read when the pick is sent. */
export function enqueuePick(
  runKey: string,
  knownVersion: () => number,
  send: (expectedSeedStageVersion: number) => Promise<unknown>
): Promise<PickOutcome> {
  const lane = lanes.get(runKey) ?? { tail: Promise.resolve(), version: null };
  lanes.set(runKey, lane);
  waiting[runKey] = (waiting[runKey] ?? 0) + 1;
  const run = lane.tail.then(async (): Promise<PickOutcome> => {
    // Everything, including reading the caller's version, sits inside the try:
    // a throw here must still count the pick as done, or the run's other
    // decisions stay disabled and later picks never send.
    try {
      const expected = Math.max(lane.version ?? -1, knownVersion());
      const answer = await send(expected);
      const version = (answer as { seedStageVersion?: unknown } | null | undefined)?.seedStageVersion;
      lane.version = typeof version === "number" ? version : null;
      return { ok: true };
    } catch (error) {
      // A coded refusal wrote nothing, so the version this lane knows still
      // holds (a closed pane's own version can be older). After a version
      // conflict or a failure that may have saved, the next pick uses the
      // newest version the caller knows.
      const code = userErrorCode(error);
      if (code === null || code === "STALE_REVISION") lane.version = null;
      return { ok: false, error };
    } finally {
      const left = (waiting[runKey] ?? 1) - 1;
      if (left > 0) waiting[runKey] = left;
      else {
        delete waiting[runKey];
        if (lanes.get(runKey) === lane) lanes.delete(runKey);
      }
    }
  });
  // The next pick waits for this one however it ends; the tail never rejects.
  lane.tail = run.catch(() => undefined);
  return run;
}
