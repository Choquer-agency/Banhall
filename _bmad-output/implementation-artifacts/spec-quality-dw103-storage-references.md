---
title: 'DW-103: Preserve referenced storage during document cleanup'
type: bugfix
created: '2026-09-06'
status: done
review_loop_iteration: 0
baseline_commit: ed79a296039109fe1a2bf5dd867f9e5af22f2967
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '/Users/johnnynguyen/.agents/skills/typescript-best-practices/SKILL.md'
---

<frozen-after-approval reason="human-owned intent; standing authorization for verified fixes">

## Intent

**Problem:** Duplicate-upload cleanup trusts that a supplied storage ID is an orphan. A valid registered-mutation sequence uploads A with S1 and B with S2, then duplicates A with S2: current cleanup deletes B's original bytes. Normal document deletion and maintenance dedupe have the same unsafe assumption when records share an ID.

**Approach:** Delete bytes only after no application record references them. Preserve existing document dedupe, deletion, access, receipts and attribution behavior. Prove the original loss using real Convex storage before repairing it.

## Boundaries & Constraints

**Always:** Work only in `/Users/johnnynguyen/Documents/Repos/Banhall-quality-pass`. Keep all other worktrees unchanged. Query reference existence through indexes with a bounded first result. Any reference, including archived documents or revoked/soft-deleted source records, protects its bytes. Preserve true orphan cleanup and transactional behavior. Keep blank-upload constant-read behavior. Load context paths with project-root resolved to this worktree. Record actual baseline and fixed commands/results under `.audit/quality-pass/Q1`.

**Ask First:** A change to human permissions, report prose, source-retention policy, or upload ownership policy not already authorized by the product contract.

**Never:** Rewrite generated files, native deferred ledger, other specs, dependencies, or historical audit artifacts. No staging, commits, pushes, remote mutations, dependency installs or full-suite review dispatch by implementer. No global scans, reference-count migration, broad ingestion refactor, or new public API. Do not change the maintenance function's existing document-selection semantics.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Duplicate with referenced blob | A/S1, B/S2, duplicate A supplying S2 | A remains original; B and S2 bytes/URL survive | Existing return ID and receipt resolution |
| True orphan duplicate | A/S1 and freshly stored unattached S2 | A/S1 unchanged; S2 removed | Preserve existing result |
| Shared record deletion | Two document rows reference one blob | Delete first row, retain bytes; delete final row, reclaim bytes | Existing authorization applies |
| Other application references | Blob referenced by brainSources.storageId or ingestionItems.storageId/textStorageId | Document cleanup preserves blob and unrelated record | No metadata disclosure to caller |
| Maintenance shared blob | Dedupe removes row sharing retained row's blob | Kept document's bytes survive | Keep existing return shape |
| Unauthorized delete | Outsider requests deleteDocument | No document or blob changes | Existing access denial |

</frozen-after-approval>

## Code Map

- `convex/documents.ts:66-163` registered upload: access then nonblank exact filename/content dedupe. Lines110-112 delete supplied nonmatching storage ID. Lines231-240 deleteDocument currently deletes storage first. Reuse existing auth and attempt handling unchanged.
- `convex/seed.ts:11-39` tagAndDedupeDoc is the only additional production ctx.storage.delete caller. Its retained row may share storage with deleted rows. Do not broaden its query or cross-project behavior in this fix.
- `convex/schema.ts:999-1080,1650-1697,1980-2055`: persistent storage reference fields are projectDocuments.storageId, brainSources.storageId, ingestionItems.storageId and textStorageId. No reference index exists yet. Add four named by_storageId/by_textStorageId indexes to relevant tables; widening indexes does not change records.
- `convex/lib/` has no shared reference-safe deletion mechanism. A small typed helper reused by all three cleanup callers is appropriate. `MutationCtx`, `Id<"_storage">` from generated types are read-only imports. Perform row deletion before checking remaining references when removal actually discards that reference.
- `convex/documents.test.ts:1-43,190-238` real convex-test setup and stored Blob assertions, including genuine orphan deletion. Extend this suite or add a focused registered-function suite with matching fixture conventions. `convex/uploadAttempts.test.ts` remains compatibility coverage.
- `docs/product-domain.md` governs immutable creator/human workflow and source governance; this repair changes none of those policies. Existing `projects` duplication intentionally copies bytes through its action; do not alter it here.
- `.audit/branch-consolidation/B3/evidence.md` and native DW-103 are historical starting evidence, not runtime proof of this fix.

## Tasks & Acceptance

**Execution:**
- [ ] `convex/documents.test.ts` (or a focused `convex/storageCleanup.test.ts`) add real registered-mutation and storage regressions covering the matrix. Run against unchanged production source first, retaining failure output and baseline source hashes.
- [ ] `convex/schema.ts` add bounded lookup indexes for the four actual storage reference fields.
- [ ] `convex/lib/storage.ts`, `convex/documents.ts`, `convex/seed.ts` implement one shared reference-safe cleanup and use it at all three deletion sites, preserving existing operations.
- [ ] `.audit/quality-pass/Q1/evidence.md` map each criterion and matrix row to exact executed case/log, before/after hashes and commands; retain full outputs.

**Acceptance Criteria:**
- Given the original public upload reproduction, when tests run before and after the repair without expectation changes, then the baseline demonstrates lost referenced bytes and the repaired version preserves them while reclaiming an actual orphan.
- Given unrelated records in any project and archived/source states, when cleanup checks storage, then all actual references protect bytes without full-table reads or authorization weakening.
- Given one surviving reference and later its deletion, when registered delete operations complete, then reference and byte lifecycle remains consistent and the last unreferenced blob is deleted.
- Given the current empty-upload optimization and attempt tests, when focused compatibility suites run, then their assertions remain intact and pass.

## Spec Change Log

## Verification

- `npm test -- convex/documents.test.ts convex/storageCleanup.test.ts convex/uploadAttempts.test.ts` selecting only files that exist; all matrix regressions executed, no skipped cases. Baseline must fail specifically on referenced-byte loss.
- `node node_modules/typescript/bin/tsc -p convex/tsconfig.json --noEmit` passes.
- `git diff --check` passes for owned source/spec.
- Root independently reviews all three BMAD lenses and runs canonical verification before accepting/committing this unit. Implementer must not claim root acceptance.

## Suggested Review Order

- Preserve bytes whenever any record references them.
  [storage.ts:7](../../convex/lib/storage.ts#L7)

- Use safe cleanup at public duplicate and delete operations.
  [documents.ts:110](../../convex/documents.ts#L110)

- Remove discarded references before maintenance cleanup.
  [seed.ts:32](../../convex/seed.ts#L32)

- Index all four persisted reference fields.
  [schema.ts:1073](../../convex/schema.ts#L1073)

- Exercise registered operations and real storage failure cases.
  [storageCleanup.test.ts:38](../../convex/storageCleanup.test.ts#L38)
