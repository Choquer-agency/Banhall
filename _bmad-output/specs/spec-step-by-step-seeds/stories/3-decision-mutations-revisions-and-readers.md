---
title: 'Decision mutations, revisions, approval challenge, events and reader'
type: 'feature'
created: '2026-09-18'
status: 'ready-for-owner-checkpoint'
baseline_commit: '7aa4ad20b0bdaf810db145abbcb436c6d2d82d99'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-step-by-step-seeds/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-step-by-step-seeds/stories.yaml'
  - '{project-root}/convex/_generated/ai/guidelines.md'
---

<frozen-after-approval reason="human-owned intent; pending owner checkpoint">

## Intent

**Problem:** Story 2 can generate and retain Seeds, but writers cannot yet save decisions, reconcile outdated suggestions, inspect complete decision sets or measure the resulting workflow. The next public writers must update revisions, approvals, stale episodes and telemetry atomically while preserving the immutable attempt inputs.

**Approach:** Add the default-runtime seed decision API, shared revision and readiness helpers, server-built paginated DTOs, approval challenges and the seed learning-health query. Reuse Story 2 dispatch and provider execution. Keep normal reservations on the sections workflow and leave the workspace, sign-off and prose drafting to their planned stories.

## Boundaries & Constraints

**Always:** Follow SPEC CAP-4 through CAP-11, CAP-15 and the CAP-16 read bounds, plus AD-33/36/39/42/43/44. Public mutations require report-edit access, stored seeds workflow, active awaiting-input generation, no deletion barrier, and expected seed-stage version, in that order. Reference IDs must belong to the same project, generation and role where applicable. Every domain write, revision update, transition, version bump and event belongs to one transaction. Use the existing generations version helper and seedRuns attempt writers.

**Ask First:** Approve this checkpoint and the resolutions below before production implementation. A missing product decision is recorded here rather than silently amending the PRD or spine.

**Never:** Enable seeds in normal reservations; add workspace components, sign-off, Summary writes, section drafting or model-based claim classification; mutate consumed revisions or original Seed bullets; auto-select feedback results; write report prose, chat proposals or Brief entries; impose a usage cap or fixed product selection limit; hand-edit generated files or the native deferred-work ledger.

## Proposed checkpoint resolutions

1. **Approval-relative prefetch:** After approving role K, inspect successors in canonical order and choose the first untouched successor. Prefetch only if that candidate has no Batch history, shown/pending Batch, and no other queued/running prefetch exists. Do not skip an ineligible untouched candidate to prefetch farther ahead. An out-of-order approval does not require earlier roles to be decided. No successor means no prefetch. Existing matching initial work is reused by the attempt helper. This supplies the Story 3 caller that AD-42 assigns to approve, without adding a global navigation cursor.
2. **Approval succeeds independently of optional prefetch:** Validate optional prefetch eligibility and context before any attempt writes. If its fixed context exceeds the existing processing limits, save the valid approval and omit prefetch; an explicit later open reports the existing role-specific INVALID_INPUT. Catch only the known pre-write prefetch validation outcome, never a failure after attempt writes. Do not swallow database, authorization or invariant errors. No background regeneration is introduced.
3. **Claim Exclusion matching:** Use the existing Self-check's deterministic normalized whole-token substring semantics for the frozen Brief's active claimExclusion text or exactExcerpt against each selected Seed's final bullets independently (never joining across a bullet boundary). Read entries only through the generation's pinned briefVersionId. Ignore removed entries and blank needles. Share or extract the matcher without changing existing Self-check behavior. The challenge lists exact matching entry IDs and requires their explicit acknowledgment. This is a deterministic warning, not a claim of semantic equivalence or a new AI request.
4. **Complete decisions versus bounded display:** Story 2's 128-item/byte ceilings apply to model snapshots, not saved selection counts or UI pagination. Canonical revision hashing must be separable from dispatch-limit enforcement. Use indexed, byte-budgeted complete reads for transactional calculations; when a complete calculation cannot be performed within a safe transaction budget, refuse the mutation before committing any write with a typed processing-limit error naming the affected role. Never hash or approve a truncated subset. Display queries explicitly disclose truncation and expose pagination; readiness never reports ready from incomplete inputs. Optional prefetch overflow follows resolution 2.
5. **Story 4 integration boundary:** Implement the pure readiness calculation and transaction-local loader now. Prove registered getReadiness parity with the same loader invoked in a mutation-context test and prove a decision change removes readiness before any placeholder Summary/lifecycle write. Do not ship a partial signOffSeedStage endpoint. The real sign-off/query parity and no-Summary-write race witness are mandatory in Story 4 when that endpoint exists.

