> **Reconciled 2026-09-01 against `main` 0ece1f0.** Drafted on branch `bmad-loop` (b39b434); all eight capabilities are still open on `main`. See `.memlog.md`. Re-verify every anchor at planning time.

---
id: SPEC-ai-engine-sprint-2-learn-chat
companions:
  - decisions/rerank-fallback-measurement-2026-09-05.md
  - decisions/digest-diversity-policy-2026-09-04.md
  - touchpoints.md
  - ../../../docs/the-brain.md
  - ../../../docs/ai-architecture-plan.md
  - ../../../convex/_generated/ai/guidelines.md
sources:
  - ../../../docs/ai-engine-audit-2026-08-25.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# AI engine sprint 2B: learning loop measurement and chat experience

## Why

A pain to solve: the learning loop cannot answer "is the system improving?" Post-edit distance is computed but never stored, Brain provenance is write-only, digests carry no signal provenance and can be published from one writer's feedback, and client prose enters firm-wide knowledge verbatim. The chat panel has no regenerate, no optimistic send, no visible sources, and no per-answer feedback, so writers cannot correct the assistant and the loop cannot learn from them.

## Capabilities

- **CAP-1**
  - **intent:** Client identifiers are removed before content enters firm-wide knowledge.
  - **success:** A `deidentify(text, project)` helper strips company name, project title, people names from the project record, and email/phone patterns; `nominateFromReport`, `sectionEditEvents`, and `proposalWordingEditEvents` writes pass through it; the digest prompt carries a privacy instruction; publishing a digest requires an explicit `privacyReviewed: true` argument.

- **CAP-2**
  - **intent:** Post-edit distance is persisted per report at milestones so trends can be read.
  - **success:** A `reportEditDistance` table (reportId, generationId, revisionNumber, ped, computedAt, trigger) is written at candidate selection, milestone snapshots, and `client_review` publish; a query returns the series per report and per writer.

- **CAP-3**
  - **intent:** Admins can see whether learning is working.
  - **success:** `/admin/learning` shows PED trend (30/90 days), exemplar usage by Brain source (join `generations.brainProvenance` to `writerReviews` and `candidateScores`), and measured rerank fallback rate at the existing Brain rerank call sites, with operational outcomes independent of aiUsage billing metadata. The human approved failed attempted reranks divided by all attempted reranks, excluding deliberate skips, prospective tracking now, and unavailable historical coverage (2026-09-05). Count logical terminal attempts after existing retries; preserve billing and retrieval semantics. The measurement companion defines the edge cases; all numbers come from queries with tests.

- **CAP-4**
  - **intent:** A firm-wide digest cannot be distilled from one writer or one project, and every digest names its inputs.
  - **success:** `generateDraftStyleDigest` and `generateQaCalibrationDigest` include only streams with ≥2 distinct writers and ≥2 distinct projects after existing signal filters and exclusion of records lacking writer/project attribution. Omit failing streams without blocking qualifying ones or pooling diversity across streams. At least five admitted records must remain overall before distillation; omitted inputs do not affect prompts, source counts, provenance or freshness cutoffs. `learningDigests` records exact admitted signal ids and per-producer counts; the admin reviews page shows them plus exclusion counts and reasons, including when generation is skipped, without fabricating candidates or legacy metadata. Preserve excluded source records, immutable unpublished candidates, freshness, privacy review and separate admin publication. This mixed-stream rule was explicitly approved by the human on 2026-09-04 and also applies to additional learning streams.

- **CAP-5**
  - **intent:** A writer can regenerate or retry an assistant turn without retyping.
  - **success:** Failed and completed assistant turns show a regenerate control that re-sends the originating prompt as a new turn on the same thread; keyboard accessible; covered by a component test.

- **CAP-6**
  - **intent:** A sent message appears immediately.
  - **success:** An optimistic user bubble keyed by a client request id renders on send and is replaced when the server page catches up; on send failure it shows the inline error with retry.

- **CAP-7**
  - **intent:** Writers can see which Brain sources and documents grounded an answer, and rate it.
  - **success:** `searchBrain` tool steps render source chips (title, science code) using `Source.svelte`; each completed assistant turn has a `FeedbackBar` whose votes persist to a `chatAnswerFeedback` table in a new `convex/chatFeedback.ts` module; the learning distiller reads it as an additional signal stream.

- **CAP-8**
  - **intent:** Generation orchestration seams are covered by deterministic tests.
  - **success:** convex-test suites exist for `completeCandidateRun` fan-in (seeded + failed), `approveSectionDraft` with and without ghost, `selectReportCandidate`, and `restoreSnapshot`; all pass in `npm test`.

## Constraints

- Admin publication remains the only path to activate firm-wide guidance; nothing here auto-publishes.
- Client-visible surfaces untouched; all UI here is internal (chat panel, admin).
- Design-system rules apply to all UI: type roles, remapped gray ramp, max font weight 500, bits-ui primitives over native controls, tab active-state rule.
- Component tests run under `npm run test:component` (browser); backend tests under `convex/**/*.test.ts`.
- Stories in this epic must not edit `convex/ai/chatAgentV2.ts`, `convex/chatV2.ts`, `convex/ai/analyzerAgent.ts`, `convex/ai/pipeline.ts`, `convex/lib/auth.ts`, `convex/projectWorkflow.ts`, `convex/ai/qaChecks.ts`, or `convex/reports.ts` beyond adding a read-only query; those belong to the parallel boundary epic. New backend code goes in new modules (`convex/chatFeedback.ts`, `convex/learningHealth.ts`, `convex/lib/deidentify.ts`).

## Non-goals

- Trusted-context, injection tests, edit authorization, review decisions, QA policy, caching, chat budgets (epic 2A).
- Frozen eval set and Brain-on/off runs (Later).
- Negative-signal namespace and CRA outcomes (Later).

## Success signal

An admin opens `/admin/learning` and sees a PED series with at least one point per generated report, exemplar usage per Brain source, and rerank fallback rate; a digest candidate from one writer is refused; a writer regenerates a failed turn and rates an answer, and the vote appears in the next digest's signal counts.

## Assumptions

- PED formula stays as implemented in `reports.postEditDistance`; only persistence is added.
- De-identification is regex + project-record driven, not model-driven; false negatives are acceptable in this sprint and are logged for review.
- `chatAnswerFeedback` is a new table, not a reuse of `qaItemFeedback`.

## Open Questions

- CAP-1: should previously nominated Brain sources be re-processed through `deidentify`? Default: no; a follow-up admin action can re-run it.
