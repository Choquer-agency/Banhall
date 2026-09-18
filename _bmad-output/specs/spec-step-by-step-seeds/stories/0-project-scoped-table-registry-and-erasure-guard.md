---
title: 'Project-scoped table registry and whole-schema erasure guard'
type: 'feature'
created: '2026-09-17'
status: 'done'
baseline_commit: '74021befd75c84344248907676c6a9022b298724'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-step-by-step-seeds/stories/0-sweep-2026-09-17.md'
  - '{project-root}/convex/_generated/ai/guidelines.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `deleteProject` deletes 7 of the 53 tables that reference a project, leaves document blobs and running generations behind, and does it unpaginated in one transaction; the parent spine names a project-scoped registry (AD-19) that was never built, and the seed feature (spine AD-45) adds eleven more project tables.

**Approach:** One registry lists every schema field typed `v.id("projects")` with a disposition; `deleteProject` records a deletion barrier, terminalizes live generation work, then purges through the registry in paginated, resumable internal mutations, deleting blobs as rows go; a schema-walk test fails on any unlisted project reference.

## Boundaries & Constraints

**Always:** Registry keyed by validator target (`v.id("projects")`), not field name, so optional and renamed references are caught. Widen-only schema changes (new optional field, new indexes). Preserve today's behaviour: refuse deletion while open work items exist; dashboard bucket decremented exactly once; QA findings cleanup still scheduled per deleted report; `deleteStorageIfUnreferenced` runs after the `projectDocuments` row delete in the same transaction. Authorization stays `requireProjectCreatorOrAdmin` (parent Q2 pending). Every purge page is idempotent and resumable (cursor in args, self-reschedule, `numItems ≤ 100`). Follow `convex/_generated/ai/guidelines.md`.

**Ask First:** Any disposition change for `comparisons`, `reviewDecisions`, `writerReviews`, `qaItemFeedback`, `reportEditDistance` (spec says keep). Any change to the barrier check site list. Any new cron.

**Never:** Purge component-owned rows (agent threads, RAG entries, workflow runs) or revoke Brain sources in this story; register the seed tables (story 1); touch `requireInternalProjectAccess`; add `sveltekit()` to the component vitest config.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | Admin deletes a project with rows in ≥ 20 registry tables, one document with a blob, one `awaiting_input` generation | Barrier set; generation and its runs `failed`, scheduled jobs cancelled; pages purge in registry order; blob gone; `detach` fields cleared; `keep` rows remain; project row deleted last; bucket decremented once | N/A |
| Open work item | Project has an open work item | Refused before any write | `INVALID_STATE` as today |
| Retry mid-purge | Page N already ran, scheduler re-delivers it | Page is a no-op for already-deleted rows and continues from its cursor | N/A |
| Late async writer | `claimCandidateRun` / `claimSectionRun` / `runReportQa` runs after the barrier | Returns without writing | logged narration, no throw |
| Unlisted reference | A new table adds `projectId` without a registry entry | `projectErasure.test.ts` fails naming the table and field | N/A |
| Unauthorized | Non-creator consultant deletes | Refused, nothing written | `NOT_AUTHORIZED` |

</frozen-after-approval>

## Code Map

