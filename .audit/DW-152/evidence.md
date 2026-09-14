# DW-152 evidence: byte-bounded generation-consumer Brief reads

- Base commit: `611cbcb24504acba7e3d7e3bd1799a53de9dd74b` (branch `factory/dw-152-brief-byte-bounded-reads`).
- Fix commit: the commit that adds this file (single commit on top of the base; message names DW-152).
- Final bytes proven (sha256): `convex/generations.ts` 6333c627515e4bc35aab129b72f7b16bedbcce5e935981a25ad60b5be0b1b525, `convex/ai/brief.test.ts` d75cccce4a3e16f78a291f0c13eb3572d6bd731e55c600fe0a45523526877a3e, `convex/ai/promptProgram.test.ts` 65f5285549b635b18477f1d663d6ab19f8398e891eebd2a7998464597b2ab9af. Each raw log records the hashes it ran on in its header.
- Deferred-work ledger not edited.

## Defect

`readBriefEntryRowsOrOmit` read up to `MAX_BRIEF_ENTRY_ROWS + 1` `generationBriefEntries` rows with `take()` and no byte bound. Writer edits accept any non-empty text, so 500 or fewer rows can exceed Convex's 16 MiB per-transaction read limit. The read then throws in `renderBriefForGeneration` and in `loadBriefCheck`, which runs inside `claimOrderedSectionRun` and `getOrderedCandidateDrafts`. Both are awaited outside the `try` in `convex/ai/orderedGeneration.ts` (:174, :374), so the CAS claim rolls back and the section stays `queued` until stale-generation recovery.

## Fix

`convex/generations.ts`:
- New export `BRIEF_CONSUMER_READ_BYTES = 4 MiB`.
- `readBriefEntryRowsOrOmit` now makes one `.paginate({ cursor: null, numItems: MAX_BRIEF_ENTRY_ROWS + 1, maximumBytesRead: BRIEF_CONSUMER_READ_BYTES })`. This is the same platform byte bound `getBriefDiffBaselinePage` uses. The Brief counts as complete only when:
  - the page has at most `MAX_BRIEF_ENTRY_ROWS` rows,
  - `isDone` is true, and
  - `pageStatus` is not `SplitRequired`.
- Row overflow keeps its existing message byte-for-byte. A byte or incomplete-page overflow logs one `console.error` naming the generation id, the Brief id and the byte budget. In both cases the helper returns `null`, so both consumers omit the whole Brief (`""` / `{ briefBlock: "", brief: null }`) and never a prefix, as the DW-107/118 spec's `Always` rules require.
- Both consumers still share the same choke point, and their filters are unchanged.

The API surface was checked in the installed packages, not assumed. `maximumBytesRead?: number` is in `node_modules/convex/dist/esm-types/server/pagination.d.ts:109` (convex 1.42.3) and is passed through at `node_modules/convex/src/server/impl/query_impl.ts:303`.

### Byte budget rationale (4 MiB)

The heaviest caller is `claimOrderedSectionRun`. Besides the Brief rows, one transaction reads:
- the claimed section row (`orderedRunForSection`)
- the fence's candidate run, generation and project
- the candidate's three section rows, which include prior drafts (`orderedRunsForCandidate`)
- the Brief parent

That is 8 documents of at most 1 MiB each. Convex checks `maximumBytesRead` after reading a row, so the Brief read can overshoot by at most one row (1 MiB or less). The worst case is 8 + 4 + 1 = 13 MiB, under 16 MiB. `getOrderedCandidateDrafts` reads 6 other documents and `renderBriefForGeneration` reads 2, so both have more headroom. 4 MiB matches `BRIEF_BASELINE_PAGE_BYTES`. A realistic derived Brief is a small fraction of it.

### orderedGeneration.ts:174 / :374: decision, no change

With the fix, the Brief read is bounded at about 5 MiB, so a byte-heavy Brief can no longer make either await throw. The ordered-chain test proves this under the enforced limit. Wrapping those awaits in `try` would be general exception-safety hardening for other failures, such as database errors or limits hit by the caller's other reads. It would also change claim and fail semantics: `failOrderedSectionRun` is fenced, and it would run after a claim that rolled back. That is outside DW-152 and was left unchanged. The helper's doc comment now says which failures still propagate.

### Constraint preserved

