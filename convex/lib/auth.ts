import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Verify that the caller owns the given project (authenticated + createdBy match).
 * Returns the project document if authorized, or null otherwise.
 */
export async function assertProjectOwner(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">
) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const project = await ctx.db.get(projectId);
  if (!project || project.createdBy !== userId) return null;
  return project;
}

/**
 * Verify that the caller has access to the given project, either as:
 * 1. The authenticated owner (writer), or
 * 2. A client reviewer with a valid share token.
 *
 * Returns the project document if authorized, or null otherwise.
 */
export async function assertProjectAccess(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  shareToken?: string
) {
  // Try authenticated owner first
  const ownerProject = await assertProjectOwner(ctx, projectId);
  if (ownerProject) return ownerProject;

  // Fall back to share token validation
  if (shareToken) {
    const project = await ctx.db.get(projectId);
    if (project && project.shareToken === shareToken) return project;
  }

  return null;
}
