import { PD_SUBSECTIONS } from "../../../../shared/pdSubsections";

type ReviewRow = { roleId: string; state: string; stale: boolean };

/**
 * 2026-09-28 (seventh, owner): after an earlier step's change marks later
 * steps for review, the step whose change did it offers "Keep all" and
 * "Review each". That step is the nearest one before the first marked step
 * that the writer has worked on; the marked steps all come after it.
 * Returns how many steps are marked and the first of them, for that step
 * only, else null.
 */
export function laterReviewFor(
  rows: readonly ReviewRow[],
  roleId: string
): { count: number; firstRoleId: string } | null {
  const ordered = PD_SUBSECTIONS.map((definition) => rows.find((row) => row.roleId === definition.roleId)).filter(
    (row): row is ReviewRow => row !== undefined
  );
  const first = ordered.findIndex((row) => row.stale);
  if (first < 0) return null;
  let source: ReviewRow | undefined;
  for (let index = first - 1; index >= 0; index -= 1) {
    if (ordered[index].state !== "untouched") {
      source = ordered[index];
      break;
    }
  }
  if (!source || source.roleId !== roleId) return null;
  const marked = ordered.filter((row) => row.stale);
  return { count: marked.length, firstRoleId: marked[0].roleId };
}
