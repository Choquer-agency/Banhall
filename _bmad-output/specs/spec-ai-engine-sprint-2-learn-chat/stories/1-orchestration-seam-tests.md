---
title: 'Orchestration seam tests (CAP-8)'
type: 'chore'
created: '2026-09-04'
status: 'done'
baseline_revision: '2460d6beb07e2cb8a2346a33d5df47e530225ef2'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
warnings: ['oversized']
deferred:
  - summary: >-
      restoreSnapshot has no positive-path test asserting the pre_restore
      checkpoint's own fields or the provenance/lineage rewrite it performs.
    evidence: |-
      convex/snapshots.ts:286-307 writes a pre_restore snapshot with
      label "Before restore" and createdByRole "system", then patches the report's
      provenanceId/generationId/sourceTranscriptId(s)/contentHash from
      snapshotAuditFields(snapshot). convex/comments.test.ts:210 checks only that a
      pre_restore row carries the accepted content, and convex/snapshots.test.ts:112
      checks only the transcript set. Restoring a legacy snapshot that lacks a
      generationId would silently clear the report's provenance with no test failing.
    location: >-
      convex/snapshots.test.ts
    severity: medium
  - summary: >-
      completeCandidateRun's ghost-after-terminal branch is covered only for a
      completed generation that already has a report row.
    evidence: |-
      convex/generations.ts:1026-1059 terminalizes a late ghost run and inserts the
      comparison snapshot only when generation.status === "completed" and a report
      exists. convex/generationAttribution.test.ts:1788 covers that case and
      convex/generationRecovery.test.ts:749-797 covers a superseded generation
      (run terminalized, no snapshot). Still uncovered: the completed-but-no-report
      sub-case, and a ghost completion carrying an error, which patches the run to
      "failed" and stores the truncated error.
    location: >-
      convex/generations.ts:1026
    severity: medium
  - summary: >-
      createMilestoneSnapshot and pruneSnapshots retention have no direct test
      coverage.
    evidence: |-
      convex/snapshots.ts:205 (createMilestoneSnapshot: R-number parsing via
      milestoneKeyFor, canonical label mapping, per-project duplicate rejection,
      stale-revision fence) and convex/lib/snapshots.ts:237 (pruneSnapshots, called on
      both create and restore) are exercised only incidentally. No test asserts the
      retention thinning rule or the milestone label contract.
    location: >-
      convex/snapshots.ts:205
    severity: low
  - summary: >-
      The ConvexError domain-code assertion helper is reimplemented privately in
      eight convex test files instead of living in a shared test util.
    evidence: |-
      The same "(error as { data?: unknown }).data" unwrapping appears in
      brainFeedback.test.ts, comments.test.ts, chatProposals.test.ts,
      generationInput.test.ts, projects.test.ts, reportAuthz.test.ts, reviews.test.ts
      and now generationLifecycle.test.ts, each with slightly different strictness.
      Extracting one helper would make error-code assertions uniformly strict.
    location: >-
      convex/
    severity: low
  - summary: >-
      provenanceId propagation and createGeneratedReportArtifacts idempotency/version
      bumping are untested.
    evidence: |-
      No test passes provenanceId to completeCandidateRun, so its flow into
      reportCandidates and onward into the report and its "generated" snapshot is
      unverified, as is listSnapshots' "unavailable_legacy" fallback that depends on
      it. createGeneratedReportArtifacts' existing-report short-circuit and its
      version: (latest?.version ?? 0) + 1 increment are never exercised because every
      fixture starts with no report.
    location: >-
      convex/generations.ts
    severity: low
  - summary: >-
      approveSectionDraft's generation-state, run-state and next-section-ready guards are untested repo-wide.
    evidence: |-
      convex/generations.ts:1934 ("No section is awaiting review right now"), :1938 ("This section is not awaiting review") and :1994 ("The next section is not ready to draft") are the three INVALID_STATE guards the new suite does not drive; grepping convex/*.test.ts for those messages returns nothing. Only the earlier-sections-unapproved guard, the attempt fence and the empty-text guard are covered. A regression that dropped any of the three would let an approval land on a generation that is not awaiting input, on a section that is not awaiting review, or double-schedule the next section.
    location: >-
      convex/generations.ts:1934
    severity: medium
  - summary: >-
      The live-ghost failure branch of completeCandidateRun has no test.
    evidence: |-
      convex/generations.ts:1101-1104 patches a ghost run under a still-live iterative generation to "failed" and appends the "One-shot comparison draft failed" progress line. The new "records a ghost draft without advancing a live iterative generation" test drives only the success line, and no other suite seeds a failing ghost under a live generation. Distinct from DW-24, which is the ghost-after-terminal branch.
    location: >-
      convex/generations.ts:1101
    severity: low
  - summary: >-
      sectionEditEvents' skip, zero-word and 6000-character truncation branches are untested.
    evidence: |-
      approveSectionDraft writes a sectionEditEvents row only when run.draftText exists, computes editRatio 0 when the draft has no words, and caps draftText/approvedText/ghostText at 6000 characters. Every fixture in convex/generationLifecycle.test.ts seeds a short non-empty draftText, so the no-draft skip (no row written), the zero-word ratio and all three caps are unexercised.
    location: >-
      convex/generations.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** The generation orchestration seams — `completeCandidateRun` fan-in, `approveSectionDraft` (with and without a ghost run), `selectReportCandidate`, and `restoreSnapshot` — carry the lifecycle state machine, yet `selectReportCandidate` has zero tests, `approveSectionDraft` is only touched incidentally by a provenance test, and `restoreSnapshot`'s guard rails (stale revision, cross-project target, missing snapshot) are untested. Regressions there silently corrupt project status, report artifacts, and version history.

**Approach:** Add deterministic `convex-test` suites for the uncovered seam behavior: a new `convex/generationLifecycle.test.ts` for the three generation mutations, plus new cases appended to the existing `convex/snapshots.test.ts` for `restoreSnapshot`'s guards. Tests only — no production code changes.

## Boundaries & Constraints

**Always:**
- Tests only. No file under `convex/` other than `convex/generationLifecycle.test.ts` (new) and `convex/snapshots.test.ts` (extended) may be modified. No production code changes at all.
- Follow the existing fixture pattern: `convexTest(schema, modules)` with `const modules = import.meta.glob("./**/*.ts")`, seed rows through `t.run(async (ctx) => ctx.db.insert(...))`, call mutations through `t.withIdentity({ subject: AUTH_ID })`, and read back through `t.run`. Mirror `convex/generationRecovery.test.ts` and `convex/snapshots.test.ts`.
- Seed writers with `projects.ownerId` set to the acting user so `requireReportEditAccess` passes; the epic's auth gates are already covered in `convex/reportEditAccess.test.ts` and must not be re-tested here.
- Assert on observable state (row fields, row counts, scheduled `_scheduled_functions` jobs, thrown `domainError` codes), not on internal helper calls.
- If a test exposes a real production defect, append it to frontmatter `deferred` with summary + evidence + location, keep the test asserting current (correct-per-contract) behavior or mark it `it.skip` with a comment naming the deferred entry, and do not fix the production code.

