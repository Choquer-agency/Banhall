import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

type ActiveStatus =
  | "reserved"
  | "running"
  | "awaiting_selection"
  | "awaiting_input";

/**
 * Find a generation in one of the given active states for a project.
 * Checks the activeGenerationId pointer first, then ALWAYS falls back to
 * the status index — deliberately: legacy projects predate the pointer,
 * and an orphaned active row (pointer moved on) still means a generation
 * is live/awaiting a pick and must be surfaced (mirrors the original run
 * guard, which forbade a second generation while any such row existed).
 */
export async function findActiveGeneration(
  ctx: QueryCtx,
  project: Doc<"projects">,
  statuses: readonly ActiveStatus[]
): Promise<Doc<"generations"> | null> {
  if (project.activeGenerationId) {
    const active = await ctx.db.get(project.activeGenerationId);
    if (active && (statuses as readonly string[]).includes(active.status)) {
      return active;
    }
  }
  for (const status of statuses) {
    const legacyActive = await ctx.db
      .query("generations")
      .withIndex("by_projectId_and_status", (q) =>
        q.eq("projectId", project._id).eq("status", status)
      )
      .first();
    if (legacyActive) return legacyActive;
  }
  return null;
}
