# B3 read-only preflight

Result: the proposed registered-mutation metrics API and fixture are valid. No impossible assertion or needed source-scope expansion found. Three evidence/wording corrections are needed below. No tests ran and no source/spec/ledger changed.

## API and count feasibility

- `convex-test/dist/index.d.ts:24` supports `writer.mutation(async ctx => ...)`; runtime `dist/index.js:1732-1736` runs that inline callback as a mutation. Its `ctx.runMutation` resolves the registered reference (`:1714-1716`), so this is the real upload handler/validators, not mocked db counters.
- Convex `src/server/registration.ts:158` exposes mutation `meta`; `src/server/meta.ts:134` declares `getTransactionMetrics()`. convex-test `dist/index.js:1005-1009` returns the active tracker. Top-level transactions always construct the tracker (`:1403`), even though current `convex/documents.test.ts:13` uses the default limit-enforcement setting. Enabling transaction limits is not required merely to measure usage.
- Nested mutation usage folds into the inline parent's metrics (`convex-test/dist/transactionMetrics.js:38-42,62-66`). Separate `t.run` seeding and post-capture reads do not contaminate the measured transaction.
- Current fixture (`convex/documents.test.ts:12-37`) maps one writer and project. Access reads the indexed user (`convex/lib/auth.ts:16-24`) and project (`:45-64`). With no reportId/attemptKey/storageId, the optimized blank path then inserts without another body lookup (`convex/documents.ts:134-163`). Two query/read operations are a coherent fixture-specific expectation. Current eager collection (`:83-92`) adds a query even when empty and body reads when seeded.
- Exact bytes can be compared across the two histories for each input fixture, rather than hardcoding historical 375 bytes. Three 100,000-character bodies are valid seeded rows; their creation lies outside measurement. The source-only inference still needs the planned actual before/after run.

## Concrete corrections

1. **Collect all four baseline measurements before asserting.** The historic test at `18f383c:convex/documents.test.ts:507-510` asserts two queries immediately after the first empty/zero-history measurement. The unfixed baseline fails there, so it never exercises three bodies or the whitespace fixture during that run. Preserve the exact regression title and numeric assertions, but first collect/record all four `(content, existingCount, metrics, stored)` results, then assert them. This satisfies draft execution :54-56 and makes retained before/after metrics substantiate both fixtures/history sizes. It does not weaken the initial red case.

2. **Qualify two-query/two-document counts to the minimal measured fixture.** Draft acceptance :60 currently reads as universal blank-upload behavior. `reportId` adds a validation read (`convex/documents.ts:67-71`); `attemptKey` invokes receipt resolution (`:155-161`). These supported paths must remain intact and can legitimately read more. State that exact counts apply when the metrics fixture supplies no optional report/attempt/storage arguments. The general invariant is no unrelated project-body collection for blank input, not zero legitimate binding/receipt reads.

3. **Do not claim existing focused storage/report-binding/archived-dedupe test coverage.** Neither `convex/documents.test.ts` nor `convex/uploadAttempts.test.ts` currently contains `storageId`, `reportId` or `archived` fixture arguments. Existing status and receipts are substantial, but the draft's “existing ... storage ... tests” language overstates these two suites. For this narrow conditional-query patch, preserve those source branches verbatim and record that static check; if parent requires executable matrix coverage, add small cases in the already-allowed documents.test.ts rather than claiming it exists. No new test file or dependency is necessary. A post-metrics assertion on the image fixture's `processingStatus=reference_only`/`processingDetail=image_reference` is also a useful direct guard, consistent with existing extraction fixture at :50-54.

## Current behavior to preserve

- Authorization/binding remain before eligibility (`documents.ts:66-72`); an unauthenticated call fails before writes (`auth.ts:19-29`). New anonymous fixture can validly check an empty projectDocuments collection because setup seeds only users/project.
- Dedupe is exact filename/content across the entire by_projectId collection (`documents.ts:83-92`), including archived/legacy rows. Do not cap/filter or trim persisted content (`:139`).
- Preserve storage upgrade/delete (`:101-109`), status backfill-on-touch (`:114-118`), duplicate attempt resolution (`:123-129`), new-row caller-derived uploaderRole (`:146-151`) and new attempt resolution (`:155-161`).
- Existing proofs cover truthful extraction status (`documents.test.ts:40 onward`), legacy role preservation (`:159-235`), separate unreadable documents/attempts (`:238-306`), nonblank dedupe (`:309-323`), separate whitespace rows (`:326-342`), invalid attempt rollback (`:345-364`), unreadable eligibility (`:367-397`), replacement receipt resolution (`:400-432`) and old-client status (`:460-470`). UploadAttempts tests independently pin new and duplicate receipt resolution (`uploadAttempts.test.ts:131-183`). Preserve these tests and their selection.

Parent must replace PARENT_SETS_BASELINE at dispatch. This preflight used current read-only source and installed APIs only; no claim of fresh runtime metrics is made.
