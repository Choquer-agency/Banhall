> **Reconciled 2026-09-01 against `main` 0ece1f0.** Drafted on branch `bmad-loop` (b39b434), whose Sprint 1 code was superseded by `main`. CAP-6 is already shipped; see `.memlog.md`. Re-verify every anchor at planning time.

---
id: SPEC-ai-engine-sprint-2-boundary
companions:
  - touchpoints.md
  - ../../../docs/product-domain.md
  - ../../../docs/ai-architecture-plan.md
  - ../../../convex/_generated/ai/guidelines.md
sources:
  - ../../../docs/ai-engine-audit-2026-08-25.md
  - ../spec-ai-engine-sprint-1/RETROSPECTIVE.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# AI engine sprint 2A: trusted context and review authority

## Why

A mandate to meet: plan Phase 2 (trusted context) is the audit's remaining P0 and has not started. Client content still sits inside the system prompt in chat, trust is granted by an upload category field, generation input has no total budget, and no injection test exists. Alongside it, the review layer still lets QA stay advisory, lets stage transitions skip any review record, and, until Sprint 1 landed `requireReportEditAccess` (4ea1bb9), enforced `report.editProse` nowhere; CAP-6 is therefore already done on `main` (see .memlog.md, 2026-09-01). Sprint 1 closed the cheap gaps; this epic closes the structural ones on the backend boundary.

## Capabilities

- **CAP-1**
  - **intent:** The three `pre_chat_edit` snapshot sites share one writer helper.
  - **success:** `writePreEditSnapshot(ctx, report, reason)` exists in `convex/lib/snapshots.ts`; `applyProposal`, `markProposalApplied`, and `acceptEdit` call it; existing snapshot tests still pass.

- **CAP-2**
  - **intent:** Generation context is assembled by one trusted-context module that classifies every source, budgets per source and in total, and records what was truncated.
  - **success:** `convex/ai/trustedContext.ts` exports a builder used by the analyzer; `generationSources` records per-source truncation and the total budget applied; the transcript is wrapped in BEGIN/END markers; the data-not-instructions guidance is emitted even with zero documents; worst-case analyzer input is bounded by a configured token budget.

- **CAP-3**
  - **intent:** Document trust comes from who uploaded it, not from a category label.
  - **success:** A document is treated as `writer_notes` trust only when its uploader had an internal role at upload time; a client-uploaded file tagged `writer_notes` is treated as client evidence; covered by a test.

- **CAP-4**
  - **intent:** Chat sends client evidence as labeled data, not as policy, and keeps the static policy prefix first.
  - **success:** `chatAgentV2` system prompt contains only policy and writer style; report text, documents, analyzer JSON, and prior decisions travel in one user-role evidence message with provenance headers; document count and total evidence size are capped and the truncation is logged; the system prefix is byte-stable across turns for the same writer.

- **CAP-5**
  - **intent:** Prompt-injection attempts in client content cannot change model instructions in either pipeline.
  - **success:** A deterministic test suite feeds injection fixtures (instruction overrides, tool-call requests, role spoofing) through the generation context builder and the chat evidence builder and asserts they land inside delimited data blocks with the guidance present.

- **CAP-6**
  - **intent:** Every prose-writing mutation is authorized by the `report.editProse` capability through one helper.
  - **success:** `requireReportEditAccess(ctx, projectId)` exists and is called by `updateReportContent`, `applyProposal`, `markProposalApplied`, `acceptEdit`, `restoreSnapshot`, and `approveSectionDraft`; a consultant assigned to the project passes, an unrelated consultant fails with `NOT_AUTHORIZED`; covered by tests.

- **CAP-7**
  - **intent:** Leaving `internal_review` requires a recorded reviewer decision pinned to the exact report revision.
  - **success:** A `reviewDecisions` table (reviewer, reportId, revisionNumber, contentHash, decision approve|return, note) is written in the same mutation as the `internal_review → edits` or `→ ready_for_delivery` stage event; the transition fails with a typed error without it.

- **CAP-8**
  - **intent:** Non-waivable QA checks block filing readiness and client publish.
  - **success:** Deterministic QA findings persist as rows; `because_clause` and CRA-methodology findings are flagged blocking; `getFilingReadiness` returns `QA_BLOCKING` while any blocking finding is open on the current revision; `publishForReview` refuses with the same code.

- **CAP-9**
  - **intent:** Human review artifacts are pinned to the exact content they judged.
  - **success:** `writerReviews`, `qaItemFeedback`, and `pdReviews` carry `revisionNumber` and `contentHash` (document hash for pdReviews); `writerReviews.userId` is `v.id("users")`; new rows populate them; old rows tolerate absence.

- **CAP-10**
  - **intent:** Compare mode runs the analyzer once and reuses it for every candidate, with prompt caching on the shared prefix.
  - **success:** `generateReport` stores `generationArtifacts.analysis` once and passes it to each `generateCandidate`; Anthropic calls mark the system prompt and transcript with `cache_control`; a test proves one analyzer call for two candidates.

- **CAP-11**
  - **intent:** Chat spend is bounded per project and per user.
  - **success:** `sendMessage` refuses with a typed error when the project's rolling 24h `aiUsage` cost exceeds a configured budget, or when the user has more than N queued turns; admin-configurable via `appSettings`.

## Constraints

- Agents propose, humans apply: no fix adds an AI-driven prose write path.
- Public `api.*` paths stay stable; argument shapes may gain optional fields only. Any frontend caller touched must be listed in the story spec.
- Schema changes additive only; new fields optional; no backfill jobs.
- Prompt text edits must keep existing `prompts.test.ts` snapshots passing or update them with a stated reason in the story spec.
- All `convex/` edits follow `convex/_generated/ai/guidelines.md`.
- Stories in this epic must not edit `src/lib/components/chat/AgentChatPanel.svelte`, `AssistantTurn.svelte`, `ToolTraceStep.svelte`, `turnParts.ts`, `convex/learning.ts`, `convex/ai/learning.ts`, `convex/brain.ts`, or `src/routes/admin/brain/**`; those belong to the parallel learn-and-chat epic.

## Non-goals

- De-identification, PED persistence, learning-health panel, digest gates (epic 2B).
- Chat UX (regenerate, optimistic bubble, source chips, feedback bar) (epic 2B).
- Provenance re-derivation after human edits, report branches, production outcomes (Later).
- Splitting `generations.ts` (Later).

## Success signal

`npm test` and `npm run check` green; injection fixtures provably land in data blocks in both pipelines; a stage transition out of `internal_review` without a decision fails; an open blocking QA finding blocks publish; two-candidate compare makes one analyzer call.

## Assumptions

- Token budget defaults: analyzer input 150k tokens total, chat evidence 60k tokens, 12 documents max, configurable via `appSettings`.
- "Uploader had an internal role" is derivable from `projectDocuments.uploadedBy` joined to `users.role` at upload time; if no uploader is recorded, treat as client trust.
- `reviewDecisions` is required only on the two edges named; other transitions unchanged.

## Open Questions

- CAP-8: should a manager be able to waive a blocking finding with a recorded reason, or is "never waivable" absolute? Default implemented: absolute, with the finding text editable only by fixing the report.
