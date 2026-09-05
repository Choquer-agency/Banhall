# Implementation of parent review findings

This supersedes the initial implementation inspection's no-defect result: subsequent independent review identified a deep-nesting extraction defect and two verification gaps. Parent retains review triage, final gates, commits, status and acceptance ownership.

## HIGH: deep nesting

Entry source: `9da55bece5948da12129720dd2330a3032c985bf`, with only new regression assertions applied before reproduction. `convex/qaBlocking.test.ts` adds two registered boundary cases with 5,000 nested block containers and 5,000 nested containers inside a paragraph. The baseline failed both cases because readiness lacked QA_BLOCKING. The assertions also cover a registered human save, resulting exact-reference findings, and rejection at both readiness/publish boundaries before and after save.

Command: `npx vitest run convex/qaBlocking.test.ts -t 'deep .* retain uncertainty'`. Actual exit 1, two failing tests. Raw log: `deep-nesting-before.log`.

Repair: `convex/lib/tiptapReport.ts` traverses both outer blocks and inner text using explicit stacks. Child order, parent-dependent separators, hard breaks and heading semantics are retained. The catch encloses only JSON parsing; extraction failures no longer silently yield an empty section collection.

## MEDIUM: iterative assembly override proof

Extended `convex/generationAttribution.test.ts` test `stamps the frozen set on the iterative report and its ghost comparison snapshot`. The fixture supplies a brain_blocks artifact with bannedWords:true and canonical uncertainty text containing robust plus a missing because clause. Registered `approveSectionDraft` assembles the report. Assertions require no banned_word row and a substantive because_clause row with exact report id, revision and computed content hash.

Mutation proof temporarily bypassed only the generationId branch that loads brain_blocks in `persistDeterministicFindings`, ran the targeted test, and restored original source bytes in finally. Actual exit 1 on the unexpected banned_word row. `git diff --exit-code -- convex/lib/qaFindings.ts` then exited 0. Exact command, mutation description and restoration result: `brain-overrides-mutation-provenance.json`; raw output: `brain-overrides-mutation-before.log`.

After restoration, command `npx vitest run convex/generationAttribution.test.ts -t 'stamps the frozen set on the iterative report and its ghost comparison snapshot'` exited 0, one passing test. Raw output: `brain-overrides-restored-after.log`.

## MEDIUM: scheduler atomicity

`convex/qaBlocking.test.ts` helper `expectBlocked` now snapshots `_scheduled_functions` before the registered publish mutation and compares it after rejection, alongside the existing project-state equality assertion. All existing helper callers and the new deep cases exercise this assertion.

## Combined targeted verification

Command: `npx vitest run convex/qaBlocking.test.ts convex/lib/tiptapReport.test.ts convex/generationAttribution.test.ts`. Actual exit 0, 91 tests passed across three files. Raw output: `review-patches-after.log`. This ran after the repair and both verification enhancements, before the isolated brain_blocks mutation; the affected source was restored byte-identically afterward and its targeted case passed again.

`git diff --check` exited 0. No full gate, native marker, new policy, deferred item or commit was produced by this implementation step.
