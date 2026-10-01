import { PD_SUBSECTIONS } from "../../../../shared/pdSubsections";

type ReviewRow = {
  roleId: string;
  state: string;
  stale: boolean;
  staleReason?: { changedRoleIds: readonly string[] } | null;
};

/**
 * 2026-09-28 (seventh, owner): after an earlier step's change marks later
 * steps for review, the step that changed offers "Keep all" and "Review
 * each". It is the earliest step the marked steps name as changed (their
 * server `staleReason`), never a skipped one; when none is named, or the
 * named one is skipped, it is the nearest step before the first marked one
 * that the writer has worked on and not skipped. Returns the marked steps
 * after it (the ones "Keep all" keeps) for that step only, else null.
 */
export function laterReviewFor(
  rows: readonly ReviewRow[],
  roleId: string
): { roleIds: string[]; firstRoleId: string } | null {
  const ordered = PD_SUBSECTIONS.map((definition) => rows.find((row) => row.roleId === definition.roleId)).filter(
    (row): row is ReviewRow => row !== undefined
  );
  const first = ordered.findIndex((row) => row.stale);
  if (first < 0) return null;
  const named = new Set(ordered.filter((row) => row.stale).flatMap((row) => row.staleReason?.changedRoleIds ?? []));
  let source = ordered.findIndex((row, index) => index < first && named.has(row.roleId) && row.state !== "skipped");
  if (source < 0) {
    for (let index = first - 1; index >= 0; index -= 1) {
      if (ordered[index].state !== "untouched" && ordered[index].state !== "skipped") {
        source = index;
        break;
      }
    }
  }
  if (source < 0 || ordered[source].roleId !== roleId) return null;
  const marked = ordered.slice(source + 1).filter((row) => row.stale);
  if (marked.length === 0) return null;
  return { roleIds: marked.map((row) => row.roleId), firstRoleId: marked[0].roleId };
}
