---
title: 'DW-99 capped rerank cohort regression'
type: 'chore'
created: '2026-09-05'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'c3bcddd475a924780cfaf2362b0217d1d58d428d'
context: ['AGENTS.md', 'convex/_generated/ai/guidelines.md']
---

<frozen-after-approval reason="already authorized review remediation">

## Intent

**Problem:** The capped rerank metric regression currently inserts interchangeable same-time successes, so an incorrect newest-first cohort could escape tests despite the page promising oldest-first evidence.

**Approach:** Add a real persisted Convex query regression with varied timestamps and mixed terminal outcomes beyond the cap, and show that the test rejects an intentionally reversed ordering in an audit-only control. Current production selection is correct.

## Boundaries & Constraints

**Always:** Preserve exact accepted production behavior and source bytes. Use own dependencies and public placeholder environment only. Work solely in /Users/johnnynguyen/Documents/Repos/Banhall-bmad-dw99-fix. Capture actual command logs and exits. Treat root integration evidence as context, never as freshly executed tests here.

**Ask First:** Any newly discovered production defect or necessary production-scope change must be reported to parent before altering scope.

**Never:** Change production source, metric semantics, retrieval, API, generated code, package lock, native spec/policy/state/ledger or another checkout. No push, merge, loop, ledger close. Do not claim the correct baseline fails. Do not introduce an audit wrapper as the canonical test gate.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Oldest capped cohort | More than 2,000 chronologically distinct outcomes, selected success and fallback plus a newer excluded differing outcome | Exact selected numerator, denominator, rate, bounds, partial flag | No unavailable or full-coverage claim |
| Wrong-order control | Same regression with only outcome ordering transformed to descending in memory | Assertion fails from changed cohort, not setup or unrelated error | Retain exit/log and prove production file hash unchanged |

</frozen-after-approval>

## Code Map

- `convex/learningHealth.test.ts`: existing persisted getHealth test setup and cap fixture near332; extend this file only for canonical test.
- `convex/learningHealth.ts:47`: correctly ascending indexed outcomes read; read-only target of in-memory audit mutation, never modify disk file.
- `vitest.config.ts`: unchanged canonical projects and edge-runtime Convex integration; reuse config via audit-only Vite transform plugin for the deliberate wrong-order control.
- `.audit/story-8/third-final-*`: accepted prior passing gates, not new test proof.
- `src/routes/admin/learning/+page.svelte:138`: read-only oldest-first public promise.
- Story8 complete spec and approved companion under `_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/`: authoritative existing contract, read-only.

## Tasks & Acceptance

**Execution:**
- [x] `convex/learningHealth.test.ts` add the order-sensitive actual persisted-query regression with distinguishable selected/excluded observations.
- [x] `.audit/DW-99-fix` retain an audit-only wrong-order in-memory transform config and red/green logs with exit files; install worker-owned npm ci and sync without secrets; run focused health/retrieval regressions, full npm test, Convex typecheck and npm check with public URL placeholder; whitespace check.
- [x] `.audit/DW-99-fix` capture unchanged production source hash and exact changed paths. Report results to parent without committing; parent workflow will review and finalize.

**Acceptance Criteria:**
- Given a population beyond the cap, when the canonical query executes, then its selected oldest cohort, counts, rate and timestamp bounds are asserted by a passing real query test.
- Given the identical fixture, when audit-only in-memory ordering is reversed, then the new assertion fails meaningfully while production source bytes remain identical.
- Given the finished patch, when gates run, then the canonical suites/checks pass without production/config changes and evidence clearly distinguishes deliberate control failure.

## Spec Change Log

## Verification

Use `npm ci`, `npx svelte-kit sync`, focused `npm test -- convex/learningHealth.test.ts convex/learningHealthBytes.test.ts convex/ai/brain/retrieveOutcomes.test.ts`, full `npm test`, `npx tsc --noEmit -p convex/tsconfig.json`, `PUBLIC_CONVEX_URL=https://example.convex.cloud npm run check`, and `git diff --check`. No browser suite required for a backend test-only change; parent owns final combined browser evidence. Audit control must use inherited canonical config with one exact source-transform replacement and be labelled noncanonical. No test selector that silently misses the regression.

## Suggested Review Order

- Inspect the actual persisted query regression and exact selected-cohort assertions.
  [learningHealth.test.ts:332](../../convex/learningHealth.test.ts#L332)
- Inspect the deliberately wrong in-memory order and its distinct noncanonical purpose.
  [wrong-order.config.ts:1](wrong-order.config.ts#L1)
- Compare real control failure with passing canonical gate evidence.
  [evidence.md:1](evidence.md#L1)
- Review all four fresh layers and resolved audit refinements.
  [review-triage.md:1](review-triage.md#L1)
