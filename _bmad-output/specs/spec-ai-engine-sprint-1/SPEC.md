---
id: SPEC-ai-engine-sprint-1
companions:
  - touchpoints.md
  - ../../../docs/product-domain.md
  - ../../../convex/_generated/ai/guidelines.md
sources:
  - ../../../docs/ai-engine-audit-2026-08-25.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# AI engine sprint 1: close the boundary

## Why

A pain to solve and a mandate to meet. The 2026-08-25 audit found that any authenticated identity, including anonymous or role-less users, can mutate report prose, that two proposal-apply paths skip the snapshot and revision safeguards, and that neither cost nor prompt/digest version can be attributed to a generation. These are the cheapest, highest-leverage gaps before the Phase 2 trusted-context work in `docs/ai-architecture-plan.md`, and each is a small change with a deterministic test.

## Capabilities

- **CAP-1**
  - **intent:** Only signed-in users with an internal role can call project-scoped mutations.
  - **success:** A test proves an anonymous and a role-less identity cannot call `updateReportContent` or `applyProposal`.

- **CAP-2**
  - **intent:** Every proposal marked applied has a matching pre-edit snapshot and revision bump.
  - **success:** The one-by-one apply flow cannot produce an `applied` proposal without a `pre_chat_edit` snapshot and an incremented `revisionNumber`.

- **CAP-3**
  - **intent:** Publishing a report for client review is authorized by Owner, Manager, or Admin, not by who created the project.
  - **success:** A transferred owner and a manager can publish; the original creator cannot after losing ownership.

- **CAP-4**
  - **intent:** Accepting a client suggested edit is reversible, and Brain nomination only follows a persisted writer review.
  - **success:** Restoring the snapshot taken before `acceptEdit` returns the prior text; a failed review insert produces no nomination.

- **CAP-5**
  - **intent:** Writer feedback to the Brain is scoped to reports and projects the caller can access.
  - **success:** `submitBrainFeedback` rejects a `reportId`/`projectId` the caller cannot read.

- **CAP-6**
  - **intent:** A single provider call, including retries, cannot outlive the Convex action that owns it.
  - **success:** Worst-case provider timeout × attempts is under 600 s.

- **CAP-7**
  - **intent:** A generation that was retried is distinguishable from one that produced a report, and QA cannot be requested on the former.
  - **success:** The original of a `retryFailedCandidates` call is `superseded`, excluded from history and stats; `requestReportQa` on a reportless generation returns a typed error.

- **CAP-8**
  - **intent:** Chat context and proposal lists are bounded, and a missing thread renders as empty rather than as an error.
  - **success:** Thread history sent to the model is capped at 30 messages excluding tool messages; `listProposals` returns only the loaded turn window; `listMessages` on a deleted thread returns `[]`.

- **CAP-9**
  - **intent:** Every generation records which prompt and learning guidance produced it, and its cost is attributable.
  - **success:** `getGeneration` exposes `promptVersion`, `learningDigestIds`, and total cost summed from `aiUsage` rows keyed by `generationId`.

- **CAP-10**
  - **intent:** Revoking a Brain source leaves a confirmed-erasure record, and embedding never retries against a revoked source.
  - **success:** After revoke, the audit log contains `unlearn_confirmed`, `ragEntryId` is cleared, and a queued embed job for that source exits without retries.

- **CAP-11**
  - **intent:** The stale-generation reaper covers every project.
  - **success:** Reaper reads projects by an index on status; no `take(500)` cap.

## Constraints

- Agents propose, humans apply (`AGENTS.md` policy): no fix may add a code path where an AI tool writes report prose.
- Public `api.*` function paths stay stable; frontend callers are unchanged except the one-by-one apply flow in `ProposalCard.svelte`.
- Schema changes are additive only: new optional fields, one new status value, new indexes. No backfill.
- All `convex/` edits follow `convex/_generated/ai/guidelines.md`.

## Non-goals

- Trusted-context module and injection test suite (Sprint 2).
- `report.editProse` enforcement helper, `reviewDecisions` table, blocking QA policy (Sprint 2).
- De-identification, PED persistence, learning-health panel (Sprint 2).
- Splitting `generations.ts`, report branches, production outcomes, eval set (Later).

## Success signal

`npm test` is green with new tests for CAP-1, CAP-2, CAP-3, CAP-4, CAP-7; an anonymous mutation attempt against a report fails; an admin can read cost and prompt version for any generation.

## Assumptions

- `superseded` is a new value in the `generations.status` union rather than a boolean flag.
- A 4-minute provider timeout with `maxRetries: 1` is acceptable for the largest transcripts.

## Open Questions

- CAP-2: keep `markProposalApplied` with a revision fence and snapshot, or delete it and route the one-by-one flow through `applyProposal` per pair?
- CAP-3: should the original creator retain publish rights after ownership transfer? The domain contract says no.
