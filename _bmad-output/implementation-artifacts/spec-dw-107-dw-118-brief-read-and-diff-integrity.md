---
title: 'DW-107/DW-118: Brief read completeness and diff-baseline integrity'
type: 'bugfix'
created: '2026-09-12'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: [oversized]
deferred:
  - summary: >-
      convex/ai/brief.test.ts cannot assert on model prompts, because convex-test
      runs leftover scheduled jobs from earlier cases against the shared
      module-level Anthropic mock.
    evidence: |-
      Confirmed during implementation: 16-18 polluting network.create calls were
      observed while the case's own database held zero generationBriefs rows, so
      neither briefCalls() nor mockClear() isolates a case's prompts in that file.
      Pre-existing property of the file's fixtures, surfaced by this work rather
      than caused by it. Worked around, not fixed: that file's assertions are
      database-scoped, and the prompt-level proof lives in
      convex/ai/promptProgram.test.ts, where every scheduled job is cancelled and
      run explicitly with mockClear() before each scan. A future prompt-level
      assertion added to brief.test.ts would be silently unreliable.
    location: >-
      convex/ai/brief.test.ts (fixture and scheduler lifecycle)
    severity: low
  - summary: >-
      Generation-consumer Brief reads bound rows but not bytes, so a byte-heavy
      Brief can exceed the transaction read limit and throw where the ordered
      chain awaits the read outside its try.
    evidence: |-
      renderBriefForGeneration and loadBriefCheck read up to MAX_BRIEF_ENTRY_ROWS + 1
      generationBriefEntries rows with no maximumBytesRead (readBriefEntryRowsOrOmit
      in convex/generations.ts). The same byte-unbounded .take(500) existed at
      7b0723b (convex/generations.ts:1755, :3696). Writer edits
      (briefs.saveEntryEdit) accept any non-empty text, so 501 or fewer rows can
      exceed 16 MiB. A read-limit exception in claimOrderedSectionRun or
      getOrderedCandidateDrafts rolls the claim back outside
      convex/ai/orderedGeneration.ts's try, leaving the section queued until
      stale-generation recovery. Pre-existing; surfaced by the attempt 2 review
      (blind hunter), triaged defer by the gpt-6-astra medium review lead.
    location: >-
      convex/generations.ts readBriefEntryRowsOrOmit; convex/ai/orderedGeneration.ts:174,374
    severity: high
  - summary: >-
      A derived Brief can still be published and stamped after its generation
      was cancelled or superseded, because publication fences only on the
      project's newest Brief, not on the generation's lifecycle.
    evidence: |-
      persistDerivedBrief checks the newest-Brief fence and then stamps
      generations.briefId without checking generation status or
      project.activeGenerationId. At 7b0723b the same race already spanned the
      structured model call and publication (convex/ai/brief.ts:313, :435); the
      paged baseline read adds a short window to it. Pre-existing; surfaced by the
      attempt 2 review (blind hunter), triaged defer by the review lead.
    location: >-
      convex/generations.ts persistDerivedBrief
    severity: medium
  - summary: >-
      Chat's open-question evidence block still admits change "removed"
      confidenceMap rows from the Brief a generation used.
    evidence: |-
      convex/chatV2.ts openQuestionsFor (around :1311-1318) reads
      generationBriefEntries by briefId and filters by group and confidence only,
      identically to 7b0723b. Already owned as finding 6 / story 9 in the reviewed
      twelve-story intake (commit 09b2403); recorded here because the attempt 2
      review lead triaged it defer, not as a new repair owner.
    location: >-
      convex/chatV2.ts openQuestionsFor
    severity: medium
  - summary: >-
      The writer-facing Brief rail reads a plain take(MAX_BRIEF_ENTRY_ROWS), so it
      shows a prefix of an over-bound Brief.
    evidence: |-
      convex/briefs.ts briefEntries (:46-51) takes MAX_BRIEF_ENTRY_ROWS rows with no
      overflow probe; the same prefix read existed at 7b0723b (convex/briefs.ts:50
      with its local 500). Already tracked as DW-128; recorded here because the
      attempt 2 review lead triaged it defer, not as a new repair owner.
    location: >-
      convex/briefs.ts briefEntries (getBrief, listBriefEntries)
    severity: medium
baseline_revision: '7b0723b18cd19fe6e90f9216ff6272674edf2006'
---

<intent-contract>

## Intent

