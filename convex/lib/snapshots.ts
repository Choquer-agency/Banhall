import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const HARD_CAP = 50;

/**
 * Log-thinning retention for report version history. Keeps storage bounded
 * while preserving a sensible spread of restore points:
 *   - everything from the last hour (dense recent history)
 *   - one per hour for the last day
 *   - one per day beyond that
 *   - hard cap of 50 snapshots per report (oldest pruned first)
 *
 * Bounds each report to ~50 small JSON docs (~1MB) no matter how long someone
 * edits. Called after inserting any new snapshot.
 */
export async function pruneSnapshots(
  ctx: MutationCtx,
  reportId: Id<"reports">
) {
  const now = Date.now();
  const snaps = await ctx.db
    .query("reportSnapshots")
    .withIndex("by_reportId", (q) => q.eq("reportId", reportId))
    .order("desc")
    .collect();

  const seen = new Set<string>();
  const kept: typeof snaps = [];
  const toDelete: typeof snaps = [];

  for (const s of snaps) {
    const age = now - s.createdAt;
    let bucket: string;
    if (age < HOUR) {
      bucket = `r:${s._id}`; // keep every snapshot in the last hour
    } else if (age < DAY) {
      bucket = `h:${Math.floor(s.createdAt / HOUR)}`; // one per hour
    } else {
      bucket = `d:${Math.floor(s.createdAt / DAY)}`; // one per day
    }
    // snaps are newest-first, so the first seen in a bucket is the newest.
    if (seen.has(bucket)) {
      toDelete.push(s);
    } else {
      seen.add(bucket);
      kept.push(s);
    }
  }

  // Hard cap — drop the oldest survivors beyond the cap.
  if (kept.length > HARD_CAP) {
    toDelete.push(...kept.slice(HARD_CAP));
  }

  for (const s of toDelete) {
    await ctx.db.delete(s._id);
  }
}
