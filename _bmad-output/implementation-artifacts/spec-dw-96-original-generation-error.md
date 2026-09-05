---
title: 'DW-96 preserve original generation failure'
type: 'bugfix'
created: '2026-09-04'
status: 'done'
baseline_commit: '3b8a451e3738a8da1bd95ba5e7029dba6f970a4d'
review_loop_iteration: 0
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '/Users/johnnynguyen/.agents/skills/typescript-best-practices/SKILL.md'
---

<frozen-after-approval reason="already authorized narrow DW-96 remediation">

## Intent

**Problem:** When a digest provider or parser fails, the action records a failed attempt and then rethrows the generation exception. If that secondary mutation also fails, the original exception is replaced, contradicting the existing error-preservation contract and hiding the causal failure.

**Approach:** Preserve the exact original thrown value through the failed-attempt write, while retaining the existing write attempt and ordinary success/failure behavior. Verify both action kinds through their real action paths and the actual catch branch.

## Boundaries & Constraints

**Always:** Preserve error object identity, await the existing failed-attempt write, record successful failure logging exactly as before, retain all diversity/admission/publication and no-candidate invariants. Work only in `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-dw96-fix` on `codex/bmad-dw96-fix`. Use worker-owned npm dependencies and public placeholders. Retain red-before/green-after proof. Keep the fix small; secondary logging failure is subordinate to the original generation failure.

**Ask First:** Any change to which failures count as attempts, which exception the normal provider adapter emits, or new recovery/retry/publication policy. No such change is needed for this scope.

**Never:** Modify native worker5, pinned target, native state, policy or deferred-work ledger; invoke build-auto or another loop; edit generated APIs; add UI changes, credentials or secret logging; push or merge. No generic error utility or production private-helper export is needed. Do not commit: parent owns review/finalization/private commit.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Provider failure, attempt saved | Eligible QA/style input, provider rejects with a known Error, record succeeds | Failed attempt retains correct kind/admission; no candidate saved | Exact original Error escapes |
| Provider failure, attempt fails | Same input plus secondary recording rejection | Recording still attempted once; no candidate saved | Exact original Error escapes, not secondary Error |
| Parse failure, attempt saved | Provider adapter rejects with known parse error, record succeeds | Existing failed-attempt behavior retained | Original parse error identity escapes |
| Parse failure, attempt fails | Same parse failure plus secondary recording rejection | No extra retries or candidate/publication changes introduced | Original parse error identity escapes |

</frozen-after-approval>

## Code Map

- `convex/ai/learning.ts:89-115`: shared distillAdmittedRules catch awaits recordDigestAttempt then throws original; change only exception precedence here. Both public internal generator handlers use it after admission.
- `convex/learning.test.ts:1423-1516`: existing actual convex-test actions exercise provider and malformed JSON failures for both kinds, assert safe metadata and unchanged candidates/selections. Preserve these tests.
- `convex/ai/instrument.test.ts:8-13`: provider-adapter createAnthropicClient mock precedent; preferred seam for a known Error identity without the SDK wrapping a fetch error. Keep real instrumentedAnthropic and generateStructured when practical.
- `node_modules/convex/src/server/registration.ts:571`: registered actions expose original `_handler`; no new production export is needed. `convex-test` ordinary Error handling preserves identity in the installed runtime. Either the actual registered handler with narrowly supplied ActionCtx or convex-test action with an isolated failing mutation boundary is acceptable; avoid copying the catch implementation into a test.
- `convex/lib/learningAdmission.ts`, `convex/learning.ts` and schema are read-only scope. Test input must independently satisfy diversity and five-row minimum before reaching real distillation. Use current validators and FunctionReference names instead of string guesses.
- Prior browser proof at sibling browser-gate-repair checkout: unchanged canonical 323 tests/53 files at baseline. No browser rerun for this server-only exception fix; final integrated browser proof remains parent-owned.

## Tasks & Acceptance

**Execution:**
- [x] Add a narrowly scoped backend regression file or extend existing tests. Exercise both actual action kinds and matrix outcomes; compare errors by identity, assert failed-attempt payload, no save call/candidate, and preserve real admission/catch logic. Fault-inject only provider and secondary persistence boundaries.
- [x] Run new regression against untouched production baseline and retain failing output/exit under `.audit/DW-96-fix/before-*`. Do not weaken expected original-error identity to manufacture a pass.
- [x] `convex/ai/learning.ts` -- protect original throw from the secondary mutation rejection without changing ordinary write behavior or swallowing the generation error.
- [x] Run relevant new+existing tests, full `npm test`, `npx tsc -p convex/tsconfig.json --noEmit`, and public-placeholder `npm run check`; retain exact receipts. Capture source/forbidden-file/ledger integrity and whitespace.
- [x] `.audit/DW-96-fix/evidence.md` and `decisions.tsv` -- map matrix to executed tests and explain seams/limits. Parent handles fresh BMAD review and finalization.

**Acceptance Criteria:**
- Given either digest action and either original failure type, when failed-attempt persistence succeeds or rejects, then the caller receives the exact original error and the recording behavior matches the matrix.
- Given eligible input and generation failure, when the regression runs, then no new candidate is saved or publication mutated.
- Given the final patch, when backend/type/Svelte checks run, then they pass and only the authorized exception handling and regression artifacts differ.

## Spec Change Log

## Verification

- New focused regression command: select actual test filename chosen during implementation; preserve failing baseline then passing patch.
- `npx vitest run convex/learning.test.ts` -- existing 36 action/storage/publication cases remain green.
- `npm test` -- full non-browser suite passes.
- `npx tsc -p convex/tsconfig.json --noEmit` -- exit 0.
- `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm run check` -- zero errors/warnings.
- `git diff --check` and protected source/ledger comparison -- no unexpected modifications.

## Review Triage Log

2026-09-04: Fresh BMAD blind, edge, verification-gap and acceptance layers completed with zero actionable findings. No patch/intent-gap/bad-spec/defer/reject items. The parent independently inspected the diff, new regression, baseline failures and all gate tails. Follow-up review recommended: false; repair score 0. No native ledger or sprint status changes.

## Suggested Review Order

- Preserve the causal exception while retaining the awaited failure write.
  [learning.ts:105](../../convex/ai/learning.ts#L105)
- Exercise both real action paths with isolated provider and persistence faults.
  [learningFailure.test.ts:113](../../convex/learningFailure.test.ts#L113)
- Inspect identity, admission, awaited-write and unchanged-storage assertions.
  [learningFailure.test.ts:191](../../convex/learningFailure.test.ts#L191)
