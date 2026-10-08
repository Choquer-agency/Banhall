/**
 * Delete a project from its card, row or page (owner request 2026-10-07,
 * Paper boards K1 to K4). `projects.deleteProject` decides: only the
 * project's creator or an admin may delete it (docs/product-domain.md keeps
 * that rule pending a separate decision), and open work refuses it. This
 * mirrors the first rule so the action is offered only to people who can use
 * it; the server check stays the guard.
 *
 * Pure helpers only: no `$app` imports, so unit tests can load this module.
 */

type Viewer = {
  _id: string;
  role?: string | null;
  isAnonymous?: boolean;
};

/**
 * Whether `viewer` may delete a project created by `createdBy`. Unknown
 * (still loading, or a row that does not say who created it) reads as no,
 * as does a project already being deleted.
 */
export function canDeleteProject(
  viewer: Viewer | null | undefined,
  createdBy: string | null | undefined,
  deleting = false
): boolean {
  if (deleting || !viewer || viewer.isAnonymous === true || !viewer.role) return false;
  // Stricter than the server for an admin on a row without a creator, on
  // purpose: projects.createdBy is required and every row source projects
  // it, so only a source that leaves it out (Home's With you, which always
  // carries open work) lands here, and there a delete would be refused.
  if (createdBy === undefined || createdBy === null) return false;
  return viewer.role === "admin" || createdBy === viewer._id;
}
