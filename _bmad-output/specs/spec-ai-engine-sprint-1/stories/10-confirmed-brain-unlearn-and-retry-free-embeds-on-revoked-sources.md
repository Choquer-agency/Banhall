---
title: 'Confirmed Brain unlearn and retry-free embeds on revoked sources'
type: 'feature'
created: '2026-08-26'
status: 'ready-for-dev'
baseline_revision: '8813063e06dbcbc7f6c4f96fc0edce0e11f2cd77'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '{project-root}/_bmad-output/specs/spec-ai-engine-sprint-1/SPEC.md'
warnings:
  - oversized
deferred: []
---

<intent-contract>

## Intent

**Problem:** CAP-10. Revoking a Brain source is intent-only: `revokeSource` writes a `revoke` audit row and schedules the vector delete, but nothing records that the erasure actually happened, `ragEntryId` is never cleared (the admin row keeps showing "in brain"), and `embedSource` throws on a non-approved row so the workpool retries a revoked source up to 6 times (audit T6).

**Approach:** Make the unlearn action confirm its own work through a new internal mutation that clears `ragEntryId` and writes an `unlearn_confirmed` audit row (new action value); make `embedSource` return early with a warning when the source is no longer approved so the workpool marks the job complete instead of retrying.

## Boundaries & Constraints

**Always:**
- Schema change is additive: one new literal `unlearn_confirmed` in the `brainAuditLog.action` union; no new tables, fields, or indexes.
- The vector delete stays in the action (`brain.delete` needs `runAction`); the audit row and the `ragEntryId` patch happen in one internal mutation invoked by the action after the delete resolves, so a confirmed row is never written before the vector is gone.
- `unlearn_confirmed` is written only on the erasure paths (`revokeSource`, `removeSourcePermanently`), never by `requeueAllApprovedEmbeds`, whose unlearn is a re-embed step and not an erasure.
- The confirmation patch clears `ragEntryId` only when the row still exists and its `ragEntryId` equals the deleted entry id, so a re-ingest that landed a newer entry in between is not clobbered.
- `embedSource` returns (no throw) when `getBrainSourceForIngest` yields `null`; it logs `console.warn` so the skip is visible in logs. Throwing is what triggers workpool retries (`retryActionsByDefault: true`).
- Public `api.brain.*` paths and argument shapes are unchanged; `internal.brain.unlearnSource` gains only an optional `sourceId` arg.
- All `convex/` edits follow `convex/_generated/ai/guidelines.md` (validators on every function, `internal.*` references, no `ctx.db` in actions).

**Block If:**
- Confirming the unlearn would require changing how the RAG component stores or deletes entries.
- Any change would require an AI tool to write report prose.

**Never:**
- No Brain reconciliation cron, no retry of a failed `unlearnSource` action, no unlearning of knowledge already distilled into a published digest (audit "Later" items).
- No change to the `ingestOnComplete` late-completion fence in `convex/ai/brain/rag.ts:88-103`; it already discards vectors that land after a revoke.
- No revert support for `unlearn_confirmed` rows and no content scrubbing of revoked rows.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Revoke embedded source | admin calls `revokeSource` on an `approved` row with `ragEntryId: "e1"` | row `status: "revoked"`; `revoke` audit row; one pending `_scheduled_functions` job for `unlearnSource` whose args carry `ragEntryId: "e1"` and `sourceId` | No error expected |
| Revoke never-embedded source | admin calls `revokeSource` on a row with no `ragEntryId` | `revoke` audit row; no `unlearnSource` job scheduled; no `unlearn_confirmed` row (nothing to erase) | No error expected |
| Confirm unlearn | `confirmUnlearn({ sourceId, ragEntryId: "e1" })` on a revoked row whose `ragEntryId` is `"e1"` | `ragEntryId` is `undefined`; `brainAuditLog` gains `{ action: "unlearn_confirmed", sourceId, actorId: "system" }` with a reason naming `e1` | No error expected |
| Confirm after re-ingest | `confirmUnlearn({ sourceId, ragEntryId: "e1" })` but the row now has `ragEntryId: "e2"` | `ragEntryId` stays `"e2"`; `unlearn_confirmed` row still written for `e1` | No error expected |
| Confirm on deleted row | `confirmUnlearn` with a `sourceId` whose row was removed (`removeSourcePermanently` path) | no patch; `unlearn_confirmed` audit row written with that `sourceId` | No throw |
| Unlearn without sourceId | `unlearnSource({ ragEntryId })` from `requeueAllApprovedEmbeds` | vector delete only; no audit row, no patch | No error expected |
| Embed on revoked source | `embedSource({ sourceId })` for a `revoked` row | resolves `undefined`; no `brain.add`; no usage row; `console.warn` emitted once | No throw (workpool does not retry) |
| Embed on pending source | `embedSource({ sourceId })` for a `pending` row | same as revoked case | No throw |
| Embed on deleted source | `embedSource({ sourceId })` for a row deleted after enqueue | same as revoked case | No throw |

