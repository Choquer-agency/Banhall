# Proposed build sequence — Step-by-step PD generation

A proposed split into independently reviewable slices for the human to confirm in an interactive `bmad-spec` Story Breakdown (which writes `stories.yaml`). This is a rendering, not `stories.yaml`; `spec_checkpoint` / `done_checkpoint` / `invoke_dev_with` are for the human to set. Each slice names the capabilities and spine ADs it owns and the tests that must exist when it lands. Slice 0 is a prerequisite the parent spine already named as TARGET; slices 1–3 are backend-only and can ship dark behind the workflow discriminator; the mode relabel (slice 8) is the last thing to land. Parent-spine amendments C2 (sign-off gate vs AD-24) and C4 (exclusion override vs AD-25) were approved by the owner on 2026-09-17; C1 (request cap) was withdrawn because the owner decided there is no cap; C3, C5, C6 are acknowledgements. Slices 2 and 4 are unblocked.

| # | Lane | Slice | Owns | Enforcing tests to add | Depends on |
|---|---|---|---|---|---|
| 0 | schema / lifecycle | Project-scoped table registry: `convex/lib/projectScopedTables.ts` listing every `projectId` table in `schema.ts` (schema-walk test enforces completeness), `deleteProject` purging through it paginated while preserving existing blob and Brain cleanup | parent AD-19 (TARGET → built) | `convex/projectErasure.test.ts` (every projectId table listed; purge covers each; existing cleanup unchanged) | — |
| 1 | shared / schema | Subsection vocabulary, workflow discriminator, seed tables registered in the slice-0 registry | CAP-1 (discriminator, resolver), CAP-2 (vocabulary); AD-31 (reservation write), AD-32, AD-33, AD-40 | `shared/pdSubsections.test.ts` (bijection with prompt/QA roles), `convex/lib/gatedWorkflow.test.ts` (absent → sections; old awaiting_input; old completed; new reserved), `convex/projectErasure.test.ts` (seed tables listed), schema typecheck | 0 |
| 2 | pipeline | Seed stage in the iterative topology; `generations.initializeSeedStage`; `seedRuns.dispatch/claimAttempt/completeAttempt/failAttempt/settleAttempt` with the immutable context snapshot and `pendingBatchId` fence; Node action; seed contract and role-aware tool schema; provenance; slots; usage metering; reaper scan | CAP-3, CAP-14 (metering, lease); AD-31, AD-34, AD-35, AD-38, AD-42 | `convex/lib/seedContract.test.ts`, `convex/lib/seedDispatch.test.ts`, `convex/ai/seeds.test.ts` (invalid seed dropped, batch < 3 fails, bad excerpt → writer-asserted, 1–3 revisions, request bytes from the snapshot), `convex/ai/instrument.test.ts` (two slots), `convex/ai/promptScaffolds.test.ts` (scaffolds, promptVersion), `convex/ai/contextBoundary.test.ts` (seed fixtures), `convex/generationReaper.test.ts` (over-lease attempt failed), `convex/seeds.test.ts` (one pending batch; late never shown; usage counted, never refused; three consecutive failures → failed with retry; Retry remains available and metered without limit) | 1 |
| 3 | mutations | Canonical decision DTO and revisions (`lib/seedRevisions.ts`), select/edit/restore, feedback requests and withdrawal, regenerate/restore batch, skip/unskip, approve with the server-owned challenge, stale episodes, readiness, AD-44 DTOs and pagination, events + learning-health reader | CAP-4 (decision set assembly), CAP-5, CAP-6, CAP-7, CAP-8, CAP-9, CAP-10, CAP-15, CAP-16 (read bounds); AD-36, AD-39, AD-43, AD-44 | `convex/lib/seedRevisions.test.ts`, `convex/seeds.test.ts` (successor-only staleness; approval revert on own change; consumed revision immutable; challenge mismatch refused; carried selections force acknowledgment; one open episode across R0→R1→R0→R2; outdated late batch shown not applied; skip/unskip/cancel dispositions; unlinked advancement refused; readiness matrix; version conflict; feedback in own and successor revisions; withdrawal; no text on events; authorization branch per mutation), `convex/learningHealth.test.ts` (worked trace from the PRD addendum) | 2 |
| 4 | pipeline | `generations.signOffSeedStage` (in `convex/generations.ts`, owning the status transition) → summary version → ordered chain entry for iterative seeds → content-plan block, skip instructions, coverage/skip compliance rows → report creation → post-QA; `generations.retryFromSummary` | CAP-12 (sign-off, cancel), CAP-13; AD-37 | `convex/generationLifecycle.test.ts` (sign-off transitions; chain scheduled with plan block; report via creation writer; retry reuses summary; legacy mutations refuse seeds and vice versa), `convex/ai/selfCheck.test.ts` (cover and skip rows), `convex/orderedChainRecovery.test.ts` (iterative seeds entry) | 3 |
| 5 | client | Seed workspace: split host, Outline, Subsection pane, Seed card, action bar, drawer below lg, conflict handling, announcements | CAP-2 (Outline), CAP-5–CAP-9 UI, CAP-10 (client behaviour), CAP-16; AD-41 | `src/lib/components/seeds/*.component.test.ts` (checkbox semantics; disabled Approve; Confirm-and-approve listing; stale/outdated word pills; feedback chip withdraw; drawer below lg; STALE_REVISION keeps unsaved text), `ReportLoading.component.test.ts` (routing by discriminator, initializing state) | 3 |
| 6 | client | Summary Review (full-width state, sticky Section headings, per-item edit, read-only model and Summary version from 2, Sign off and generate), post-generation read-only Summary, Brief rail version label | CAP-11, CAP-12 UI, CAP-4 (Brief labelling); AD-41 | `SeedSummaryReview.component.test.ts` (readiness gating with reasons; browser-history entry; edit withdraws readiness; no free-text add), Brief rail label test | 4, 5 |
| 7 | quality | Release-blocking semantic suite (`scripts/seed-plan-eval.mjs`) with the five fixtures; production-model latency measurement; NFR-1 numbers and the 40-request notice fixed | CAP-13 (suite), CAP-14 (numbers) | Fixture judgments recorded under `_bmad-output/test-artifacts/`; measurement note in the spine memlog | 4 |
| 8 | client / docs | Mode relabel from one shared definition in all three selectors; design-system note for the sticky Section headings; product-domain amendment proposal (PRD §10) | CAP-1 (relabel); AD-41 | `shared` test that the three selectors import the shared list; docs diff | 5, 6 |

