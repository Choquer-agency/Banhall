### DW-1: Restore the ten pre-existing failing cases in the excluded Bun proposal test file.
origin: spec-deferred 542cee466154
location: tests/chatProposals.test.ts
source_spec: `9-bounded-chat-context-windowed-proposals-empty-reads-on-missing-threads.md`
severity: medium
reason: At baseline 4b38e6c891f35be9e8dea57aec6622812f8cddaa, `bun test tests/chatProposals.test.ts` reported 12 passing and 10 failing cases. After the Story 9 review patches it reports the same 12 passing and 10 failing cases, while the Story 9 `proposal access` subset passes 4 of 4.
status: open

### DW-2: Follow-up review still recommended for 9 after the damping cap was spent
origin: review-budget-followup
location: n/a
source_spec: `9-bounded-chat-context-windowed-proposals-empty-reads-on-missing-threads.md`
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20260901-192212-7e0e; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-3: A deployment can change the live prompt program while an already-started generation is still running.
origin: spec-deferred 96dbf2f50b46
location: convex/ai/pipeline.ts, convex/ai/iterative.ts, convex/ai/instrument.ts
source_spec: `10-generations-record-prompt-version-hash-and-learning-digest-ids.md`
severity: low
reason: The approved design stamps promptVersion atomically at beginGeneration and intentionally does not re-verify it at later provider handoffs, so a mid-flight generation may finish under mixed deployed code while retaining its start-time hash.
status: open

### DW-4: Generation-owned Voyage query-embedding and rerank usage remains outside Story 10 attribution.
origin: spec-deferred 441c1cd5bc10
location: convex/ai/brainRetrieval.ts, convex/ai/brain/retrieve.ts
source_spec: `10-generations-record-prompt-version-hash-and-learning-digest-ids.md`
severity: high
reason: The existing Brain retrieval path writes aiUsage rows but does not pass generationId or durationMs; candidateRunId is not applicable because retrieval occurs before candidate runs.
status: open

### DW-5: Digest provenance can grow after terminal status through post-QA or late in-flight calls.
origin: spec-deferred f3ddbb267ea5
location: convex/generations.ts, convex/ai/postQa.ts, convex/ai/pipeline.ts
source_spec: `10-generations-record-prompt-version-hash-and-learning-digest-ids.md`
severity: high
reason: The approved story design permits completed post-QA attribution, and the union mutation has no terminal fence, so late ghost calls can also extend the union.
status: open

### DW-6: Partial candidate retries do not define ownership for copied candidate provenance and usage.
origin: spec-deferred 7403dbc2733c
location: convex/generations.ts
source_spec: `10-generations-record-prompt-version-hash-and-learning-digest-ids.md`
severity: high
reason: retryFailedCandidates can copy a successful candidate into a newly hashed generation while its original usage and report provenance remain keyed to the prior generation.
status: open

### DW-7: The prompt-program manifest does not cover every stable provider-visible rule.
origin: spec-deferred 2b000c09e95e
location: convex/ai/promptProgram.ts, convex/ai/qaChecks.ts, convex/ai/structured.ts, shared/craScienceCodes.ts
source_spec: `10-generations-record-prompt-version-hash-and-learning-digest-ids.md`
severity: high
reason: Review found omitted deterministic QA rendering, structured validation summaries, CRA science-code labels, and recovery routes, plus descriptive fields that runtime code does not consume.
status: open

### DW-8: Usage persistence and attribution integrity remain best effort in rare failure or caller-error paths.
origin: spec-deferred 50914cf5f212
location: convex/ai/instrument.ts, convex/aiUsage.ts
source_spec: `10-generations-record-prompt-version-hash-and-learning-digest-ids.md`
severity: high
reason: A simultaneous scheduler and fallback mutation failure drops returned usage, and logUsage does not validate generation, candidate, and project relationships.
status: open

