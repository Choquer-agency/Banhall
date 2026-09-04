---
title: 'Shared pre-edit snapshot writer'
type: 'refactor'
created: '2026-09-04'
baseline_revision: '2460d6beb07e2cb8a2346a33d5df47e530225ef2'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/convex/_generated/ai/guidelines.md']
warnings: ['oversized']
deferred:
  - summary: >-
      writePreEditSnapshot copies a research session's evidenceSourceCount without
      checking the session belongs to this project or report.
    evidence: |-
      Every other foreign id on a reportSnapshots row is filtered through
      validGeneration/validTranscriptId/validTranscriptIds in convex/lib/snapshots.ts,
      which drop cross-project references. The research session id is passed straight
      to ctx.db.get and its count copied in. Pre-existing behaviour carried over
      verbatim from applyProposal, not introduced by this story, and not reachable
      today because the research layer only ever creates a session for the proposal's
      own report — but the helper is now the single choke point where a check belongs.
    location: >-
      convex/lib/snapshots.ts writePreEditSnapshot researchFields
    severity: low
---

<intent-contract>

## Intent

**Problem:** Three mutations hand-roll the same `reportSnapshots` insert before rewriting report prose (`applyProposal` and `markProposalApplied` in `convex/chatV2.ts` with reason `pre_chat_edit`, `acceptEdit` in `convex/comments.ts` with reason `pre_client_edit`). Sprint-1 retro finding A1: the shape is copied, so a future field (revision pinning, content hash policy) has to be applied in three places and can silently diverge.

**Approach:** Add `writePreEditSnapshot(ctx, report, reason, options?)` to `convex/lib/snapshots.ts`, next to the existing `snapshotAuditFields`/`pruneSnapshots` exports, and route all three sites through it. Behavior is byte-identical: same stored fields, same values, same ordering relative to the report patch and `pruneSnapshots`.

## Boundaries & Constraints

**Always:**
- Pure refactor. Every row `reportSnapshots` receives must be identical to today, field for field, at all three sites.
- The snapshot insert stays inside the same mutation transaction, after all validation/`domainError` throws and before the `ctx.db.patch(report._id, …)`, exactly where it sits now.
- The `createdAt` written must stay the same `now` value the caller uses for `updatedAt` on the report patch.
- The writer takes the reason as a parameter; the reason union is exactly `pre_chat_edit | pre_client_edit`.
- `convex/_generated/ai/guidelines.md` applies to all `convex/` edits.

**Block If:**
- Preserving identical stored rows at all three sites turns out to require diverging helper shapes (i.e. the helper cannot cover a site without a behavior change).

**Never:**
- Do not touch the other `reportSnapshots` inserts (`convex/snapshots.ts` `createSnapshot`/`createMilestoneSnapshot`/`restoreSnapshot`, `convex/generations.ts`) — different reasons, `createdByRole`, and dedupe rules.
- Do not change `convex/schema.ts`, any `api.*` argument shape, authorization, or the frontend.
- Do not modify `convex/chatProposals.test.ts` or `convex/comments.test.ts`; they must pass unchanged.
- No new snapshot reason, no new stored field, no dedupe added to the pre-edit path.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Chat proposal apply | `applyProposal` on a proposal with no `researchSessionId` | One row: `reason: "pre_chat_edit"`, `label: "Before AI edit"`, `createdByRole: "system"`, prior `report.content`, `sourceRevisionNumber` = prior revision, audit fields from `snapshotAuditFields`, no research fields | No error expected |
| Researched proposal apply | `applyProposal` on a proposal with `researchSessionId` | Same row plus `label: "Before researched edit"`, `researchSessionId`, and `researchSourceCount` = that session's `evidenceSourceCount ?? 0` | Missing session row -> `researchSourceCount: 0` |
| Stepped apply | `markProposalApplied` | One row: `reason: "pre_chat_edit"`, `label: "Before AI edit"`, no research fields | No error expected |
| Client suggestion accept | `comments.acceptEdit` | One row: `reason: "pre_client_edit"`, `label: "Before client edit"` | No error expected |
| Rejected apply | Replacement count 0/ambiguous, stale revision, or unauthorized | No snapshot row is written at all | Existing `domainError` throws before the writer is reached |

</intent-contract>

## Code Map

