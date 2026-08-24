# PSOS-43 — Bare project number stays the submission instance

## Work control

- **Status:** `ready`
- **Phase:** P11 — August 20 meeting-directed writer flow
- **Current owner:** Unassigned
- **Started:** —
- **Completed:** —
- **Source:** August 20, 2026 meeting; amends the 2026-08-19 auto-lettering behavior
- **Progress note:** Collision lettering already ships in `convex/projects.ts`. This ticket reverses the part that rewrites an existing bare number to `Na`.

> Work this ticket independently after every dependency is complete or explicitly waived. Preserve the one-active-ticket rule.

## Problem

Michael’s submission convention: the unlettered number (`3`) is the version going forward; lettered siblings (`3a`, `3b`) are experiments, model tests, or background research. Current collision handling does the opposite: applying a second bare `3` patches the original to `3a` and stores the new row as `3b`, so there is no remaining submission number.

## Current code

- `resolveProjectNumberCollision` in `convex/projects.ts` (commented as meeting 2026-08-18 / owner direction 2026-08-19).
- On collision with a bare sibling, it patches that sibling to `${n}a` and treats `a` as used.
- `projectNumberKey` in `src/lib/workspace/fiscalYearGroups.ts` sorts a bare number as the `A` slot and therefore last in the letter group.

## Product outcome

- No collision: store the bare number unchanged.
- Collision with an existing bare `3`: leave `3` as-is; assign the new row `3a` (then `3b`, …).
- Explicit lettered input (`3c`) is still stored as typed.
- Dashboard sort shows the bare number first in the sibling set (submission on top), matching Michael’s stacked-card request in PSOS-38.

## Acceptance criteria

- [ ] Applying `3` when no sibling `3` exists stores `3`.
- [ ] Applying `3` when `3` already exists stores `3a` (or next free letter) and does **not** rewrite the existing row.
- [ ] Applying `3` when `3` and `3a` exist stores `3b`; `3` remains bare.
- [ ] Explicit `3c` does not auto-shift other numbers.
- [ ] Sort/list order places the bare number ahead of lettered siblings.
- [ ] `backfillProjectNumberLetters` is not re-run in a way that letters existing bare submission numbers; document any one-time repair for rows already rewritten to `Na`.
- [ ] Tests cover create and `setProjectNumber` collision cases in the same company + fiscal year.

## Dependencies and boundaries

- **Coordinates with:** PSOS-37/38 visual grouping. This ticket does not implement collapse/expand.
- **Out of scope:** deleting unused lettered experiments; `1R` review suffixes (Michael will decide later); raising the 20-project cap.

## Transcript evidence

- **09:43–11:30:** Michael: unlettered number is the submission version; letters are tests/research. Johnny: if there is no collision, leave it alone; the next `3` becomes `3a` / `3b`.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-08-20 | Do not rename an existing bare number on collision. | Bare number is the submission instance; letters are extras. | Michael Obregon, confirmed by Johnny in meeting |
