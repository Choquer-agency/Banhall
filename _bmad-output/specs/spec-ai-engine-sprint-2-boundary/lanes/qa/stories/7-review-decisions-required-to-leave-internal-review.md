---
title: 'reviewDecisions required to leave internal_review'
type: 'feature'
created: '2026-09-04'
baseline_revision: 'c40da52ab3c311f027cd2637ccd908f0cd4dd1d3'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The report the decision is pinned to is chosen by creation order, not by
      the highest revisionNumber.
    evidence: |-
      setWorkflowStage resolves the report with
      by_projectId + .order("desc").first(), copied verbatim from
      convex/reports.ts:35 and used elsewhere in the repo. With more than one
      reports row on a project the newest-created row need not hold the highest
      revisionNumber, so the audit row can pin a revision other than the one
      under review. Pre-existing convention, newly load-bearing for an audit
      record; no test inserts two reports for one project.
    location: >-
      convex/projectWorkflow.ts (setWorkflowStage report lookup)
    severity: medium
  - summary: >-
      Nothing pins that the only production caller actually sends
      reviewDecision, so a UI regression would make leaving internal review
      impossible while the suite stays green.
    evidence: |-
      ProjectWorkflowMenu.svelte submitStage is the sole setWorkflowStage
      client. Every reviewDecision assertion lives in
      convex/projectWorkflow.test.ts and constructs the arguments itself. No
      ProjectWorkflowMenu component test exists; ProjectHighlights.component.test.ts
      mounts the menu with workflowStage "drafting" and never opens the dialog.
      Removing the conditional spread breaks review completion in the app and
      fails no test.
    location: >-
      src/lib/components/project/ProjectWorkflowMenu.svelte:288
    severity: medium
  - summary: >-
      The decision is pinned to whatever revision is current at commit time,
      with no caller-supplied fence proving the reviewer read that revision.
    evidence: |-
      setWorkflowStage already fences the stage field with expectedVersion, but
      the review decision takes no expected revisionNumber or contentHash. If
      the report is edited between the reviewer reading it and confirming the
      transition, the row silently attests a judgement against the newer
      revision. The story chose server-side resolution deliberately; closing
      this needs a client-supplied baseline and UI plumbing.
    location: >-
      convex/projectWorkflow.ts (reviewDecisions insert)
    severity: medium
  - summary: >-
      A project sitting in internal_review with no reports row cannot leave via
      either completion edge, and the UI gives no advance signal.
    evidence: |-
      The new INVALID_STATE ("no report revision to record a review decision
      against") is raised only after submission. workflowStageOptions has no
      report knowledge, so StageChangeDialog still renders both completion
      edges as selectable. Recorded in the 2026-09-04 product-domain amendment;
      the escape hatch is moving to any other stage under unchanged default
      policy.
    location: >-
      shared/workflowLabels.ts:69 (workflowStageOptions)
    severity: low
---

<intent-contract>

## Intent

**Problem:** `setWorkflowStage` lets `internal_review → edits` and `internal_review → ready_for_delivery` happen with no recorded reviewer decision, so "the review is done" is an unaudited stage flip and nothing pins the judgement to the report revision that was actually read.

**Approach:** Add a `reviewDecisions` table and an optional `reviewDecision` argument to `setWorkflowStage`; on the two internal-review completion edges the argument becomes mandatory and the mutation writes one decision row — reviewer, report, revision number, content hash, decision, note — in the same transaction as the stage patch and the `stage_changed` event, failing with a new typed `REVIEW_DECISION_REQUIRED` code when it is absent.

## Boundaries & Constraints

**Always:**
- The decision row, the stage patch, and the `projectEvents` row are written in one mutation; no separate mutation, no scheduler hop.
- The row pins the project's latest report: `reportId`, `revisionNumber` (`report.revisionNumber ?? 0`), and `contentHash` (`report.contentHash ?? await sha256(report.content)`).
- `reviewDecision` is validator-optional (`v.optional`) so every other edge keeps its exact current argument shape; the requirement is enforced per-edge inside the handler.
- Requirement lives in `shared/workflowTransitions.ts` as a new `TransitionRequirement` value so the matrix stays the single source of per-edge policy.
- The decision value must agree with the destination: `edits` ⇒ `return`, `ready_for_delivery` ⇒ `approve`.
- Schema change is additive: one new table, no field added to an existing table, no backfill.
- Follow `convex/_generated/ai/guidelines.md` for every `convex/` edit (object-form functions, explicit validators, indexed queries).

**Block If:**
- The product-domain contract turns out to forbid a new fail-closed requirement on these edges without a recorded amendment beyond the one this story writes.

**Never:**
- No second mutation, no new public `api.*` function.
- Do not change authority rules, OCC/`expectedVersion` semantics, note rules, the open-work check before `abandoned`, or the same-stage no-op.
- Do not add a reader/query/UI panel for `reviewDecisions`; this story only writes the record.
- Do not touch `StageChangeDialog.svelte` or any other component; the only frontend edit is `submitStage` in `ProjectWorkflowMenu.svelte`.
- Do not touch files owned by the parallel epic (`src/lib/components/chat/**`, `convex/learning.ts`, `convex/ai/learning.ts`, `convex/brain.ts`, `src/routes/admin/brain/**`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Review returned for edits | project in `internal_review` with a report; `toStage: "edits"`, `reviewDecision: { decision: "return" }`, note supplied | `{ status: "updated", version: n+1 }`; exactly one `reviewDecisions` row with `decision: "return"`, `toStage: "edits"`, the report's id/revisionNumber/contentHash, `reviewerId` = actor, `note` = the normalized note; one `stage_changed` event | No error expected |
| Decision missing | project in `internal_review` with a report; `toStage: "edits"`, no `reviewDecision` | Mutation throws; stage, `workflowVersion`, `projectEvents` and `reviewDecisions` all unchanged | `REVIEW_DECISION_REQUIRED` |
| Decision missing on approve edge | project in `internal_review`; `toStage: "ready_for_delivery"`, no `reviewDecision` | Mutation throws before the `promoted_branch` fail-closed check | `REVIEW_DECISION_REQUIRED` |
| Decision contradicts the edge | `toStage: "edits"`, `reviewDecision: { decision: "approve" }` | Mutation throws; nothing written | `INVALID_INPUT` |
| Decision on an unrelated edge | `fromStage: "drafting"`, `toStage: "client_review"`, `reviewDecision` supplied | Mutation throws rather than silently dropping the decision | `INVALID_INPUT` |
| No report on the project | project in `internal_review`, no `reports` row; `toStage: "edits"` with a valid decision | Mutation throws; a decision cannot be pinned to a revision that does not exist | `INVALID_STATE` |
| Report without `contentHash` | legacy report row with `contentHash`/`revisionNumber` absent | Row stores `revisionNumber: 0` and a freshly computed `sha256(report.content)` | No error expected |
| Unrelated edges | any transition whose `from` is not `internal_review`, or whose `to` is neither `edits` nor `ready_for_delivery` | Behavior byte-identical to today; no `reviewDecisions` row | Unchanged |

</intent-contract>

## Code Map

- `convex/projectWorkflow.ts:316-411` -- `setWorkflowStage`. `args` at `:317-322`; `requireInternalWorkflowActor` at `:328` yields the reviewer `Doc<"users">`; `findWorkflowTransition` at `:341`; authority check `:350`; `normalizedNote` at `:354` (trims, `undefined` when empty, `INVALID_INPUT` past `MAX_WORKFLOW_NOTE_CHARS`); the existing fail-closed requirement checks at `:358-369` — insert the review-decision check **before** them so it is observable on the `ready_for_delivery` edge too; `now`/`nextVersion` at `:385-386`; `patchProjectWorkflowStage` at `:396` (the ONLY sanctioned `workflowStage` writer — do not bypass); `projectEvents` insert at `:400-408` — the decision insert goes immediately after it, same transaction.
- `shared/workflowTransitions.ts:9` -- `TransitionRequirement = "delivery_outcome" | "promoted_branch"`; add `"review_decision"`. `transitionRule` at `:28-49` already special-cases `from === "internal_review" && (to === "edits" || to === "ready_for_delivery")` for authorities at `:31-32` — reuse that exact predicate to append the requirement (the `ready_for_delivery` edge then carries both `promoted_branch` and `review_decision`). Add an exported `reviewDecisionForStage(to)` helper returning `"return"` for `edits`, `"approve"` for `ready_for_delivery`, `undefined` otherwise, plus a `ReviewDecision` type, so the mutation and the Svelte caller share one mapping. The doc comment at `:50-60` lists preserved policy and must gain the new requirement.
- `convex/lib/contracts.ts:9-27` -- `domainErrorCodes`; append `"REVIEW_DECISION_REQUIRED"`. `domainError(code, message, details?)` at `:31-37`. `sha256` at `:243-249` (async, `crypto.subtle`; already used from mutations in `convex/reports.ts:63`).
- `convex/schema.ts:525-541` -- `reports` table: `revisionNumber` and `contentHash` are both `v.optional`, `by_projectId` index exists. `convex/reports.ts:34-38` is the latest-report pattern to copy verbatim: `.withIndex("by_projectId", q => q.eq("projectId", …)).order("desc").first()`.
- `convex/schema.ts:1506-1522` -- `writerReviews`, the closest shape precedent for the new table (per-report review artifact, `by_reportId` + `by_projectId` indexes). Add `reviewDecisions` near it. Do **not** import `workflowStageValidator` from `convex/lib/contracts.ts` into `schema.ts`; inline `v.union(v.literal("edits"), v.literal("ready_for_delivery"))` for `toStage`.
- `convex/projectWorkflow.test.ts` -- the fence. `setupFixture` `:15-61` (admin/manager/owner/other/roleless/anonymous identities), `insertProject` `:66-95` (no report row is created), `projectEvents` `:97-104`. Three existing cases drive `internal_review → edits` and expect plain success and must now pass a decision **and** have a report: the N×N matrix case at `:151-196` (its branch ladder checks `delivery_outcome` then `promoted_branch` — add a `review_decision` branch *first*, and note its event-count expectation at `:184-186` keys off `transition.requirements?.length`), the H-authority case at `:310-315`, and the handoff case at `:397-401`. Add an `insertReport(setup, projectId)` helper alongside `insertProject`.
- `convex/dashboardStageCounts.test.ts:135-199` and `convex/workItems.test.ts:397-407` -- other `setWorkflowStage` callers; all use `intake`/`drafting`/`abandoned` edges only, so they must keep passing untouched. Verify, do not edit.
- `src/lib/components/project/ProjectWorkflowMenu.svelte:281-303` -- `submitStage(toStage, note?)`, the single UI caller (`useMutation` at `:95`, wired at `:496`). `header` (`$derived`, `:129`) exposes `workflowStage`; `baseline.version` is the OCC value. Add the derived `reviewDecision` here only. `actionError` at `:272-278` maps `STALE_REVISION`; other codes fall through to `userErrorMessage`, which is acceptable for `REVIEW_DECISION_REQUIRED` because the UI always sends the decision.
- `src/lib/components/project/StageChangeDialog.svelte:26` -- `onSubmit: (to, note?)`. Read-only: the decision is derived from the destination, so the dialog needs no new control and `StageChangeDialog.component.test.ts` must pass unmodified.
- `docs/product-domain.md:73-97` -- "Transition matrix": the per-edge policy table (`Review completion` row at `:89`) and the rule list. `:249-279` shows the amendment format (`### YYYY-MM-DD — title`, Origin / What changes / Implementation / Tests / Approval bullets); `:1439-1484` is the most recent full example. Append the new amendment at the end of the amendment list, before `## Amendment process` (`:1559`).
- Read-only context: `convex/lib/dashboardProjection.ts:149` (`patchProjectWorkflowStage`), `convex/workItems.ts:298-305` (enters `internal_review`, never leaves it), `convex/projects.ts` (`bulkUpdateProjects` writes no `workflowStage`) — confirming `setWorkflowStage` is the only exit from `internal_review`.

## Tasks & Acceptance

**Execution:**
- `shared/workflowTransitions.ts` -- add `"review_decision"` to `TransitionRequirement`, attach it to the two internal-review completion edges inside `transitionRule`, export `ReviewDecision` and `reviewDecisionForStage`, and extend the matrix doc comment -- one source of per-edge policy for both the mutation and the UI.
- `convex/lib/contracts.ts` -- append `"REVIEW_DECISION_REQUIRED"` to `domainErrorCodes` -- the typed code the transition fails with.
- `convex/schema.ts` -- add the `reviewDecisions` table (`projectId`, `reportId`, `reviewerId: v.id("users")`, `revisionNumber: v.number()`, `contentHash: v.string()`, `decision: v.union(v.literal("approve"), v.literal("return"))`, `toStage`, `note: v.optional(v.string())`, `createdAt: v.number()`) with `by_projectId` and `by_reportId` indexes, and a comment recording that the row is required on the two completion edges -- additive audit record.
- `convex/projectWorkflow.ts` -- add the optional `reviewDecision` arg, resolve the latest report, enforce the requirement/agreement/misuse rules ahead of the existing requirement checks, and insert the `reviewDecisions` row in the same transaction right after the `projectEvents` insert -- atomic decision + stage event.
- `src/lib/components/project/ProjectWorkflowMenu.svelte` -- in `submitStage`, when the current stage is `internal_review` and `reviewDecisionForStage(toStage)` is defined, pass `reviewDecision: { decision }` -- keeps the only UI exit from internal review working.
- `convex/projectWorkflow.test.ts` -- add an `insertReport` helper; update the three cases that leave `internal_review`; add a `describe` covering every row of the I/O matrix (missing decision on both edges, contradictory decision, decision on an unrelated edge, missing report, legacy report without `contentHash`/`revisionNumber`, and the happy path asserting the stored row plus the single `stage_changed` event) -- the behavioral fence.
- `docs/product-domain.md` -- update the `Review completion` policy row and add a dated amendment describing the `reviewDecisions` record, the `REVIEW_DECISION_REQUIRED` code, and the no-report consequence -- the contract requires an amendment before behavior changes.

**Acceptance Criteria:**
- Given a project in `internal_review` with a report and an actor with review authority, when `setWorkflowStage` is called for `edits` with `reviewDecision: { decision: "return" }`, then the stage advances, one `reviewDecisions` row exists carrying the report's id, `revisionNumber`, and `contentHash`, and exactly one `stage_changed` event is written.
- Given the same project, when the same call omits `reviewDecision`, then the mutation rejects with `REVIEW_DECISION_REQUIRED` and the project's `workflowStage`, `workflowVersion`, `projectEvents`, and `reviewDecisions` are all unchanged.
- Given any transition whose origin is not `internal_review`, when it is performed with today's arguments, then behavior and stored rows are identical to before this story.
- Given `npm run check` and `npm test`, when run on the finished change, then both pass, including `convex/dashboardStageCounts.test.ts` and `convex/workItems.test.ts` unmodified.

## Spec Change Log

## Review Triage Log

### 2026-09-04 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 2, low 4)
- defer: 4: (high 0, medium 3, low 1)
- reject: 9: (high 0, medium 3, low 6)
- addressed_findings:
  - `[medium]` `[patch]` The decision insert was guarded by `if (reviewedReport && reviewedStage && args.reviewDecision)`, which failed open: a stage patch and `stage_changed` event could commit with no decision row. Keyed the insert off `needsDecision` and made a missing pinned report/decision abort the transaction with `INVALID_STATE`.
  - `[medium]` `[patch]` Nothing pinned the `review_decision: null` entry in `TRANSITION_REQUIREMENT_BLOCKERS`, the single line keeping `internal_review -> edits` selectable in `StageChangeDialog`; no test used `internal_review` as an origin. Extended `src/lib/workflow/workflowLabels.test.ts` to assert `disabledReason === null` for `edits` and exactly the promoted-branch reason for `ready_for_delivery`.
  - `[low]` `[patch]` `reviewedStage` was derived by a `=== "edits" ? ... : "ready_for_delivery"` ternary that would mislabel any future third edge. Replaced with an explicit two-literal check that fails closed.
  - `[low]` `[patch]` `contentHash ?? sha256(...)` would pin a stored empty-string hash. Changed to a falsy check so an empty hash recomputes.
  - `[low]` `[patch]` No assertion proved the decision row attributes to the actual actor rather than the owner. The H-authority case now asserts `reviewerId` is the handoff assignee and not the owner.
  - `[low]` `[patch]` `docs/system-map.md` recorded neither the new table nor the new gate. Added the `reviewDecisions` relation, annotated both internal-review edges, and extended the fail-closed paragraph.

### 2026-09-04 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 0
- reject: 27: (high 0, medium 4, low 23)
- addressed_findings:
  - `[low]` `[patch]` The `INVALID_STATE` "not an internal-review completion edge" guard was dead code: `reviewDecisionForStage` returns `undefined` for any third edge, so the `decision !== expectedDecision` comparison always fired first and masked it behind an "does not match" `INVALID_INPUT`. Moved the destination check ahead of the agreement check so it can actually fail closed.
  - `[low]` `[patch]` Nothing distinguished the deliberate falsy `contentHash ||` fallback from a nullish `??`: no fixture stored an empty hash, so `||` → `??` passed the whole suite. Added a `contentHash` option to `insertReport` and a case asserting an empty stored hash is recomputed to a 64-hex digest (verified the new test fails under `??`).
  - `[low]` `[patch]` The `reviewDecisions` test helper used `.take(20)`, so a bug writing extra rows would be silently truncated by the fence itself. Changed to `.collect()`.

## Design Notes

The decision value is derivable from the destination edge, so the argument exists to make the reviewer's judgement explicit and auditable rather than to carry new information; agreement with the edge is therefore enforced instead of inferred. Placing the `review_decision` check ahead of `promoted_branch` keeps the requirement observable on the `ready_for_delivery` edge, which otherwise fails closed on every call.

```ts
// convex/projectWorkflow.ts, before the existing requirement checks
const expected = reviewDecisionForStage(args.toStage);
const needsDecision = transition.requirements?.includes("review_decision") === true;
if (!needsDecision && args.reviewDecision) {
  domainError("INVALID_INPUT", "A reviewer decision applies only to internal-review completion");
}
if (needsDecision) {
  if (!args.reviewDecision) {
    domainError("REVIEW_DECISION_REQUIRED", "Record an approve or return decision to complete this review");
  }
  if (args.reviewDecision.decision !== expected) {
    domainError("INVALID_INPUT", "The reviewer decision does not match this transition");
  }
}
```

## Verification

**Commands:**
- `npx vitest run --project convex convex/projectWorkflow.test.ts convex/dashboardStageCounts.test.ts convex/workItems.test.ts` -- expected: all pass
- `npm test` -- expected: green
- `PUBLIC_CONVEX_URL=http://localhost npm run check` -- expected: no new errors

## Auto Run Result

Status: done

### Implemented change

Leaving `internal_review` now requires a recorded reviewer decision. `setWorkflowStage` gained an optional `reviewDecision` argument that becomes mandatory on the two internal-review completion edges via a new `review_decision` requirement in the shared transition matrix; on those edges the mutation resolves the project's latest report and writes one `reviewDecisions` row — reviewer, report, `revisionNumber`, `contentHash`, decision, note — in the same transaction as the stage patch and the `stage_changed` event, failing with the new typed `REVIEW_DECISION_REQUIRED` when the decision is absent and `INVALID_STATE` when there is no report to pin it to.

### Files changed

- `convex/lib/contracts.ts` — added the `REVIEW_DECISION_REQUIRED` domain error code.
- `convex/schema.ts` — added the additive `reviewDecisions` table with `by_projectId` and `by_reportId` indexes.
- `convex/projectWorkflow.ts` — added the optional `reviewDecision` arg, the per-edge requirement/agreement/misuse checks ahead of the existing fail-closed checks, and the same-transaction decision insert.
- `shared/workflowTransitions.ts` — added the `review_decision` requirement, the `ReviewDecision` type, and the shared `reviewDecisionForStage` mapping.
- `shared/workflowLabels.ts` — made `TRANSITION_REQUIREMENT_BLOCKERS` nullable so a caller-satisfiable requirement does not disable the option.
- `src/lib/components/project/ProjectWorkflowMenu.svelte` — `submitStage` derives and sends the decision when leaving internal review.
- `convex/projectWorkflow.test.ts` — `insertReport`/`reviewDecisions` helpers, the three updated existing cases, and a describe covering every I/O-matrix row.
- `src/lib/workflow/workflowLabels.test.ts` — pinned that the review requirement does not disable the `edits` option.
- `docs/product-domain.md`, `docs/system-map.md` — the 2026-09-04 transition-policy amendment and the map/state-diagram updates.

### Review findings breakdown

- **Patches applied (3, all low):** made the dead third-edge `INVALID_STATE` guard reachable by ordering the destination check ahead of the agreement check; added a test pinning the deliberate falsy `contentHash` fallback (an empty stored hash must be recomputed, not copied); switched the `reviewDecisions` test helper from `.take(20)` to `.collect()`.
- **Items deferred (0).** The four entries already in `deferred` were re-surfaced by this pass and are left exactly as recorded: creation-order report resolution, the absent `ProjectWorkflowMenu` component test, the missing caller-supplied revision fence, and the no-report project having no advance UI signal.
- **Items rejected (27).** Four were duplicates of those recorded `deferred` entries. Notable rejects verified against the code rather than assumed: `Doc` is imported at `convex/projectWorkflow.ts:2`; `sha256` is the same helper `convex/reports.ts:64` uses to write the canonical hash, so recomputation is comparable; no `patchProjectWorkflowStage` caller can leave `internal_review` (`convex/ownerBackfill.ts:223` writes a stage only when `workflowStage` is `undefined`, `convex/workItems.ts:302` only enters the stage); `TRANSITION_REQUIREMENT_BLOCKERS` has no consumer outside `workflowStageOptions` and one test; the single-parent ER convention matches `writerReviews`. The same-stage no-op dropping a supplied decision, the untouched `StageChangeDialog`, and the fixed schema field list were rejected as out of scope on the authority of the intent's own `Never` list.

### Follow-up review recommendation

`false`. Patched findings this pass: high 0, medium 0, low 3. Score = 3 × 0 + 1 × 3 = 3, below the threshold of 5, and no patched finding was high severity.

### Verification performed

- `npx vitest run --project convex convex/projectWorkflow.test.ts convex/dashboardStageCounts.test.ts convex/workItems.test.ts` — 3 files, 59 tests, all pass.
- `npm test` — 127 files, 1358 tests, all pass.
- `PUBLIC_CONVEX_URL=http://localhost npm run check` — 5841 files, 0 errors, 0 warnings.
- Mutation-tested the new fence: replacing `||` with `??` in the `contentHash` fallback fails the new test, and the change was restored.

### Residual risks

- The decision is pinned to the report resolved by creation order and to whatever revision is current at commit time; both are recorded `deferred` items, not regressions from this pass.
- The `internal_review → ready_for_delivery` decision path never commits in tests because `promoted_branch` still fails closed, so a stored row with `toStage: "ready_for_delivery"` stays unobserved until branch storage lands.
- The `ProjectWorkflowMenu` wiring that supplies the argument in production has no component test, so a regression there would break review completion in the app with a green suite (recorded `deferred`).