Convex allows one `.paginate()` per function execution. convex-test enforces this at `node_modules/convex-test/dist/index.js:943-955`. None of the three callers paginates anywhere else (`grep -n "\.paginate(" convex/generations.ts`: only `getBriefDiffBaselinePage` and the stale-project sweep). The helper's comment records the rule.

## What convex-test does and does not enforce

- It **does** enforce the 16 MiB per-transaction read limit when you construct `convexTest({ schema, modules, transactionLimits: true })`. It sums `getDocumentSize` over every `get`, streamed query row and returned page row, and throws `Read too much data in a single function execution (limit: 16777216 bytes)` (`transactionMetrics.js:9-18,81-92`). The repo already relies on this in `convex/learningHealthBytes.test.ts`. The DW-152 tests use it, so the BEFORE failure is the real limit exception, not a simulated one.
- It **does** honour `maximumBytesRead` in `paginate`: `SplitRequired` once `bytesRead >= maximumBytesRead`, with the crossing row included in the page (`index.js:278-384`).
- It does **not** reproduce the production backend byte for byte:
  - its document sizes come from `getDocumentSize`, an approximation of the backend's accounting;
  - its paginate never ends a page early for reasons other than the row/byte options;
  - it runs no actual deployment.
- The claim that 13 MiB is the worst case in production rests on the arithmetic above (1 MiB document cap, overshoot of at most one row), not on a deployed measurement.

## Acceptance points → proof

| # | Acceptance point | Proof |
|---|---|---|
| 1 | A byte-heavy Brief (≤ `MAX_BRIEF_ENTRY_ROWS` rows, > 16 MiB) no longer throws in `renderBriefForGeneration` and `loadBriefCheck`, and is omitted whole with a diagnosable log | `brief.test.ts` › "omits a byte-heavy Brief under the row bound that exceeds the transaction read limit from both prompt readers instead of throwing (DW-152)". 450 rows × 42 KB. It first proves the plain `take(501)` throws `Read too much data`. Then it reads both consumers via `renderBriefForGeneration` and `getOrderedCandidateDrafts` (loadBriefCheck), expects 0 rendered bytes and a null brief, and expects 2 log lines naming the generation id, the Brief id and `BRIEF_CONSUMER_READ_BYTES` |
| 2 | The ordered claim path completes and no section is left queued | `promptProgram.test.ts` › "omits a byte-heavy Brief from the ordered chain under enforced transaction limits: every section drafts, none is left queued (DW-152)". It runs the real `claimOrderedSectionRun` ×3 and `getOrderedCandidateDrafts` in finalize, then asserts the order `242, 244, 246, finalize`, every row `drafted`, the generation `completed`, and no Brief marker or row text in any prompt |
| 3 | The render path through real callers (iterative.ts:406, pipeline.ts:957) omits it | `promptProgram.test.ts` › "omits a byte-heavy Brief from iterative's own section and from its one-shot ghost under enforced transaction limits (DW-152)" |
| 4 | The budget, not the platform limit, decides omission (whole Brief, same semantics) | `brief.test.ts` › "omits a Brief past the consumer byte budget even where the transaction read limit would allow the read (DW-152)". Uses 200 rows, about 8.4 MB, between 4 MiB and 12 MiB |
| 5 | The budget is not too tight, and a complete single page is accepted | `brief.test.ts` › "reads a large Brief just under the consumer byte budget completely in both readers (DW-152 boundary)". Uses 80 rows, about 3.4 MB |
| 6 | Row-cap omission and the DW-107/118/112 tests still pass | `.audit/DW-152/focused.raw.log`. Files: `convex/ai/brief.test.ts`, `promptProgram.test.ts`, `briefPipelineWiring.test.ts`, `pipeline.compare.test.ts`, `selfCheck.test.ts`, `writerSettings.test.ts`, `convex/briefs.test.ts`. Result: 7 files, 131 tests passed. This includes "omits an over-bound Brief from both prompt readers instead of throwing" (row message still contains `500`), "reads a Brief of exactly MAX_BRIEF_ENTRY_ROWS completely…", "re-reads a byte-heavy baseline page smaller after SplitRequired…", both over-bound ordered and iterative chain tests, and the DW-112 idempotency tests |
| 7 | Full gate | `bash scripts/loop-verify.sh`: `.audit/DW-152/full-gate.raw.log`, `GATE_EXIT=0`, all 9 steps ok, unit tests 189 files / 2688 tests passed |

