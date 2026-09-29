/**
 * The notification toaster's memory for one page load (owner, 2026-09-28
 * eighth). Each route's shell mounts its own toaster, so which unseen rows
 * were already waiting when the page loaded, and whether the person opened
 * them from the pill, live here rather than in the component. Sign-out
 * forgets both, so the next person on this tab gets their own reading.
 */
type Row = { _id: string; seenAt?: number; createdAt: number };

let waitingIds: Set<string> | null = null;
let waitingShown = $state(false);

export const notificationSession = {
  /**
   * The first defined answer decides, once: unseen rows written more than
   * `graceMs` before it were waiting. Any row that arrives later is new.
   */
  waiting(rows: readonly Row[] | undefined, graceMs: number): ReadonlySet<string> | null {
    if (waitingIds === null && rows) {
      const cutoff = Date.now() - graceMs;
      waitingIds = new Set(rows.filter((row) => row.seenAt === undefined && row.createdAt < cutoff).map((row) => String(row._id)));
    }
    return waitingIds;
  },
  get waitingShown() {
    return waitingShown;
  },
  showWaiting() {
    waitingShown = true;
  },
  clear() {
    waitingIds = null;
    waitingShown = false;
  },
};
