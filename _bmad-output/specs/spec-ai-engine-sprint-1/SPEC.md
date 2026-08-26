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
  - **success:** Reaper sweeps `projects.by_status_and_updatedAt` (`status = generating`, `updatedAt < cutoff`) uncapped; no `take(500)` cap. (`projects.by_status` already existed at baseline.)

## Constraints

- Agents propose, humans apply (`AGENTS.md` policy): no fix may add a code path where an AI tool writes report prose.
- Public `api.*` function paths stay stable (`listProposals` gained required `startOrder`/`endOrder` args; the path did not move). Frontend edits are limited to: the one-by-one apply flow in `CurrentProjectPage.svelte` and `PreviewProjectPage.svelte` (CAP-2; `ProposalCard.svelte` is not the apply site), `GenerationStatusChip.svelte` and `recovery.ts` (CAP-7), `AgentChatPanel.svelte` (CAP-8), and `admin/brain/+page.svelte` (CAP-10).
- Schema changes are additive only: new optional fields, one new status value, new indexes. No backfill.
- All `convex/` edits follow `convex/_generated/ai/guidelines.md`.
- Story dispatch: `touchpoints.md` test rows name files vitest executes (`npx vitest list <file>` returns it; `tests/chatProposals.test.ts` is bun-only and inert), and `invoke_dev_with` hints name symbols that exist.

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
- "An admin can read cost and prompt version" is satisfied at the query layer (`getGeneration` exposes `promptVersion`, `learningDigestIds`, `costUsd`); no screen is built in this sprint. A panel belongs to the Sprint 2 learning-health item.

## Decisions (closed questions)

- CAP-2: `markProposalApplied` is kept and fenced (`expectedRevisionNumber`, `pre_chat_edit` snapshot, revision bump); per-pair `applyProposal` cannot express keep-instance-2/replace-instance-3.
- CAP-3: Owner is strict `ownerId`; the original creator loses publish rights after transfer, per `docs/product-domain.md`.

## Open Questions

- CAP-7: "excluded from stats" is not met; `modelStats` keys off `candidateScores`/`modelSelections` and never reads `generations.status`. Reword to history-only, or add a story filtering superseded generations' candidates out of `modelStats`?
- CAP-1: intent covers all project-scoped mutations; success covers `updateReportContent` and `applyProposal` only. `getProjectAccess` still grants internal access to anonymous/role-less identities, so `comments.addComment` is callable anonymously. Gate the write branch now; does the read branch keep role-less visibility (2026-08-06 decision)?
- Anonymous sessions receive `NOT_AUTHORIZED` from `requireInternalProjectAccess`/`submitBrainFeedback` but `NOT_AUTHENTICATED` from `requireCapability`. Unify, or accept divergent frontend copy?
