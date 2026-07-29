# PSOS-38 — Dashboard project groups: numbering, collapse/expand, and Primary instance

## Work control

- **Status:** `blocked`
- **Phase:** P9 — meeting-directed portfolio organization
- **Current owner:** Unassigned
- **Started:** —
- **Completed:** —
- **Source:** July 27, 2026 meeting transcript supplied directly by the product team
- **Progress note:** Blocked on PSOS-37’s approved domain decisions and production-query sequencing. Do not invent group, numbering, or preferred/final semantics in implementation.

> Work this ticket independently after every dependency is complete or explicitly waived. Preserve the one-active-ticket rule.

## Problem

The dashboard may show many independent AI test project rows for one real client project. Users need a compact group/folder row that preserves each instance, expands on demand, carries the approved project number, and opens the group’s Primary instance by default.

## Provisional scope — subject to PSOS-37

- Widen-only storage for the approved Project group model; do not merge or delete project rows.
- Optional group membership on legacy project rows.
- Project number stored according to the scope and allocation contract approved in PSOS-37.
- Atomic, audited Primary-instance selection with at most one Primary per group.
- Mutations to create/rename a group, add/remove project rows, set/change the number, and select Primary.
- Dashboard group projection with collapsed and expanded states; ungrouped projects remain unchanged.
- Primary instance appears first and is the default group destination.
- Existing company → fiscal-year hierarchy, filters, sorting, bulk edit, and broad internal visibility remain compatible.

## Explicit non-goals

- No branch implementation or migration; PSOS-18–20 own report alternatives.
- No deliverable promotion or production outcome; PSOS-19 and PSOS-22–23 own those meanings.
- No durable client/claim-period shortcut that conflicts with PSOS-31.
- No project-row deletion, content merge, or automatic fuzzy grouping.
- No change to `projects.createdBy`, ownership, workflow stage, legacy status, or visibility.

## Acceptance criteria

- [ ] PSOS-37 is `done`, with approved vocabulary and number scope recorded in `docs/product-domain.md`.
- [ ] Schema rollout is widen-only and preserves every existing project row and artifact.
- [ ] Group membership, number changes, and Primary changes are server-authorized, OCC-safe, and append immutable typed events.
- [ ] A project belongs to at most one group; a group has at most one valid Primary member.
- [ ] Setting Primary writes no workflow stage, branch promotion, report content, production outcome, or legacy status fields.
- [ ] Number uniqueness and allocation follow PSOS-37; concurrent assignment cannot produce duplicates.
- [ ] Dashboard queries return complete group projections from bounded indexed pagination; groups are not assembled incorrectly after page slicing.
- [ ] Collapsed group row states the project number, group title, instance count, Primary instance, client, and fiscal period without color-only meaning.
- [ ] Expand/collapse is keyboard-operable, screen-reader labelled, and uses ≥44px touch targets; mobile layout remains usable.
- [ ] Grouped and ungrouped rows coexist, including loading, empty, permission-denied, conflict, and partial-success states.
- [ ] Manual grouping never changes current firm-wide internal read visibility.
- [ ] Regression tests cover membership invariants, number collisions, Primary atomicity, audit events, pagination boundaries, sorting, and branch/outcome non-interference.

## Dependencies

- **Hard:** PSOS-37.
- **Production query:** PSOS-11 unless PSOS-37 records a narrowly scoped and measured waiver.
- **Conditional:** PSOS-31 if the approved number scope requires durable clients or claim periods.
- **Coordination:** PSOS-18–20 and PSOS-22–23.

## Rollout and rollback

- Deploy schema/indexes before UI.
- Enable manual groups first; no automatic backfill.
- Verify a small set of known duplicate-test rows such as the 3GA examples from the meeting.
- Rollback hides grouped presentation while retaining additive group metadata and immutable events; never destructively ungroup during rollback.

## Transcript evidence

- **22:14–25:42:** distinct test instances should collapse into one expandable dashboard group.
- **25:46–27:10:** project numbers such as `01` should support collection, sorting, and financial identification.
- **27:16–27:37:** the “go with this one” instance should be surfaced first.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-07-28 | Ticket remains blocked until PSOS-37 closes. | Storage and UI depend on unresolved number scope and non-conflicting Primary semantics. | Claude Code/Fable and Opus planning reviews |
| 2026-07-28 | Grouping will be manual in the initial release. | Similar names and experiments cannot be safely auto-merged; the product contract forbids silent fuzzy grouping. | Planning default; product approval pending |

## Work log and evidence

| Date | Change/evidence | Result |
|---|---|---|
| 2026-07-28 | Implementation task extracted from the July 27 transcript. | Blocked safely behind PSOS-37 rather than expanding PSOS-11, PSOS-18, or PSOS-31 implicitly. |

## Completion record

- **Pull request/commit:** —
- **Deployment:** —
- **Follow-up tickets:** PSOS-18–20 for future branch-based alternatives; PSOS-31 for durable client/claim-period identity.
- **Known limitations accepted at creation:** No automatic grouping and no implementation before domain approval.