Sequencing notes:

- Slices 1–4 are testable with `convex-test` and never touch the browser; run `bash scripts/loop-verify.sh` per slice.
- Slice 5 and 6 touch `src/lib/components`; run `npm run test:component` locally before opening them.
- The ghost draft is not scheduled for seeds generations from slice 2 onward (OQ-5 default); if OQ-5 is answered "keep", slice 2 re-enables it behind the discriminator.
- If OQ-2 is answered "keep the second gate", slice 4 routes the chain through `generationSectionRuns.awaiting_review` and `approveSectionDraft` with the content-plan block instead of `gate none`, and slice 6 keeps `IterativeStepper` after sign-off.

## Worked event trace (metrics fixture, v1)

Producer-schema events (AD-39 kinds), one generation `G`, firm-time period P1 = [09:00, 10:00), P2 = [10:00, 11:00). Actor `L` = Larry (user), `S` = system. Expected query results follow.

| # | at | kind | roleId | refs | actor | notes |
|---|---|---|---|---|---|---|
| 1 | 09:00:00 | initialized | — | — | S | |
| 2 | 09:00:01 | batchDispatched | company_context | batch b1 (open, roleOpen=true) | S | queuedAt 09:00:01 |
| 3 | 09:00:09 | batchCompleted | company_context | b1 | S | 5 seeds |
| 4 | 09:00:12 | batchViewed | company_context | b1 | L | first render |
| 5 | 09:00:40 | select | company_context | seed s1 | L | |
| 6 | 09:00:50 | select | company_context | s2 | L | |
| 7 | 09:01:20 | edit | company_context | s2 | L | editRatio 0.3 |
| 8 | 09:01:30 | approve | company_context | snapshot {s1, s2} | L | confirmed=false |
| 9 | 09:01:31 | batchDispatched | goal_problem | b2 (prefetch) | S | |
| 10 | 09:01:38 | batchCompleted | goal_problem | b2 | S | |
| 11 | 09:05:00 | batchViewed | experimentation | b3 (open) | L | b3 dispatched 09:04:50, completed 09:04:58 (events omitted for brevity) |
| 12 | 09:05:30 | feedbackRequested | experimentation | request f1 on s9 | L | |
| 13 | 09:05:31 | batchDispatched | experimentation | b4 (feedback, f1) | S | |
| 14 | 09:05:35 | approve | experimentation | snapshot {s9} | L | before f1's response |
| 15 | 09:05:41 | batchCompleted | experimentation | b4 | S | 2 revised seeds s9a, s9b |
| 16 | 09:06:00 | select | experimentation | s9a | L | |
| 17 | 09:06:05 | deselect | experimentation | s9 | L | |
| 18 | 09:06:10 | approve | experimentation | snapshot {s9a} | L | |
| 19 | 09:20:00 | deselect | active_uncertainties | s5 | L | |
| 20 | 09:20:00 | staleOpened | hypothesis | episode e1 | S | |
| 21 | 09:20:00 | staleOpened | experimentation | e2 | S | |
| 22 | 09:22:00 | approve | active_uncertainties | snapshot {…} | L | |
| 23 | 09:23:00 | regenerate | hypothesis | b5 dispatched/completed 09:23:00–09:23:09 | L | fresh context |
| 24 | 09:24:00 | approve | hypothesis | snapshot {seeds of b5} | L | |
| 25 | 09:24:00 | staleDisposed | hypothesis | e1 resolved; freshAttemptCompleted=true, freshSeedsInSnapshot=true, olderSelectionsConfirmed=false | S | |
| 26 | 09:26:00 | approve | experimentation | snapshot {s9a} | L | confirmed=true (acknowledged carried s9a) |
| 27 | 09:26:00 | staleDisposed | experimentation | e2 resolved; fresh=false, freshSeeds=false, olderConfirmed=true | S | |
| 28 | 10:05:00 | feedbackWithdrawn | experimentation | f1 | L | after scoring |
| 29 | 10:30:00 | signOff | — | snapshot of all roles | L | |

Expected (period P1 unless stated):

- Batches completed 5 (b1–b5), batches viewed 3 (b1, b3, b4 counted when first viewed; b2 unviewed), seeds viewed = seeds of viewed batches.
- Feedback f1: `firstApproveExposure` = event 14, outcome `response_not_available`; `eligibleScore` = event 18, selected = true; SM-5 numerator 1, denominator 1; withdrawal at event 28 reported separately in P2 and changes neither result.
- Stale episodes: 2 opened, 2 resolved in P1 (attributed by disposedAt); e1 fresh-attempt-used, e2 confirmed-only; durations 4 min and 6 min wall time.
- SM-3 at sign-off: company_context snapshot holds s1 unedited → counts; experimentation holds s9a (Revised) → does not count.
- Active time to sign-off (attributed to P2 by signOff.at): gaps < 10 min summed over events 1–29; the 09:26→10:05 gap (39 min) and 10:05→10:30 (25 min) are excluded.
- Latency: b1 dispatch-to-result 8 s; b1 foreground dispatch-to-first-render 11 s (roleOpen=true); b2 (prefetch) 7 s, no foreground figure.
