import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * Story 0 (AD-19) deletion barrier. True once `projects.deleteProject` has
 * stamped `deletionStartedAt`, and stays true after the purge deletes the
 * row: a project that no longer exists must not be repopulated either.
 *
 * Checked only by async writers that can land after a deletion started
 * (candidate/section run claims, the post-QA action's entry). They return
 * early without writing; nothing throws, so a late scheduled job simply
 * finishes as a no-op.
 */
export async function isProjectDeleting(
  ctx: { db: QueryCtx["db"] },
  projectId: Id<"projects">
): Promise<boolean> {
  const project = await ctx.db.get(projectId);
  return project === null || project.deletionStartedAt !== undefined;
}