## BEFORE (HEAD `convex/generations.ts`, final test bytes): `.audit/DW-152/before.raw.log`

To rerun BEFORE on the final test bytes, the fixed `generations.ts` was copied aside, `git show HEAD:convex/generations.ts` was restored, the run was made, and the fixed file was put back. The log header records that `generations.ts` and `orderedGeneration.ts` were identical to HEAD.

```
     × omits a byte-heavy Brief under the row bound that exceeds the transaction read limit from both prompt readers instead of throwing (DW-152)
     × omits a Brief past the consumer byte budget even where the transaction read limit would allow the read (DW-152)
     × reads a large Brief just under the consumer byte budget completely in both readers (DW-152 boundary)
     × omits a byte-heavy Brief from the ordered chain under enforced transaction limits: every section drafts, none is left queued (DW-152)
     × omits a byte-heavy Brief from iterative's own section and from its one-shot ghost under enforced transaction limits (DW-152)
Error: Read too much data in a single function execution (limit: 16777216 bytes). ...
 ❯ readBriefEntryRowsOrOmit convex/generations.ts:1642:16
 ❯ handler convex/generations.ts:2105:21                       (renderBriefForGeneration)
AssertionError: expected { renderedBytes: 8402970, …(1) } to deeply equal { renderedBytes: +0, …(1) }
TypeError: expected value must be number or bigint, received "undefined"
Error: Read too much data in a single function execution (limit: 16777216 bytes). ...
 ❯ readBriefEntryRowsOrOmit convex/generations.ts:1642:16
 ❯ loadBriefCheck convex/generations.ts:4050:16
 ❯ handler convex/generations.ts:4123:35                       (claimOrderedSectionRun)
AssertionError: expected [] to deeply equal [ '242' ]
 Test Files  2 failed (2)
      Tests  5 failed | 61 skipped (66)
EXIT=1
```

How to read the BEFORE failures:
- (1) and (2) fail on the real read-limit exception in each consumer.
- (4) fails because the byte budget did not exist, so an 8.4 MB Brief was rendered.
- (5) is the boundary guard. Its behavioural assertions (80 rows read in full) ran before its final budget-relation assertion, which failed only because `BRIEF_CONSUMER_READ_BYTES` did not exist yet. It is a guard, not a reproduction.
- (3) showed no section-242 draft prompt: the iterative section job's Brief read threw before drafting.

## AFTER: `.audit/DW-152/after.raw.log`

```
 ✓ ... omits a byte-heavy Brief under the row bound that exceeds the transaction read limit from both prompt readers instead of throwing (DW-152)
 ✓ ... omits a Brief past the consumer byte budget even where the transaction read limit would allow the read (DW-152)
 ✓ ... reads a large Brief just under the consumer byte budget completely in both readers (DW-152 boundary)
 ✓ ... omits a byte-heavy Brief from the ordered chain under enforced transaction limits: every section drafts, none is left queued (DW-152)
 ✓ ... omits a byte-heavy Brief from iterative's own section and from its one-shot ghost under enforced transaction limits (DW-152)
 Test Files  2 passed (2)
      Tests  5 passed | 61 skipped (66)
EXIT=0
```

## Full gate tail: `.audit/DW-152/full-gate.raw.log`

```
[5/9] unit tests
 Test Files  189 passed (189)
      Tests  2688 passed (2688)
[6/9] test discovery guard   ok
[7/9] production build       ok
[8/9] uploader harness (pwsh) ok
[9/9] uploader harness (bash) ok
GATE_EXIT=0
```

## Limitations / residual risk

- No deployed-backend proof. Production byte accounting and early page termination can differ from convex-test.
  - If production ends a page early (`isDone` false) for a Brief under both bounds, the Brief is omitted. That fails safe (guidance dropped, generation continues) but would suppress guidance. The warning log makes it diagnosable.
- Behaviour change: a Brief between 4 MiB and 16 MiB used to be rendered and is now omitted whole. This is intentional (budget headroom), consistent with row-cap omission, and pinned by test (4).
- Omission is still visible only in logs. Writer-facing omitted-Brief visibility is DW-109/DW-120, out of scope.
- The awaits outside `try` in `orderedGeneration.ts` still propagate other failures, such as database errors or limits reached by prior-section reads. That is not a Brief-byte issue and is unchanged by design (see above).
- No independent gpt-6-astra review was run in this worker session. Review is pending, not passed.
