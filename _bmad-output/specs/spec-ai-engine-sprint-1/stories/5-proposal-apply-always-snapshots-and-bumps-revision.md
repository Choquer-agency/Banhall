---
title: 'Proposal apply always snapshots and bumps revision'
type: 'bugfix'
created: '2026-08-25'
status: done
baseline_revision: '4e6afe2bb94e13970fa645f0ff3ef798204dcd6a'
review_loop_iteration: 1
followup_review_recommended: true
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '{project-root}/docs/svelte-migration.md'
warnings:
  - oversized
deferred:
  - summary: >-
      tests/chatProposals.test.ts (bun-only harness) has 10 pre-existing failures on the baseline and is not run by npm test or CI.
    evidence: |-
      Verification-gap reviewer ran `bun test tests/chatProposals.test.ts` on the base commit
      4e6afe2b with the story diff stashed: 10 cases in `proposal creation integrity` and
      `proposal apply integrity` fail. vitest.config.ts has no project including tests/**,
      and no package.json script or workflow invokes bun test, so the file is inert as a signal.
    location: >-
      tests/chatProposals.test.ts
    severity: medium
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
- `convex/reportAuthz.test.ts:1-120,219-265` -- **the test model for this story.** convex-test + vitest, `agentTest.register(t)` (chatV2 imports `@convex-dev/agent`), `setup()` seeding writer/manager/anonymous/roleless users, a project, a report at `revisionNumber: 3`, and a pending edit `chatProposals` row; `asActor`, `getReport`, `getProposal`, `errorCode` helpers. Copy these helpers into the new test file (do not import across test files).
- `convex/commentsAcceptEdit.test.ts` -- convex-test precedent that asserts on real `reportSnapshots` rows written through `snapshotAuditFields`/`pruneSnapshots` and on `revisionNumber` bumps.
- `convex/chatV2.markProposalApplied.test.ts` -- **new file, vitest `convex` project (`convex/**/*.test.ts`).** Home for every I/O matrix row plus role denial and the `updateReportContent` resync row.
- `tests/chatProposals.test.ts` -- **do not touch.** It is a bun-only harness (`bun:test` import) that `npm test`/CI never executes (vitest.config.ts has no `tests/**` project) and it already has 10 pre-existing failures on the baseline; anything added there is inert.
- `src/lib/components/project/fencedProposalMark.ts` -- **new module** holding the shared client sequencing (`runFencedProposalMark`, see Design Notes), imported by both pages; unit-tested in `src/lib/components/project/fencedProposalMark.test.ts` (vitest `src` project, node environment, no DOM).

## Tasks & Acceptance

**Execution:**
- `convex/chatV2.ts` -- fence `markProposalApplied` (`expectedRevisionNumber`, applyProposal-ordered checks, `pre_chat_edit` snapshot, revision bump, `pruneSnapshots`, typed return) -- closes CAP-2 on the server surface.
- `convex/chatV2.markProposalApplied.test.ts` -- new convex-test file (model: `convex/reportAuthz.test.ts`) covering every I/O matrix row through `api.chatV2.markProposalApplied`: happy path asserts the full snapshot tuple (`reason`, `label`, `sourceRevisionNumber`, `createdByRole`, audit fields) and that `content`/`contentHash` are byte-identical; stale revision; already-applied idempotent shape; rejected and stale proposals; references kind; missing proposal; deleted report and report whose `projectId` belongs to another project; anonymous and role-less users (`NOT_AUTHORIZED`, proposal stays `pending`, no snapshot). The "Client resync" row must actually call `api.reports.updateReportContent` with the returned revision and assert success, and with the old revision and assert `STALE_REVISION`. Assert the snapshot count after the mark (exactly one new row) -- deterministic proof for the success signal, executed by `npm test`.
- `src/lib/components/project/fencedProposalMark.ts` -- new shared helper `runFencedProposalMark` implementing the client sequencing from Design Notes (flush, then mark inside the chain, then adopt the returned revision); both pages call it so the fence logic cannot drift.
- `src/lib/components/project/fencedProposalMark.test.ts` -- vitest unit test (node, fake deps): asserts (i) `flushEditor` resolves before `mark` is invoked, (ii) `mark` receives the post-flush revision, (iii) `setRevision` is called with the returned revision, (iv) a rejected prior chain still runs the mark (`then(fn, fn)`), (v) a flush failure short-circuits and reports through `onError` without calling `mark`, (vi) a mark rejection reports through `onError`.
- `src/lib/components/project/PreviewProjectPage.svelte` -- `markApplied` delegates to `runFencedProposalMark`; update both call sites to `void markApplied(...)` with the error path handled inside; fix the `messageId` comment and tighten `ReplaceSession.messageId` to `Id<"chatProposals">` (drop the `as` cast) -- keeps autosave and the fence consistent.
- `src/lib/components/project/CurrentProjectPage.svelte` -- same change as above -- the two pages share the flow.
- `convex/chatV2.ts` JSDoc on `markProposalApplied` -- document the fence contract: required `expectedRevisionNumber`, the content-free revision bump and why (invalidate concurrent tabs, clear `provenanceId`), and both return shapes.

**Acceptance Criteria:**
- Given a pending edit proposal and a report at revision N, when `markProposalApplied({ proposalId, expectedRevisionNumber: N })` runs, then one `pre_chat_edit` snapshot with `sourceRevisionNumber: N` exists, the report is at N+1 with identical `content`, and the proposal is `applied`.
- Given the same proposal with `expectedRevisionNumber: N-1`, when the mutation runs, then it throws `STALE_REVISION`, no snapshot is written, and the proposal stays `pending`.
- Given a writer finishes a one-by-one review with at least one replacement, when the session ends, then the page flushes pending autosaves before marking, adopts the returned revision, and a following autosave succeeds without `STALE_REVISION`.
- Given a one-by-one review where every instance is kept, when the session ends, then no mark call is made (existing `replaced > 0` gate preserved).
- Given `npm test -- chatV2.markProposalApplied`, when run, then vitest lists and executes the new file (non-zero test count) and every matrix row passes.
- Given `npm test -- fencedProposalMark`, when run, then the client sequencing cases pass.
- Given `npm test` and `npm run check`, when run, then both are green.

## Spec Change Log

### 2026-08-25 — Review loop 1: tests were placed on a harness that `npm test` never runs
- **Triggering findings:** verification-gap "The new `markProposalApplied` tests live in a file that `npm test` (CI) never runs" (`tests/chatProposals.test.ts` imports `bun:test`; vitest.config.ts includes only `convex/**`, `shared/**`, `src/**`; `npx vitest list | grep chatProposals` returns 0; the file also has 10 pre-existing failures on the baseline). Also verification-gap / intent-alignment "client flush-then-mark sequence and revision resync are unverified" (Acceptance Criterion 3 had no task producing evidence), and blind-hunter "markApplied duplicated verbatim between the two pages".
- **Root cause (outside `<intent-contract>`):** Code Map and Tasks directed the tests into the bun-only harness and the Verification command `npm test -- chatProposals` matched no vitest file, so it was vacuously green. No task existed for the client sequencing AC.
- **Amended:** Code Map (test model is now `convex/reportAuthz.test.ts`; `tests/chatProposals.test.ts` marked do-not-touch; new `fencedProposalMark.ts` module), Tasks (new `convex/chatV2.markProposalApplied.test.ts`, shared helper + unit test, JSDoc, `messageId` typing), Acceptance Criteria (vitest must list and execute the new files), Design Notes (client shape extracted to a helper; test placement rule), Verification (commands target the new files and include `npx vitest list`).
- **Known-bad state avoided:** shipping the CAP-2 fence with tests that look like coverage but are inert in CI; a "Client resync" test that never calls `updateReportContent`; two byte-identical copies of the fence logic in the pages.
- **KEEP (must survive re-derivation):**
  - The `convex/chatV2.ts` `markProposalApplied` handler from the reverted attempt was a line-for-line realisation of the intent contract (check order, snapshot tuple, content-free report patch, proposal patch, `pruneSnapshots`, both return shapes, `as const` literals). Re-derive it identically; only add the JSDoc.
  - The stale-proposal `INVALID_INPUT` message distinguished `stale` ("This suggestion no longer matches the current report. Ask the assistant to regenerate it.") from other non-pending states ("This suggestion is no longer available to apply."); keep that.
  - The `// CAP-2:` comment explaining that content is never written from client input; keep it.
  - Both page call sites became `void markApplied(sess.messageId)` with the error path inside `markApplied`; keep that.
  - `applyProposal`, `updateReportContent`, the editor autosave contract, `ProposedEditCard.svelte`, `ProposalCard.svelte`, and the schema were untouched; keep them untouched.

## Review Triage Log

### 2026-08-25 — Review pass
- intent_gap: 0
- bad_spec: 3: (high 1, medium 2, low 0)
- patch: 3: (high 0, medium 0, low 3)
- defer: 1: (high 0, medium 1, low 0)
- reject: 17
- addressed_findings:
  - `[high]` `[bad_spec]` New mark-applied fence tests were written into the bun-only `tests/chatProposals.test.ts`, which `npm test`/CI never executes and which already fails on the baseline; spec Code Map/Tasks/Verification pointed there. Amended the spec to place the tests in `convex/chatV2.markProposalApplied.test.ts` (convex-test, vitest `convex` project) with an `npx vitest list` gate; code reverted for re-derivation.
  - `[medium]` `[bad_spec]` Client flush-then-mark sequencing and `localRevision` adoption (AC 3) had no task producing test evidence, and the "returned revision fences the next client save" test never called `updateReportContent`. Amended Tasks/Design Notes to extract `runFencedProposalMark` into `src/lib/components/project/fencedProposalMark.ts` with a node unit test, and to require the resync case to exercise `api.reports.updateReportContent`.
  - `[medium]` `[bad_spec]` `markApplied`, `ReplaceSession`, and the comment edits were duplicated verbatim across `CurrentProjectPage.svelte` and `PreviewProjectPage.svelte` so the fence logic could drift; the spec prescribed the duplicate. Folded into the shared-helper amendment above.
  - Patch findings carried into the amended Tasks (moot this pass, code re-derived): `[low]` JSDoc on `markProposalApplied` must document the fence contract; `[low]` `ReplaceSession.messageId` typed `string` with an `as Id<"chatProposals">` cast; `[low]` mark-applied test file lacked role-denial and snapshot-count assertions.
- rejected (intent authority or false on inspection): snapshot reason/label semantics, "empty" revision bump, missing research provenance, `applied` early return before report validation, `then(mark, mark)` after a rejected save, `replaced === 0` leaves proposal pending (all mandated by the intent contract); "localRevision never resynced" and "alreadyApplied adopts a foreign revision" (the existing `$effect` resyncs `localRevision` from the live report whenever `pendingSaves === 0`, so behaviour matches the pre-existing autosave design); non-integer `expectedRevisionNumber` validation (matches `updateReportContent` precedent); error-copy specialisation, `pendingSaves` bump during mark, unmounted-component guard, `docs/product-domain.md` update, atomicity of mid-write throws (Convex mutations are transactional); user re-pressing Apply after a stale mark (server `applyProposal` marks the proposal stale when the find strings are gone; no double replace).

### 2026-08-25 — Review pass (loop 2)
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 2, low 5)
- defer: 0
- reject: 23
- addressed_findings:
  - `[medium]` `[patch]` `runFencedProposalMark` installed the raw mark promise as `saveChain`; a rejected mark (STALE_REVISION) left the chain rejected so `flushEditor()` (bare `await saveChain`, used by `onBeforeApply` and `beforeSnapshot`) rethrew the stale mark error until the next autosave. The helper now installs `chain.then(noop, noop)` while still awaiting the raw chain for `onError`; added test "a rejected mark leaves a settled chain"; Design Notes snippet updated to match.
  - `[medium]` `[patch]` The `provenanceId` cleared assertion ran on a fixture that never had provenance (vacuous). Added `seedProvenance()` inserting a real approved `reportProvenance` row: happy path asserts it is cleared on the report and recorded on the snapshot; stale-revision and already-applied cases assert it is preserved.
  - `[low]` `[patch]` `pruneSnapshots` after the mark was unobservable. Added a test seeding 55 fresh `manual` snapshots and asserting the stream is trimmed to the 50 cap with the mark's `pre_chat_edit` row retained and the oldest checkpoints dropped.
  - `[low]` `[patch]` JSDoc said the fence always throws STALE_REVISION but the idempotent already-applied path skips it; documented the exception explicitly.
  - `[low]` `[patch]` JSDoc did not say that the scrub and unique-target checks remain out of scope for the mark path; added the note.
  - `[low]` `[patch]` Helper doc comment implied the flush result is the fence; clarified that `getRevision()` is re-read inside the chained callback and added a test where an autosave is queued after the flush and before the mark (mark fences on the autosave's revision).
  - `[low]` `[patch]` Happy-path test now asserts `updatedAt` moved with the bump.
- rejected (intent authority or false on inspection): check order NOT_FOUND/INVALID_INPUT before access, already-applied return before report validation (both mandated by the contract's check order; loop-1 rejection stands), snapshot reason/label semantics, redundant `provenanceId`/`updatedAt` patch, `researchSessionId` fields omitted from the snapshot (contract's snapshot tuple is exhaustive), client retry on STALE_REVISION / bespoke `saveError` message (contract prescribes `notifyReplace(userErrorMessage(...))`; `$effect` resync is the recovery path), `replaced > 0` partial-apply gate (preserved by contract), `returns` validator (guidelines do not require it; `applyProposal` precedent has none), `Promise<unknown>` deps type (cosmetic; spec-prescribed), relocating the `as Id<"chatProposals">` cast into `AgentChatPanel`/`ProposalCard` prop types (`ProposalCard` is contract-frozen; cast is documented), page-level component test of the wiring (spec loop-1 amendment deliberately placed evidence at the helper + server resync surfaces; recorded as residual risk), legacy `revisionNumber` undefined with expected 0 (matches `updateReportContent`), autosave capturing `localRevision` at enqueue time (false: `save` reads it inside the chained callback), mark returning 0 regressing the local revision (only reachable on already-applied + deleted report; `$effect` resyncs), legacy `chatMessages` id callers (grep: none), removed silent no-op return (grep: only the two pages call it), `docs/product-domain.md` update, concurrent double-mark (Convex transactions serialise; second sees `applied`), `client_review` share-token actor (unchanged access helper), `pruneSnapshots` collapsing the fresh snapshot (false: sub-hour snapshots are unique buckets; now also covered by the prune test).

## Design Notes

**Choice: fence, not delete.** `applyProposal` replaces every occurrence of each `find` server-side. The one-by-one flow exists so the writer can accept or keep each instance individually (`replaceAndNext` / `keepOriginalAndNext` in the page components); per-pair `applyProposal` cannot express "keep instance 2, replace instance 3". `ProposalCard.svelte` only forwards `onReviewReplacements`, so nothing there can absorb the difference. Deleting `markProposalApplied` would therefore regress UX; the SPEC's open question is resolved as fence.

**Snapshot semantics.** The editor autosaves on a 1 s debounce, so by the time the session ends the server content already carries the accepted replacements. The session-start `createManualSnapshot({ reason: "manual" })` remains the writer's pre-review restore point; the fenced mutation's `pre_chat_edit` row is the audit checkpoint tying the applied proposal to the revision it bumped (`sourceRevisionNumber` = flushed revision), hence the label "AI edit reviewed one by one" rather than "Before AI edit". The bump with unchanged content is deliberate: it invalidates any concurrent editor tab that still holds the older revision and clears `provenanceId`, matching what `updateReportContent` does for a writer edit.

**Client shape.** The sequencing lives once in `src/lib/components/project/fencedProposalMark.ts` so it is unit-testable without mounting a page and cannot drift between the two components:

```ts
export type FencedMarkDeps = {
  flushEditor: () => Promise<unknown>;
  getChain: () => Promise<unknown>;
  setChain: (chain: Promise<unknown>) => void;
  getRevision: () => number;
  setRevision: (rev: number) => void;
  mark: (expectedRevisionNumber: number) => Promise<{ revisionNumber: number }>;
  onError: (err: unknown) => void;
};

export async function runFencedProposalMark(deps: FencedMarkDeps): Promise<void> {
  try {
    await deps.flushEditor();
  } catch (err) {
    deps.onError(err);
    return;
  }
  const mark = async () => {
    const result = await deps.mark(deps.getRevision());
    deps.setRevision(result.revisionNumber);
  };
  const chain = deps.getChain().then(mark, mark);
  // Install the settled form: flushEditor() awaits saveChain bare, so a
  // rejected mark must not poison later apply/snapshot flushes.
  deps.setChain(chain.then(noop, noop));
  try {
    await chain;
  } catch (err) {
    deps.onError(err);
  }
}
```

Each page wires it as:

```ts
function markApplied(id: Id<"chatProposals">) {
  return runFencedProposalMark({
    flushEditor,
    getChain: () => saveChain,
    setChain: (c) => (saveChain = c),
    getRevision: () => localRevision,
    setRevision: (r) => (localRevision = r),
    mark: (expectedRevisionNumber) => markProposalApplied({ proposalId: id, expectedRevisionNumber }),
    onError: (err) => notifyReplace(userErrorMessage(err, "The suggestion could not be marked applied.")),
  });
}
```

`saveChain`/`localRevision` remain page-local `$state`; the helper only reads and writes them through the closures, so Svelte reactivity is unaffected. The page-level `$effect` that resyncs `localRevision` from the live `report` query when `pendingSaves === 0` is the existing recovery path after a failed mark; no additional resync is required.

**Test placement.** Server behaviour is proven with convex-test under the vitest `convex` project (`convex/chatV2.markProposalApplied.test.ts`), which `npm test` and CI actually run. The bun-only `tests/chatProposals.test.ts` is not a valid verification surface for this story.

## Verification

**Commands:**
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npx vitest list chatV2.markProposalApplied fencedProposalMark` -- expected: both new files are listed with their cases (proves the tests are on the executed path).
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test -- chatV2.markProposalApplied` -- expected: every matrix row, role denial, and the `updateReportContent` resync case pass.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test -- fencedProposalMark` -- expected: client sequencing cases pass.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test` -- expected: green.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && PUBLIC_CONVEX_URL=http://placeholder npm run check` -- expected: 0 errors (catches the new required arg at both call sites).

## Auto Run Result

**Summary:** `markProposalApplied` is fenced on `expectedRevisionNumber`, mirrors `applyProposal`'s check order, writes a `pre_chat_edit` snapshot ("AI edit reviewed one by one"), bumps `revisionNumber` without touching content, clears `provenanceId`, marks the proposal `applied`, prunes snapshots, and returns the new revision (or the idempotent already-applied shape). Both project pages route the one-by-one flow through the shared `runFencedProposalMark` helper: flush autosave, mark inside `saveChain` with the current `localRevision`, adopt the returned revision, surface errors via `notifyReplace`.

**Files changed:**
- `convex/chatV2.ts` -- fenced `markProposalApplied` handler + JSDoc contract (fence, idempotent exception, out-of-scope scrub/uniqueness).
- `convex/chatV2.markProposalApplied.test.ts` -- new convex-test suite: every I/O matrix row, role denial, real-provenance clearing/preservation, `updateReportContent` resync, prune-to-cap.
- `src/lib/components/project/fencedProposalMark.ts` -- new shared client sequencing helper (installs a settled chain).
- `src/lib/components/project/fencedProposalMark.test.ts` -- 9 node unit cases for the helper.
- `src/lib/components/project/CurrentProjectPage.svelte`, `PreviewProjectPage.svelte` -- `markApplied` delegates to the helper; `void markApplied(...)` call sites; `ReplaceSession.messageId` typed `Id<"chatProposals">`.

**Review findings (loop 2):** 7 patched (medium 2, low 5), 0 deferred, 23 rejected, 0 bad_spec, 0 intent_gap. Loop 1: 3 bad_spec (spec amended, code re-derived), 1 deferred.

**Follow-up review recommendation:** true. Patched high 0, medium 2, low 5; score 3*2 + 1*5 = 11 (>= 5).

**Verification performed:**
- `npx vitest list chatV2.markProposalApplied fencedProposalMark` -- 24 cases listed across both files.
- `npm test -- chatV2.markProposalApplied fencedProposalMark` -- 24/24 passed.
- `npm test` -- 106 files, 987 tests passed.
- `PUBLIC_CONVEX_URL=http://placeholder npm run check` -- 0 errors, 0 warnings.

**Residual risks:**
- The page wiring of the helper (`flushEditor`, `saveChain`, `localRevision` closures) is verified by inspection and by the helper/server tests, not by a mounted-component test; a regression in how either page feeds the helper would not be caught by `npm test`.
- Between `setRevision(N+1)` and the subscription reflecting N+1, the existing `$effect` (`pendingSaves === 0`) may briefly write the older revision back before catching up; a keystroke in that window would hit STALE_REVISION once and resync (pre-existing autosave design, acknowledged in Design Notes).
- The already-applied path returns `report?.revisionNumber ?? 0` without validating the report against the proposal's project (contract-mandated order); only reachable for deleted/moved reports, and `$effect` resync repairs `localRevision`.
- Client-side replacements remain unscrubbed and unchecked for unique targets (contract "Never"; audit items still open outside CAP-2).