- `convex/lib/snapshots.ts` -- target for the new writer. Already exports `snapshotAuditFields` (rebuilds `contentHash`/provenance/generation/transcript lineage) and `pruneSnapshots`. Imports `MutationCtx`/`QueryCtx` types and `Doc`/`Id`; `Doc<"reports">` is the natural report parameter type.
- `convex/chatV2.ts:468-490` -- `applyProposal` site: computes `now`, `revisionNumber = report.revisionNumber ?? 0`, `auditFields`, then `researchSourceCount` via `ctx.db.get(proposal.researchSessionId)` -> `evidenceSourceCount ?? 0`; `insert("reportSnapshots", …)` at `:475`, conditional label at `:482`, conditional research spread at `:487-492`; then report patch and `pruneSnapshots`.
- `convex/chatV2.ts:585-596` -- `markProposalApplied` site: `now`, `auditFields`, `insert` at `:587` with fixed label `"Before AI edit"`, no research fields.
- `convex/comments.ts:180-196` -- `acceptEdit` site: `insert` at `:186` with inline `...(await snapshotAuditFields(ctx, report))`, `reason: "pre_client_edit"`, `label: "Before client edit"`. The comment block at `:180-185` explains the ordering guarantee and must survive.
- `convex/schema.ts:1229-1263` -- `reportSnapshots` table: the exact field set, including optional `researchSessionId`/`researchSourceCount`. Read-only.
- `convex/chatProposals.test.ts:177-262` and `convex/comments.test.ts:176-221` -- the behavioral fences; they assert `reason`, `label`, `createdByRole`, `content`, `sourceRevisionNumber`, `contentHash`, and snapshot counts. Read-only.
- `convex/snapshots.ts:188,243,286` and `convex/generations.ts:988,1042,2067` -- other `reportSnapshots` inserts. Out of scope; do not route them through the writer.

## Tasks & Acceptance

**Execution:**
- `convex/lib/snapshots.ts` -- add exported `PreEditSnapshotReason` (`"pre_chat_edit" | "pre_client_edit"`) and `async writePreEditSnapshot(ctx: MutationCtx, report: Doc<"reports">, reason: PreEditSnapshotReason, options?: { label?: string; createdAt?: number; researchSessionId?: Id<"researchSessions"> })` returning the new `Id<"reportSnapshots">`. It derives `projectId`/`reportId`/`content`/`sourceRevisionNumber` from `report`, calls `snapshotAuditFields`, defaults the label per reason (`pre_chat_edit` -> "Before AI edit", `pre_client_edit` -> "Before client edit"), sets `createdByRole: "system"` and `createdAt: options.createdAt ?? Date.now()`, and only when `researchSessionId` is given also writes `researchSessionId` plus `researchSourceCount` read from that session's `evidenceSourceCount ?? 0`. -- one place owns the pre-edit checkpoint shape.
- `convex/chatV2.ts` -- replace both inline inserts with `writePreEditSnapshot` calls: `applyProposal` passes `"pre_chat_edit"`, `createdAt: now`, and, when `proposal.researchSessionId` is set, that id plus `label: "Before researched edit"`; delete its now-dead `auditFields` and `researchSourceCount` locals. `markProposalApplied` passes `"pre_chat_edit"` and `createdAt: now` and drops its `auditFields` local. -- removes two copies of the shape.
- `convex/comments.ts` -- replace the inline insert in `acceptEdit` with `writePreEditSnapshot(ctx, report, "pre_client_edit", { createdAt: now })`, keeping the existing explanatory comment about transaction ordering. -- removes the third copy.
- `convex/snapshots.test.ts` -- add a focused case that the writer stores the research trail: with a `researchSessions` row carrying `evidenceSourceCount`, `writePreEditSnapshot` (exercised through `api.chatV2.applyProposal` on a researched proposal, or directly if that fixture is cheaper) yields `label: "Before researched edit"` and the matching `researchSourceCount`. -- the one branch the existing suites do not cover.

**Acceptance Criteria:**
- Given the untouched `chatProposals.test.ts` and `comments.test.ts` suites, when `npx vitest run convex/chatProposals.test.ts convex/comments.test.ts convex/snapshots.test.ts convex/reportAuthz.test.ts convex/reportEditAccess.test.ts` is run, then every test passes with no test file edited.
- Given the three call sites after the change, when `grep -n 'insert("reportSnapshots"' convex/chatV2.ts convex/comments.ts` is run, then it returns no matches.
- Given `convex/lib/snapshots.ts`, when it is read, then `writePreEditSnapshot` is exported and takes the reason as a parameter rather than branching on the call site.
- Given a full run of `npm test` and `npm run check`, when both complete, then both are green with no new type errors.

## Spec Change Log