6. **Explicit writer-matrix reconciliation:** AD-39 requires approve to write immutable feedback outcomes, while AD-33 omits approve from the seedFeedbackRequests patch allowlist. Proposed narrow resolution: permit the approve transaction's feedback-scoring helper to patch only firstApproveExposure and eligibleScore, each once, without changing target, wording, instruction, status or attempt. Keep all other field writers unchanged. For editing a never-selected Seed, interpret the seeds.select insertion owner as the shared plain selection-row creation helper also called by edit/restore, creating selected=false and never generating a select event or auto-selecting feedback output. A write-spy test enforces these field-specific owners and proves no other caller inserts or patches those rows. This is an explicit proposed reconciliation for this checkpoint, not a claim that the existing matrix already permits it; PRD/spine files remain unchanged.

**Technical implementation:** AI bullets and original provenance remain immutable; edits live on selection rows and only support changes on the Seed. Add optional feedback outcome fields/indexes needed for the approved resolution. No new unregistered project table is introduced.

## I/O & Edge-Case Matrix

| Scenario | Expected behavior |
| --- | --- |
| Select/deselect or edit/restore selected wording | Recompute own selection revision and successor context revisions; own approval returns to in progress; approved successors become derived Stale. No predecessor changes. |
| Edit an unselected Seed | Persist edited wording and writer-asserted support without selecting it or changing the Decision Set; feedback results targeting its old wording become Outdated. |
| Restore original wording | Restore AI bullets and originalSupport; matching selection content restores its old hash but does not silently restore approval. |
| Decision changes R0 to R1 to R0 to R2 | At most one open stale episode; restoration clears derived Stale while retaining the episode until explicit approval, skip or cancel disposes it. |
| Client supplies stale expected version | STALE_REVISION and no domain writes, scheduling, version increment or events. |
| Cross-project/generation/role ID | Refuse before mutation; never disclose unauthorized text. |
| Feedback request | At most 300 characters, frozen target wording, stable command identity, active instruction; own and successor context revisions update before dispatch. Results remain unselected. |
| Feedback command redelivery | Reuse the original request/attempt for the same stable payload; do not insert another request or change its target. A different target/instruction under the same command is invalid. Version-fence semantics still apply. |
| Withdraw feedback, then skip/unskip | Withdrawn instructions never reactivate; only suspendedBySkip instructions return. |
| Regenerate/retry while pending | Reuse/refuse according to Story 2 operation matrix; no second attempt. Existing selections and shown content are preserved. |
| Restore previous Batch | Restore only an ordinary completed Batch of this role, use seedRuns for Batch status changes, retain selections and immutable consumed revision; approval returns to in progress. |
| Skip optional role while attempt pending | Clear pending ownership, terminalize via seedRuns, suspend active feedback, retain selections as inactive, bypass open episode; late callback never becomes current. |
| Unskip | Reactivate retained selections and suspended feedback; in progress if any Batch history exists, otherwise untouched; never directly approved or resurrecting an old pending attempt. |
| Approval sees outdated shown or selected material | Server challenge identifies carried selection IDs and changed roles; exact challenge and exact acknowledgment sets required; consumed revisions never rewritten. |
| Selected advancement has missing/inactive/wrong-role references | INVALID_STATE with UNLINKED_ADVANCEMENT; regeneration/feedback repairs links, acknowledgment cannot bypass it. |
| Approve with valid current data | Save current approved revisions, confirmation and exclusion acknowledgment; emit hashed snapshot; settle stale episode facts and immutable feedback outcomes; optionally prefetch next candidate. |
| Skip/cancel | Open episodes disposed bypassed; no report or Summary created. |
| Batch first view delivered twice | Exactly one event per Batch/user, server-derived identity, no seed/feedback text. |
| Subsection or Summary exceeds one display page | Explicit truncation/partial state with stable cursor and complete reachable history/items; no silent loss or client-derived readiness. |
| Metrics join crosses reporting window or read budget | Join attributed entities across windows; disclose incomplete when the budget prevents a complete answer. Never present partial counts as complete. |
| Legacy workflow, signed-off, cancelled or deleting generation | Public decision calls refuse; existing legacy generation behavior remains unchanged. Authorized historical read DTOs remain available where the contract permits. |

