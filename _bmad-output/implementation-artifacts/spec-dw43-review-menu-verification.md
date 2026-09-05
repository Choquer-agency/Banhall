---
title: 'DW-43: Verify production review menu submission'
type: 'chore'
created: '2026-09-04'
status: 'done'
baseline_commit: '9da55bece5948da12129720dd2330a3032c985bf'
review_loop_iteration: 0
context:
  - '{project-root}/docs/svelte-migration.md'
---
<frozen-after-approval reason="human-owned intent">
## Intent
**Problem:** Backend tests construct their own reviewDecision arguments. Existing ProjectHighlights tests mount drafting without submitting the production ProjectWorkflowMenu. Removing the production decision spread leaves tests green but prevents users returning internal review to edits.
**Approach:** Execute the real menu and StageChangeDialog in Chromium with the existing Convex browser stub. Pin mutation payloads and visible success/error outcomes. This is component/runtime verification with mocked transport, not a live-backend end-to-end claim.

## Boundaries & Constraints
**Always:** Use the existing workflow contract, permission-driven options and rendered controls. Retain raw verification and mutation-sensitivity evidence. Install owned dependencies with npm ci. Run full component suite, check, and existing relevant backend tests. Keep production behavior unchanged.
**Ask First:** A discovered need to change review policy or production APIs.
**Never:** Change review decision APIs, revision pinning (DW-44), generated Convex files, production UI intent, native state, ledger, other checkouts, push or deploy.

## I/O & Edge-Case Matrix
| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Return for edits | Internal review with owner authority, workflow version 7; user opens menu and dialog, selects Edits, enters audit note and submits | Exactly one setWorkflowStage call with projectId, edits, normalized note, expectedVersion 7, reviewDecision return; dialog closes on updated response | No error |
| Unrelated destination | Internal review to Drafting | Submission omits reviewDecision; normal successful close | Unchanged |
| Unrelated source | Drafting to Edits | Submission omits reviewDecision despite edits destination; normal successful close | Unchanged |
| Server rejection | Return for edits rejects with typed domain error | Dialog remains visible, error text and note retained; no false success | Existing error display |
</frozen-after-approval>

## Code Map
- src/lib/components/project/ProjectWorkflowMenu.svelte:282: submitStage derives reviewDecision from source and destination then passes expectedVersion from baseline. Mount this real component or its real ProjectHighlights parent; never call a copied helper instead.
- src/lib/components/project/ProjectHighlights.component.test.ts: existing browser mount and query seeding.
- src/lib/components/project/StageChangeDialog.component.test.ts: real bits-ui dialog controls and audit note interactions.
- src/lib/test/convex-svelte-stub.svelte.ts: reusable reactive query registry, mutation capture, configurable results. Add only narrowly necessary rejection support if existing Promise rejection fixtures suffice poorly; isolate errors and reset them with existing registry.
- src/lib/test/component-setup.ts and vitest.component.config.ts: installed runtime aliases, Chromium setup, serial component suite. Preserve these configurations.
- shared/workflowTransitions.ts and shared/workflowLabels.ts: canonical source/destination and authority policy; do not copy their calculation into test expectations.
- docs/product-domain.md:1560: approved decision amendment and unchanged unrelated edges.
- _bmad-output/specs/spec-ai-engine-sprint-2-boundary/stories/7-review-decisions-required-to-leave-internal-review.md: original contract and production caller gap.
- convex/projectWorkflow.test.ts: existing real mutation tests cover recording and rejection. These are complementary to the browser test, not proof of a deployed backend.

## Tasks & Acceptance
**Execution:**
- [x] src/lib/components/project/ProjectWorkflowMenu.component.test.ts: add meaningful real menu browser interactions for matrix rows, using existing test transport and accessible selectors.
- [x] src/lib/test/convex-svelte-stub.svelte.ts: only if needed, support controlled mutation failure with reset isolation.
- [x] .audit/dw43-review-menu-verification/: retain before/after sensitivity logs and commands proving verification; evidence explicitly distinguishes mocked transport from backend tests.
**Acceptance Criteria:**
- Given the baseline production spread is temporarily removed, when the new return test executes, then it fails specifically because reviewDecision is absent; restore production byte-for-byte and rerun successfully.
- Given normal production code, when the full component suite and check and relevant backend suite run, then all required checks pass.
- Given completion, when reviewing the diff, then only tests/support and work evidence/spec changed.

## Spec Change Log

## Verification
- npm ci: install this checkout's own lockfile dependencies, do not symlink dependencies.
- npm run test:component: full required local browser suite.
- PUBLIC_CONVEX_URL=http://localhost npm run check: zero errors.
- npx vitest run --project convex convex/projectWorkflow.test.ts convex/dashboardStageCounts.test.ts convex/workItems.test.ts: existing mutation contracts pass.
- Mutation sensitivity: temporarily remove production reviewDecision spread, run targeted browser test to retain expected failure, restore exactly, targeted test passes.

## Implementation verification
- Full component suite: 53 files, 315 tests pass.
- Full npm test: 148 files, 1730 tests pass on restored production source.
- Svelte check: zero errors and warnings.
- Existing workflow backend subset: 3 files, 59 tests pass.
- Production menu byte-for-byte unchanged; git diff --check passes.
- Review status: completed. All three independent Astra medium layers returned before triage; five low-severity patches applied, six findings rejected with individual rationale. See the retained audit review-triage.md.

## Suggested Review Order

- Follow the real menu through return submission and strict payload verification.
  [ProjectWorkflowMenu.component.test.ts:50](../../src/lib/components/project/ProjectWorkflowMenu.component.test.ts#L50)
- Verify unrelated edges omit the decision and the error path preserves selection through successful retry.
  [ProjectWorkflowMenu.component.test.ts:68](../../src/lib/components/project/ProjectWorkflowMenu.component.test.ts#L68)
- Inspect controlled transport failure and recovery without changing production APIs.
  [convex-svelte-stub.svelte.ts:48](../../src/lib/test/convex-svelte-stub.svelte.ts#L48)
- Review independent findings, triage, sensitivity proof and actual verification limits.
  [review-triage.md](../../.audit/dw43-review-menu-verification/review-triage.md)
  [evidence.md](../../.audit/dw43-review-menu-verification/evidence.md)