**Block If:**
- Making a seam testable would require a production change (e.g. a mutation is unreachable without an action). Record it and HALT rather than editing production code.

**Never:**
- Do not touch `convex/generations.ts`, `convex/snapshots.ts`, `convex/schema.ts`, or any other production module.
- Do not duplicate coverage that already exists: seeded/partial recovery fan-in and late-ghost terminalization (`convex/generationRecovery.test.ts`), ghost snapshot provenance stamping (`convex/generationAttribution.test.ts`), the `pre_restore` round-trip (`convex/comments.test.ts:210`), the transcript-set carry on restore (`convex/snapshots.test.ts:112`), and the `report.editProse` gate on restore (`convex/reportEditAccess.test.ts:220`).
- No UI, component, or e2e tests. No mocking of provider/AI calls — every seam under test is a mutation reachable directly.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Fan-in partial | compare generation, `totalCandidates: 2`, one run still `running`; complete the other with content | generation stays `running`; `candidatesDone`/`candidatesFailed` and `progressLog` updated only | No error expected |
| Fan-in last success | compare generation, second (last) run completes with content | generation → `awaiting_selection`, `currentStep: "Choose your preferred draft"`, one `reportCandidates` row per success | No error expected |
| Fan-in all failed | compare generation, both runs complete with `error` and no content | generation → `failed`, `error: "All candidate models failed to generate."`; project `activeGenerationId` cleared and status back to `previousProjectStatus` | No error expected |
| Fan-in single mode | `candidateMode: "single"`, sole run completes with content | generation → `completed`, report artifacts created, project → `review` with `activeGenerationId` cleared, `reportCandidates` rows deleted | No error expected |
| Fan-in CAS no-op | run already `succeeded`, or project `activeGenerationId` points elsewhere | mutation returns without writing: run row, generation row, and project row unchanged | Silent no-op by design |
| Ghost under live generation | `candidateMode: "iterative"`, generation `awaiting_input`, `ghost: true` run completes with content | candidate row inserted, run → `succeeded`, ghost line appended to `progressLog`; generation status and project status unchanged | No error expected |
| Approve mid-chain | iterative generation `awaiting_input`, `s242` run `awaiting_review` | `s242` → `approved` with `approvedText`; `s244` → `queued`; generation → `running`; one `sectionEditEvents` row with an `editRatio` in `[0,1]`; one `generateSection` job scheduled for `s244` | No error expected |
| Approve final, no ghost | `s242`/`s244` approved, `s246` `awaiting_review`, no ghost run | report created for the generation, generation → `completed`, project → `review` with `activeGenerationId` cleared, `postQaStatus: "running"`, one `runReportQa` job scheduled | No error expected |
| Approve final, with ghost | same, plus a `succeeded` ghost run whose candidate has parseable `agentOutputs` | ghost comparison `reportSnapshots` row (`reason: "generated"`, comparison label) inserted after the report's own baseline; ghost run's `candidateId` cleared; `sectionEditEvents` rows patched with `ghostText`; all `reportCandidates` rows deleted | No error expected |
| Approve stale attempt | run `attempt: 2`, call passes `attempt: 1` | mutation throws; run stays `awaiting_review`, no `sectionEditEvents` row written | `STALE_REVISION` |
| Approve out of order | `s244` `awaiting_review` while `s242` not approved | mutation throws; nothing written | `INVALID_STATE` |
| Approve empty text | `s242` `awaiting_review`, `text: "   "` | mutation throws; nothing written | `INVALID_INPUT` |
| Select candidate happy | compare generation `awaiting_selection`, candidate belongs to it | report created, generation → `completed` with `agentOutputs` from the candidate, project → `review` and `activeGenerationId` cleared, one `modelSelections` row for the caller, all `reportCandidates` rows deleted | No error expected |
| Select foreign candidate | candidate whose `generationId` is a different generation | mutation throws; no report, no `modelSelections` row | `NOT_AUTHORIZED` |
| Select on iterative | `candidateMode: "iterative"` generation | mutation throws | `INVALID_STATE` |
| Select not awaiting | generation status `running` (or project points at a different active generation) | mutation throws | `STALE_REVISION` |
| Restore stale revision | report at `revisionNumber: 2`, call passes `expectedRevisionNumber: 1` | mutation throws; report content and `revisionNumber` unchanged; no `pre_restore` snapshot written | `STALE_REVISION` |
| Restore cross-project | snapshot from project A, `targetReportId` a report in project B | mutation throws; neither report changes | `NOT_AUTHORIZED` |
| Restore missing snapshot | `snapshotId` of a deleted snapshot | mutation throws | `NOT_FOUND` |

