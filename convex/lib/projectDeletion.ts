import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * Story 0 (AD-19) deletion barrier. True once `projects.deleteProject` has
 * stamped `deletionStartedAt`, and stays true after the purge deletes the
 * row: a project that no longer exists must not be repopulated either.
 *
 * Writers check in their mutation transaction, so the barrier and the write
 * cannot race. Async callbacks can stop without writing; public access gates
 * reject new work. Retained billing is recorded without the project link.
 */
export async function isProjectDeleting(
  ctx: { db: QueryCtx["db"] },
  projectId: Id<"projects">
): Promise<boolean> {
  const project = await ctx.db.get(projectId);
  return project === null || project.deletionStartedAt !== undefined;
}
