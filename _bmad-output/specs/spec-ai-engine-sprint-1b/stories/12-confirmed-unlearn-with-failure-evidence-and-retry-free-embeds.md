---
title: 'Confirmed unlearn with failure evidence and retry-free embeds'
type: 'feature'
created: '2026-09-02'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_revision: '3f73beab6de559c426201123e50c3023d81dfc56'
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '{project-root}/docs/product-domain.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The admin audit table has no ACTION_LABEL entry for the two new
      brainAuditLog actions, so they render as raw slugs.
    evidence: |-
      src/routes/admin/brain/+page.svelte:17-24 maps every other action to a
      human label and falls back to `?? a.action`; unlearn_confirmed /
      unlearn_failed therefore render unlabeled. The actor mapping at line 187
      also renders the "system" actor as "admin". Out of scope by the intent's
      Never clause ("No frontend change, no UI for unlearn evidence").
    location: >-
      src/routes/admin/brain/+page.svelte:17
    severity: medium
  - summary: >-
      An orphan erasure that keeps failing produces no audit evidence at all.
    evidence: |-
      ingestOnComplete's orphan branch schedules unlearnSource without a
      sourceId, and both bookkeeping mutations early-return in that case, so a
      capped-out orphan erasure is invisible. Mitigated at serve time by the
      new status join (a hit whose sourceId maps to no row is dropped).
      brainAuditLog.sourceId is optional, so a sourceId-less row is
      representable if evidence is later wanted.
    location: >-
      convex/brain.ts:449
    severity: low
  - summary: >-
      Repeated revokeSource clicks start concurrent, undeduplicated remediation
      ladders.
    evidence: |-
      The revoked early-return schedules a fresh unlearnSource with no attempt
      each time, so N clicks yield N ladders, N duplicate unlearn_failed rows
      and N concurrent deletes. Intended as the documented remediation restart,
      but there is no in-flight marker to make it idempotent.
    location: >-
      convex/brain.ts:357
    severity: low
  - summary: >-
      Failure evidence is dropped when the row already carries a newer
      ragEntryId.
    evidence: |-
      recordUnlearnFailure patches the id back only `if (!s.ragEntryId)` (as the
      spec task specifies). If a re-ingest wrote E2 while the compensation for
      E1 was failing, the un-erased E1 survives only in the unlearn_failed
      reason string, and re-revoke remediation then retries against E2.
    location: >-
      convex/brain.ts:479
    severity: low
  - summary: >-
      No unlearn_failed row is written if the source row is deleted or
      re-approved between the throw and the bookkeeping.
    evidence: |-
      recordUnlearnFailure's insert sits inside `if (s && s.status !==
      "approved")`, while the action still rethrows and still reschedules. The
      guard exists to avoid contradicting a re-approval, so the fix is a policy
      choice rather than a bug.
    location: >-
      convex/brain.ts:477
    severity: low
  - summary: >-
      A failure of the new governance join degrades retrieval to zero
      exemplars rather than erroring.
    evidence: |-
      dropNonServableCandidates runs inside searchBrainExemplars' outer
      try/catch, whose catch returns { exemplars: [], degraded: true }. This is
      the pre-existing degrade contract, but the join is a new failure source
      inside it and no test covers that path.
    location: >-
      convex/ai/brain/retrieve.ts:268
    severity: low
  - summary: >-
      docs/the-brain.md still describes unlearn as a plain vector delete, with
      no confirmed-erasure contract or the two new audit actions.
    evidence: |-
      docs/the-brain.md:11 and its status table at line 85 predate the
      confirmed-erasure contract. No changelog entry accompanies the governance
      behavior change. The intent neither requires nor forbids doc updates.
    location: >-
      docs/the-brain.md:11
    severity: low
---

<intent-contract>

## Intent

**Problem:** Revoking a Brain source is intent-only: `revokeSource` flips status, schedules a fire-and-forget `unlearnSource` that never confirms erasure, never clears `ragEntryId`, and writes no confirmation or failure evidence; `embedSource` throws on a non-approved source and the embed workpool then retries it up to six times; and the late-completion fence in `ingestOnComplete` discards a late entry with an unconfirmable `deleteAsync`.

**Approach:** Make erasure a confirmed operation with a single outcome contract (`confirmed` / `already_absent` / thrown failure), record `unlearn_confirmed` only on confirmation, keep `ragEntryId` as failure evidence with bounded deletion-only remediation, make `revokeSource` idempotent, make `embedSource` a silent no-op on any non-approved source, and route the late-completion fence through the same confirmed-erasure action.

## Boundaries & Constraints

**Always:**
- Erasure confirmation is a positive read, never an absence of throw: `brain.getEntry` returns `null` before deleting (already absent) or after `brain.delete` (confirmed). Anything else is a failure.
- `unlearn_confirmed` is written exactly once per erased entry and only after confirmation or already-absent.
- On failure: `ragEntryId` holds the un-erased remote id as evidence, the source stays non-approved, an `unlearn_failed` audit row is written, deletion-only remediation is scheduled (bounded), and the failure is rethrown from the action.
- No path re-approves a revoked source, writes `ragEntryId` for a non-approved source, or schedules an embed as remediation.
- `api.brain.revokeSource` stays a `mutation` with unchanged args (`src/lib/components/admin/SourceRow.svelte:50` uses `useMutation`). No frontend file is edited.
- Schema changes are additive only: `brainAuditLog.action` gains `unlearn_confirmed` and `unlearn_failed`. Nothing else.
- Convex edits follow `convex/_generated/ai/guidelines.md`.

**Block If:**
- The confirmed-erasure contract cannot be expressed without changing `@convex-dev/rag`'s API or its retry policy (SPEC non-goal).
- A new schema field turns out to be required beyond the two audit-action literals.

**Never:**
- No new `brainSources` evidence field: G-8 is resolved against `ragEntryId` (see Design Notes).
- No re-ingest, no RAG filter-value rewrite, no backfill of existing revoked rows. The only retrieval-side change is the served-result status join below; ranking, embeddings, and query construction are untouched.
- No change to `embedPool` retry configuration; `embedSource` stops throwing instead.
- No frontend change, no UI for unlearn evidence.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| (a) Revoke, live entry, erasure confirmed | `approved` source with `ragEntryId`; entry present then absent after delete | status `revoked`; exactly one `unlearn_confirmed` row; `ragEntryId` cleared | No error expected |
| (b) Revoke, already absent or never embedded | `approved` source whose entry reads `null`, or with no `ragEntryId` | Same as (a): one `unlearn_confirmed` row, no `ragEntryId` | No error expected |
| (c) Revoke, erasure fails | erase throws or entry still present after delete | no `unlearn_confirmed`; `ragEntryId` retained; one `unlearn_failed` row; source `revoked`; remediation scheduled | Action rejects (failure surfaced to its caller) |
| (d) Second revoke after (a) | source already `revoked`, no `ragEntryId` | Returns; no remote call; no second `unlearn_confirmed`; no second `revoke` row | No error expected |
| (e) `embedSource` on non-servable source | sourceId missing / `revoked` / `pending` | Resolves `undefined`; no `ragEntryId`; no throw so the workpool schedules no retry | No error expected |
| (f1) Late embed completes after revoke, compensation confirmed | `ingestOnComplete` with a `revoked` source row | no `ragEntryId` write; status unchanged; compensating erasure runs; one `unlearn_confirmed`; no embed scheduled | No error expected |
| (f2) Late embed completes after revoke, compensation fails | same, erase throws | no `unlearn_confirmed`; `ragEntryId` set to the orphaned id as evidence; status still `revoked`; `unlearn_failed` row; remediation scheduled; no embed scheduled | Action rejects |
| (g) Search while an orphaned or un-erased entry still exists remotely | `brain.search` returns a hit whose `metadata.sourceId` maps to a `brainSources` row that is not `approved` (or no longer exists) | The hit is dropped from the served results before they are returned; hits whose row is `approved`, and legacy hits with no `metadata.sourceId`, are served unchanged | No error expected |

</intent-contract>

## Code Map

- `convex/brain.ts:341-362` -- `revokeSource` mutation: patches status, inserts the `revoke` audit row, schedules `internal.brain.unlearnSource` only when `ragEntryId` is set. Add the already-revoked early return (before patch and audit insert), pass `sourceId` to the erasure action, and write `unlearn_confirmed` inline when the source never had a `ragEntryId`. Must stay a `mutation`.
- `convex/brain.ts:364-369` -- `unlearnSource` internalAction, currently `brain.delete(ctx, { entryId: args.ragEntryId as never })` with no confirmation. Becomes the single confirmed-erasure + bookkeeping action; args gain optional `sourceId` and `attempt`.
- `convex/brain.ts:257-271` (`removeSourcePermanently`) and `:279-295` (`requeueAllApprovedEmbeds`) -- existing `unlearnSource` callers that pass only `ragEntryId`. `sourceId` must stay optional so both keep working with no governance bookkeeping (the row is gone / the entry is about to be replaced).
- `convex/brain.ts:35-43` -- `scheduleEmbed` enqueues through `embedPool` (`:29-33`: `retryActionsByDefault: true`, `maxAttempts: 6`). This is why a throwing `embedSource` is a retry against a revoked source.
- `convex/brain.ts:587` -- `hasEntry: !!r.ragEntryId` in `listBrainSources`. The only reader of `ragEntryId` outside the unlearn paths.
- `src/lib/components/admin/SourceRow.svelte:50,84-91` -- read-only G-8 evidence: `useMutation(api.brain.revokeSource)` (so it stays a mutation) and the `hasEntry` badge renders **only** when `row.status === "approved"`, so a retained `ragEntryId` on a revoked row is never displayed as servable.
- `convex/ai/brain/rag.ts:66-113` -- `ingestOnComplete` (`brain.defineOnComplete`, an internalMutation). The `source.status !== "approved"` fence at `:93-104` and the orphan branch at `:70-76` both call `brain.deleteAsync` (workpool, unconfirmable). Replace both with `ctx.scheduler.runAfter(0, internal.brain.unlearnSource, ...)`; keep the existing `ingest` audit row on the fence branch; still never patch `ragEntryId`.
- `convex/ai/brain/ingest.ts:76-80` -- `embedSource`; `if (!src) throw new Error("brainSource not found for ingest")` is the retry trigger. `convex/brain.ts:299-318` (`getBrainSourceForIngest`) already returns `null` for missing **and** non-approved rows, so `return;` covers all three cases in (e).
- `convex/schema.ts:1560-1580` -- `brainAuditLog.action` union (`ingest`/`approve`/`reject`/`revoke`/`reweight`/`revert`), `actorId: v.string()` required, index `by_source`. `convex/schema.ts:1485` -- `brainSources.ragEntryId` optional string.
- `convex/ai/brain/retrieve.ts:219-228` -- served results are already joined to `metadata.sourceId`. Add the status join here: load each distinct `sourceId` once, drop hits whose row is missing or not `approved`, pass legacy hits with no `sourceId` through. This is what makes a revoked source non-servable immediately; deletion plus remediation then reconciles the remote index.
- `node_modules/@convex-dev/rag/src/client/index.ts:628-638,748-789` -- read-only G-8 evidence: `getEntry` returns `Entry | null`; `delete` in an action runs `entries.deleteSync`; `deleteAsync` is workpool-backed and returns before the entry is gone.
- `node_modules/@convex-dev/rag/src/component/entries.ts:326-336,491-530` -- read-only: `entries.get` returns `null` for a missing entry; `deleteAsync` **throws** `Entry <id> not found`; `deleteSync` ends in `_del` → `db.delete` on a possibly-missing doc. Hence the pre-check.
- `node_modules/@convex-dev/rag/src/shared.ts:67-77,193-198` -- read-only: `vOnCompleteArgs` = `{ namespace, entry, replacedEntry?, error? }`; `entryId` is a branded **string**, so tests can synthesize the payload with plain strings.
- `convex/generationEntryFailure.test.ts:10-17` -- the working `vi.mock` + `convexTest` pattern in this repo (module mock applies to the module the Convex function imports).
- `convex/brainFeedback.test.ts:14-55` -- reusable harness: `convexTest(schema, modules)`, admin/writer identities, `allRows(t, "brainAuditLog")`, and the `_scheduled_functions` query for asserting scheduled jobs.

## Tasks & Acceptance

**Execution:**
- `convex/schema.ts` -- add `v.literal("unlearn_confirmed")` and `v.literal("unlearn_failed")` to the `brainAuditLog.action` union -- no existing action records a confirmed or failed erasure (`revoke` is intent, `ingest` is ingestion), so both new literals are required; recorded as the G-8 choice.
- `convex/ai/brain/erase.ts` (new) -- export `type EraseOutcome = "confirmed" | "already_absent"` and `eraseBrainEntry(ctx: ActionCtx, entryId: string): Promise<EraseOutcome>`: `brain.getEntry` → `null` ⇒ `already_absent` (no delete call); else `brain.delete`, re-read, `null` ⇒ `confirmed`, still present ⇒ throw -- one seam that defines "confirmed" and "already absent" and that tests mock, keeping the RAG component out of `convex-test`. Must not be `"use node"`.
- `convex/brain.ts` -- rewrite `unlearnSource` as the single confirmed-erasure action (`{ ragEntryId, sourceId?, attempt? }`): call `eraseBrainEntry`; on `confirmed`/`already_absent` run an internal mutation that clears `ragEntryId` **only if it still equals the erased id** and inserts one `unlearn_confirmed` row (`actorId: "system"`); on throw run an internal mutation that sets `ragEntryId` to the erased id if unset, inserts one `unlearn_failed` row carrying the error and attempt, and schedules the next deletion-only remediation attempt while under the cap; then rethrow -- unifies revoke-time and late-embed compensation, since both reduce to "erase, then record" (see Design Notes).
- `convex/brain.ts` -- add the two internal mutations above (guarded on a still-existing, still-non-approved source row) and a named remediation cap/backoff constant -- bookkeeping must run in a transaction and must never resurrect a deleted or re-approved source.
- `convex/brain.ts` -- `revokeSource`: return early when `status === "revoked"` and there is no `ragEntryId` (idempotent); when already `revoked` **with** a `ragEntryId`, schedule remediation without a second `revoke` row; otherwise patch, insert `revoke`, then either schedule `unlearnSource` with `sourceId` or, when there is no `ragEntryId`, insert `unlearn_confirmed` inline -- (b) and (d) are unreachable while the mutation is unconditional.
- `convex/ai/brain/ingest.ts` -- `embedSource`: replace the `throw` with `return;` and a short comment naming the `embedPool` retry -- (e).
- `convex/ai/brain/rag.ts` -- `ingestOnComplete`: in both the orphan branch and the non-approved fence, replace `brain.deleteAsync` with `ctx.scheduler.runAfter(0, internal.brain.unlearnSource, { ragEntryId: entry.entryId, sourceId })` (`sourceId` omitted in the orphan branch); keep the existing `ingest` audit row; never patch `ragEntryId` -- (f).
- `convex/ai/brain/retrieve.ts` -- after the `byEntry` join, resolve the distinct `sourceId`s (one read each, bounded by the result count) and filter out hits whose source row is absent or not `approved`; leave hits without `sourceId` untouched; no change to query, filters, or ranking -- (g).
- `convex/brainUnlearn.test.ts` (new) -- one test per matrix row (a)–(g), mocking `./ai/brain/erase` per case; drive (f) by calling `internal.ai.brain.rag.ingestOnComplete` directly with a synthesized `vOnCompleteArgs` payload, then running the scheduled `unlearnSource` -- the matrix is the acceptance contract and `brainFeedback.test.ts` is a feedback-routing suite.

**Acceptance Criteria:**
- Given the two new audit literals, when `npm run check` runs, then the `brainAuditLog` union is the only schema change and no other table or field is touched.
- Given any erasure failure anywhere in the story, when the run settles, then no `unlearn_confirmed` row exists for that entry id and exactly one `unlearn_failed` row does.
- Given remediation is scheduled after a failure, when the scheduled job runs, then it is `unlearnSource` (deletion only) and never `embedSource`, and the number of remediation attempts is bounded by the named cap.
- Given `requeueAllApprovedEmbeds` or `removeSourcePermanently` calls `unlearnSource` without a `sourceId`, when erasure confirms, then no audit row is written and no `brainSources` row is patched.
- Given a search hit whose `metadata.sourceId` points at a `revoked` (or deleted) source row, when the served results are assembled, then that hit is absent while approved and legacy (no `sourceId`) hits are unaffected; verified with the RAG search seam mocked to return the hit.

## Spec Change Log

- 2026-09-02 plan checkpoint (Claude Fable 5.1, reviewer): approved with one widening amendment. The plan deferred the fact that an un-erased entry stays searchable until deletion succeeds; CAP-10 (c) and (f) require the source to be non-servable, and `retrieve.ts:219-228` already resolves `metadata.sourceId`, so the served-result status join is pulled into scope as matrix row (g). Deferred item removed accordingly. Erase seam, audit literals, idempotent revoke, no-throw `embedSource`, and the unified compensation path approved as planned. `brainAuditLog.reason` carries the failure error text; no new field.

## Review Triage Log

### 2026-09-02 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 3, low 5)
- defer: 7: (high 0, medium 1, low 6)
- reject: 9: (high 0, medium 3, low 6)
- addressed_findings:
  - `[medium]` `[patch]` Retry escalation was unverified — `attempt: args.attempt + 1` could be mutated to `args.attempt` (infinite retry loop) with the suite green. Test (c) now pins the rescheduled job's `attempt === 2` and its backoff delay against the exported `UNLEARN_RETRY_BASE_MS`.
  - `[medium]` `[patch]` The re-revoke remediation restart was unverified — test (d) ran after a *successful* erasure so the `if (s.ragEntryId)` reschedule never executed. New test (d') fails the erasure, re-revokes, and asserts fresh restart jobs plus exactly one `revoke` row.
  - `[medium]` `[patch]` `recordUnlearnConfirmed`'s anti-clobber guards were unverified. Two new tests cover a row holding a newer `ragEntryId` (not clobbered) and a row re-approved before confirmation lands (no audit row).
  - `[low]` `[patch]` Matrix row (e)'s "sourceId missing" case was uncovered; the test now drives a deleted source id alongside revoked and pending.
  - `[low]` `[patch]` `eraseBrainEntry` was mocked in every test, so dropping its post-delete confirmation read passed the suite. New `convex/brainErase.test.ts` stubs the `brain` component and covers absent / present-then-gone / present-then-still-present.
  - `[low]` `[patch]` The orphan branch of `ingestOnComplete` was never driven. New tests (f3) and (f3') cover the unmatched-`ragKey` schedule (no `sourceId`) and the `error` sub-case.
  - `[low]` `[patch]` Dead `const drain = unlearnDrain(t)` bindings removed from (c'), the no-`sourceId` test and (g); (e) now asserts an empty scheduler instead.
  - `[low]` `[patch]` `dropNonServableCandidates`' comment claimed "ranking, filters and query construction are untouched; this only removes hits", but running before `shouldRerankBrainCandidates` narrows the reranker's slate. Comment corrected; placement kept (spec-mandated).

## Design Notes

**G-8, resolved against the installed `@convex-dev/rag` 0.7.5.**
- *Confirmed* = `brain.getEntry(ctx, { entryId })` returns `null` **after** `brain.delete`. *Already absent* = it returns `null` **before**. The client's `delete`/`deleteAsync` return `void` and signal nothing, so the positive read is the only honest confirmation. The pre-check also avoids `deleteAsync`'s `Entry <id> not found` throw and `deleteSync`'s `_del` on a missing document, so "already absent" never masquerades as a failure.
- *Which deletion call compensation reuses:* the same `eraseBrainEntry` helper, i.e. `brain.delete` in an action. `ingestOnComplete` is a **mutation**, so it cannot confirm anything inline; it schedules the action. That is why compensation and revoke-time unlearn are one code path.
- *Is `ragEntryId` a usable evidence carrier?* Yes. Its only reader outside the unlearn paths is `hasEntry` (`convex/brain.ts:587`), rendered by `SourceRow.svelte:84-91` **only** for `status === "approved"` rows; retrieval (`convex/ai/brain/retrieve.ts`) never reads it, filtering instead on the RAG entry's own `industryApproved` filter. A revoked row with a retained id is therefore never read as servable, and a later `revokeSource` finds the id and retries erasure — the evidence doubles as the remediation handle. No additive `brainSources` field is needed.

**Why unlearn and late-embed compensation collapse into one action.** Revoke-time: `ragEntryId` is set, success clears it. Compensation: `ragEntryId` is unset, success leaves it unset. Expressed as *"on success clear `ragEntryId` iff it equals the erased id; on failure ensure it equals the erased id"*, both cases are the same two lines, and `unlearn_confirmed` is by construction gated on confirmation in both.

**Served-result status join (closes the residual window).** An orphaned entry carries `approved: true` in its own RAG filter value, so `brain.search` keeps matching it until deletion succeeds. Rather than accept that window, the served results are joined to `brainSources.status` at `retrieve.ts:219-228`, where `metadata.sourceId` is already resolved; non-approved or missing rows are dropped. Cost is one `db.get` per distinct source in the top-N, bounded by the existing result cap. Legacy entries without `metadata.sourceId` cannot be joined and are served as before; they predate revocation tracking and are outside CAP-10.

**`unlearn_confirmed` on confirmed compensation.** CAP-10(f) says the row is never written "until compensation is confirmed", so it *is* written once compensation confirms — the entry really was erased. (f1) asserts exactly one such row alongside the unchanged status and absent `ragEntryId`.

**Test seam.** `convex-test` has no registration for the `rag` component, and registering it would demand real embeddings. Mocking `./ai/brain/erase` (the `generationEntryFailure.test.ts` pattern) makes every branch deterministic. The cost is that `eraseBrainEntry`'s own getEntry/delete/getEntry sequence is only verified against a live deployment; it is deliberately three statements long with no branching beyond the two null checks.

## Verification

**Commands:**
- `PUBLIC_CONVEX_URL=placeholder npm run check` -- expected: no new type errors.
- `npx vitest run convex/brainUnlearn.test.ts` -- expected: eight tests green, one per matrix row (a)–(g).
- `npm test` -- expected: no regression against the `6be7b94` baseline; pre-existing failures recorded, not fixed.

**Manual checks (if no CLI):**
- `git diff --stat` shows no file under `src/` and no `convex/schema.ts` change beyond the two audit-action literals.

## Auto Run Result

Status: ready-for-dev
Blocking condition: none — planning complete, halted after planning as instructed.
Baseline revision: 6be7b9456fe0bb29e013d9236a02d5f24bc3551c (clean tree, branch `main`).
G-8 verified against `@convex-dev/rag` 0.7.5; no additive `brainSources` evidence field needed (`ragEntryId` is the carrier). `brainAuditLog.action` gains both `unlearn_confirmed` and `unlearn_failed`.

### 2026-09-02 implementation run

Status: done

**Implemented change.** Revoking a Brain source is now a confirmed erasure with a single outcome contract. `eraseBrainEntry` is the one seam that defines "erased": `brain.getEntry` returning `null` before the delete means `already_absent`, returning `null` after `brain.delete` means `confirmed`, anything else throws. `unlearnSource` wraps that seam and routes to two internal mutations — `recordUnlearnConfirmed` (clears `ragEntryId` only if it still equals the erased id, inserts exactly one `unlearn_confirmed` row) and `recordUnlearnFailure` (retains the un-erased id as evidence, inserts one `unlearn_failed` row, schedules the next deletion-only attempt under a cap of 5 with 60s exponential backoff) before rethrowing. `revokeSource` is idempotent, `embedSource` is a silent no-op on any non-servable source instead of feeding the `embedPool`'s six retries, both `ingestOnComplete` branches compensate through the same action rather than an unconfirmable `deleteAsync`, and retrieval joins each hit back to `brainSources.status` so an un-erased entry is never served.

**Files changed**
- [convex/schema.ts](../../../../convex/schema.ts) — `brainAuditLog.action` gains `unlearn_confirmed` and `unlearn_failed`; the only schema change.
- [convex/ai/brain/erase.ts](../../../../convex/ai/brain/erase.ts) (new) — the confirmed-erasure seam, `EraseOutcome` + `eraseBrainEntry`.
- [convex/brain.ts](../../../../convex/brain.ts) — idempotent `revokeSource`, rewritten `unlearnSource` action, the two bookkeeping mutations, the remediation cap/backoff constants, and `approvedBrainSourceIds` for the served-result status join.
- [convex/ai/brain/ingest.ts](../../../../convex/ai/brain/ingest.ts) — `embedSource` returns instead of throwing on a non-servable source.
- [convex/ai/brain/rag.ts](../../../../convex/ai/brain/rag.ts) — `ingestOnComplete`'s orphan branch and non-approved fence both schedule `unlearnSource`.
- [convex/ai/brain/retrieve.ts](../../../../convex/ai/brain/retrieve.ts) — `dropNonServableCandidates` joins the candidate slate back to governance.
- [convex/brainUnlearn.test.ts](../../../../convex/brainUnlearn.test.ts) (new) — 16 tests covering matrix rows (a)–(g) plus the remediation cap, restart, anti-clobber guards and orphan branch.
- [convex/brainErase.test.ts](../../../../convex/brainErase.test.ts) (new) — 3 tests pinning the erase seam against a stubbed `brain` component.

**Review findings.** 8 patches applied (3 medium, 5 low — all verification gaps except one comment correction), 7 items deferred (1 medium, 6 low), 9 rejected. No intent_gap, no bad_spec, no loopback.

**Follow-up review recommended: true.** Patched severities: 0 high, 3 medium, 5 low. Score = 3 × 3 + 1 × 5 = 14, at or above the threshold of 5.

**Verification.**
- `PUBLIC_CONVEX_URL=placeholder npm run check` — `COMPLETED 5865 FILES 0 ERRORS 0 WARNINGS`.
- `npx vitest run convex/brainUnlearn.test.ts convex/brainErase.test.ts` — 19/19 pass across 2 files.
- `npm test` — 1110/1110 pass across 115 files; no regression against the `6be7b94` baseline, and the previously flaky `formControlContract` timeout did not recur.
- Manual check: `git diff --stat` shows no file under `src/`, and the `convex/schema.ts` diff is the two audit-action literals plus a comment.
- Matrix audit: every matrix row (a)–(g), including (b), (c'), (f1) and (f2), is covered by a test that ran and passed. Each new invariant was additionally mutation-checked — inverting it produced a failing test.

**Residual risks.**
- `eraseBrainEntry` is now unit-tested against a stubbed `brain` component, but never against the live `@convex-dev/rag` deployment; if the component tombstones a deleted entry rather than removing it, `getEntry` would keep returning non-null and every erasure would enter a permanently failing 5-attempt ladder.
- The remediation ladder exhausts in about 15 minutes; a provider outage longer than that abandons the erasure until an admin re-revokes. The retained `ragEntryId` plus `unlearn_failed` rows are the only standing evidence, and nothing proactively surfaces a stuck erasure to an operator.
- The two new audit actions render as raw slugs in the admin table (deferred — the intent forbids frontend changes).
