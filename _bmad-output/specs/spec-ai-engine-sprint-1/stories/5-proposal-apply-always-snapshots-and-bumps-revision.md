---
title: 'Proposal apply always snapshots and bumps revision'
type: 'bugfix'
created: '2026-08-25'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '{project-root}/docs/svelte-migration.md'
warnings:
  - oversized
deferred: []
---

<intent-contract>

## Intent

**Problem:** `markProposalApplied` (`convex/chatV2.ts:426-434`) flips a `chatProposals` row to `applied` after the client-side one-by-one replace flow, with no revision fence, no snapshot, and no revision bump (audit CAP-2, P0). The applied mark is therefore unconnected to any report revision and can land on a stale or already-resolved proposal.

**Approach:** Keep `markProposalApplied` (decision recorded in Design Notes: routing the one-by-one flow through `applyProposal` per pair is a UX regression) and fence it: require `expectedRevisionNumber`, run the same state and access checks as `applyProposal`, write a `pre_chat_edit` snapshot, bump `revisionNumber`, mark applied, and return the new revision. The two page components flush their autosave before calling it and adopt the returned revision.

## Boundaries & Constraints

**Always:**
- Snapshot insert, report patch, and proposal patch happen in the one mutation; a throw anywhere leaves the proposal `pending` and writes no snapshot.
- Check order mirrors `applyProposal`: proposal `NOT_FOUND` → `references` kind `INVALID_INPUT` → `requireInternalProjectAccess(ctx, proposal.projectId)` → `applied` idempotent return → non-`pending` `INVALID_INPUT` → report `NOT_FOUND` (missing or `projectId` mismatch) → revision fence `STALE_REVISION`.
- Snapshot fields: `content: report.content`, `...snapshotAuditFields(ctx, report)`, `sourceRevisionNumber: report.revisionNumber ?? 0`, `reason: "pre_chat_edit"`, `label: "AI edit reviewed one by one"`, `createdByRole: "system"`, `createdAt: now`; then `pruneSnapshots(ctx, report._id)` after the patches.
- Report patch: `revisionNumber + 1`, `updatedAt: now`, `provenanceId: undefined`; `content` and `contentHash` untouched (the client already saved the text through `updateReportContent`).
- Return `{ applied: true, revisionNumber }` on success and `{ applied: true, alreadyApplied: true, revisionNumber }` on the idempotent path so the client can resync `localRevision`.
- Client one-by-one flow in both pages: `await flushEditor()` first, then run the mark inside `saveChain` (same `saveChain.then(fn, fn)` pattern as `handleEditorUpdate`) with `expectedRevisionNumber: localRevision`, and set `localRevision` from the result. Surface failures via `notifyReplace(userErrorMessage(err, ...))`; never swallow with `.catch(() => {})`.
- Public function names and paths unchanged; `api.chatV2.markProposalApplied` gains one required arg.

**Block If:**
- Any caller other than `CurrentProjectPage.svelte` and `PreviewProjectPage.svelte` invokes `markProposalApplied` (grep at task time; none exist at planning).
- The fence cannot be satisfied without changing `updateReportContent` or the editor autosave contract.