</frozen-after-approval>

## Code Map

- `convex/seeds.ts`: public decision mutations, view event, outline/subsection/history/Summary/readiness queries. Separate plain transaction helpers where needed; no lifecycle status ownership here.
- `convex/lib/seedRevisions.ts`: complete canonical decision and selection hashing, contribution changes, shared ordering and explanations. Preserve Story 2 snapshot encoding and bytes.
- `convex/lib/seedSnapshotLoader.ts`: reuse immutable dispatch loader and separate complete decision calculation from model-request processing limits.
- `convex/lib/seedReadiness.ts`: one pure calculation and QueryCtx/MutationCtx loader, importing neither seeds nor generations.
- Supporting `convex/lib/seed*.ts` helpers: selection ownership, transition/episode updates, approval challenge, read DTO assembly and bounded access as implementation warrants; avoid a second policy implementation.
- `convex/seedRuns.ts`: transaction-local attempt reuse, supersession and safe optional prefetch preflight; do not duplicate its settlement or lease rules.
- `convex/generations.ts`: cancel disposes open stale episodes; retain lifecycle/version helper ownership. No sign-off endpoint in this story.
- `convex/schema.ts`: optional feedback scoring/command metadata and narrowly needed indexes; all seed tables remain registered for erasure.
- `convex/learningHealth.ts` plus bounded seed metric helpers: additive admin query, event joins, latency and exact trace results; existing health results preserved.
- `convex/learning.ts` draft-style digest reader: explicitly labels seed generations as excluded from that learning stream.
- Pure/helper and convex-test suites under `convex/`, including mutation authorization matrix and worked-event-trace fixture.

## Tasks & Acceptance