**Problem:** Every Generation Brief read in `convex/generations.ts` was silently bounded (sources `.take(200)`, entries `.take(500)` in `persistDerivedBrief`'s diff baseline, `renderBriefForGeneration`, `loadBriefCheck`), so an over-cap project derived from, diffed against, or drafted from a silent prefix (DW-107). `persistDerivedBrief` also diffed against the previous version's `change: "removed"` markers and `storylineQuestion` rows, so markers accumulated and questions came back as bogus "removed" evidence, and `renderBriefForGeneration` rendered those markers into prompts (DW-118). Attempt 1 fixed both but made the diff baseline refuse above 500 rows, so an over-bound newest Brief blocks every later changed-input derivation (CAP-4 regression found by independent review).

**Approach:** Consumers keep attempt 1's fail-open bounded read (omit the whole Brief above `MAX_BRIEF_ENTRY_ROWS`, never a prefix) and the live-evidence filters. The diff baseline is instead read **completely**: the derivation action pins the project's newest Brief id and enumerates its entry rows through separate bounded page queries (rows and bytes bounded per transaction) until an accepted page reports `isDone`, keeping only live evidence. `persistDerivedBrief` then publishes the complete new version atomically in one mutation, fenced on the pinned id still being the project's newest; a moved baseline writes nothing and the action re-reads and retries a bounded number of times.

## Boundaries & Constraints

**Always:**
- Every Brief **collection** read in `convex/generations.ts` is bounded per transaction and never yields a prefix as guidance, baseline or evidence. Single-row selects (`findReusableBrief`, the newest-Brief pin and fence) are exempt.
- One definition per bound: `MAX_BRIEF_SOURCE_ROWS` (200) and `MAX_BRIEF_ENTRY_ROWS` (500) exported from `convex/generations.ts`; `convex/briefs.ts` imports the latter. Neither number changes.
- `getGenerationSourcesForBrief` refuses above its bound with `domainError("INVALID_STATE", …)` (per generation, under the existing fail-open catch at `pipeline.ts:796-805` / `iterative.ts:261-269`).
- Generation consumers fail open and never throw on overflow: `renderBriefForGeneration` returns `""`, `loadBriefCheck` returns `{ briefBlock: "", brief: null }`, one `console.error` naming generation id, brief id and bound. Both filter identically (`group !== "storylineQuestion" && change !== "removed"`).
- The diff baseline is the project's actual newest `generationBriefs` row (`by_projectId`, desc, first), compared against **all** its live rows (`change !== "removed"`, `group !== "storylineQuestion"`) by `(group, sourceContentHash, startOffset, endOffset)`.
- Baseline enumeration: one `.paginate()` per internal query call over `generationBriefEntries.by_briefId`, `numItems` clamped to `MAX_BRIEF_ENTRY_ROWS`, `maximumBytesRead` set to `BRIEF_BASELINE_PAGE_BYTES`. A page whose `pageStatus` is `"SplitRequired"` is discarded and re-requested from the same cursor with fewer rows; a one-row page that still reports it throws. Enumeration is complete only when an accepted page reports `isDone`.
- Publication is one `persistDerivedBrief` mutation: fence first (pinned id, or `null` for a project with no Brief, must equal the current newest), then re-validate citations, insert the parent, every validated entry with its `change`, and one `removed` marker per unmatched live baseline row, then stamp `generations.briefId`. A fence miss returns `null` having written nothing.
- Prior versions stay byte-identical: no patch, delete or backfill of any `generationBriefs`/`generationBriefEntries` row.
- Convex rules in `convex/_generated/ai/guidelines.md` hold: indexed queries only, validators on every function, no hand-edits to `convex/_generated/`.

**Block If:**
- Proving recovery would require diff-unavailable/reset semantics, diffing against a version other than the newest, truncating or refusing an ordinary publication, or omitting truthful `removed` markers: that relaxes CAP-4 and needs a product decision.
- A previously-passing test asserts that a `change: "removed"` row is rendered into a section prompt.

**Never:**
- Carry the previous version's `storylineQuestion` rows forward or resolve them (`briefs.saveEntryEdit` owns that).
- Touch `briefs.getBrief`/`listBriefEntries` (DW-128), `convex/chatV2.ts:openQuestionsFor` (finding 6 / story 9 in intake `09b2403`), or omitted-Brief visibility (DW-109/DW-120).
- Cap, truncate or partially write `persistDerivedBrief`'s output: a derivation whose entries plus markers exceed `MAX_BRIEF_ENTRY_ROWS` persists in full and consumers omit it.
- Call `.paginate()` more than once in a function, enumerate baseline pages inside the publishing mutation, or add a larger fixed `take(N)` as the fix.
- Add a third Brief writer, publish a parent before its complete row set, re-run the model on a publish retry, or mutate report prose.
- Edit the deferred-work ledger or native loop state.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ordinary derivation | No previous Brief | Brief persisted; every entry `change: undefined` | No error expected |
| Re-derivation, entry dropped | Previous live entry K; candidates omit K | One `removed` marker for K | No error expected |
| Third derivation | Previous version carries a `removed` marker for K; K still omitted | No row for K | No error expected |
| Dropped entry returns | Previous `removed` marker for K; candidates include K | K stamped `added` | No error expected |
| Previous questions | Previous version has a `storylineQuestion` row | No question row, no marker for it | No error expected |
| Source overflow | 201 frozen sources | `getGenerationSourcesForBrief` throws `INVALID_STATE`; generation completes, `briefId` unset | Existing catch |
| Over-bound newest baseline | Newest Brief 821 rows (520 live, 300 markers, 1 question), changed inputs | New version diffs against all 520 live rows, including rows past index 500; markers and stamps truthful; the 821 rows unchanged | No error expected |
| Recovery continues | Newest Brief is the recovered (itself over-bound) version | Next changed-input derivation diffs against its live rows only and is readable by consumers when ≤ 500 rows | No error expected |
| Byte-heavy baseline | Live rows large enough that a full row-count page exceeds `BRIEF_BASELINE_PAGE_BYTES` | `SplitRequired` pages discarded and re-read smaller; every live row compared | No error expected |
| Baseline moves mid-derivation | A writer edit publishes after the pin | First publish returns `null`, writes nothing; retry diffs against the edited version | Bounded retries |
| Baseline keeps moving | Every publish attempt loses the fence | No version from this derivation; throws after `BRIEF_PUBLISH_ATTEMPTS` | Existing catch |
| Interrupted baseline read | A page query fails | Nothing written; next derivation publishes normally | Existing catch |
| Render overflow | Generation's Brief has 501 rows | `renderBriefForGeneration` `""`, `getOrderedCandidateDrafts(...).brief` `null`, nothing thrown | One `console.error` |
| Reused oversized Brief | Stored 501-row Brief matching `inputsHash` | Stamped via reuse; both consumers omit | Fail open |
| Prompt render | Live exclusion, `removed` exclusion, question | Only the live exclusion renders | No error expected |

</intent-contract>

## Code Map

- `convex/generations.ts:1552-1670` -- Brief read helpers from attempt 1: `MAX_BRIEF_SOURCE_ROWS`, `MAX_BRIEF_ENTRY_ROWS`, `readBriefSourceRows`, `probeBriefEntryRows`, `readBriefEntryRowsOrRefuse` (the lockout: only used by the baseline), `readBriefEntryRowsOrOmit`. Remove the refusing form; the omit form keeps the single `take(bound + 1)` probe.
- `convex/generations.ts:1671-1692` -- `getGenerationSourcesForBrief`, `findReusableBrief`. Unchanged.
- `convex/generations.ts:1721-1731` -- `briefCandidateEntryValidator`: exactly the fields a removal marker copies; reuse it for baseline rows.
- `convex/generations.ts:1743-1863` -- `persistDerivedBrief`: `:1760-1777` per-entry `ctx.db.get(sourceId)` re-validation (cache by source id so index ranges scale with sources, not entries); `:1780-1798` newest select + refusing baseline read to replace with the fence and supplied baseline; `:1807-1861` inserts, unchanged in shape.
- `convex/generations.ts:1868-1889`, `:3814-3857` -- `renderBriefForGeneration`, `loadBriefCheck`: fail-open consumers, keep.
- `convex/ai/brief.ts:279-446` -- `deriveOrReuseBrief`; `:435-444` the one `persistDerivedBrief` call to route through the new publish helper. `:149` `maxTokens: 8192` bounds a derived output.
- `convex/briefs.ts:36-70,182-330` -- `latestVersionOf`, `briefEntriesToCopy`, `saveEntryEdit`: second writer, inserts a whole version; the concurrent-edit regression drives it.
- `convex/generations.ts:3936-3968` -- `completeOrderedSectionRun` appends `storylineQuestion` rows to an existing version: the only post-publication change to a version's rows, excluded from the baseline.
- `node_modules/convex/src/server/pagination.ts:51-121` -- `pageStatus`, `splitCursor`, `maximumBytesRead` (Convex 1.42.3). `node_modules/convex-test/dist/index.js:278-384,943-955` -- test paginate honours `maximumBytesRead` and rejects a second `.paginate()` per function.
- `convex/ai/brief.test.ts:775-1480` -- attempt 1's DW-107/DW-118 block: `derivationFixture`/`derive` (`:903-916`), baseline-refusal case (`:1153-1202`, replace), 600-row case (`:1355-1409`), exact-bound case (`:1412-1464`), tenant cases (`:556-660`) calling `persistDerivedBrief` directly. `:400-420` reuse pattern (patch project between generations), `:422-500` changed-inputs pattern (extra `project_document` source).
- `convex/ai/promptProgram.test.ts:740-800` -- `seedOverBoundBrief` consumer path regressions; no `persistDerivedBrief` call.
- `convex/ai/orderedGeneration.ts:174,374` -- consumers awaited outside `try` (`:200`, `:410`): why consumers must fail open.

## Tasks & Acceptance

**Execution:**
- `convex/ai/brief.test.ts` -- First, before any source change, add the over-bound-newest recovery regression driven only through `internal.ai.pipeline.generateReport` and `t.run` (works on both code shapes) and run it on the adopted attempt-1 bytes; retain the failing log. -- Reproduces the lockout on attempt-1 code.
- `convex/generations.ts` -- Add exported `BRIEF_BASELINE_PAGE_BYTES` (4 MiB) and internal queries `getBriefDiffBaselineId({ projectId })` (newest id or `null`) and `getBriefDiffBaselinePage({ briefId, cursor, numItems })` (one clamped, byte-bounded `.paginate()`; returns live rows projected to `briefCandidateEntryValidator` fields plus their `entryId`, `readCount`, `isDone`, `continueCursor`, `pageStatus`). -- Complete enumeration in bounded transactions.
- `convex/generations.ts` -- `persistDerivedBrief`: add required `baselineBriefId` (id or `null`), `baselineRetained` and `baselineRemoved` (shapes in the P1 block below, which replaced a first-pass `baselineEntries`); fence before any read or write and return `null` on a miss; build the diff from those two arguments; cache source reads; remove `readBriefEntryRowsOrRefuse` and fold the probe into the omit form; update doc comments. -- Atomic, fenced publication with no baseline ceiling.
- `convex/ai/brief.ts` -- Export `readCompleteBriefDiffBaseline(ctx, projectId, candidates)` (pin, page loop with `SplitRequired` shrink, `isDone` completion, per-page partition into retained references and removed payload) and `publishDerivedBrief(ctx, args)` (read, publish, retry on `null` up to `BRIEF_PUBLISH_ATTEMPTS` = 3, then throw); both typed on `Pick<ActionCtx, "runQuery" | "runMutation">`; `deriveOrReuseBrief` calls `publishDerivedBrief`. -- Keeps the derivation stage the only derived writer.
- `convex/ai/brief.test.ts` -- Route `derive`, the 600-row and exact-bound cases through `publishDerivedBrief` with a `t.query`/`t.mutation` ctx adapter; tenant cases pass `baselineBriefId: null, baselineEntries: []`; replace the baseline-refusal case; add the concurrent-edit, retry-exhaustion, interrupted-read and byte-heavy cases. -- Proves every new matrix row.
- `_bmad-output/implementation-artifacts/spec-dw-107-dw-118-brief-read-and-diff-integrity.md` -- Record the result, evidence paths and residual risks.

**Execution, P1 transport repair (repair-plan review; keep every earlier task's result):**
- `convex/ai/brief.test.ts` -- First, before changing the transport, add the retained-large-text transport regression (see Acceptance Criteria) and run it on the current bytes; save the red log, the test file's hash and a patch of the addition under `.audit/dw-brief-read-and-diff-integrity/attempt-2/p1/`, never overwriting existing attempt-2 logs. -- Proves the argument-size defect before fixing it.
- `convex/ai/brief.ts` -- `readCompleteBriefDiffBaseline`/`publishDerivedBrief` compare the complete baseline against the candidates' diff keys in the action (same key and same last-row-wins map as the mutation) and keep, per page, only compact references for live baseline keys a candidate shares and full payload only for live baseline keys no candidate shares; the retained rows' text is not kept or sent. -- Old text for retained keys never travels.
- `convex/generations.ts` -- `persistDerivedBrief` replaces `baselineEntries` with `baselineRetained: v.array(v.object({ entryId: v.id("generationBriefEntries"), candidateIndex: v.number() }))` and `baselineRemoved: v.array(briefCandidateEntryValidator)`. Keep the fence first and candidate re-validation. Stamp `unchanged` for a validated entry whose key is in either set, `added` otherwise; insert `baselineRemoved` rows as markers; for a retained reference no validated entry consumed (its candidates all failed re-validation), `ctx.db.get` the row and copy it as a marker only if it belongs to `baselineBriefId`, is live and has the referenced candidate's key, otherwise throw `INVALID_STATE` so the whole mutation aborts. Out-of-range `candidateIndex` throws the same way. -- Truthful full diff with a bounded argument.
- `convex/ai/brief.test.ts` -- Update the direct-call cases to the new arguments; make the retry-exhaustion case assert exactly `BRIEF_PUBLISH_ATTEMPTS` publish calls that each returned `null`; make the interrupted-read case finish with an uninjected `publishDerivedBrief` or `generateReport` that returns a non-null id; make the byte-heavy case count accepted and discarded pages and assert every live row is covered; add a case where a retained candidate fails re-validation and its baseline row still gets a `removed` marker. -- The review's execution requirements.
- Do not run the canonical gate in this handoff; step-03 Verify runs it once on final bytes with the hash comparison in Verification.

**Acceptance Criteria:**
- Given a project whose newest Brief was produced through `generateReport` with 820 derived rows plus a `storylineQuestion` row, when a changed-input `generateReport` runs, then the generation gets a new `briefId` whose rows are exactly: `unchanged` for each kept live key (including a row past index 500), `added` for each new key (including a key that was only a historical `removed` marker), one `removed` marker per dropped live key (including the row at index 500), no question row and no inherited marker; and every row of the prior versions is deep-equal to its pre-derivation snapshot.
- Given that recovered version as newest, when another changed-input `generateReport` runs, then it publishes against the recovered version's live rows only and `renderBriefForGeneration` renders it.
- Given the same regression on the adopted attempt-1 bytes, when it runs, then it fails because the changed-input generation has no `briefId` (the reproduced lockout), and it passes after the fix.
- Given a writer edit published between pin and publish, when `publishDerivedBrief` runs, then the stale attempt writes nothing and the final version diffs against the edited version; given a baseline that moves on every attempt, then no version from this derivation exists and the call throws; given a failing page read, then nothing is written and the next derivation publishes.
- Given a baseline whose rows exceed `BRIEF_BASELINE_PAGE_BYTES` in one row-count page, when enumerated, then at least one `SplitRequired` page is discarded and every live row reaches the diff.
- Given a newest Brief whose live rows carry about 15.6 MiB of text over about 20 keys (each row under 1 MiB) and a derivation with a writer Storyline of about 0.6 MiB whose short candidates reuse every one of those keys plus at least one dropped key, when `publishDerivedBrief` runs, then every live baseline row was enumerated (accepted and discarded pages counted), the recorded outgoing `persistDerivedBrief` argument measured with Convex's own value serialization (`convexToJson`, UTF-8 bytes) is below 16 MiB and within the Design Notes bound, and the published version stamps every reused key `unchanged` with the fresh text and carries a full-payload `removed` marker for each dropped key. On the pre-P1 bytes the same measurement exceeds 16 MiB and the case fails.
- Given `bash scripts/loop-verify.sh` on final bytes, when it runs, then every numbered step passes with no new failures or skips.

## Spec Change Log

### 2026-09-12 -- fail-open consumers (independent plan review, GPT-6 Astra medium)

**Finding (high):** the plan's throwing prompt reads break the established optional/fail-open Brief contract on a *reachable* path. Evidence: (1) `convex/ai/brief.ts:289-305` reuses a Brief by parent row only, so an already-oversized Brief is stamped onto a new generation and never passes through `deriveOrReuseBrief`'s catch; (2) `claimOrderedSectionRun` (`convex/ai/orderedGeneration.ts:173-178`) and `getOrderedCandidateDrafts` (`:373-376`) are awaited *outside* that action's `try` (`:200`, `:410`), so a throw rolls the CAS claim back and leaves the section `queued` until stale-generation recovery — `failOrderedSectionRun:345` never sees it; (3) `persistDerivedBrief`'s `entries` arg is an uncapped array, so validated entries plus removal markers can exceed the bound on their own (300 + 300 disjoint = 600 rows), and an over-bound count is measured before marker filtering. All three verified in-tree before amending.

**Amended:** the `Always` fail-open contract (writes refuse atomically, the two generation consumers omit the whole Brief and log), the `Never` rules (no prefix anywhere; no truncated `persistDerivedBrief` write), four I/O Matrix rows (render overflow rewritten from "throws/unreachable"; reused-oversized, newly-produced-overflow and markers-alone added), the helper task (one probe, two outcomes), two test tasks (reachable reuse/newly-produced regressions; executing ordered/ghost/iterative path proof), and three acceptance criteria.

**Known-bad state avoided:** an oversized Brief — reachable through reuse or one large derivation — stalling a generation with a section row stuck `queued`, or failing an iterative/ghost candidate, instead of drafting without optional Brief guidance.

**KEEP:** bounded `bound + 1` complete reads with no prefix ever used as guidance; atomic refusal on the write paths ahead of the `generationBriefs` insert; the DW-118 diff-baseline filter (`change !== "removed" && group !== "storylineQuestion"`) and the identical `renderBriefForGeneration`/`loadBriefCheck` filters; single definitions of both bounds; the `chatV2.openQuestionsFor` and `briefs.getBrief` Never rules.

### 2026-09-12 -- artifact corrections (independent implementation review, GPT-6 Astra medium)

**Findings:** (low) the Execution task and Design Notes sample still instructed that `renderBriefForGeneration`/`getOrderedCandidateDrafts` throw on 501 rows, contradicting the amended `Always` contract and the implemented code; (medium, verification claim) two acceptance criteria promised compare/iterative completion and "every section" for oversized origins and derivation refusal, which the executed tests do not establish — and iterative correctly pauses for human acceptance, so demanding `completed` there would have invited bypassing a human gate.

**Amended:** the reused-oversized and newly-produced-overflow matrix rows (each now says which consequence is proven directly and which by the separate path tests), the helper and test Execution tasks, the Design Notes sample (now the implemented one-probe/two-outcome shape), the `promptProgram.test.ts` task (each caller family at its own approved lifecycle stage), and three acceptance criteria — bounded compositional coverage stated precisely, with the un-executed origin-by-mode matrix explicitly disclaimed. Added the `Never` rule recording the three adjacent findings' existing owners (DW-109/DW-120, DW-128, finding 6 / story 9 in intake commit 09b2403).

**Known-bad state avoided:** an acceptance criterion that reads as satisfied only if iterative generation is driven past its human acceptance gate, and a spec that instructs the opposite of its own contract.

**KEEP:** everything in the previous entry's KEEP list, plus the executed evidence pairing — real oversized reuse and real 600-row persistence proven separately from the consumer path tests over the shared readers.

### 2026-09-12 — `Always` wording scoped to collection reads (step-04 review, blind-hunter finding)

**Finding (low):** the `Always` rule required `bound + 1` of "every Brief-related `ctx.db.query(...)`", which the implementation correctly does not do — `findReusableBrief` selects one row with `.order("desc").first()`, and so does the diff baseline's latest-Brief select. A rule contradicted by correct code misleads any later re-derivation.

**Amended:** that rule now covers Brief **collection** reads (`generationSources`, `generationBriefEntries`) and states that single-row selects are exempt because they cannot return a prefix. No behavior change; no other rule touched.

**Known-bad state avoided:** a future pass "fixing" `findReusableBrief` into a bounded probe to satisfy an over-broad rule.

**KEEP:** both prior entries' KEEP lists stand unchanged.

### 2026-09-12 — attempt 2 recovery: complete diff baseline (independent recovery review, GPT-6 Astra medium)

**Trigger:** run `20260912-061909-feb3` lost its engine before native completion. Attempt 2 adopted attempt 1's staged delta from `.audit/resume-sweep-20260912T194000Z` (`staged.patch` sha256 `08124027262e0f328854dc13460a8b766ecd5792dbec6239945452b68b44b3da`; adopted bytes match `generations.ts 744e64a8…`, `briefs.ts dace4ae9…`, `brief.test.ts c5ad1a61…`, `promptProgram.test.ts 731b52bf…`, this spec `12ef319a…`). Attempt 1's original spec and nine proof logs are retained read-only at `.audit/dw-brief-read-and-diff-integrity/attempt-1/`; its `done` status was never native acceptance. The recovery review (`brief-recovery-review/review.md`, findings 1-3) found that the refusing diff baseline makes an over-bound newest Brief block every later changed-input derivation, that attempt 1's bans on schema support, pagination and output handling were its own implementation choices rather than an approved contract, and that "production oversized origin" wording overstated seeded/direct-call proof.

**Amended:** Problem/Approach (complete, paged, fenced baseline instead of refusal); `Always` (baseline, enumeration and publication rules; baseline no longer refuses); `Block If` (the schema-change block, an attempt-1 choice, replaced by a CAP-4-relaxation block); `Never` (pagination ban and baseline refusal removed; single-`.paginate()`, no in-mutation paging, no larger `take(N)`, no model re-run added); I/O Matrix (baseline-overflow row replaced by over-bound newest, recovery-continues, byte-heavy, moving-baseline, exhausted-retry and interrupted-read rows; the two "proven directly / by path tests" rows shortened, their proofs unchanged); Code Map, Tasks, Acceptance Criteria, Design Notes and Verification rewritten for the repair. Frontmatter `deferred[0]` (the lockout) removed because this attempt repairs it; `deferred[1]` (shared scheduler/mock) kept verbatim. Attempt 1's Auto Run Result retitled as a historical record.

**Known-bad state avoided:** a stored Brief that permanently prevents later Briefs, and fixes that avoid the throw by diffing against nothing, an older version, a truncated baseline or faked markers.

**KEEP:** consumer fail-open omission and its diagnostics; identical consumer filters; the DW-118 baseline filter; source refusal; both bounds and their single definitions; atomic single-mutation version publication with no truncated write; attempt 1's consumer path regressions in `promptProgram.test.ts` and its repeated-derivation, render-filter, source-overflow, reuse-overflow and exact-bound cases.

### 2026-09-12 — P1 transport repair (repair-plan review, GPT-6 Astra medium)

**Finding (P1, medium):** the plan sent every live baseline row to `persistDerivedBrief`, including old text for keys a fresh candidate reuses and that is never written, so the argument was not bounded by the version write. Writer edits (`briefs.ts:256-262,315-323`) can enlarge entries below the 500-row guard, and a writer Storyline (`brief.ts:432-441`) is outside the model-output cap: about 15.6 MiB of retained baseline text plus a 0.6 MiB Storyline exceeds the 16 MiB argument limit while the small new version would fit. The 8,192-token observation bounds neither. The review also asked to correct the absolute reachability and memory claims and tightened the race, exhaustion, interruption and byte-heavy test requirements. The review reported this finding before the first implementation pass's full gate ran; that gate (2026-09-12T20:24:00Z to 20:25:47Z; 73 targeted tests, 2659 unit tests, all green) predates the P1 repair, did not include it, and is not final proof.

**Amended (outside the intent contract):** a P1 Execution block (red transport regression first, action-side comparison, compact retained references, full payload only for removed keys, mutation fallback read for retained rows whose candidates fail re-validation, test tightening); one acceptance criterion measuring the real outgoing argument; Design Notes resource accounting split into inherited write constraints and the new transport bound, with array-element and action-memory residuals and the "no reachable version size requires" claim removed; Verification (P1 red/green, one canonical gate on final bytes with before/after hashes of tracked files and evidence, `p1/` log directory, mutation summaries labelled as filtered).

**Known-bad state avoided:** a derivation that reads the complete baseline correctly and still can never publish because obsolete baseline text inflates its argument past the limit.

**KEEP:** everything in the attempt 2 recovery KEEP list; the pinned id, fence-first publication, paged live-row enumeration, `SplitRequired` discard and `isDone` completion; the three-attempt retry without a model re-run; the first pass's recovery, concurrent-edit, exhaustion, interrupted-read and byte-heavy cases and its red/green recovery evidence.

## Review Triage Log

<!-- This section was absent from the step-02 spec (template section omitted); added with the first review pass. -->

### 2026-09-12 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 2, low 6)
- defer: 2: (high 0, medium 1, low 1)
- reject: 4: (high 0, medium 1, low 3)
- addressed_findings:
  - `[medium]` `[patch]` No boundary-success case existed at either bound, so an accidental `>=` or wrong probe size would have passed the whole suite — added "exactly 500 entries stay readable in both consumers and as a diff baseline" and "exactly 200 frozen sources read completely"; both confirmed to fail under a `>=` mutation and nothing else.
  - `[medium]` `[patch]` The returning-entry proof only covered v4 against a v3 that had already shed the marker, not the I/O Matrix row itself — added a case whose baseline still carries K's `removed` marker while the candidates include K, asserting `added` and zero markers.
  - `[low]` `[patch]` The Design Notes claim about a previous version whose rows all filter out was untested — added both shapes (only `removed` markers; only `storylineQuestion` rows), asserting `added` rather than first-version `undefined`.
  - `[low]` `[patch]` The iterative and ghost overflow cases asserted only the block delimiter, and no ghost-family test covered `removed` filtering — both now assert no individual row's text leaks, and the ghost fixture seeds a `change: "removed"` exclusion whose text must not reach any ghost prompt.
  - `[low]` `[patch]` `readBothConsumers` collapsed an absent `getOrderedCandidateDrafts` result into `brief: null`, letting a stale run read as successful omission — it now fails on a null drafts result.
  - `[low]` `[patch]` `MAX_BRIEF_ENTRY_ROWS` duplicated `briefs.ts`'s local `MAX_BRIEF_ENTRIES`, leaving the writer and generation bounds free to diverge — `briefs.ts` now imports the exported constant and its local copy is gone (no cycle: no non-test module in `convex/` imports `briefs.ts`).
  - `[low]` `[patch]` `readBriefEntryRowsOrOmit`'s "never a throw" comment overstated the guarantee — scoped to row-count overflow, with database and resource-limit failures explicitly still propagating.
  - `[low]` `[patch]` A test comment described DW-118 as growing "a marker per version" for one key — reworded to persistence across versions, accumulating one stale marker per key ever dropped.
  - `[low]` `[patch]` (spec artifact, not implementer scope) The `Always` rule said *every* Brief-related `ctx.db.query(...)` reads `bound + 1`, which the correct implementation contradicts via `findReusableBrief`'s `.first()` — scoped to collection reads, single-row selects exempt.

Rejected, with reasons: the claim that the baseline-refusal test's length assertions cannot establish "writes nothing" (`persistDerivedBrief`'s only writes are the two inserts and the `briefId` patch, and the test pins both table counts and the unset `briefId`, so they do); the reading that the intent asks for complete evidence *availability* above the caps (the intent asks for completeness *handling*, and raising either bound is an explicit `Never`); the observation that coverage is compositional rather than a full origin-by-mode matrix (already disclaimed in the acceptance criteria by the approved correction); and the absence of a writer-visible signal when a Brief is omitted (real, but owned by the next DW-109/DW-120 bundle — duplicating it here is forbidden).

### 2026-09-12 — Review pass

Attempt 2, after the P1 transport repair. Diff: `7b0723b18cd19fe6e90f9216ff6272674edf2006` to the working tree (6 files, 2,782 insertions, 65 deletions; code hashes `generations.ts 788eafa1…`, `ai/brief.ts 6f7294c3…`, `ai/brief.test.ts 31950b48…`). Four layers and the triage lead ran on `gpt-6-astra`, reasoning effort `medium`, through Codex (`CODEX_HOME=/Users/johnnynguyen/.codex2`, `BMAD_LOOP_TASK_ID` unset, read-only sandbox); all exited 0, no fallback. Blind hunter 13 findings, edge case hunter none, verification gap 1, intent alignment descriptive (6 divergences triaged). Prompts, raw results and logs: `.audit/dw-brief-read-and-diff-integrity/attempt-2/p1/review/`.
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 1, low 2)
- defer: 4: (high 1, medium 3, low 0)
- reject: 12: (high 0, medium 0, low 12)
- addressed_findings:
  - `[medium]` `[patch]` Duplicate diff keys were untested after the comparison moved into per-page accumulation (blind hunter and verification gap, merged): a first-row-wins regression in `readCompleteBriefDiffBaseline` would have passed. Added "keeps the last baseline row for a diff key duplicated across pages…" (dropped key, and all candidates failing re-validation, each asserting the later page's full payload and every stamp) and "stamps the first validated duplicate candidate unchanged and later ones added…". Temporary first-row-wins mutations of the removed and retained maps each fail the first case (`review-patches/mutation-checks-raw.txt`).
  - `[low]` `[patch]` The one-row `SplitRequired` and non-advancing-cursor exits had no test. Added "stops without publishing when a one-row page still needs a split or an accepted page makes no progress", asserting the exact halving sequence at one cursor, the stuck cursor sequence, the error text, no publish call, unchanged Brief tables and an unchanged `briefId`.
  - `[low]` `[patch]` The spec's Tasks and Design Notes sample still showed `readCompleteBriefDiffBaseline(ctx, projectId)` and `baselineEntries`; they now show the candidates argument, `baselineRetained`/`baselineRemoved` and the page rows' `entryId`.

Deferred (frontmatter): consumer reads bound rows but not bytes (pre-existing `take(500)`, high); publication has no generation-lifecycle fence (pre-existing model-call window, medium); chat open questions admit `removed` rows (pre-existing, owned by finding 6 / story 9); writer rail prefix read (pre-existing, DW-128). Rejected: fabricated `baselineRemoved` payload (internal mutation, action-built from pinned pages); unconditional validation of retained references (a different contract that would read the old text P1 avoids sending); missing generation/project ownership check (pre-existing, no mismatched-id path); removal-heavy near-limit argument (documented bound, no reachable output-fits case); aggregate bytes of fallback reads (needs a re-validation drop of action-validated candidates); `briefCalls()` in the source-overflow case (filters the brief tool, which only directly awaited derivations call); the node-file import of `generations.ts` (a deploy-proof limit with repository precedent, `ai/brain/ingest.ts` importing `./rag`); missing final gate/review (both exist for the reviewed bytes); and four intent-alignment divergences (continued availability above bounds, writer-visible overflow signal, compositional mode coverage, production-proof limits), none required by `intent.md`.

## Design Notes

**Why the baseline is read outside the publishing mutation.** A version's live rows never change after publication: both writers insert a whole version in one mutation, nothing patches or deletes entry rows, and the only later insert (`storylineQuestion`, `completeOrderedSectionRun`) is excluded from the baseline. So pages read in separate query transactions against a pinned id enumerate exactly the live set the publishing mutation would have seen; the only race is a *newer* version, which the fence catches. Diffing against nothing, an older version or a prefix would each give a different CAP-4 answer, so none is used.

```ts
// brief.ts (action side), shape only
for (let attempt = 1; attempt <= BRIEF_PUBLISH_ATTEMPTS; attempt += 1) {
  const baseline = await readCompleteBriefDiffBaseline(ctx, args.projectId, args.entries); // pin + pages to isDone
  const briefId = await ctx.runMutation(internal.generations.persistDerivedBrief, {
    ...args, baselineBriefId: baseline.briefId,
    baselineRetained: baseline.retained, // { entryId, candidateIndex }: key a candidate shares, no text
    baselineRemoved: baseline.removed,   // full payload: key no candidate shares, becomes a marker
  });
  if (briefId !== null) return briefId; // null: newest moved, nothing written
}
throw new Error("Generation Brief baseline kept changing; not published");
```

**Resource accounting (Convex limits: 16 MiB read, 16 MiB written, 32,000 scanned, 16,000 written, 4,096 index ranges, 16 MiB arguments and returns per call, 1 MiB per document, 8,192 array elements, 512 MiB Node-runtime memory).**
- Pin query: one index range, one document.
- Page query: one index range; at most `MAX_BRIEF_ENTRY_ROWS` documents; bytes read stop at `BRIEF_BASELINE_PAGE_BYTES` (4 MiB) plus at most one document; the returned projection is no larger. A `SplitRequired` page is never trusted, whatever the backend's page-completeness semantics; a one-row page reads at most 1 MiB, below the budget, so shrinking terminates.
- Publish mutation, reads: one index range for the fence, one `get` per distinct cited source (at most `MAX_BRIEF_SOURCE_ROWS`), one `get` per retained reference whose candidates all failed re-validation (at most the number of entries).
- Publish mutation, writes (inherited): one parent, the validated entries, the markers and one generation patch, in one transaction. At `7b0723b` and in `briefs.saveEntryEdit` a version is written the same way, so a version too large for one transaction was already unwritable; that constraint is not new.
- Publish mutation, arguments (new transport, P1): `entries` + `storylineText` + `baselineRemoved` payload + at most `entries.length` retained references of a fixed small shape. Every byte of `entries` that passes re-validation, of `storylineText` and of `baselineRemoved` is also written into the new version, so the argument is at most the new version's written content plus the bytes of re-validation-dropped candidates plus the retained references (≤ 8,192 × one id and one number). Old text for a retained key is never sent. At `7b0723b` markers were read inside the transaction; sending their payload is the new part, and it cannot exceed what the same transaction must write.
- Array elements: `entries` ≤ 8,192 (pre-existing argument); retained references ≤ `entries`; `baselineRemoved` ≤ the newest version's live rows, which are ≤ 8,192 for a derived version (its own `entries` argument) and ≤ `MAX_BRIEF_ENTRY_ROWS` for a writer-edited version (`briefEntriesToCopy` refuses more).
- Action memory (residual): the Node action holds sources, candidates, the retained references and removed payload together. Nothing enforces a per-action total below the 512 MiB runtime limit; it is bounded only by stored Brief and source sizes.
- Residual: a publish over a per-call limit aborts atomically (nothing written; the existing fail-open catch continues without a Brief). It recurs only while the version the derivation must write, or its argument as bounded above, stays over that limit. No bound across both writers prevents such a version; removing the residual would need staged chunked publication, which this repair does not attempt.

**Test-proof limits.** The provider is stubbed at the SDK boundary; no live provider, browser or deployed backend is exercised, and convex-test is not the production backend (its paginate and one-`.paginate()` rule are emulations). The recovery regression's oversized versions are produced by the real derivation stage from a stubbed structured response, not by a real model. `brief.test.ts` assertions stay database-scoped (frontmatter `deferred`).

## Verification

**Commands:**
- `npx vitest run convex/ai/brief.test.ts -t "recovers an over-bound newest Brief on the next changed-input derivation"` on the adopted attempt-1 bytes -- expected: fails on the missing `briefId` (lockout reproduced); log kept under `.audit/dw-brief-read-and-diff-integrity/attempt-2/`.
- `npx tsc --noEmit -p convex/tsconfig.json` -- expected: clean.
- `npx vitest run convex/ai/brief.test.ts convex/briefs.test.ts convex/ai/promptProgram.test.ts convex/lib/briefRender.test.ts convex/ai/briefPipelineWiring.test.ts` -- expected: all pass.
- `npx vitest run convex/ai/brief.test.ts -t "sends no retained baseline text, so a large retained baseline publishes under the argument limit"` before and after the P1 transport change -- expected: fails on the measured argument size before, passes after; logs, test hash and patch under `.audit/dw-brief-read-and-diff-integrity/attempt-2/p1/`.
- `bash scripts/loop-verify.sh` -- expected: every numbered step passes. Run once on final bytes: hash every tracked working-tree file and every file under `.audit/dw-brief-read-and-diff-integrity/` before and after, compare without restoring anything, and bind the passing log to the final code hashes. Logs go to `.audit/dw-brief-read-and-diff-integrity/attempt-2/p1/`.

**Manual checks:**
- `.audit/dw-brief-read-and-diff-integrity/attempt-2/mutation-checks.txt` holds filtered summaries of three temporary source mutations, not raw failure transcripts; cite it only as such.

## Auto Run Result

Status: done (bmad-build-auto workflow status only). Native outside verification, native review handling, ledger harvesting, merge-back and acceptance are still pending; this local result and commit are not acceptance. Bundle `brief-read-and-diff-integrity` (DW-107, DW-118); no ledger or native state was edited.

### Summary

Attempt 2 of the interrupted run. It adopted attempt 1's staged delta (hashes verified against `.audit/resume-sweep-20260912T194000Z/preservation.json`), reproduced attempt 1's permanent lockout, and repaired it. DW-107: consumers still omit a Brief above `MAX_BRIEF_ENTRY_ROWS` rather than use a prefix, and sources above `MAX_BRIEF_SOURCE_ROWS` still refuse under the fail-open catch. The diff baseline is now read completely: the derivation action pins the newest Brief and enumerates its live rows through separate byte- and row-bounded page queries, discarding `SplitRequired` pages and finishing only on `isDone`. DW-118: markers and questions stay out of the baseline and both prompt readers. Publication stays one fenced mutation (`null` and nothing written if the newest Brief moved; three attempts, no model re-run). After the P1 plan review, the action compares keys itself and sends only references for retained keys and full payload for removed keys, so obsolete baseline text never travels.

### Files changed (against `7b0723b`)

- `convex/generations.ts` -- bounds and `BRIEF_BASELINE_PAGE_BYTES`; fail-open consumer read; `getBriefDiffBaselineId`, `getBriefDiffBaselinePage`, shared `briefDiffKey`; `persistDerivedBrief` fence, cached source reads, retained/removed transport and validated fallback marker read; render filter.
- `convex/ai/brief.ts` -- `readCompleteBriefDiffBaseline` and `publishDerivedBrief`; `deriveOrReuseBrief` publishes through them.
- `convex/briefs.ts` -- imports `MAX_BRIEF_ENTRY_ROWS` (attempt 1, unchanged in attempt 2).
- `convex/ai/brief.test.ts` -- repeated-derivation, filter, overflow, recovery (821-row newest through `generateReport`), fence, exhaustion, interruption, byte-heavy, transport-size, fallback, invalid-reference, duplicate-key and page-error cases.
- `convex/ai/promptProgram.test.ts` -- attempt 1's ordered, iterative and ghost over-bound consumer path regressions (unchanged in attempt 2).
- This spec -- recovery amendments, P1 amendment, records, triage log and this result.

### Review findings

One pass (see the Review Triage Log), four layers plus triage lead on `gpt-6-astra` medium: 3 patches applied (medium 1, low 2), 4 deferred (high 1, medium 3; all pre-existing, two already owned by DW-128 and finding 6 / story 9), 12 rejected, 0 intent gaps, 0 bad-spec loopbacks. Before it, independent Astra medium reviews drove the recovery repair (recovery review), the P1 transport repair (repair-plan review) and cleared P1 on `generations.ts 788eafa1…`, `ai/brief.ts 6f7294c3…`, `ai/brief.test.ts 31950b48…` (P1 implementation proof review); those files live under `.audit/resume-sweep-20260912T194000Z/`.

### Follow-up review recommendation

`true`. Patched findings this pass: high 0, medium 1, low 2; score `3 × 1 + 1 × 2 = 5`, at the threshold. The three review-patch tests (`ai/brief.test.ts 02b56df1…`) were added after the review pass and have not had an independent review.

### Verification performed

Logs carry inline `EXIT_CODE`s and source hashes; all under `.audit/dw-brief-read-and-diff-integrity/`.
- Lockout reproduced on adopted attempt-1 bytes: `attempt-2/before-recovery-regression.txt`, `EXIT_CODE=1` (v3 `briefId` undefined after `INVALID_STATE`); passes on later bytes.
- P1 transport red/green: `attempt-2/p1/before-transport-regression.txt` (`17021834` serialized bytes against `16777216`), `after-transport-regression.txt` `EXIT_CODE=0`, argument 635,054 bytes.
- Gate on the reviewed bytes: `attempt-2/p1/gate/loop-verify.txt`, `EXIT_CODE=0`, 9/9, 187 files / 2,662 tests, harnesses 93/0 and 47/0 (20:55:45Z to 20:57:31Z); before/after snapshots identical. Per the canonical preservation review, that interval covers 7,174 directly hashed regular files and 34 evidence files; its 13 tracked symlinks have Git-based continuity only.
- Review patches: new cases `attempt-2/p1/review-patches/new-tests.txt` `EXIT_CODE=0`; Convex typecheck `convex-typecheck.txt` `EXIT_CODE=0`; raw mutation transcripts `mutation-checks-raw.txt` (first-row-wins in either map fails the duplicate case, `M1_EXIT_CODE=1`, `M2_EXIT_CODE=1`, source restored to `6f7294c3…`); five Brief suites `targeted-tests-verbose.txt` 79/79 `EXIT_CODE=0`. Two logs aborted before running anything by a shell word-splitting error are kept as `*.aborted-shell-split.txt`.
- Final gate on final code bytes (`generations.ts 788eafa1…`, `ai/brief.ts 6f7294c3…`, `ai/brief.test.ts 02b56df1…`, `briefs.ts dace4ae9…`, `promptProgram.test.ts 731b52bf…`): `attempt-2/p1/review-patches/gate/loop-verify.txt`, `EXIT_CODE=0`, 9/9, 187 files / 2,665 tests, svelte-check clean, build ok, harnesses 93/0 and 47/0 (21:14:38Z to 21:16:24Z). Before/after snapshots byte-identical (`409e48d2…`): 7,174 regular-file hashes, 13 tracked symlinks recorded by target, 64 evidence files, git status. After that gate only this spec changed (this result and `status`); no code or test file changed.
- `attempt-2/mutation-checks.txt` holds filtered summaries only, not raw transcripts.
- Not exercised: component suite, browser, deployed Convex backend or bundler, live provider.

### Residual risks

- Deferred and pre-existing: byte-heavy consumer reads can throw outside the ordered chain's `try`; publication has no generation-lifecycle fence; chat open questions admit `removed` rows (finding 6 / story 9); writer rail prefix read (DW-128); omitted-Brief visibility (DW-109/DW-120).
- A publish over a per-call Convex limit aborts atomically and the generation continues without a Brief; the argument is bounded by the written version plus references (Design Notes), not by a platform-unlimited protocol. Action memory is bounded only by stored sizes.
- `convex/ai/brief.ts` (`"use node"`) imports from `convex/generations.ts`; repository precedent exists, but no Convex deploy bundle was built.
- convex-test emulates pagination, `SplitRequired` and transactions; the provider is stubbed; the large baselines are seeded, not built through repeated writer edits.
- Under sustained concurrent Brief edits a derivation gives up after three attempts and that generation drafts without a Brief.

## Attempt 2 Implementation Record

Implementation handoff result (step-03). Status, review and ledger remain the workflow's to record. Raw logs, each with its own inline `EXIT_CODE`, are under `.audit/dw-brief-read-and-diff-integrity/attempt-2/`.

First implementation pass, before the P1 repair (its full gate ran after Astra had reported the P1 finding but did not include the repair). Its transport (`baselineEntries`) and bytes are superseded by the P1 Transport Repair Record below. Its logs stay as evidence for those bytes only.

### What changed

- `convex/generations.ts`: adds `BRIEF_BASELINE_PAGE_BYTES` (4 MiB), `getBriefDiffBaselineId` (newest id or `null`) and `getBriefDiffBaselinePage` (one clamped, byte-bounded `.paginate()` returning live rows projected to `briefCandidateEntryValidator`, plus `readCount`, `isDone`, `continueCursor`, `pageStatus`). `persistDerivedBrief` now takes `baselineBriefId` and `baselineEntries`, fences on the newest Brief before any other read or write (a miss returns `null`), caches source reads by id, and diffs against the supplied live rows. It declares `returns`. `readBriefEntryRowsOrRefuse` and `probeBriefEntryRows` are gone, and their single `take(bound + 1)` probe now lives only in `readBriefEntryRowsOrOmit`.
- `convex/ai/brief.ts`: exports `BRIEF_PUBLISH_ATTEMPTS` (3), `BriefPublishCtx`, `readCompleteBriefDiffBaseline` (pin, page loop, halve-and-retry on `SplitRequired`, throw when a one-row page still splits, complete only on `isDone`) and `publishDerivedBrief` (read, publish, re-read on `null`, throw after 3). `deriveOrReuseBrief` publishes through it.
- `convex/ai/brief.test.ts`: covers the items in the Tasks list. It adds the generateReport recovery regression, a `briefPublishCtx` adapter over `t.query`/`t.mutation`, and `derive` plus the 600-row and exact-bound cases routed through `publishDerivedBrief`. Tenant cases pass `baselineBriefId: null, baselineEntries: []`. The baseline-refusal case is replaced by a complete-read and stale-fence case. New cases cover the concurrent edit, retry exhaustion, the part-way page failure and the byte-heavy baseline. `convex/briefs.ts` and `convex/ai/promptProgram.test.ts` are unchanged from the adopted bytes.

### Verification

| Check | Result | Log |
|---|---|---|
| Recovery regression on adopted attempt-1 bytes (`generations.ts 744e64a8…`) | `EXIT_CODE=1`: v3 `briefId` undefined after `INVALID_STATE` from `readBriefEntryRowsOrRefuse` (v1/v2 setup and the 821-row, index-500 assertions passed first) | `before-recovery-regression.txt` |
| Same case on final bytes | `EXIT_CODE=0` | `after-recovery-regression.txt` |
| `npx tsc --noEmit -p convex/tsconfig.json` | `EXIT_CODE=0`, no diagnostics | `after-convex-typecheck.txt` |
| Five Brief suites (Verification command) | `EXIT_CODE=0`, 5 files / 73 passed (attempt 1: 68; +5 cases, refusal case replaced one-for-one) | `after-targeted-tests.txt` |
| `bash scripts/loop-verify.sh` | `EXIT_CODE=0`, 9/9 steps; 187 files / 2659 tests (attempt 1 final 2654, +5); svelte-check 0 errors / 0 warnings; uploader harnesses 93/0 and 47/0. The header hashes were re-verified against the working tree after the run | `after-loop-verify.txt` |
| Mutation checks (not required by the spec) | Fence removed: 3 fence cases fail. `SplitRequired` page accepted: the byte-heavy case fails. Baseline cut to its first page: 4 cases fail, including the recovery regression. Bytes restored and hashes verified | `mutation-checks.txt` |

Final bytes: `generations.ts d64e03be…`, `ai/brief.ts 086fc782…`, `ai/brief.test.ts 08bdf90b…`, with `briefs.ts dace4ae9…` and `promptProgram.test.ts 731b52bf…` unchanged.

### I/O matrix coverage (all ran and passed in `after-targeted-tests.txt`)

- **Ordinary, entry dropped, third derivation:** "does not re-insert a removed marker across repeated derivations…". The recovery regression also covers the ordinary case (v1).
- **Dropped entry returns:** "stamps a returning key `added` against a baseline that still carries its removed marker", plus recovery v3 (fact 0).
- **Previous questions:** "never carries the previous version's storylineQuestion rows forward…", plus recovery v3.
- **Source overflow:** "refuses a source read above MAX_BRIEF_SOURCE_ROWS; the generation completes with no Brief".
- **Over-bound newest baseline:** "recovers an over-bound newest Brief on the next changed-input derivation" (821 rows through `generateReport`) and "diffs against every live row of an over-bound baseline, and a stale fence writes nothing".
- **Recovery continues:** the recovery regression's v4. It publishes 413 rows against v3's 412 live rows, and `renderBriefForGeneration` renders them.
- **Byte-heavy baseline:** "re-reads a byte-heavy baseline page smaller after SplitRequired and diffs every live row".
- **Baseline moves / keeps moving:** "re-reads and re-publishes when a writer edit lands between pin and publish" (a real `briefs.saveEntryEdit`), and "gives up after BRIEF_PUBLISH_ATTEMPTS lost fences…".
- **Interrupted read:** "writes nothing when a baseline page read fails part-way…". The second of two pages fails.
- **Render overflow, reused oversized, prompt render:** attempt 1's cases, unchanged and passing.
- **Throws under the existing catch:** the exhaustion and interrupted-read rows prove the throw directly. The catch is the same `pipeline.ts` catch the source-overflow case exercises, so that part is compositional.

### Residual risks

- `convex/ai/brief.ts` (`"use node"`) now imports values from `convex/generations.ts`, the one-definition-per-bound rule. There is precedent: `ai/promptProgram.ts` imports from the non-node `./styleAnalysis` and `./brain/retrieve`. Those modules register actions, though, and this is the first node import of a module that registers queries and mutations. The only check was that an esbuild Node bundle of `brief.ts`, including `generations.ts`, loads and exposes its exports. No Convex deploy bundle was built.
- The Design Notes platform residual, made concrete: `baselineEntries` is a `v.array` argument, so a newest version with more than 8,192 live rows would fail argument validation on every later publish (caught fail-open). Such a version is not reachable: a derivation is capped at 8,192 output tokens, and writer edits refuse to copy more than 500 rows.
- The recovery regression uses `vi.useFakeTimers()` so that no scheduled candidate job touches its database, which keeps the prior-version snapshots exact. The frontmatter `deferred` scheduler/mock pollution still applies to the rest of `brief.test.ts`.
- `SplitRequired` and the one-`.paginate()` rule are exercised through convex-test's emulation, not the production backend.
- Under sustained concurrent Brief edits, a derivation gives up after 3 attempts, and that generation drafts without a Brief.

## P1 Transport Repair Record

Implementation handoff result for the "Execution, P1 transport repair" block. Status, review and ledger remain the workflow's to record. Logs, the red-stage test copy, the addition patch, hashes, `decisions.tsv` and `evidence.md` are under `.audit/dw-brief-read-and-diff-integrity/attempt-2/p1/`. No existing attempt-2 log was changed.

### What changed

- `convex/generations.ts`: exports `briefDiffKey`, the one diff key now shared by the action and the mutation. A private `liveBaselinePayload` holds the DW-118 live-row filter and the marker projection. `getBriefDiffBaselinePage` returns each live row with its `entryId`, which a retained reference needs. `persistDerivedBrief` takes `baselineRetained` (`{ entryId, candidateIndex }`) and `baselineRemoved` (full payloads) instead of `baselineEntries`. The fence is still first and re-validation is unchanged. Stamps and markers are resolved before the first insert. A validated entry whose key is in either set is `unchanged`, otherwise `added`, and each baseline key matches once, as before P1. Unmatched `baselineRemoved` rows become markers. An unmatched retained reference is read back and copied only if the row belongs to `baselineBriefId`, is live and has the referenced candidate's key. Otherwise, and for an out-of-range or non-integer `candidateIndex`, the mutation throws `INVALID_STATE` and writes nothing.
- `convex/ai/brief.ts`: `readCompleteBriefDiffBaseline(ctx, projectId, candidates)` partitions each accepted page by `briefDiffKey`. It uses the first candidate index per key, and the last row with a key wins. Only references and removed payloads outlive a page. `publishDerivedBrief` passes `args.entries` and sends `baselineRetained`/`baselineRemoved`. Pinning, `SplitRequired` discard, `isDone` completion and the three-attempt retry are unchanged.
- `convex/ai/brief.test.ts`: adds the transport regression first (red, then green, byte-identical case). It moves the direct-call cases to the new arguments and tightens the exhaustion, interrupted-read and byte-heavy cases as the block requires. It adds "marks a retained baseline row removed when every candidate sharing its key fails re-validation" and "aborts the whole publish with INVALID_STATE when a retained reference is not what it claims". `convex/briefs.ts` and `convex/ai/promptProgram.test.ts` are unchanged.

Two differences from the earlier task wording follow from the P1 block. `readCompleteBriefDiffBaseline` needs the candidates as a third argument, which the Design Notes sample omits. The page query's rows gain `entryId`.

### Verification

| Check | Result | Log (`attempt-2/p1/`) |
|---|---|---|
| Transport regression on first-pass bytes (`generations.ts d64e03be…`, `ai/brief.ts 086fc782…`) | `EXIT_CODE=1`: `expected 17021834 to be less than 16777216`; setup and page-enumeration assertions passed first | `before-transport-regression.txt`, `red-stage-brief.test.ts`, `transport-regression-addition.patch`, `red-stage-hashes.txt` |
| Same case on final bytes | `EXIT_CODE=0` | `after-transport-regression.txt` |
| Measured values, final bytes | Argument 635,054 bytes ≤ written 638,216 + references 1,331. There are 20 references and 1 removed payload (240 bytes). 14 pages: 7 accepted, 7 discarded | `argument-measurement-default-reporter.txt` |
| `npx tsc --noEmit -p convex/tsconfig.json` | `EXIT_CODE=0`, no diagnostics | `after-convex-typecheck.txt` |
| Five Brief suites (Verification command) | `EXIT_CODE=0`, 5 files / 76 passed (first pass 73, +3) | `after-targeted-tests.txt` |
| Temporary mutations, raw transcripts (not required) | Fallback skipped: 2 cases fail. Brief-ownership check removed: 1 case fails. Bytes restored, hash verified | `mutation-checks-raw.txt` |
| `bash scripts/loop-verify.sh` | Not run. The P1 block assigns the single canonical gate on final bytes to step-03 Verify | none |

Final bytes: `generations.ts 788eafa1…`, `ai/brief.ts 6f7294c3…`, `ai/brief.test.ts 31950b48…`. `briefs.ts dace4ae9…` and `promptProgram.test.ts 731b52bf…` are unchanged.

### Residual risks

- No independent review of the P1 code has run in this handoff, so review is pending under the reviewer policy.
- The red result is a measurement, not a platform rejection. convex-test does not enforce the 16 MiB argument limit (transaction limits are opt-in), and no deployed backend was exercised.
- The large baseline is seeded with `t.run`, not built by repeated `briefs.saveEntryEdit` calls.
- The page query still returns retained rows' text to the action, up to `BRIEF_BASELINE_PAGE_BYTES` plus one document per page, including discarded pages. It is dropped per page and never accumulated or sent. Total action memory is still bounded only by stored sizes (Design Notes residual).
- Marker order changes only in the fallback case. Unmatched `baselineRemoved` markers keep baseline order. A marker read back for a retained key is inserted before them, not at its baseline position. No contract or consumer depends on marker order.
- Duplicate candidate keys keep the pre-P1 behaviour: the first validated candidate is `unchanged`, later ones `added`. The block's "whose key is in either set" could be read as stamping every duplicate `unchanged`; that reading was not adopted.
- The first pass's "not reachable above 8,192 live rows" residual is superseded by the Design Notes array-element bullet. `baselineRetained` is at most `entries`, and `baselineRemoved` is at most the newest version's live rows.
- In this agent session Vitest's reporter hides console output of passing tests. Three instrumentation logs therefore print nothing, and they are kept as they are.

## Attempt 1 Run Record (historical, superseded)

Recorded by attempt 1 before the interruption. Its `done` status and its "not repaired" deferral of the lockout are superseded by the 2026-09-12 attempt 2 recovery entry above; its proof logs are retained at `.audit/dw-brief-read-and-diff-integrity/attempt-1/` and bind only to the four adopted code hashes. The original text follows unchanged.

Status: done
Bundle: `brief-read-and-diff-integrity` (DW-107, DW-118). Ledger resolution is the orchestrator's to record; this run edited no ledger or native state.

### What was implemented

Every Brief collection read in `convex/generations.ts` now probes one row past its bound and treats an over-bound result as unreadable, never as a prefix — with a deliberate asymmetry. **Write paths refuse:** `getGenerationSourcesForBrief` and `persistDerivedBrief`'s diff baseline raise `INVALID_STATE`, the baseline read staying ahead of the `generationBriefs` insert so a refusal writes nothing; both run only under the derivation's existing fail-open catch, so the generation continues with no Brief. **Generation consumers omit:** `renderBriefForGeneration` returns `""` and `loadBriefCheck` returns `{ briefBlock: "", brief: null }`, logging one diagnostic — they must not throw, because `claimOrderedSectionRun` and `getOrderedCandidateDrafts` are awaited outside their action's `try`, where a throw would roll back the CAS claim and strand a section `queued`. Separately (DW-118), the diff baseline now excludes `change: "removed"` markers and `storylineQuestion` rows so markers stop persisting into later versions, and `renderBriefForGeneration` gained the `change !== "removed"` filter it was missing, making it render exactly the rows `loadBriefCheck` checks against.

### Files changed

- `convex/generations.ts` — two exported bounds, one bounded probe with a refusing and an omitting form, all four Brief reads routed through them, the diff-baseline filter, and the render filter.
- `convex/briefs.ts` — imports `MAX_BRIEF_ENTRY_ROWS` instead of defining its own 500, so the writer-facing and generation-side bounds cannot diverge.
- `convex/ai/brief.test.ts` — 15 new cases: repeated derivation and marker/question exclusion, both write-path refusals, whole-Brief omission with diagnostics, the two production routes to an over-bound Brief (real `generateReport` reuse of a stored 501-row Brief; real `persistDerivedBrief` writing all 600 rows), markers-alone overflow, and both exact-bound success cases.
- `convex/ai/promptProgram.test.ts` — `seedOverBoundBrief`, plus executing path regressions for the ordered single chain (drafts and completes), iterative's gated section (stops at `awaiting_review`/`awaiting_input`), and the one-shot ghost (all three sections, run `succeeded`), each asserting no Brief block and no individual row text in any prompt.

### Review findings

Four layers ran on `gpt-6-astra`, reasoning effort `medium`, via the supported Codex path (`CODEX_HOME=/Users/johnnynguyen/.codex2`, `BMAD_LOOP_TASK_ID` unset), per the project reviewer policy; the Claude-side agent runner cannot select that model. All four exited 0. Edge-case hunter returned no unhandled paths; the verification-gap layer returned the exact-bound gap; blind hunter returned 13 items; intent-alignment was descriptive.

- **8 patches applied** (medium 2, low 6) — see the Review Triage Log entry for each.
- **2 deferred** (medium 1, low 1) — the permanent derivation lockout an over-bound newest Brief would cause, and `brief.test.ts`'s scheduler/mock pollution. Both in frontmatter `deferred`.
- **4 rejected**, with reasons recorded in the triage log.
- **0 intent gaps, 0 bad-spec loopbacks.** `review_loop_iteration` stayed 0.

Two earlier independent Astra reviews reached this run mid-flight and were acted on rather than deferred: a **high** plan finding (throwing consumers are reachable via Brief reuse and stall ordered sections) drove the fail-open contract and the reuse/600-row regressions, and an implementation review drove two artifact corrections. Both are recorded in the Spec Change Log.

### Follow-up review recommendation

`true`. Patched findings only: high 0, medium 2, low 6 → `3 × 2 + 1 × 6 = 12`, at or above the threshold of 5. No patched finding was high severity.

### Verification performed

Final bytes, raw logs and exit codes retained under `.audit/dw-brief-read-and-diff-integrity/` (each log records its own `EXIT_CODE` inline, so no pipe can hide a failure):

- `npx tsc --noEmit -p convex/tsconfig.json` — exit 0, no diagnostics.
- `npx vitest run convex/ai/brief.test.ts convex/briefs.test.ts convex/ai/promptProgram.test.ts convex/lib/briefRender.test.ts convex/ai/briefPipelineWiring.test.ts` — exit 0, 5 files / 68 passed.
- `bash scripts/loop-verify.sh` — exit 0, all 9 steps; 187 files / 2654 unit tests; svelte-check 0 errors, 0 warnings; uploader harnesses 93/0 and 47/0.
- **Before/after proof.** The 11 original regression cases were run against baseline `7b0723b` logic (only the two bound constants injected so the imports resolve — declared, hashed, and independently reconstructed by root) and failed with exit 1, 11 failed / 32 passed, each failure naming its defect; the same cases pass after. The unit-test baseline is 2639 (integration `c327aa0`; `7b0723b` differs from it only in ledger bytes), so final 2654 is +15.
- Browser-free gate. No component-suite, browser or live-provider proof is claimed.

### Residual risks

- An over-bound Brief is now silently *ineffective* rather than fatal: generations draft without their Claim Exclusions and Confidence Map with only a `console.error`. Writer-visible signalling is owned by the next DW-109/DW-120 bundle.
- If such a Brief ever became a project's newest version it would block all later derivations permanently (deferred above, medium). No production path to a 501-row Brief has been demonstrated — `briefOutputSchema` caps no array, but the call is capped at 8192 output tokens.
- `briefs.getBrief` / `listBriefEntries` still read a plain `.take(MAX_BRIEF_ENTRY_ROWS)`, so the writer's rail would show a 500-row prefix of an over-bound Brief — owned by DW-128.
- `convex/chatV2.ts:openQuestionsFor` still surfaces `change: "removed"` confidenceMap rows in CAP-14's chat evidence block — finding 6 / story 9 in reviewed pending intake commit `09b2403`.
- Coverage of overflow across generation modes is compositional, not a full origin-by-mode matrix; compare-mode overflow and iterative 244/246 resume are not executed.
- `_bmad-output/implementation-artifacts/spec-*.md` carries the `oversized` warning (over the 1600-token target), a deliberate consequence of preserving three amendment entries and the review trail.
