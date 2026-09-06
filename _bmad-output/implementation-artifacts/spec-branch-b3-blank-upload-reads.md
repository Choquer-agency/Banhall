---
title: Keep blank-upload document reads independent of project body count
type: bugfix
created: 2026-09-05
status: done
review_loop_iteration: 0
baseline_commit: 0d481e2b76390e0eff3208d91f1f47d83b173474
context:
  - "{project-root}/AGENTS.md"
---

<frozen-after-approval reason="authorized BMAD integration; parent owns approval and dispatch">

## Intent

**Problem:** uploadDocument reads existing bodies before exempting blanks from dedupe, wasting transaction budget on unrelated content.

**Approach:** Evaluate existing eligibility first; preserve upload outcomes and prove read independence through the registered mutation and actual transaction metrics.

## Boundaries & Constraints

**Always:** User-selected BMAD supersedes generic factory engine/shipping restrictions. Work at the parent baseline; preserve main/prior batches. Read Convex guidelines. Only documents.ts/test changes. Preserve access/report checks, exact content, distinct blanks, status/backfill, storage, receipts, trust and eligibility.

**Ask First:** Escalate actual policy changes to parent; this optimization and bounded regression cases are authorized.

**Never:** No worker staging/commits/remotes/review dispatch/installs/ledger/other-worktree changes. Parent owns review/gate/ship. Never trim content, dedupe blanks, bypass access/receipts, cap nonblank reads or change schema/API/frontend/config/generated files.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Metrics | Empty/whitespace; zero/three large bodies; no optional args | Two queries/two reads; history-independent bytes; exact content/status | Assert after all four measurements |
| Repeat blank | Same name twice, distinct attempt keys | Separate documents/resolved attempts | No merged receipt |
| Duplicate | Nonblank archived/legacy exact name/content | Reuse same ID; preserve archive/trust; status backfill | No capped search |
| Storage upgrade | Duplicate has no storage; new blob supplied | Same ID gains blob/MIME | Blob survives |
| Orphan cleanup | Duplicate already has different blob | Keep original; delete newly supplied orphan | Original survives |
| Readable | New nonblank content | Existing insertion/status | Normal validators |
| Anonymous | Empty/whitespace upload | Reject; no writes | Existing auth error |
| Report mismatch | Blank upload bound to foreign report | Reject; no document/attempt writes | INVALID_INPUT |

</frozen-after-approval>

## Code Map

- `convex/documents.ts`: conditionalize collection :83-92; preserve checks :66-72 and branches :100-163.
- `convex/documents.test.ts`: add metrics/anonymous/missing matrix cases; preserve existing assertions.
- `convex/uploadAttempts.test.ts`: read-only receipt regression suite.
- Provenance: `18f383c079ba24bf8781e5c5eca3b2b3af0b0a3f`; audit `.audit/branch-consolidation/planning/B3.md` and `B3-preflight.md`.
- APIs: convex-test/dist/index.d.ts:24,45 supports inline mutation and t.run storage; metrics fold into parent. reviewFromProject.test.ts:94 demonstrates Blob storage; dist/index.js:1171-1188 supports delete/getUrl.

## Tasks & Acceptance

**Execution:**
- [x] Confirm baseline/ownership; hash intended/protected files. Add tests first with documents.ts unchanged.
- [x] Keep metrics test title. Seed 0/3 ×100,000-character bodies outside measurement. Call registered uploadDocument via writer.mutation/ctx.runMutation; capture ctx.meta.getTransactionMetrics before verification reads. Record all four combinations before assertions; check counts/bytes/exact content and image reference_only/image_reference. Retain baseline red/metrics.
- [x] Add anonymous empty/whitespace no-write case using normal setup and unauthed t.mutation.
- [x] Foreign-report case: seed another project/report; authenticated blank upload with foreign reportId/fresh attemptKey rejects INVALID_INPUT, target document/attempt collections unchanged.
- [x] Archived legacy case: seed exact nonblank duplicate, archived:true, absent processingStatus/uploaderRole; assert same ID, archive/trust preserved and expected status backfill.
- [x] Separate storage cases: seed via t.run(ctx => ctx.storage.store(new Blob(...))). Text-only duplicate gains supplied blob/MIME, same ID and live URL. Already-backed duplicate keeps original blob while different supplied orphan has null system metadata/getUrl. Use authenticated api.documents.uploadDocument throughout.
- [x] Preserve blank/receipt/role tests and every matrix row. Move only eligibility; rerun suites; retain hashes/commands/exits and evidence.md under `.audit/branch-consolidation/B3/`. Hand readiness to parent.

**Acceptance Criteria:**
- Minimal metrics fixture (no reportId/attemptKey/storageId) has two queries/two documents, independent of history; legitimate binding/receipt reads in other cases are not constrained to two.
- Same registered-mutation regression fails before and passes after; all four measurements exist on both sides without mocked counters.
- Every matrix row executes; retain existing assertions. No new files/config exemptions.

## Spec Change Log

## Design Notes

Metrics work without limit enforcement; isolate seed/verification transactions. Preserve full nonblank collection; its budget risk is outside scope. Historical bytes are not current proof/limits. Local Blob fixtures need no deployment/credentials.

## Verification

**Commands:**
- Tests only baseline: `node node_modules/vitest/vitest.mjs run convex/documents.test.ts --testNamePattern '^uploadDocument processing status empty and whitespace uploads keep document reads constant$' --expect.requireAssertions` must fail after recording all four cases.
- Repaired source: `node node_modules/vitest/vitest.mjs run convex/documents.test.ts convex/uploadAttempts.test.ts --expect.requireAssertions` must pass.
- Parent coordinates independent review, `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` and `git diff --check`, possibly combined with adjacent final batches.

Draft/preflight ran no tests. This proves blank-body read independence and preservation, not nonblank capacity or browser transport.

## Suggested Review Order

- Skip unrelated bodies before dedupe; retain all existing upload branches.
  [documents.ts:83](../../convex/documents.ts#L83)

- Prove four registered-mutation measurements before and after the fix.
  [documents.test.ts:43](../../convex/documents.test.ts#L43)

- Preserve validation, legacy trust, original bytes and orphan cleanup.
  [documents.test.ts:102](../../convex/documents.test.ts#L102)

Native follow-up DW-103 concerns pre-existing nonblank storage cleanup; it remains open. No sprint story key is present, so sprint synchronization is a no-op.