</intent-contract>

## Code Map

- `convex/schema.ts:1559-1567` -- `brainAuditLog.action` union (`ingest | approve | reject | revoke | reweight | revert`): add `v.literal("unlearn_confirmed")` with a comment that it is written by `confirmUnlearn` after the vector delete resolved.
- `convex/brain.ts:353-358` -- `unlearnSource` internalAction (`args: { ragEntryId }`; body is `brain.delete(ctx, { entryId })`). Add `sourceId: v.optional(v.id("brainSources"))`; after the delete, when `sourceId` is present, `await ctx.runMutation(internal.brain.confirmUnlearn, { sourceId, ragEntryId })`. Add the sibling `confirmUnlearn` internalMutation (`sourceId: v.id("brainSources")`, `ragEntryId: v.string()`) implementing the three "Confirm" matrix rows; `actorId: "system"` matches `ingestOnComplete` (`convex/ai/brain/rag.ts:79`). Guidelines `:96`: annotate the `runMutation` return type (`Promise<void>`) since it targets the same file.
- `convex/brain.ts:329-350` -- `revokeSource`: the `ctx.scheduler.runAfter(0, internal.brain.unlearnSource, ...)` call at `:345` gains `sourceId: args.sourceId`. Do not clear `ragEntryId` here; it clears on confirmation so `listBrainSources.hasEntry` (`:559`) reflects the vector's real state.
- `convex/brain.ts:245-261` -- `removeSourcePermanently`: pass `sourceId: args.sourceId` at `:255` so a hard delete of a previously-embedded row also leaves a confirmed-erasure record.
- `convex/brain.ts:267-286` -- `requeueAllApprovedEmbeds`: leave the `:277` call without `sourceId` (re-embed, not erasure).
- `convex/brain.ts:23-28` -- `embedPool` config: `retryActionsByDefault: true`, `maxAttempts: 6`. Read-only evidence that a thrown `embedSource` is retried and a returned one is not.
- `convex/brain.ts:289-306` -- `getBrainSourceForIngest`: already returns `null` for missing or non-approved rows. Read-only.
- `convex/ai/brain/ingest.ts:76-84` -- `embedSource`: replace `if (!src) throw new Error("brainSource not found for ingest")` with `console.warn("brain embed skipped: source missing or not approved", args.sourceId); return;`. Update the doc comment at `:70-74` to say revoked/pending rows are skipped without retry.
- `convex/ai/brain/rag.ts:66-116` -- `ingestOnComplete`: read-only. Its `source.status !== "approved"` branch is the late-completion fence; it stays as is.
- `src/routes/admin/brain/+page.svelte:17-24` -- `ACTION_LABEL` map used by the audit tab (`:183` falls back to the raw action string). Add `unlearn_confirmed: "Erasure confirmed"`. Not a caller change; no `api.*` usage changes.
- `src/lib/components/admin/SourceRow.svelte:86-89` -- renders `hasEntry` as "in brain" / "embedding..."; read-only, benefits from the cleared `ragEntryId`.
- `convex/brainFeedback.test.ts:1-91` -- convex-test precedent: `setup()` inserts `users` (`brain-admin` with `role: "admin"`), `allRows(t, "brainAuditLog")`, and `scheduledDistillations` reads `ctx.db.system.query("_scheduled_functions")` and filters on `job.name`. Reuse the same shapes (filter on `unlearnSource`, assert `job.args[0]`) in the new test file.
- `convex/brainFeedback.test.ts:93` onward -- existing `revokeSource` is untested; `brainSources` fixture fields per `convex/schema.ts:1461-1490` (`kind`, `status`, `title`, `industry`, `writerTier`, `docType`, `content`, `ragKey`, `sourceHash`, `createdBy`, `createdAt`).
- `convex/ai/providers.test.ts`, `convex/learning.test.ts` -- precedent that `"use node"` modules load under the `edge-runtime` vitest project; `t.action(internal.ai.brain.ingest.embedSource, ...)` runs without registering the `rag` component because the early return never touches `brain.add`. Do not register `components.rag` in tests; `confirmUnlearn` is exercised directly via `t.mutation(internal.brain.confirmUnlearn, ...)` and the action's delete path is verified by inspection.
- `convex/researchReviewMode.test.ts:1-28` -- component registration precedent; not needed here (documented so the implementer does not reach for it).