- 2026-09-04 (review pass 2): the shipped writer signature deviates from the Tasks sketch on purpose. `options` is required with a required `createdAt` (so a caller cannot forget to thread the patch's `now`), and there is no `label` option: the label is derived inside the writer (per-reason default, or "Before researched edit" whenever `researchSessionId` is given), so the Design Notes call-site sketch that passes `label:` is superseded. Stored rows are unchanged at all three sites. Constraint: keep the label derivation inside the writer; do not reintroduce a caller-supplied label.

## Design Notes

`researchSourceCount` moves into the writer because it is purely derived from `researchSessionId` (`(await ctx.db.get(id))?.evidenceSourceCount ?? 0`, no cross-project check today); keeping the derivation with the fields it populates is what makes the call sites one line each. Shape:

```ts
await writePreEditSnapshot(ctx, report, "pre_chat_edit", {
  createdAt: now,
  ...(proposal.researchSessionId
    ? { researchSessionId: proposal.researchSessionId, label: "Before researched edit" }
    : {}),
});
```

`createdAt` is threaded rather than taken inside the writer so the snapshot and the report's `updatedAt` keep sharing one timestamp, as they do today.

## Verification

**Commands:**
- `npx vitest run convex/chatProposals.test.ts convex/comments.test.ts convex/snapshots.test.ts convex/reportAuthz.test.ts convex/reportEditAccess.test.ts` -- expected: all pass, no test file modified
- `npm test` -- expected: green
- `PUBLIC_CONVEX_URL=placeholder npm run check` -- expected: no new errors versus the pre-change baseline
- `grep -n 'insert("reportSnapshots"' convex/chatV2.ts convex/comments.ts` -- expected: no output

## Review Triage Log

### 2026-09-04 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 0
- reject: 17
- addressed_findings:
  - `[low]` `[patch]` `markProposalApplied` and `acceptEdit` had no fence that the checkpoint's `createdAt` equals the report's `updatedAt` (the protected suites never read `createdAt`) — added two end-to-end cases to `convex/preEditSnapshot.test.ts`; mutation-checked by stamping a drifted clock, which fails the new test.
  - `[low]` `[patch]` The matrix row "missing session row -> `researchSourceCount: 0`" was unpinned — added a direct writer case to `convex/snapshots.test.ts` that deletes the session before writing and asserts the researched label, the kept session id, and count 0.
  - `[low]` `[patch]` The shipped signature (required `createdAt`, no `label` option) deviated from the Tasks sketch with no record — added a Spec Change Log entry stating the deviation and the keep-constraint.

## Auto Run Result

Status: done
Blocking condition: none

**Implemented change.** Follow-up review pass on the completed refactor (the first pass scored 5, which triggered this re-review). The pre-edit `reportSnapshots` row shape stays owned by `writePreEditSnapshot` in `convex/lib/snapshots.ts`; the three sites (`applyProposal`, `markProposalApplied`, `comments.acceptEdit`) are unchanged from the first pass. This pass added test fences only.

**Files changed (this pass).**
- `convex/preEditSnapshot.test.ts` — fixture gains a stepped proposal and a client comment; two new end-to-end cases drive `markProposalApplied` and `acceptEdit` and assert `snapshot.createdAt === report.updatedAt` plus reason/label/content.
- `convex/snapshots.test.ts` — `setup` also returns `userId`; new direct writer case for a deleted research session (label kept, id kept, `researchSourceCount: 0`).
- this story file — Spec Change Log entry for the signature deviation; triage log; this result.

**Review findings.** 3 patches applied (all low), 0 deferred, 17 rejected. Rejections: the cross-project research-session check (already recorded as this spec's deferred item / DW-23, not duplicated); deleted-session fallback and `markProposalApplied` dropping the research trail (both spec-mandated pre-existing behaviour under the pure-refactor constraint); label strings mirrored in `VersionHistory.svelte` (frontend out of scope); `sourceRevisionNumber` derived in the helper (same expression on the same object); type-narrowing the options by reason, deriving the reason union from the schema, unused return value, fixture duplication, `firstName` vs `name` fixtures (style, several already rejected in pass 1); JSDoc/comment/doc wording in `chatV2.ts`, `comments.ts`, `docs/product-domain.md`, `docs/system-map.md` (they describe behaviour, which is unchanged, so they remain accurate); rejected-apply coverage (already fenced in the protected suites); the `oversized` warning (orchestrator metadata).

**Follow-up review recommended: false.** Patched by severity: high 0, medium 0, low 3. Score = 3x0 + 1x3 = 3, below the threshold of 5.

**Verification.**
- `npx vitest run convex/preEditSnapshot.test.ts convex/snapshots.test.ts convex/chatProposals.test.ts convex/comments.test.ts convex/reportAuthz.test.ts convex/reportEditAccess.test.ts` — 6 files, 45 tests, all pass.
- Mutation check: replacing `createdAt: now` with `Date.now() + 5` in `markProposalApplied` fails the new `preEditSnapshot.test.ts` case; source restored, `git diff convex/chatV2.ts` empty.
- `npm test` — 123 files, 1209 tests, all pass.
- `PUBLIC_CONVEX_URL=placeholder npm run check` — 0 errors, 0 warnings across 5873 files.
- `grep -n 'insert("reportSnapshots"' convex/chatV2.ts convex/comments.ts` — no matches.
- `convex/chatProposals.test.ts` and `convex/comments.test.ts` untouched (`git status`).

**Residual risks.**
- The research-session ownership check remains deferred (frontmatter `deferred`, ledger DW-23), unchanged by this pass.
- `_bmad-output/implementation-artifacts/deferred-work.md` was dirty in the worktree when this pass started (orchestrator-written DW-23); it is committed verbatim here so the tree finalizes clean, with no entry edited.
