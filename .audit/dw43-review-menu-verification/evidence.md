# DW-43 production menu verification
Baseline: 9da55bece5948da12129720dd2330a3032c985bf

Scope: a real Chromium component test mounts ProjectWorkflowMenu and its production StageChangeDialog, opens the menu, selects a transition, enters a note and submits. Convex transport is stubbed. This is not a live-backend end-to-end test. Existing convex-test mutation tests separately prove backend behavior.

## Before and after
- Existing ProjectHighlights and StageChangeDialog component suites, with the production reviewDecision spread removed: **10 tests pass** (before-existing-suite-mutant.log).
- New return-to-edits browser test with the same missing spread: **fails**, exactly because reviewDecision is absent from the captured mutation payload (before-new-test-mutant.log).
- Original production source retained in ProjectWorkflowMenu.original.svelte, restored byte-for-byte; git diff for ProjectWorkflowMenu.svelte is empty.
- New four-test suite with original production source: **4 pass** (targeted-after.log).
- Initial test authoring failure was a selector mismatch with the existing Status control; raw targeted-initial.log is retained and is not represented as product failure.

## Acceptance mapping
| Contract | Evidence |
|---|---|
| Return includes return decision, trimmed audit note and captured version 7 | ProjectWorkflowMenu.component.test.ts return test; targeted-after.log |
| Unrelated source and destination omit decision | Parameterized internal_review-to-drafting and drafting-to-edits tests; targeted-after.log |
| Rejection retains dialog, audit note, server explanation and enabled retry control | INVALID_STATE test; targeted-after.log |
| Production decision removal is caught | before-new-test-mutant.log alongside before-existing-suite-mutant.log |
| Persistence, revision/hash and transactional semantics remain separately verified | backend.log: 3 files, 59 tests pass |

## Verification commands
- npm ci: exit 0, npm-ci.log; owned node_modules populated from the unchanged lockfile.
- npm run test:component -- src/lib/components/project/ProjectWorkflowMenu.component.test.ts: targeted-after.log.
- npm run test:component -- src/lib/components/project/ProjectHighlights.component.test.ts src/lib/components/project/StageChangeDialog.component.test.ts: before-existing-suite-mutant.log, deliberately mutated source.
- npm run test:component -- src/lib/components/project/ProjectWorkflowMenu.component.test.ts -t "returns internal review for edits": before-new-test-mutant.log, expected exit 1.
- npx vitest run --project convex convex/projectWorkflow.test.ts convex/dashboardStageCounts.test.ts convex/workItems.test.ts: backend.log.
- npm run test:component: component-full.log, exit 0; **53 files / 315 tests pass**.
- npm test on restored production source: npm-test-restored.log, exit 0; **148 files / 1730 tests pass**.
- PUBLIC_CONVEX_URL=http://localhost npm run check: check-final.log, exit 0; **zero errors / zero warnings**.
- git diff --check: exit 0. Production menu diff: empty.
- The earlier npm-test.log also passed with the deliberate browser-only mutant active; final normal-source evidence is npm-test-restored.log.
- Browser output includes the existing bits-ui derived_inert warnings documented by StageChangeDialog.component.test.ts. They did not fail any test.

## Review status
All three independent Astra medium review layers returned before triage. Raw findings and individual dispositions are retained in findings-*.md and review-triage.md. Five low-severity test/support improvements applied; no production behavior changed.

## Post-review verification
- component-review-final.log: npm run test:component, exit 0, 53 files / 315 tests pass.
- npm-test-review-final.log: npm test, exit 0, 148 files / 1730 tests pass.
- check-review-final.log: PUBLIC_CONVEX_URL=http://localhost npm run check, exit 0, zero errors/warnings.
- backend-review-final.log: existing three workflow backend suites, exit 0, 59 tests pass.
- review-final-mutant.log: reran the strengthened return test with only the production spread removed; expected exit 1, missing reviewDecision shown in diff.
- targeted-review-final-restored.log: final targeted browser rerun after byte-for-byte restoration, exit 0, 4 tests pass.
- The real component's dialog closure is the success outcome checked here. Tests do not mount the app-shell toaster or assert live database persistence. Error recovery verifies retained selected destination and note with an identical retry payload and eventual dialog closure.

Raw output fidelity: the staged all-file whitespace check reports trailing blank lines in captured logs and space-only diff context in the exact reviewer prompts/patch. These are retained byte-for-byte as evidence. The source/spec-only staged whitespace check passes.