- `convex/schema.ts` -- add `projects.deletionStartedAt: v.optional(v.number())`; add `by_projectId` index to the 12 tables listed in the sweep that lack a projectId-leading index.
- `convex/lib/projectScopedTables.ts` (new, runtime-free) -- `PROJECT_SCOPED_TABLES: readonly {table, field, disposition: "delete"|"detach"|"keep", index?: string, children?: {table, field, index}[], blob?: "storageId"}[]`, in purge order (children and blobs before parents, `projects` excluded). Include `qaFindings` (via `reports`), `generationArtifacts` (via `generations`), `chatTurns` (via `agentChatThreads`) as children.
- `convex/projects.ts:1209-1286` -- `deleteProject` becomes: authorize → open-work-item refusal → set `deletionStartedAt` (idempotent: if already set, only reschedule) → bucket decrement → terminalize non-terminal `generations`, `generationCandidateRuns`, `generationSectionRuns` (`failed`, cancel `scheduledJobId` via `ctx.scheduler.cancel`) → `scheduler.runAfter(0, internal.projects.purgeProjectPage, {projectId, entryIndex: 0, cursor: null})`. Keep `cleanupDeletedReportQaFindings` scheduling per report.
- `convex/projects.ts` (new `purgeProjectPage` internalMutation) -- walks `PROJECT_SCOPED_TABLES[entryIndex]` with `.paginate({cursor, numItems: 100})`; `delete` → delete row (children first, blob via `deleteStorageIfUnreferenced`); `detach` → patch field to `undefined`; `keep` → skip; on `isDone` advance `entryIndex`, else reschedule with `continueCursor`; after the last entry clear `projects.sourceProjectId` on referrers and delete the project row.
- `convex/lib/projectDeletion.ts` (new) -- `isProjectDeleting(ctx, projectId)`; called at the top of `claimCandidateRun`, `claimSectionRun` (`convex/generations.ts`) and `runReportQa` start (`convex/ai/postQa.ts` entry mutation) to return early.
- `convex/lib/storage.ts:8` -- reuse `deleteStorageIfUnreferenced`.
- `convex/projectErasure.test.ts` (new) -- completeness walk over `schema.tables[*].validator` finding every `v.id("projects")` field (including optional and nested unions), asserting a registry entry per (table, field) and a non-empty sentinel; purge scenario from the I/O matrix with scheduler drain; barrier scenario; authorization scenario.
- Existing tests to keep green: `convex/qaFindingsCleanup.test.ts`, `convex/dashboardStageCounts.test.ts:198`, `convex/workItems.test.ts:393`, `convex/generationReaper.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `convex/schema.ts` -- add `deletionStartedAt` and the 12 `by_projectId` indexes -- registry needs a range per table.
- [x] `convex/lib/projectScopedTables.ts` -- write the registry with dispositions from the sweep -- single source of truth for erasure.
- [x] `convex/lib/projectDeletion.ts` -- barrier helper -- async writers must not repopulate a deleting project.
- [x] `convex/projects.ts` -- rewrite `deleteProject`, add `purgeProjectPage` -- paginated, resumable, blob-safe purge.
- [x] `convex/generations.ts`, `convex/ai/postQa.ts` -- barrier checks in claim/QA entry -- late writers return early.
- [x] `convex/projectErasure.test.ts` -- completeness walk, purge, barrier, authorization -- guard is enforced from day one.
- [x] `docs/changelog` entry per `docs/changelog-guidelines.md` -- user-visible behaviour change (documents now deleted with the project).

**Acceptance Criteria:**
- Given the registry, when any table gains a `v.id("projects")` field without an entry, then `npm test` fails naming it.
- Given a project with rows across the delete, detach and keep tables and a stored document blob, when an admin deletes it and the scheduler drains, then delete rows and the blob are gone, detach fields are cleared, keep rows remain, and the project row is gone.
- Given a deletion in progress, when a candidate or section run claims, then no row is written for that project.
- Given the existing tests for QA-findings cleanup, dashboard counts and open-work-item refusal, when the suite runs, then they pass unchanged.

## Verification

**Commands:**
- `npx vitest run --project convex convex/projectErasure.test.ts convex/qaFindingsCleanup.test.ts convex/dashboardStageCounts.test.ts convex/workItems.test.ts convex/generationReaper.test.ts` -- expected: all pass.
- `bash scripts/loop-verify.sh` -- expected: every numbered step passes (typecheck, check, test, discovery guard, build, uploader harnesses).

## Deferred findings (review 2026-09-17)

Recorded here rather than in `_bmad-output/implementation-artifacts/deferred-work.md`, which the native BMAD orchestrator owns (AGENTS.md). Reviewer: gpt-6-astra, medium; three layers (blind hunter, edge-case hunter, verification gap). Seven patch findings were applied in the review round; these three were deferred.

- Resolved on 2026-09-18 under the owner-requested PR #18 greploop: shared internal/client access rejects deleting projects; workflow, ingestion, oversight and asynchronous save paths check the barrier in their writing transaction. Generation artifacts cannot be recreated after their parent is purged. Authorized repeated deletion still restarts the purge.
- Resolved on 2026-09-18: `aiUsage.logUsage` retains billed usage and available writer attribution, but omits explicit or inferred project references when that project is deleting or gone.
- `terminalizeLiveGenerationWork` runs inside the `deleteProject` transaction with fixed limits (50 live generations per status, 500 runs per generation) and warns on truncation instead of continuing; claims fail closed on the barrier, so the impact is bounded.

## PR review corrections (2026-09-18)

The owner requested agent-tree and greploop on PRs #17 and #18. This authorizes extending the original barrier-site scope and supersedes the frozen restriction against touching `requireInternalProjectAccess` for this correction. Shared access fencing closes the reviewed erasure races without changing actor permissions or retained-data dispositions.

- Every new purge continuation carries the serialized ordered registry contract, including indexes, child cleanup, detach fields, blobs and the final self-reference. Missing or changed versions restart from the beginning before the finalization sentinel is considered.
- The dashboard rebuild skips deleting projects, preserving the deletion entry's one-time decrement.
- Regression coverage: `projectErasure.test.ts` includes upload-after-purge, artifact resurrection, changed/legacy finalization jobs and dashboard recounting; `projectErasureAsyncWriters.test.ts` covers late background saves and retained usage; `projectErasureWorkflow.test.ts` covers workflow, ingestion and oversight writers. Existing chat-turn fixtures now establish real thread/project ownership.
- Red evidence reproduced generation artifact resurrection and dashboard recounting. The corresponding focused tests pass after the fixes. The full gate is required before push; its final result and the independent Astra review are reported in the PR review replies.

## Suggested Review Order

**Entry point: the registry is the contract**

- Every project reference, its disposition and purge order; the erasure test walks the schema against this list
  [`projectScopedTables.ts:72`](../../../../convex/lib/projectScopedTables.ts#L72)

- The one self-reference handled on the final page (`projects.sourceProjectId`)
  [`projectScopedTables.ts:193`](../../../../convex/lib/projectScopedTables.ts#L193)

**Deletion barrier and terminalization**

- `deleteProject`: refuse on open work, stamp the barrier (idempotency key), decrement once, terminalize, schedule the purge
  [`projects.ts:1430`](../../../../convex/projects.ts#L1430)

- Live generations, candidate runs and section runs fail and their jobs are cancelled before any purge page
  [`projects.ts:1363`](../../../../convex/projects.ts#L1363)

- The barrier helper: true once stamped, and after the row is gone
  [`projectDeletion.ts:14`](../../../../convex/lib/projectDeletion.ts#L14)

**Paginated, resumable purge**

- `purgeProjectPage`: one registry entry, one page, one transaction; write budget retries the same cursor
  [`projects.ts:1573`](../../../../convex/projects.ts#L1573)

- Continuations resolve the entry by table and field, so a registry change mid-purge cannot misroute a cursor
  [`projects.ts:1286`](../../../../convex/projects.ts#L1286)

- Children and blobs go before the parent row (`deleteStorageIfUnreferenced` after the row delete)
  [`projects.ts:1502`](../../../../convex/projects.ts#L1502)

**Late writers fenced**

- Candidate and section claims return without writing when the project is deleting
  [`generations.ts:1142`](../../../../convex/generations.ts#L1142)

- Post-QA: entry check in the action and the save mutation both consult the barrier
  [`generations.ts:2603`](../../../../convex/generations.ts#L2603)
  [`postQa.ts:32`](../../../../convex/ai/postQa.ts#L32)

**Peripherals**

- Schema widen: `deletionStartedAt`, `by_sourceProjectId`, twelve `by_projectId` indexes
  [`schema.ts:134`](../../../../convex/schema.ts#L134)

- Registry completeness walk, purge, pagination and barrier scenarios (15 tests)
  [`projectErasure.test.ts:113`](../../../../convex/projectErasure.test.ts#L113)

- Existing cleanup test: assertions moved after the scheduler drain (the only change)
  [`qaFindingsCleanup.test.ts:50`](../../../../convex/qaFindingsCleanup.test.ts#L50)

- Changelog draft
  [`2026-09-17-project-deletion.md`](../../../../docs/changelog/2026-09-17-project-deletion.md)