### DW-9: Some generation entry and artifact boundaries lack full integration coverage.
origin: spec-deferred f97517052e1a
location: convex/generationAttribution.test.ts, convex/ai/instrument.test.ts
source_spec: `10-generations-record-prompt-version-hash-and-learning-digest-ids.md`
severity: medium
reason: Iterative stamping and style-digest restoration, scheduled candidate arguments, retrieval usage, and provider-to-index persistence are covered at component seams rather than one complete flow.
status: open

### DW-10: Fourteen legacy tests/*.test.ts files still import bun:test and are executed by no script or CI job.
origin: spec-deferred 482a6ce62b45
location: tests/*.test.ts, vitest.config.ts
source_spec: `10-generations-record-prompt-version-hash-and-learning-digest-ids.md`
severity: low
reason: package.json defines no bun test script, vitest.config.ts includes only convex, shared, src, and the explicitly added tests/aiUsage.test.ts, and CI runs only npm run check and npm test, so those suites never run anywhere. Pre-existing; surfaced while reviewing the single-file Vitest migration.
status: open

### DW-11: Follow-up review still recommended for 10 after the damping cap was spent
origin: review-budget-followup
location: n/a
source_spec: `10-generations-record-prompt-version-hash-and-learning-digest-ids.md`
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20260901-192212-7e0e; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-12: getGeneration now takes a read dependency on the whole aiUsage by_generationId range, so every scheduled logUsage insert invalidates the live GenerationProgress subscription and re-pushes the full gen
origin: spec-deferred 30e515bd62ef
location: convex/generations.ts:180
source_spec: `11-getgeneration-exposes-attributable-cost-with-legacy-null-semantics.md`
severity: medium
reason: src/lib/components/generation/GenerationProgress.svelte:19 subscribes to api.generations.getGeneration for the duration of a run, and logUsage is scheduled per provider call (tens per generation). The in-query sum is required by this story's intent ("computed inside the same query", partial sum while in flight), so it is not fixable here; a stored running total on the generation row, or a separate cost query the progress card does not subscribe to, would remove the churn.
status: open

### DW-13: Per-generation dollar cost is now readable by any internal role while the aggregate usageReport stays admin-gated, and the widening is recorded only in this story file, not in docs/product-domain.md.
origin: spec-deferred 17d0f20a8246
location: docs/product-domain.md
source_spec: `11-getgeneration-exposes-attributable-cost-with-legacy-null-semantics.md`
severity: medium
reason: getInternalProjectAccessOrNull (convex/lib/auth.ts:33-42) admits writer, manager, and admin for any project, whereas convex/aiUsage.ts gates usageReport behind usageViewerOrNull. The story forbids adding a gate, so the code is correct as specified, but the domain contract should say who may see spend at generation granularity.
status: open

### DW-14: No function in convex/generations.ts declares a returns validator, so the convex-lint hook warns on every edit to the file.
origin: spec-deferred 8dea7e53e38b
location: convex/generations.ts
source_spec: `11-getgeneration-exposes-attributable-cost-with-legacy-null-semantics.md`
severity: low
reason: Pre-existing and file-wide, not introduced by this story; adding one to getGeneration alone would have been a non-additive change outside scope. Worth a focused pass over the file.
status: open

### DW-15: The admin audit table has no ACTION_LABEL entry for the two new brainAuditLog actions, so they render as raw slugs.
origin: spec-deferred 064dc3cf843b
location: src/routes/admin/brain/+page.svelte:17
source_spec: `12-confirmed-unlearn-with-failure-evidence-and-retry-free-embeds.md`
severity: medium
reason: src/routes/admin/brain/+page.svelte:17-24 maps every other action to a human label and falls back to `?? a.action`; unlearn_confirmed / unlearn_failed therefore render unlabeled. The actor mapping at line 187 also renders the "system" actor as "admin". Out of scope by the intent's Never clause ("No frontend change, no UI for unlearn evidence").
status: open

### DW-16: An orphan erasure that keeps failing produces no audit evidence at all.
origin: spec-deferred 87fa6e71d1bb
location: convex/brain.ts:449
source_spec: `12-confirmed-unlearn-with-failure-evidence-and-retry-free-embeds.md`
severity: low
reason: ingestOnComplete's orphan branch schedules unlearnSource without a sourceId, and both bookkeeping mutations early-return in that case, so a capped-out orphan erasure is invisible. Mitigated at serve time by the new status join (a hit whose sourceId maps to no row is dropped). brainAuditLog.sourceId is optional, so a sourceId-less row is representable if evidence is later wanted.
status: open

### DW-17: Repeated revokeSource clicks start concurrent, undeduplicated remediation ladders.
origin: spec-deferred b1ee08c62c36
location: convex/brain.ts:357
source_spec: `12-confirmed-unlearn-with-failure-evidence-and-retry-free-embeds.md`
severity: low
reason: The revoked early-return schedules a fresh unlearnSource with no attempt each time, so N clicks yield N ladders, N duplicate unlearn_failed rows and N concurrent deletes. Intended as the documented remediation restart, but there is no in-flight marker to make it idempotent.
status: open

### DW-18: Failure evidence is dropped when the row already carries a newer ragEntryId.
origin: spec-deferred 6e7fe476c928
location: convex/brain.ts:479
source_spec: `12-confirmed-unlearn-with-failure-evidence-and-retry-free-embeds.md`
severity: low
reason: recordUnlearnFailure patches the id back only `if (!s.ragEntryId)` (as the spec task specifies). If a re-ingest wrote E2 while the compensation for E1 was failing, the un-erased E1 survives only in the unlearn_failed reason string, and re-revoke remediation then retries against E2.
status: open

### DW-19: No unlearn_failed row is written if the source row is deleted or re-approved between the throw and the bookkeeping.
origin: spec-deferred e0dbef9e0f88
location: convex/brain.ts:477
source_spec: `12-confirmed-unlearn-with-failure-evidence-and-retry-free-embeds.md`
severity: low
reason: recordUnlearnFailure's insert sits inside `if (s && s.status !== "approved")`, while the action still rethrows and still reschedules. The guard exists to avoid contradicting a re-approval, so the fix is a policy choice rather than a bug.
status: open

### DW-20: A failure of the new governance join degrades retrieval to zero exemplars rather than erroring.
origin: spec-deferred 553bb6411cf5
location: convex/ai/brain/retrieve.ts:268
source_spec: `12-confirmed-unlearn-with-failure-evidence-and-retry-free-embeds.md`
severity: low
reason: dropNonServableCandidates runs inside searchBrainExemplars' outer try/catch, whose catch returns { exemplars: [], degraded: true }. This is the pre-existing degrade contract, but the join is a new failure source inside it and no test covers that path.
status: open

### DW-21: docs/the-brain.md still describes unlearn as a plain vector delete, with no confirmed-erasure contract or the two new audit actions.
origin: spec-deferred de93dd2066cc
location: docs/the-brain.md:11
source_spec: `12-confirmed-unlearn-with-failure-evidence-and-retry-free-embeds.md`
severity: low
reason: docs/the-brain.md:11 and its status table at line 85 predate the confirmed-erasure contract. No changelog entry accompanies the governance behavior change. The intent neither requires nor forbids doc updates.
status: open

### DW-22: Story 12 never received its independent fresh-context review pass
origin: operator 2026-09-02
location: n/a
source_spec: `12-confirmed-unlearn-with-failure-evidence-and-retry-free-embeds.md`
severity: medium
reason: All three review sessions for story 12 stalled on the Claude Fable usage limit (12-review-1 after 50 min and 1.08M weighted tokens with partial patches kept; 12-review-2 and 12-review-3 at 0 tokens). The dev commit 8259869 passed the verify gate and the dev pass's inline review, but the policy's separate review stage did not run to completion. Re-run: `claude --model claude-fable-5-1 "/bmad-build-auto <spec path>"` on the done spec, or a bmad-loop review-only re-drive, after the limit resets on 2026-09-03 13:00 America/Vancouver.
status: open

### DW-23: restoreSnapshot has no positive-path test asserting the pre_restore checkpoint's own fields or the provenance/lineage rewrite it performs.
origin: spec-deferred 001651b8506b
location: convex/snapshots.test.ts
source_spec: `1-orchestration-seam-tests.md`
severity: medium
reason: convex/snapshots.ts:286-307 writes a pre_restore snapshot with label "Before restore" and createdByRole "system", then patches the report's provenanceId/generationId/sourceTranscriptId(s)/contentHash from snapshotAuditFields(snapshot). convex/comments.test.ts:210 checks only that a pre_restore row carries the accepted content, and convex/snapshots.test.ts:112 checks only the transcript set. Restoring a legacy snapshot that lacks a generationId would silently clear the report's provenance with no test failing.
status: open

### DW-24: completeCandidateRun's ghost-after-terminal branch is covered only for a completed generation that already has a report row.
origin: spec-deferred 1a30854a6bbb
location: convex/generations.ts:1026
source_spec: `1-orchestration-seam-tests.md`
severity: medium
reason: convex/generations.ts:1026-1059 terminalizes a late ghost run and inserts the comparison snapshot only when generation.status === "completed" and a report exists. convex/generationAttribution.test.ts:1788 covers that case and convex/generationRecovery.test.ts:749-797 covers a superseded generation (run terminalized, no snapshot). Still uncovered: the completed-but-no-report sub-case, and a ghost completion carrying an error, which patches the run to "failed" and stores the truncated error.
status: open

### DW-25: createMilestoneSnapshot and pruneSnapshots retention have no direct test coverage.
origin: spec-deferred 966f0e5a244b
location: convex/snapshots.ts:205
source_spec: `1-orchestration-seam-tests.md`
severity: low
reason: convex/snapshots.ts:205 (createMilestoneSnapshot: R-number parsing via milestoneKeyFor, canonical label mapping, per-project duplicate rejection, stale-revision fence) and convex/lib/snapshots.ts:237 (pruneSnapshots, called on both create and restore) are exercised only incidentally. No test asserts the retention thinning rule or the milestone label contract.
status: open

### DW-26: The ConvexError domain-code assertion helper is reimplemented privately in eight convex test files instead of living in a shared test util.
origin: spec-deferred ee471a3f7081
location: convex/
source_spec: `1-orchestration-seam-tests.md`
severity: low
reason: The same "(error as { data?: unknown }).data" unwrapping appears in brainFeedback.test.ts, comments.test.ts, chatProposals.test.ts, generationInput.test.ts, projects.test.ts, reportAuthz.test.ts, reviews.test.ts and now generationLifecycle.test.ts, each with slightly different strictness. Extracting one helper would make error-code assertions uniformly strict.
status: open

### DW-27: provenanceId propagation and createGeneratedReportArtifacts idempotency/version bumping are untested.
origin: spec-deferred 0c99a68de5a6
location: convex/generations.ts
source_spec: `1-orchestration-seam-tests.md`
severity: low
reason: No test passes provenanceId to completeCandidateRun, so its flow into reportCandidates and onward into the report and its "generated" snapshot is unverified, as is listSnapshots' "unavailable_legacy" fallback that depends on it. createGeneratedReportArtifacts' existing-report short-circuit and its version: (latest?.version ?? 0) + 1 increment are never exercised because every fixture starts with no report.
status: open

### DW-28: approveSectionDraft's generation-state, run-state and next-section-ready guards are untested repo-wide.
origin: spec-deferred ede3e2c5cf12
location: convex/generations.ts:1934
source_spec: `1-orchestration-seam-tests.md`
severity: medium
reason: convex/generations.ts:1934 ("No section is awaiting review right now"), :1938 ("This section is not awaiting review") and :1994 ("The next section is not ready to draft") are the three INVALID_STATE guards the new suite does not drive; grepping convex/*.test.ts for those messages returns nothing. Only the earlier-sections-unapproved guard, the attempt fence and the empty-text guard are covered. A regression that dropped any of the three would let an approval land on a generation that is not awaiting input, on a section that is not awaiting review, or double-schedule the next section.
status: open

### DW-29: The live-ghost failure branch of completeCandidateRun has no test.
origin: spec-deferred a15af4de892b
location: convex/generations.ts:1101
source_spec: `1-orchestration-seam-tests.md`
severity: low
reason: convex/generations.ts:1101-1104 patches a ghost run under a still-live iterative generation to "failed" and appends the "One-shot comparison draft failed" progress line. The new "records a ghost draft without advancing a live iterative generation" test drives only the success line, and no other suite seeds a failing ghost under a live generation. Distinct from DW-24, which is the ghost-after-terminal branch.
status: open

### DW-30: sectionEditEvents' skip, zero-word and 6000-character truncation branches are untested.
origin: spec-deferred 1385b8474226
location: convex/generations.ts
source_spec: `1-orchestration-seam-tests.md`
severity: low
reason: approveSectionDraft writes a sectionEditEvents row only when run.draftText exists, computes editRatio 0 when the draft has no words, and caps draftText/approvedText/ghostText at 6000 characters. Every fixture in convex/generationLifecycle.test.ts seeds a short non-empty draftText, so the no-draft skip (no row written), the zero-word ratio and all three caps are unexercised.
status: open

### DW-31: The ConvexError domain-code assertion helper is reimplemented privately in eight convex test files instead of living in a shared test util.
origin: spec-deferred f7720b162ff9
location: convex/
source_spec: `1-orchestration-seam-tests.md`
severity: low
reason: The same "(error as { data?: unknown }).data" unwrapping appears in brainFeedback.test.ts, comments.test.ts, chatProposals.test.ts, generationInput.test.ts, projects.test.ts, reportAuthz.test.ts, reviews.test.ts and now generationLifecycle.test.ts, each with slightly different strictness. Extracting one helper would make error-code assertions uniformly strict.
status: open

### DW-32: approveSectionDraft's generation-state, run-state and next-section-ready guards are untested repo-wide.
origin: spec-deferred 9a886c2b9cdc
location: convex/generations.ts:1934
source_spec: `1-orchestration-seam-tests.md`
severity: medium
reason: convex/generations.ts:1934 ("No section is awaiting review right now"), :1938 ("This section is not awaiting review") and :1994 ("The next section is not ready to draft") are the three INVALID_STATE guards the new suite does not drive; grepping convex/*.test.ts for those messages returns nothing. Only the earlier-sections-unapproved guard, the attempt fence and the empty-text guard are covered. A regression that dropped any of the three would let an approval land on a generation that is not awaiting input, on a section that is not awaiting review, or double-schedule the next section.
status: open

### DW-33: The live-ghost failure branch of completeCandidateRun has no test.
origin: spec-deferred a8cad920b794
location: convex/generations.ts:1101
source_spec: `1-orchestration-seam-tests.md`
severity: low
reason: convex/generations.ts:1101-1104 patches a ghost run under a still-live iterative generation to "failed" and appends the "One-shot comparison draft failed" progress line. The new "records a ghost draft without advancing a live iterative generation" test drives only the success line, and no other suite seeds a failing ghost under a live generation. Distinct from DW-24, which is the ghost-after-terminal branch.
status: open

### DW-34: sectionEditEvents' skip, zero-word and 6000-character truncation branches are untested.
origin: spec-deferred 279977ac106e
location: convex/generations.ts
source_spec: `1-orchestration-seam-tests.md`
severity: low
reason: approveSectionDraft writes a sectionEditEvents row only when run.draftText exists, computes editRatio 0 when the draft has no words, and caps draftText/approvedText/ghostText at 6000 characters. Every fixture in convex/generationLifecycle.test.ts seeds a short non-empty draftText, so the no-draft skip (no row written), the zero-word ratio and all three caps are unexercised.
status: open

### DW-35: Follow-up review still recommended for 1 after the damping cap was spent
origin: review-budget-followup
location: n/a
source_spec: `1-orchestration-seam-tests.md`
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20260904-065146-9a65; this entry preserves the lingering recommendation for a deliberate later review.
status: open
