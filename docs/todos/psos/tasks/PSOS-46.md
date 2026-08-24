# PSOS-46 — Writer-identity Brain weight policy

## Work control

- **Status:** `not_started`
- **Phase:** P11 — August 20 meeting-directed Brain governance
- **Current owner:** Unassigned
- **Started:** —
- **Completed:** —
- **Source:** August 20, 2026 meeting
- **Progress note:** Each Brain source already has a manual `writerTier` (0–1) used as RAG importance. There is no admin policy that auto-applies a floor by identified writer, and no “weight Larry’s PDs toward Larry” retrieval flavor.

> Work this ticket independently after every dependency is complete or explicitly waived. Preserve the one-active-ticket rule.

## Problem

Michael wants generation to feel closer to each manager’s style without turning the Brain into a junior-writer clone. Proposed policy: keep a universal default weight, then an admin/manager override that floors identified manager writers (the current four) to the highest tier on ingest. Juniors stay at the lower default. Writers will try to pull the tool toward their voice either way.

## Current code

- `brainSources.writerTier` and `/admin/brain` per-row Weight control (`docs/the-brain.md`: Tracy 1.0, Larry/Emily/Orel 0.7, others 0.4).
- Retrieval blends `rerankScore × (0.6 + 0.4·tier)`.
- Client uploader / ingestion accept a `writerTier` argument; it is not derived from a user-identity map.
- Historical ingestion review is PSOS-41.

## Decisions required before implementation

1. Is “Larry’s PDs weighted to Larry” (a) higher importance for Larry’s sources globally, (b) a retrieval filter/boost when the generating user is Larry, or both?
2. How is writer identity bound on ingest (filename, owner, explicit picker)? Wrong binding must not silently uprank a junior.
3. Who may set the manager override list (Admin only vs Manager+)?
4. Does a per-source manual weight still win over the policy floor?

Recommended default for the first slice: **(a) ingest-time floor for an admin-maintained manager writer list**, plus the existing per-source slider. Defer generating-user personalization until that slice is measured.

## Acceptance criteria

- [ ] Product answers the four decisions above and records them in `docs/the-brain.md` / product-domain if retrieval behavior changes.
- [ ] Admin can map identified writers to a tier floor; juniors are not in that list by default.
- [ ] New approved Brain sources for mapped writers receive at least that floor unless an explicit per-source override is set.
- [ ] Changing the policy does not silently rewrite already-approved sources without a recorded migration/re-ingest action.
- [ ] Authorization: only Admin (or the approved role) edits the map; UI hiding is not authorization.
- [ ] Tests cover floor application, junior exclusion, and override precedence.

## Dependencies and boundaries

- **Coordinates with:** PSOS-41 historical ingest; existing BNH-42 Brain governance.
- **Out of scope:** fine-tuning; automatic style cloning; letting writers set their own global weight.

## Transcript evidence

- **19:32–22:19:** Weight individual writers to their own style; admin/universal override; managers (four people) at highest weight; not juniors. Johnny will look into it.