**Never:**
- Delete or rename `markProposalApplied`, or change `applyProposal` behaviour.
- Add scrub or uniqueness checks to `markProposalApplied` (audit mentions them; CAP-2 scope is snapshot + revision only).
- Move the replace step server-side or alter `ProposedEditCard.svelte` / `ProposalCard.svelte` (they only forward `onReviewReplacements`).
- Schema changes; `reportSnapshots.reason` already contains `pre_chat_edit`.
- Let the mutation write report `content` from client input.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | manager, `pending` edit proposal, report `revisionNumber` 7, `expectedRevisionNumber` 7 | `{ applied: true, revisionNumber: 8 }`; report rev 8, `provenanceId` cleared, `content`/`contentHash` unchanged; one `reportSnapshots` row (`pre_chat_edit`, `sourceRevisionNumber: 7`, label, audit tuple, `createdByRole: "system"`); proposal `applied` | No error expected |
| Stale revision | `expectedRevisionNumber` 6 against rev 7 | Proposal stays `pending`, no snapshot, report unchanged | `STALE_REVISION` |
| Already applied | proposal `state: "applied"` | `{ applied: true, alreadyApplied: true, revisionNumber: 7 }`; no new snapshot, no bump | No error expected |
| Rejected / stale proposal | `state: "rejected"` or `"stale"` | No writes | `INVALID_INPUT` |
| References proposal | `kind: "references"` | No writes | `INVALID_INPUT` |
| Missing proposal | unknown id | No writes | `NOT_FOUND` (was silent return) |
| Report mismatch | `proposal.reportId` points to another project's report or missing report | No writes | `NOT_FOUND` |
| Anonymous / no identity | no `users` row for identity | No writes | `NOT_AUTHENTICATED` via `requireInternalProjectAccess` |
| Client resync | mark succeeds, editor autosaves afterwards | Next `updateReportContent` uses `expectedRevisionNumber` 8 and succeeds | No error expected |

</intent-contract>

## Code Map

- `convex/chatV2.ts:426-434` -- `markProposalApplied`: the primary edit. Add `expectedRevisionNumber: v.number()` to args; rebuild the handler per Boundaries.
- `convex/chatV2.ts:297-424` -- `applyProposal`: the reference to mirror for check order (lines 300-322), `NOT_FOUND` report guard (`:319-322`), snapshot block (`:383-407`), report patch (`:408-414`), `state: "applied"` patch and `pruneSnapshots` (`:415-416`). Do not copy the scrub, `applyReplacements`, or `researchSessionId` branches.
- `convex/chatV2.ts:1-60` -- imports already present: `domainError`, `requireInternalProjectAccess`, `snapshotAuditFields`, `pruneSnapshots`; nothing new to import.
- `convex/reports.ts:42-71` -- `updateReportContent`: precedent for the `STALE_REVISION` fence message and the `revisionNumber + 1` return.
- `convex/lib/snapshots.ts:51-129,191-204` -- `snapshotAuditFields`, `pruneSnapshots`; read-only.
- `convex/schema.ts:1164-1195` -- `reportSnapshots`: `reason` union has `pre_chat_edit`; `label` optional; `createdByRole` is `writer | system`. No change.
- `src/lib/components/project/PreviewProjectPage.svelte:150,328-330,372,405,635-670` -- `markProposalApplied` mutation handle, `markApplied(id)`, its two call sites (`advanceReplace` end, `replaceAllRemaining`), `handleEditorUpdate`/`saveChain`/`localRevision`, `flushEditor()`. Rewrite `markApplied` to be async: flush, then chain the fenced mark.
- `src/lib/components/project/CurrentProjectPage.svelte:114,228-230,272,305,147-149,462-493` -- identical flow; apply the same rewrite (the replace-session block is byte-identical between the pages at planning time).
- `src/lib/components/project/PreviewProjectPage.svelte:313-320` -- `ReplaceSession.messageId` comment says "chatMessages id (legacy chat) or chatProposals id"; only `AgentChatPanel` → `ProposalCard` wires `onReviewReplacements`, so the id is always a `chatProposals` id. Update the comment.
- `src/lib/components/chat/ProposalCard.svelte:79-81` -- forwards `onReviewReplacements(pairs, proposal._id)`; read-only.
- `tests/chatProposals.test.ts:1-120,270-330,340-470,472-501` -- bun harness: `RegisteredHandler` cast of `_handler`, `createFixture(role)` (pinned report rev 7, pending edit proposal, `db.tables.reportSnapshots`), `applyAndAssert` assertions to mirror. Add a `markProposalApplied` registration next to `v2ApplyRegistration` and a new `describe("proposal mark-applied fence")`.
- `tests/chatProposals.test.ts:631-756` -- `proposal apply integrity` block: assertion idioms for `STALE_REVISION` (`rejects.toMatchObject({ data: { code } })`), idempotency, and anonymous rejection to reuse.
- `convex/reportAuthz.test.ts:219-265` -- convex-test precedent for `applyProposal` access cases (needs `agentTest.register`); only if the bun harness cannot express a case.