</intent-contract>

## Code Map

- `convex/generations.ts:1006-1191` -- `completeCandidateRun` (internalMutation). Early return when `run.status !== "running"`. Ghost-after-terminal branch first; then the active-status fence (`["running"]`, or `["running","awaiting_input"]` for ghosts) plus `project.activeGenerationId === generation._id`. Ghost runs insert a candidate, append a `progressLog` line, and return without advancing the lifecycle. Fan-in counts terminal runs against `generation.totalCandidates ?? runs.length`.
- `convex/generations.ts:1915-2152` -- `approveSectionDraft` (public mutation). Gates in order: `requireIterativeGeneration` → `requireReportEditAccess` → generation `awaiting_input` → section run `awaiting_review` → `attempt` fence → all earlier `SECTION_ORDER` sections approved → non-empty trimmed text. Writes `sectionEditEvents` when `run.draftText` exists. Non-final approve queues the next section and schedules `internal.ai.iterative.generateSection`. Final approve assembles the report, handles the ghost snapshot + `ghostText` patch, deletes `reportCandidates`, flips project to `review`, sets `postQaStatus: "running"`, and schedules `internal.ai.postQa.runReportQa`.
- `convex/generations.ts:2731-2800` -- `selectReportCandidate` (public mutation). Ownership check (candidate's `generationId`/`projectId` must match) → `requireReportEditAccess` → iterative refusal → `awaiting_selection` + `activeGenerationId` fence → artifacts, project flip, `modelSelections` insert, candidate cleanup.
- `convex/generations.ts:1272-1296` -- `SECTION_ORDER = ["s242","s244","s246"]`, `SECTION_TITLES`, and `getSectionRun` (index `by_generationId_and_section`).
- `convex/snapshots.ts:264-311` -- `restoreSnapshot`. `NOT_FOUND` → `requireReportEditAccess` → cross-project `NOT_AUTHORIZED` → `expectedRevisionNumber` CAS → `pre_restore` snapshot → report patch with `snapshotAuditFields` → `pruneSnapshots`. Returns `revisionNumber + 1`.
- `convex/schema.ts:1333-1358` -- `generationSectionRuns` fields required by fixtures: `generationId`, `projectId`, `section`, `status`, `model`, `label`, `attempt`, `queuedAt`, optional `draftText`/`approvedText`.
- `convex/lib/roleCapabilities.ts:82-106` -- `requireReportEditAccess`: a writer passes when `projects.ownerId` is the caller (or via an open `workItems` assignment). Seed `ownerId`, not just `createdBy`.
- `convex/generationRecovery.test.ts:1-95` -- REUSE the fixture shape (`modules` glob, `t.run` seeding, `qaJobsFor` scheduled-job helper, `t.withIdentity({ subject: authId })`).
- `convex/snapshots.test.ts:1-70` -- the file to EXTEND; `setup()` already builds a writer-owned project, two transcripts, a completed generation, and a report at `revisionNumber: 0`.
- `convex/generationAttribution.test.ts:1766-1834` -- existing `completeCandidateRun` ghost/provenance coverage; read to avoid duplication.
- `convex/comments.test.ts:210-239` and `convex/reportEditAccess.test.ts:220-238` -- existing `restoreSnapshot` round-trip and auth-gate coverage; do not repeat.

## Tasks & Acceptance

**Execution:**
- `convex/generationLifecycle.test.ts` -- create the suite with three `describe` blocks (`completeCandidateRun fan-in`, `approveSectionDraft`, `selectReportCandidate`) covering every matrix row for those seams -- these are the untested lifecycle transitions CAP-8 names.
- `convex/generationLifecycle.test.ts` -- add local fixture helpers (`setupCompare`, `setupIterative`) that seed project/transcript/generation/runs in one `t.run`, parameterised by `candidateMode`, run statuses, and section-run states -- keeps each `it` block to arrange-act-assert without copy-pasted seeding.
- `convex/snapshots.test.ts` -- append a `describe("restoreSnapshot guards")` block with the three guard rows from the matrix, reusing the existing `setup()` and adding a second project only for the cross-project case -- extends the file the touchpoints row names instead of adding a near-duplicate one.

**Acceptance Criteria:**
- Given the new suites, when `npx vitest run convex/generationLifecycle.test.ts convex/snapshots.test.ts` runs, then every test passes with no `.only` and no unhandled promise rejections.
- Given a full run, when `npm test` executes, then it passes and no previously passing test has been modified or deleted.
- Given `git diff --name-only` after the work, when inspected, then it lists exactly `convex/generationLifecycle.test.ts`, `convex/snapshots.test.ts`, and this spec file.
- Given a test that reveals a production defect, when the run finishes, then the defect appears as a `deferred` frontmatter entry with summary, evidence, and location, and no production file has been edited to make the test pass.
- Given each error-case test, when the mutation throws, then the assertion checks the specific `domainError` code (`STALE_REVISION`, `INVALID_STATE`, `INVALID_INPUT`, `NOT_AUTHORIZED`, `NOT_FOUND`) and also asserts that the guarded write did not happen.

## Spec Change Log

_No spec amendments — the review pass produced no bad_spec findings._

## Review Triage Log

### 2026-09-04 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 5, low 3)
- defer: 5: (high 0, medium 2, low 3)
- reject: 12: (high 0, medium 3, low 9)
- addressed_findings:
  - `[medium]` `[patch]` `setupIterative`'s `ghost: "unparseable"` branch was dead code — added a final-approval test that drives it, pinning the `catch {}` path (snapshot still written, `candidateId` cleared, no `ghostText`).
  - `[medium]` `[patch]` `expectDomainError` substring-matched the serialized error — now asserts `data.code` exactly, fails clearly on a non-object throw, and takes an optional message pattern so the multi-source `INVALID_STATE` guards cannot pass for the wrong reason.
  - `[medium]` `[patch]` The all-failed fan-in test could not distinguish restoring `previousProjectStatus` from the `?? "draft"` fallback — the fixture now seeds `client_review` and the test asserts that value.
  - `[medium]` `[patch]` Mixed success/failure fan-in (one run failed, last succeeds) was uncovered — added, asserting `awaiting_selection` with `candidatesDone: 1`, `candidatesFailed: 1`, one candidate row.
  - `[medium]` `[patch]` `approveSectionDraft` and `selectReportCandidate` had no authorization coverage anywhere in the repo (`reportEditAccess.test.ts` gates only `reports.save` and `snapshots.restoreSnapshot`) — added non-owner `NOT_AUTHORIZED` tests asserting no writes and no scheduling.
  - `[low]` `[patch]` `editRatio` was asserted only as within [0,1] — now pinned to the fixture's deterministic 1/3.
  - `[low]` `[patch]` The three `approveSectionDraft` rejection tests did not assert that no `generateSection` job was scheduled — added.
  - `[low]` `[patch]` Removed `Math.random()` from the fixture `shareToken`; each `convexTest` instance is already isolated.

### 2026-09-04 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 2, low 2)
- defer: 3: (high 0, medium 1, low 2)
- reject: 14: (high 0, medium 2, low 12)
- addressed_findings:
  - `[medium]` `[patch]` The three new `restoreSnapshot` guard tests asserted with `.rejects.toThrow(/CODE/)`, substring-matching the serialized error — the cross-project case would have stayed green if `requireReportEditAccess` regressed, since both guards raise `NOT_AUTHORIZED`. Added a local `expectDomainError` to `convex/snapshots.test.ts` that asserts `data.code` exactly and pins the cross-project case to its message.
  - `[medium]` `[patch]` `selectReportCandidate`'s deliberate legacy allowance (`convex/generations.ts:2763` accepts an unset `project.activeGenerationId`) was pinned by no test — tightening the fence to strict equality left all six cases green while breaking every pre-run-guard generation. Added "still selects when the project carries no active generation pointer".
  - `[low]` `[patch]` The `restoreSnapshot` guard read-backs used `.take(10)`, so a truncated page could have made the row-count assertions pass falsely. Switched the new read-backs to `.collect()`.
  - `[low]` `[patch]` Deferred entry DW-24 claimed the cancelled/failed-generation ghost-after-terminal sub-case had no coverage; `convex/generationRecovery.test.ts:749-797` drives exactly that shape. Corrected DW-24 (spec frontmatter and ledger) to name only the genuinely uncovered sub-cases, and fixed DW-26's "roughly nine"/eight file-count mismatch.

### 2026-09-04 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 1, low 6)
- defer: 0
- reject: 30: (high 0, medium 2, low 28)
- addressed_findings:
  - `[medium]` `[patch]` The foreign-candidate `selectReportCandidate` test asserted only `NOT_AUTHORIZED`, a code the mutation also raises from `requireReportEditAccess` — pinned it to the "does not belong to this generation" message so the ownership guard is the only way the test stays green.
  - `[low]` `[patch]` The fan-in matrix lacked the "last run fails after a sibling succeeded" shape — added it, asserting `awaiting_selection`, `candidatesDone: 1`/`candidatesFailed: 1`, the surviving candidate, the run's stored error and the `✗ … failed:` progress line.
  - `[low]` `[patch]` The CAS no-op coverage drove only a `succeeded` run — added a `queued` run no-op (the `run.status !== "running"` guard) and a non-ghost run under an iterative generation in `awaiting_input` (the ghost-only `activeStatuses` split), each asserting run, generation and project rows unchanged.
  - `[low]` `[patch]` The final-approval test checked only the s246 text in the assembled report — now asserts all three approved texts are present in `SECTION_ORDER` and that `generation.agentOutputs` carries the three sections with `iterative: true`.
  - `[low]` `[patch]` The ghost-snapshot test matched the baseline label with `toContain("AI draft")` — pinned to the exact `AI draft (Iterative — Sonnet 5)` label.
  - `[low]` `[patch]` No test passed a matching `attempt` to `approveSectionDraft`, so a strict-inequality regression in the fence would have gone unnoticed — the mid-chain happy path now passes `attempt: 1`.
  - `[low]` `[patch]` A test comment anchored the legacy unset-pointer allowance to `convex/generations.ts:2763`; re-anchored to the function and its "run-guard deploy" comment so the reference survives edits.

### 2026-09-04 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 1, low 6)
- defer: 0
- reject: 36: (high 0, medium 3, low 33)
- addressed_findings:
  - `[medium]` `[patch]` `approveSectionDraft`'s ghost-not-finished branch (ghost run still `running` at final approval) had no test — added one asserting the generation still completes, exactly one snapshot (the baseline) is written, the ghost run is left `running` for `completeCandidateRun`'s terminal path, no `ghostText` lands, and `runReportQa` is still scheduled. `setupIterative` now accepts `ghost: "running"`.
  - `[low]` `[patch]` Ghost edit-mining was covered only for all-three-sections and unparseable outputs — added a partial-outputs case (whitespace `section244`, missing `section246`) pinning the `typeof === "string" && trim()` skip per event.
  - `[low]` `[patch]` The single-mode fan-in test never asserted the run row — now checks `run.status`, `error`, `completedAt`, plus `candidatesDone`/`candidatesFailed`/`completedAt` on the generation.
  - `[low]` `[patch]` The mid-chain approval test did not pin `currentStep`, the two appended `progressLog` lines, or `s242.completedAt` — added.
  - `[low]` `[patch]` The ghost-snapshot test matched baseline and ghost by `collect()` index — now locates each by label, asserts the ghost shares the baseline's `reportId`, and checks ordering via `_creationTime` and first position explicitly.
  - `[low]` `[patch]` The `selectReportCandidate` happy path did not assert `currentStep: "Complete"`, `completedAt`, or the selection row's `projectId`/`candidateId` — added.
  - `[low]` `[patch]` `setupIterative`'s `editEvents` seeding carried a dead `?? \`${section} approved\`` fallback — replaced with an explicit throw so a fixture missing `approvedText` fails loudly.

## Design Notes

Scheduled work is observable through the system table, the same way `generationRecovery.test.ts` does it:

```ts
const jobs = await t.run(async (ctx) =>
  (await ctx.db.system.query("_scheduled_functions").collect()).filter(
    (job) => job.name.includes("generateSection")
  )
);
expect(jobs[0]?.args[0]).toMatchObject({ generationId, section: "s244" });
```

`completeCandidateRun` is an `internalMutation`, so call it as `t.mutation(internal.generations.completeCandidateRun, {...})` with no identity; the public mutations need `t.withIdentity({ subject: AUTH_ID })`. Assert domain errors by code, e.g. `await expect(...).rejects.toThrow(/STALE_REVISION/)`, matching how existing suites surface `domainError`.

For the ghost-approval case, seed a ghost `generationCandidateRuns` row with `status: "succeeded"` and a `candidateId` pointing at a `reportCandidates` row whose `agentOutputs` is `JSON.stringify({ section242, section244, section246 })`, plus `sectionEditEvents` rows created by the earlier approvals, so the `ghostText` patch has something to land on.

## Verification

**Commands:**
- `npx vitest run convex/generationLifecycle.test.ts convex/snapshots.test.ts` -- expected: all tests pass.
- `npm test` -- expected: full backend suite green.
- `npm run check` -- expected: no new type errors (needs `PUBLIC_CONVEX_URL` set to any value).
- `git diff --name-only` -- expected: only the two test files and this spec.

## Auto Run Result

Status: done

**Summary.** Second follow-up review pass over the CAP-8 orchestration seam suites (the spec was `done` with `followup_review_recommended: true`). Four review layers ran against the full diff since the baseline; no intent gaps, no spec defects, and no verification gaps surfaced. Seven test-hardening patches were applied to `convex/generationLifecycle.test.ts`; `convex/snapshots.test.ts` needed no change. Still tests only — no production file was touched.

**Files changed**
- `convex/generationLifecycle.test.ts` (28 tests, +2 this pass) — added the still-running-ghost final approval and the partial ghost-outputs cases; tightened run/generation bookkeeping assertions on the single-mode, mid-chain, ghost-snapshot and candidate-selection tests; `setupIterative` gained `ghost: "running"` and lost a dead fallback.
- `convex/snapshots.test.ts` (unchanged this pass) — the three `restoreSnapshot` guard tests from the earlier passes.
- `_bmad-output/implementation-artifacts/deferred-work.md` — unchanged this pass; no entry was added, modified, or re-opened.

**Review findings breakdown.** This pass: 7 patches applied (1 medium, 6 low), 0 deferred, 36 rejected. Every rejected "add coverage for X" finding either duplicates an entry already in the spec's `deferred` list / the ledger (ghost-after-terminal sub-cases, `approveSectionDraft`'s three `INVALID_STATE` guards, the live-ghost failure branch, `sectionEditEvents` caps, `restoreSnapshot`'s positive path, the shared `expectDomainError` helper), targets legacy fallbacks the earlier passes already ruled out (`totalCandidates ?? runs.length`, optional `attempt`, unset `activeGenerationId`), or is a speculative production defect with no reachable trigger (single-mode `done > 0` with no candidate requires more run rows than `totalCandidates`). The intent-alignment auditor's note that the two auth-gate tests exceed the intent's "must not re-test" fence was already triaged in the first pass: `reportEditAccess.test.ts` never covered those two mutations, so the tests stay. Cumulative across four passes: 26 patches, 8 deferred.

**Follow-up review recommendation:** `true`. Patched findings this pass: 0 high, 1 medium, 6 low → 3 × 1 + 1 × 6 = 9, which is ≥ 5. The patches are one new branch, one new edge case, and assertion tightening on already-exercised paths; a further pass is unlikely to change the diff materially.

**Verification**
- `npx vitest run convex/generationLifecycle.test.ts convex/snapshots.test.ts` — 34 passed, no `.only`/`.skip`.
- `npm test` — 1233 passed across 123 files.
- `PUBLIC_CONVEX_URL=… npm run check` — 0 errors, 0 warnings.
- `git diff --name-only` since baseline — the two test files, this spec, and the deferred-work ledger (ledger untouched this pass).

**Residual risks**
- Review subagents received the diff by scratchpad file path rather than inline (1508 lines); all four confirmed reading it in full.
- Coverage still stops at the transactional mutation boundary: scheduled jobs are asserted as `_scheduled_functions` rows, never executed.
- The convex-lint hook flags every unbounded `.collect()` read-back in the test file; these are whole-table reads against an isolated `convex-test` database, the same pattern the sibling suites use, and were left as-is.
