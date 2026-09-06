# DW-103 implementation evidence

Baseline HEAD: ed79a296039109fe1a2bf5dd867f9e5af22f2967, matching the spec. All frontmatter context was loaded before implementation. All work remained in this worktree. No installs, generated-file edits, historical artifact edits, ledger edits, staging, commits, remote operations or review dispatch.

## Changes

Four schema indexes cover projectDocuments.storageId, brainSources.storageId, ingestionItems.storageId and ingestionItems.textStorageId. The shared convex/lib/storage.ts helper uses indexed equality and first() for each field, without project or lifecycle filters. All three cleanup callers use it. Row deletion precedes the remaining-reference check in the same mutation. Maintenance selection, including its existing scan and cross-project behavior, is unchanged. Access, attribution, receipt resolution and blank-upload code are unchanged.

## Commands and full output

- Baseline hashes: `shasum -a 256 convex/documents.ts convex/seed.ts convex/schema.ts` in baseline-source-hashes.txt.
- Initial baseline: `npm test -- convex/documents.test.ts convex/storageCleanup.test.ts convex/uploadAttempts.test.ts`, exit 1, full output in baseline-tests.log. This exposed a test fixture mistake: an internal writer has access. The denied caller was corrected to an authenticated roleless user before the final baseline run.
- Final baseline, production still unchanged: same test command, exit 1, full output in baseline-tests-final.log: **15 failed, 43 passed, 58 total**. Failures demonstrate missing referenced bytes and URLs. The shared lifecycle also encounters already-deleted storage at final cleanup.
- Final baseline hashes: `shasum -a 256 convex/documents.ts convex/seed.ts convex/schema.ts convex/storageCleanup.test.ts` in baseline-final-hashes.txt. The three production hashes match baseline-source-hashes.txt.
- Fixed: same focused test command, exit 0, full output in fixed-tests.log: **58 passed, 3 files passed**.
- Fixed named-case evidence: same command plus `--reporter=verbose`, exit 0, full output in fixed-tests-verbose.log: **58 passed**.
- `node node_modules/typescript/bin/tsc -p convex/tsconfig.json --noEmit`, exit 0, full output in typecheck.log (silent success).
- `git diff --check`, exit 0, full output in diff-check.log (silent success).
- Fixed hashes: `shasum -a 256 convex/documents.ts convex/seed.ts convex/schema.ts convex/lib/storage.ts convex/storageCleanup.test.ts` in fixed-hashes.txt.

The regression test SHA-256 is identical in final baseline and fixed manifests: d4d0ee6e69ed78099005090c711af2d29d4b25f20254d96a8e641f788e7ae526. No test expectations changed after the final baseline run.

## Acceptance and matrix mapping

All storageCleanup cases call registered mutations and use convex-test Blob storage with byte, URL and metadata observations. No storage mocks or skipped cases.

| Criterion / matrix row | Exact case or source evidence | Baseline / fixed |
| --- | --- | --- |
| Public A/S1, B/S2, duplicate A/S2; original rows and receipt resolution | storageCleanup: public A/S1, B/S2, duplicate A/S2 preserves both originals and resolves receipt | Lost B bytes/URL / pass |
| True orphan duplicate removed; original unchanged | documents: an already-backed duplicate keeps its original and deletes the new orphan | pass / pass |
| Shared deletion, archived foreign reference, final byte reclamation | storageCleanup: shared document deletion retains archived foreign reference until final deletion | fail / pass |
| Four reference fields and unrelated records, archived/revoked/soft-deleted states | storageCleanup: duplicate/delete/maintenance preserves archivedDocument/revokedBrain/ingestionOriginal/ingestionText and its bytes (12 cases) | All fail on missing bytes / all pass |
| Maintenance shared survivor, existing cross-project selection, return shape and orphan cleanup | storageCleanup: maintenance keeps shared survivor bytes and reclaims a distinct orphan across projects | Lost survivor bytes / pass |
| Unauthorized deletion, no row or blob changes | storageCleanup: unauthorized deletion leaves document and storage unchanged | Final baseline pass / pass |
| Transaction rollback | storageCleanup: invalid attempt rolls back duplicate orphan cleanup | pass / pass |
| Constant-read blank-upload compatibility | documents: empty and whitespace uploads keep document reads constant | pass / pass; existing assertions unchanged |
| Attempt compatibility | All uploadAttempts.test.ts cases; new public reproduction receipt assertions | pass / pass; existing suite unchanged |
| Bounded reference checks, no metadata disclosure | convex/lib/storage.ts: four indexed equality queries ending in first(), returning no metadata; four schema indexes | Source inspected; cross-project regressions pass |
| Types and whitespace | tsc and git diff --check above | exit 0 |

Exact baseline failures are in baseline-tests-final.log; every fixed case name is in fixed-tests-verbose.log.

## Remaining work and limits

Implementation and required focused checks are complete. Independent root review through three lenses and canonical verification remain pending, as reserved by the spec. This is not root acceptance. Runtime tests use local convex-test storage; no deployed environment or remote schema deployment was exercised.

The TypeScript skill was loaded and followed. Its referenced type-system-discipline skill was absent from the searched local skill roots; the loaded TypeScript rules and generated Convex guidelines supplied the applicable typing guidance.

## Root final acceptance

Three fresh Astra6 medium review layers completed; all10 blind findings independently triaged in review-triage.md. Root added exact access-denial verification, a second discarded row sharing an orphan, and a real missing-storage failure/row-rollback check. These are verification patches; production behavior after review is unchanged. The final focused suite passes59 cases, plus Convex types and whitespace checks. The original baseline/fixed regression snapshot is separately retained and hash-bound; newly added assertions are not claimed to have run in that original baseline.

The final full nine-step gate passed2038 unit tests and489 browser tests, typechecks, discovery, build and both uploader harnesses; gate/result.json binds the actual output and reports no unexpected working-byte mutations. Known historical capture writes were preserved/restored for this unit; Q2 separately removes their cause. final-source-hashes.json binds the accepted source and completed SPEC. Deployed storage/schema behavior remains untested here.