## Tasks & Acceptance

**Execution:**
- `convex/chatV2.ts` -- fence `markProposalApplied` (`expectedRevisionNumber`, applyProposal-ordered checks, `pre_chat_edit` snapshot, revision bump, `pruneSnapshots`, typed return) -- closes CAP-2 on the server surface.
- `tests/chatProposals.test.ts` -- register the handler, add `proposal mark-applied fence` cases covering every matrix row (happy path asserts the full snapshot tuple and that `content`/`contentHash` are unchanged) -- deterministic proof for the success signal.
- `src/lib/components/project/PreviewProjectPage.svelte` -- async `markApplied`: `await flushEditor()`, chain the mark through `saveChain`, resync `localRevision`, report errors with `notifyReplace`; update both call sites to `void markApplied(...)` with the error path handled inside; fix the `messageId` comment -- keeps autosave and the fence consistent.
- `src/lib/components/project/CurrentProjectPage.svelte` -- same change as above -- the two pages share the flow.

**Acceptance Criteria:**
- Given a pending edit proposal and a report at revision N, when `markProposalApplied({ proposalId, expectedRevisionNumber: N })` runs, then one `pre_chat_edit` snapshot with `sourceRevisionNumber: N` exists, the report is at N+1 with identical `content`, and the proposal is `applied`.
- Given the same proposal with `expectedRevisionNumber: N-1`, when the mutation runs, then it throws `STALE_REVISION`, no snapshot is written, and the proposal stays `pending`.
- Given a writer finishes a one-by-one review with at least one replacement, when the session ends, then the page flushes pending autosaves before marking, adopts the returned revision, and a following autosave succeeds without `STALE_REVISION`.
- Given a one-by-one review where every instance is kept, when the session ends, then no mark call is made (existing `replaced > 0` gate preserved).
- Given `npm test` and `npm run check`, when run, then both are green.

## Spec Change Log

## Review Triage Log

## Design Notes

**Choice: fence, not delete.** `applyProposal` replaces every occurrence of each `find` server-side. The one-by-one flow exists so the writer can accept or keep each instance individually (`replaceAndNext` / `keepOriginalAndNext` in the page components); per-pair `applyProposal` cannot express "keep instance 2, replace instance 3". `ProposalCard.svelte` only forwards `onReviewReplacements`, so nothing there can absorb the difference. Deleting `markProposalApplied` would therefore regress UX; the SPEC's open question is resolved as fence.

**Snapshot semantics.** The editor autosaves on a 1 s debounce, so by the time the session ends the server content already carries the accepted replacements. The session-start `createManualSnapshot({ reason: "manual" })` remains the writer's pre-review restore point; the fenced mutation's `pre_chat_edit` row is the audit checkpoint tying the applied proposal to the revision it bumped (`sourceRevisionNumber` = flushed revision), hence the label "AI edit reviewed one by one" rather than "Before AI edit". The bump with unchanged content is deliberate: it invalidates any concurrent editor tab that still holds the older revision and clears `provenanceId`, matching what `updateReportContent` does for a writer edit.

**Client shape** (both pages):

```ts
async function markApplied(id: string) {
  await flushEditor();
  const mark = async () => {
    const result = await markProposalApplied({
      proposalId: id as Id<"chatProposals">,
      expectedRevisionNumber: localRevision,
    });
    localRevision = result.revisionNumber;
  };
  saveChain = saveChain.then(mark, mark);
  try { await saveChain; } catch (err) {
    notifyReplace(userErrorMessage(err, "The suggestion could not be marked applied."));
  }
}
```

## Verification

**Commands:**
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test -- chatProposals` -- expected: existing apply-integrity cases and the new mark-applied fence cases pass.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test` -- expected: green.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && PUBLIC_CONVEX_URL=http://placeholder npm run check` -- expected: 0 errors (catches the new required arg at both call sites).
