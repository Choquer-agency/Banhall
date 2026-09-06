---
title: 'Q5: Render distinct model score rows with repeated positions'
type: 'bugfix'
created: '2026-09-05'
status: done
baseline_commit: 67e115c124320e7e3c446cb2538335f052b7c52c
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/svelte-migration.md'
  - '{project-root}/docs/design-system.md'
  - '/Users/johnnynguyen/.agents/skills/typescript-best-practices/SKILL.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** ModelTestSummary keys its rows only on optionPosition. Distinct candidates scored by the same user can retain the same client-supplied position, causing Svelte's duplicate-key error even after the backend filters out other users' scores.

**Approach:** Give every rendered row a collision-free identity within this stateless table, preserving each row's data even when model names and positions repeat. Keep this a frontend defensive repair.

## Boundaries & Constraints

**Always:** Work only in `/Users/johnnynguyen/Documents/Repos/Banhall-quality-pass`. Preserve row count, server ordering, labels, personal score, QA score, chosen flag and empty behavior. Use Svelte 5 and current design tokens. Record evidence under `.audit/quality-pass/Q5/`. A unique row index or an index-bearing composite is acceptable for this stateless table; no backend ID expansion is needed.

**Ask First:** Changes to scoring, model selection semantics, authorization, or backend response shape require root escalation; ordinary component tests and key choice are authorized.

**Never:** Deduplicate legitimate candidate rows by model name/position, suppress the error by hiding rows, alter backend scoring, reintroduce cross-user scores, edit other checkouts, commit, stage, push, install, or change ledgers. Root owns independent three-lens review and final full gate. Do not attempt nested reviewer fan-out from the ephemeral implementation session.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Repeated position | Two rows share optionPosition but different labels | Both rows mount with correct scores | No duplicate-key exception |
| Repeated everything except score | Same position and model label, different row scores | Two distinct visible rows | Never collapse duplicates |
| Query update | Rows reorder/change/remove while mounted | Correct current row count and data pairing | No stale score/chosen cells |
| Unique rows | Typical unique positions | Existing table appearance/content | No regression |
| Empty/loading | Null or empty summary | No score table | Existing quiet behavior |

</frozen-after-approval>

## Code Map

- `src/lib/components/editor/ModelTestSummary.svelte:35` keyed each block uses `row.optionPosition`; table rows have no local interactive state.
- `src/lib/components/editor/ModelTestSummary.svelte:10` summary query and derived value are actual component seam; tests should update the query stub, not reproduce the each block in a harness.
- Read-only cause evidence: `convex/generations.ts:3066` upserts scores per user/candidate but accepts client optionPosition; line 3134 filters to current user, and line 3146 sorts by position. These files are not implementation targets. If reading backend code, first load `convex/_generated/ai/guidelines.md`.
- `src/lib/test/convex-svelte-stub.svelte.ts` supplies reactive query data; verify its exported update API and use it for mounted-update tests.
- New `src/lib/components/editor/ModelTestSummary.component.test.ts` should follow neighboring real component tests, using vitest-browser-svelte and actual rendered table.

## Tasks & Acceptance

**Execution:**
- [x] `ModelTestSummary.component.test.ts` — create a regression rendering actual component with colliding positions and labels; capture real baseline duplicate-key failure before editing production code.
- [x] `ModelTestSummary.svelte` — change only each-row identity and concise accurate explanation if needed; preserve presentation and data.
- [x] `ModelTestSummary.component.test.ts` — cover all matrix states, including reactive reorder/update/removal. Assert individual table row cell combinations rather than global body strings.
- [x] `.audit/quality-pass/Q5/` — record baseline SHA, exact old failure/new pass, before/after rendered evidence, evidence.md; root owns the canonical quality-pass decision log. Mark baseline screenshot limitations if the crash prevents table mounting rather than fabricating output.

**Acceptance Criteria:**
- Given repeated model labels and option positions, when the real component mounts or updates, then every returned row renders once and its score/QA/chosen values stay attached to the same displayed data.
- Given this table has no controls, when verifying runtime behavior, then mounted reactive query updates provide meaningful interaction evidence rather than adding artificial controls or relying on source-text assertions.

## Spec Change Log

## Design Notes

Duplicate model names alone are not the proven key defect. Tests deliberately repeat positions, then repeat labels too, so replacing the key with only model/label cannot accidentally pass. Index-based keys can recreate identity after reorder; that is acceptable because rows are stateless and tests prove current values. Model-level chosen attribution from the server is preserved, not silently redesigned.

## Verification

**Commands:**
- Root has completed the full browser baseline before component work. Latest evidence: `.audit/quality-pass/Q4/verification-result.json` binds the full gate with 2044 unit and 499 browser tests; its production bytes are unchanged after the test-only review patch proved by Q4/post-review-evidence.md (11 focused passing). Verify that evidence, then run this unit's actual component regression against unchanged production source before editing it; rerun full baseline only if new evidence invalidates it.
- `npm run test:component -- src/lib/components/editor/ModelTestSummary.component.test.ts` — baseline collision fails; repaired component passes collision, update and empty-state tests.
- `npm run check` — Svelte/TypeScript checks pass.
- `git diff --check` — clean diff; root runs final full gate and independent review.

## Suggested Review Order

- Keep every returned row when positions repeat.
  [ModelTestSummary.svelte:36](../../src/lib/components/editor/ModelTestSummary.svelte#L36)

- Verify collision rendering and mounted data transitions.
  [ModelTestSummary.component.test.ts:23](../../src/lib/components/editor/ModelTestSummary.component.test.ts#L23)
