/**
 * Duplicate a project from its card or row (owner request 2026-09-25): the
 * action opens the New project wizard prefilled from the project, with every
 * transcript and file carried over, and Step by step preselected so the
 * writer can plan the new report from that material.
 *
 * Pure helpers only: no `$app` imports, so unit tests can load this module.
 */
import { hasCapability, type CapabilityRole } from "../../../shared/capabilities";

/** The wizard's Drafts modes, in the order the wizard shows them. */
export const DRAFT_MODE_IDS = ["compare", "single", "iterative"] as const;
export type DraftModeId = (typeof DRAFT_MODE_IDS)[number];

/** The Drafts mode a card's Duplicate action asks the wizard to preselect. */
export const DUPLICATE_DRAFT_MODE: DraftModeId = "iterative";

/**
 * The wizard's optional `drafts` query value. Only an exact Drafts mode id is
 * accepted; anything else (missing, empty, mixed case, unknown) is ignored.
 */
export function parseDraftModeParam(value: string | null | undefined): DraftModeId | null {
  if (!value) return null;
  return (DRAFT_MODE_IDS as readonly string[]).includes(value) ? (value as DraftModeId) : null;
}

/** Query string for the wizard: `?from=<projectId>&drafts=<mode>`. */
export function duplicateProjectSearch(
  projectId: string,
  drafts: DraftModeId = DUPLICATE_DRAFT_MODE
): string {
  return `?${new URLSearchParams({ from: projectId, drafts }).toString()}`;
}

/**
 * Whether the signed-in user may create projects, the same rule
 * `projects.createProject` enforces: a signed-in, non-anonymous user whose
 * role holds `project.create`. Unknown (still loading) reads as no.
 */
export function canCreateProjects(
  user: { role?: CapabilityRole | null; isAnonymous?: boolean } | null | undefined
): boolean {
  if (!user || user.isAnonymous === true) return false;
  return hasCapability(user.role ?? null, "project.create");
}
