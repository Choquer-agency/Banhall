/**
 * List-context paging handoff (2026-08-13, Attio-research P1).
 *
 * When a project is opened from a Projects surface, the surface stashes the
 * BOUNDED loaded page it was showing (ids in view order + a human label +
 * whether more rows existed beyond the page). The project header renders
 * "N of M in <label>" with prev/next steppers over exactly that list —
 * flow-state preservation with zero new subscriptions.
 *
 * In-memory by design: it survives SPA navigation (including stepping
 * project → project) and honestly dies on reload — a resurrected stale page
 * would claim a context the list no longer shows. Bounded pages keep the
 * count qualifier ("of 24+") per the count-ladder contract.
 */
export type ProjectPagingContext = {
  /** Project ids of the loaded page, in the order the surface displayed. */
  ids: string[];
  /** Where the reader was: "Projects", a stage label, a client name. */
  label: string;
  /** True when more rows existed beyond this loaded page. */
  bounded: boolean;
};

let context: ProjectPagingContext | null = null;

export function setProjectPagingContext(next: ProjectPagingContext): void {
  // Queue surfaces can contain multiple work items for the same project.
  // Preserve first-seen display order while removing duplicate destinations,
  // otherwise a project header's Next control can navigate to its own route.
  const ids = [...new Set(next.ids)];
  context = ids.length > 0 ? { ...next, ids } : null;
}

export function getProjectPagingContext(): ProjectPagingContext | null {
  return context;
}

export function clearProjectPagingContext(): void {
  context = null;
}

/** Resolved position of a project inside the stashed context, or null. */
export function projectPagingPosition(
  projectId: string
): { index: number; total: number; label: string; bounded: boolean; prevId: string | null; nextId: string | null } | null {
  if (!context) return null;
  const index = context.ids.indexOf(projectId);
  if (index === -1) return null;
  return {
    index,
    total: context.ids.length,
    label: context.label,
    bounded: context.bounded,
    prevId: index > 0 ? context.ids[index - 1] : null,
    nextId: index < context.ids.length - 1 ? context.ids[index + 1] : null,
  };
}