## Tasks & Acceptance

**Execution:**
- `convex/schema.ts` -- add `unlearn_confirmed` to the `brainAuditLog.action` union -- additive schema per constraints.
- `convex/brain.ts` -- add `confirmUnlearn` internalMutation; extend `unlearnSource` with optional `sourceId` and the post-delete `runMutation`; pass `sourceId` from `revokeSource` and `removeSourcePermanently` only -- confirmed erasure record.
- `convex/ai/brain/ingest.ts` -- `embedSource` warns and returns on a `null` source; update doc comment -- no workpool retries on revoked sources.
- `src/routes/admin/brain/+page.svelte` -- add the `unlearn_confirmed` label -- audit tab reads cleanly.
- `convex/brainUnlearn.test.ts` -- new convex-test file covering every I/O matrix row: `revokeSource` scheduling (with and without `ragEntryId`), the three `confirmUnlearn` rows, and `embedSource` on revoked, pending, and deleted rows (spy `console.warn` with `vi.spyOn`, assert no `aiUsage` and no `brainAuditLog` rows are added). Reuse the `setup()` / `allRows` / scheduled-jobs helpers from `brainFeedback.test.ts` by copying their shape.

**Acceptance Criteria:**
- Given an approved source whose vector was ingested (`ragEntryId` set), when an admin revokes it and the scheduled `unlearnSource` runs to completion, then `brainAuditLog` contains a `revoke` row followed by an `unlearn_confirmed` row for that `sourceId`, and `listBrainSources({ status: "revoked" })` reports `hasEntry: false` for it.
- Given a source revoked while its embed job is still queued in `embedPool`, when the job runs, then the action resolves without throwing on its first invocation, adds no vector, and logs no usage row, so the workpool marks the job complete instead of retrying.
- Given `requeueAllApprovedEmbeds` runs, when its unlearn actions complete, then no `unlearn_confirmed` rows are written.
- Given the full test suite, when `npm test` and `PUBLIC_CONVEX_URL=http://placeholder npm run check` run, then both pass.

## Spec Change Log

## Review Triage Log

## Design Notes

The confirmation lives in a mutation the action calls after `brain.delete` resolves, rather than in `revokeSource`, because only the action knows the delete succeeded; writing `unlearn_confirmed` in the governance mutation would restore the exact "intent-only" state the audit flagged. `sourceId` is optional on `unlearnSource` so the one non-erasure caller (`requeueAllApprovedEmbeds`) keeps the plain delete. The `ragEntryId` equality guard mirrors the transaction-ordering argument in `ingestOnComplete`: whichever of confirm or completion commits second sees the other's write and does the right thing. For `embedSource`, returning instead of throwing is the whole fix: the workpool treats a resolved action as done and a rejected one as retryable.

## Verification

**Commands:**
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test -- brainUnlearn` -- expected: all new cases pass.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test -- brainFeedback learning` -- expected: existing Brain suites unchanged and green.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test` -- expected: green.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && PUBLIC_CONVEX_URL=http://placeholder npm run check` -- expected: 0 errors.