- [ ] **Shared canonical decisions:** Implement complete active-selection/skip/feedback assembly, own feedback, selection revision, contribution hashes and explainChange. Maintain stored strings unchanged and sorted-key stable encoding; no successors in predecessor context. Shared orderShownSet sorts by role, Batch creation, Seed order with revisions directly after their original. Assert insertion-order invariance, absent/empty equivalence, edit/restore equality and Story 2 codec/request regressions.
- [ ] **Public writers and atomic transitions:** Implement select/deselect, edit/restoreWording, giveFeedback/withdrawFeedback, open/regenerate/retry/restoreBatch, skip/unskip and markBatchViewed with appropriate IDs, expected version and stable command identity. Run the AD-36 transaction order and all cross-resource guards. Event/no-op/redelivery behavior is explicit and tested. Keep exactly one pending attempt and preserve human state when callbacks race decisions.
- [ ] **Staleness and approval:** Derived predicate only, one open episode, immutable consumed revisions, contribution-based explanations, feedback target-wording Outdated. Build a server-owned challenge from version, selected wording hashes, Batch IDs, changed roles and exclusion IDs. Require exact acknowledgments, current reference membership and at least one active selection. Stamp current approved revisions and text-free approval snapshot. Capture fresh-attempt-completed, fresh-seeds-in-snapshot and older-confirmed facts accurately; restored contexts never spawn duplicate episodes.
- [ ] **Approval-triggered prefetch:** Implement resolution 1 and 2 in the actual approve flow. Test out-of-order approval, exhausted successors, first untouched candidate with history, existing queued/running prefetch, open/prefetch reuse, and context overflow preserving approval without dispatch artifacts.
- [ ] **Readiness:** Shared pure rule and complete transaction-local loader with named blocking roles and invalid advancement links. Incomplete inputs cannot yield ready. Query and mutation-context parity, all role-kind states, own/successor readiness loss and no side effects; record the real sign-off integration as Story 4 acceptance, not already tested.
- [ ] **Readers and pagination:** Thirteen-row outline with words/counts/previews, usage notice and version; full Shown Set policy with feedback groups, carried selections, history and server Outdated/challenge; paginated Batches and live/frozen Summary with stable ordering. Shared createReadBudget accounts for authorization and all joins. Incomplete challenges cannot be approved. Summary pagination must never apply the 128-item prompt ceiling. Cross-scope IDs and cursor parameters are validated.
- [ ] **Events and learning reader:** Closed text-free event schema, actor and role enforcement, view dedupe, immutable first exposure and first eligible feedback score even after withdrawal. Exact AD-39 cohort, development/cancel exclusions, firm-time half-open periods, cross-window joins and incomplete flags. Include request/cost, viewed/selected/edited, feedback, regenerate, stale dispositions/durations, sign-offs/active time and latency measurements; no provider calls. Reproduce build-sequence v1 trace, adding explicitly omitted prerequisite events to the fixture without changing the canonical file or expected results. Label seed generations excluded from draft-style digestion.
- [ ] **Security and lifecycle:** Each public mutation has report-edit authorization branches (owner, open assignment, manager/admin; closed/unrelated/creator-only/anonymous/roleless denied), expected-version and closed-stage cases. Reads require existing project-read access; health remains admin-only. Cancel bypasses every open episode without changing established cancellation semantics. Prove no report/proposal/Brief or Summary writes from decisions.
- [ ] **Gate and reviews:** Run focused suites, then `bash scripts/loop-verify.sh`. Three independent gpt-6-astra medium layers (blind, edge, verification gap) review against baseline; triage and correct material findings, then reverify. No component suite unless component scope changes.

## Verification and Delivery

Story 3 has both `spec_checkpoint: true` and `done_checkpoint: true` in stories.yaml. This artifact is the reviewable pre-implementation checkpoint. After owner approval, freeze intent and implement on `feat/seeds-3-decisions` in the existing authorized worktree. No native BMAD run is claimed; the launcher remains unavailable and the native ledger stays untouched.

At completion present concrete verified code, test results and review dispositions for the done checkpoint before publication unless the owner explicitly waives that checkpoint. The eventual PR stacks against `feat/seeds-2-pipeline`. Never push main or merge. No normal reservation rollout occurs here.

## Suggested Review Order

1. Proposed resolutions, especially prefetch scope, complete decisions versus display limits and Story 4 sign-off boundary.
2. Authorization/version fences and row writer ownership.
3. Revision/transition/episode behavior and immutable attempt interleavings.
4. Challenge completeness, explicit acknowledgments and advancement references.
5. Bounded DTOs and full pagination.
6. Immutable feedback outcomes and metrics trace/period attribution.
7. Gate evidence and dark-rollout/no-prose guarantees.

## Execution Notes

Prepared using the user-confirmed agent-tree setup. Story 2 baseline is PR #20, commit 7aa4ad20b0bdaf810db145abbcb436c6d2d82d99, with local nine-step gate, both CI suites and Greptile 5/5. The independent Story 2 review lead assigned approval-relative prefetch selection to this story; it is explicitly covered above. No Story 3 production code has been changed.

## Checkpoint Review

Independent `gpt-6-astra` medium review found one material contract mismatch between AD-33 field ownership and AD-39 approval scoring. Resolution 6 now proposes the narrow owner-approved reconciliation and write-spy witnesses explicitly. Re-review found the checkpoint ready for owner approval with no remaining material findings. Evidence: `.git-local-evidence/story3-spec-review.md`. This is specification review only; no production implementation or test execution is claimed.
