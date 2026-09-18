---
title: 'Seed stage pipeline, batch attempts and seed contract'
type: 'feature'
created: '2026-09-18'
status: 'done'
baseline_commit: '6a4587d470a43416589dbdeb5fdd752b4a1ede35'
review_loop_iteration: 2
context:
  - '{project-root}/_bmad-output/implementation-artifacts/HANDOFF-2026-09-17-codex-story-1.md'
  - '{project-root}/convex/_generated/ai/guidelines.md'
---

<frozen-after-approval reason="human-owned intent; owner approved 2026-09-18">

## Intent

**Problem:** The schema can store a seed stage, but there is no durable initializer, immutable dispatch snapshot, attempt owner, model action, validator, recovery path or metering. A live read after dispatch could generate from different writer decisions than the revision recorded on the Batch.

**Approach:** Add the dark seed pipeline behind stored `gatedWorkflow = seeds`: initialize thirteen rows only after a frozen Brief exists; dispatch one leased attempt with an immutable predecessor snapshot; generate and validate a role-aware Batch in a Node action; settle it through default-runtime mutations; recover stale work through the existing reaper; and meter every provider request without an admission cap. Keep ordinary reservations on `sections` until the end-to-end rollout.

## Boundaries & Constraints

**Always:** Follow CAP-3/CAP-14 and AD-31, AD-34, AD-35, AD-38 and AD-42, with the AD-33 writer matrix, AD-36 snapshot format, AD-39 telemetry, AD-40 resolver and AD-45 deletion barrier. One action owns one attempt and makes at most two transport requests. Every action input comes from immutable rows and frozen generation inputs. Seed text stays out of reports, `chatProposals`, `generationBriefEntries`, event payloads and logs.

**Ask First:** The two checkpoint decisions below must be accepted or revised before implementation. Any further missing product decision is added here and implementation stops.

**Never:** Activate seeds for ordinary user reservations; add the workspace, public decision mutations, approval/readiness, sign-off or section-plan drafting; infer workflow from seed-row presence; read live selections or feedback in the action; place mutations in `convex/ai/*`; impose a request cap or extension mutation; edit generated Convex files, the PRD/spine or the native deferred-work ledger.

## Approved Checkpoint Decisions

1. **Oversized immutable context:** Proposed policy: only frozen source excerpts may use disclosed trusted-context truncation. Decision items, feedback targets/instructions, frozen Brief and settings remain complete. If these cannot fit, reject dispatch with `INVALID_INPUT` naming the role before any Batch, reservation-counter or scheduler write. Establish named constants for total serialized snapshot UTF-8 bytes, per-row UTF-8 bytes, collected snapshot rows, and assembled prompt UTF-8 bytes during implementation, derived from existing trusted-context/Convex limits. These are request-processing limits, never selection or usage admission caps. Bounded collection detects an extra row or excess bytes and rejects instead of silently omitting decisions; fixed Brief/settings overflow also rejects. Test each exact boundary and one unit over.
2. **Dedupe and explicit retry:** Proposed complete behavior follows the matrix below. An ordinary open never regenerates shown content merely because its context is now outdated. A redelivered command is identified independently of the current context revision.

| Operation | Existing state | Proposed result |
| --- | --- | --- |
| `open` | Any pending Batch | Reuse it; do not schedule another attempt |
| `open` | No pending, a shown Batch (including restored or Outdated) | Return the shown Batch unchanged |
| `open` | No pending/shown, no history | Dispatch initial attempt at the current revision |
| `open` | No pending/shown, failed or superseded history | Return the existing failure/history state; require explicit Retry, never resurrect or regenerate on navigation |
| `prefetch` | Matching queued/running initial Batch | Reuse it |
| `prefetch` | Any other history, shown/pending Batch, non-untouched role, or another queued prefetch | No new attempt |
| `prefetch` | Eligible next untouched role, no history or pending Batch | Dispatch one initial attempt; Story 3 supplies the approve caller |
| `retry` | Matching queued/running initial attempt | Reuse it |
| `retry` | A different pending operation | Refuse `INVALID_STATE` |
| `retry` | No pending, latest attempt failed (a prior shown Batch may exist) | Dispatch a fresh attempt at the current revision; retain the shown Batch while pending |
| `retry` | Latest attempt shown/superseded, or no failed attempt | Refuse `INVALID_STATE`; regeneration is a separate command |
| `regenerate` / `feedback` | Command already recorded, in any Batch status | Return its original Batch without another attempt, including after R0 changes to R1; reject reuse of the command ID for a different operation/target |
| `regenerate` / `feedback` | New command, any pending Batch | Refuse `INVALID_STATE` |
| `regenerate` / `feedback` | New command, no pending Batch | Dispatch a new attempt with that command identity and the current revision |

Command lookup is scoped by generation, role and command ID before computing a new context-bearing dedupe key; add an indexed lookup and validate stable command payload identity. Prefetch shares the initial identity with open, but never changes an existing Batch's immutable context.

**Brief freeze technical resolution (preserves FR-41):** Persist a seed-startup Brief candidate id or explicit absence marker, using the sources/settings frozen for that generation. Pin once before the initial seed Brief attempt and reuse the pin on every retry. An existing stamped startup Brief remains immutable; a pinned absence means derive from frozen sources without adopting a later same-input writer-edited version. Guard both publication and stamping against concurrent resume actions; the first valid result bound to that startup pin wins. Additional optional generation metadata and seeds-specific query/publication arguments are in scope. Existing section/single/compare Brief behavior remains unchanged. This does not introduce a human Brief approval gate or amend the start-freeze rule.

## I/O & Edge-Case Matrix

| Scenario | Expected behavior |
| --- | --- |
| Normal iterative reservation during this dark slice | Stores/resolves `sections`; existing section workflow and ghost behavior are unchanged |
| Stored/test `seeds` generation reaches the post-analysis Brief seam | Requires a frozen Brief version, initializes exactly thirteen rows once, stores frozen settings/length target, enters `awaiting_input`, emits text-free `initialized`; no section run, ghost or s242 job |
| Brief derivation fails or produces no Brief for a seeds generation | Records `seedStageError`, remains `running`, creates no subsection rows; retry reuses frozen sources/artifacts and never reruns analysis or Brain retrieval |
| Initializer or retry is delivered twice | Same generation-owned rows and one initialization event; no duplicate roles |
| Legacy approve/regenerate receives stored `seeds` generation | Refuses `INVALID_STATE`; cancellation remains valid for both workflows and clears pending seed attempts |
| `open` races `prefetch` at the same revision | Shared initial key yields one Batch/attempt and one scheduled action |
| No Story 3 approve caller exists yet | Internal prefetch dispatch/key path is implemented and tested; no production caller is invented |
| Dispatch followed by predecessor edit before claim | Stored request bytes still contain the dispatch snapshot and original consumed revision; no live selection read |
| A role already has a pending Batch | Apply the detailed operation matrix: open may reuse it, prefetch may no-op, and conflicting new work is refused; never schedule a second pending attempt |
| Structured output is malformed or invalid | One repair request may run; no third request; failure settles the known request count and restores the subsection state |
| Four-or-five Seed Batch lacks bullet-form diversity or tag diversity | Invalid after repair; no partial Batch is shown |
| Role-11 output references decisions changed after dispatch | Validate role, generation and active membership against the immutable dispatch snapshot only; the Batch may land Outdated; Story 3 revalidates current links at approval |
| Citation offsets/hash/excerpt fail | That Seed persists only as `writer_asserted`; invalid role-11 references are dropped and can fail the Batch minimum |
| Ordinary completion is current (`open/prefetch/retry/regenerate`) | Inserts validated Seeds/provenance, supersedes the previous shown Batch, shows the new Batch, clears pending, resets consecutive failures |
| Feedback completion is current | Adds unselected revised Seeds with request/original lineage, leaves `shownBatchId`, original Seeds and original selections unchanged, clears pending and resets consecutive failures |
| Completion is late, deleted or no longer pending | Never inserts/recreates Seed rows or becomes current; terminal status is not overwritten; `deliveredLateAt` is additive when the Batch still exists; usage is retained without a deleting/missing project link |
| Three consecutive failures and no shown Batch | Display state becomes `failed`; metered manual retry remains available without limit |
| Lease expires queued or running across multiple pages | Existing reaper drains bounded indexed pages, fails/settles each attempt once, restores prior state, and does not fail the generation |
| Project deletion begins during an attempt | Deletion transaction clears pending pointers and terminalizes non-terminal Batches; purge removes seed rows; late callback cannot resurrect them |

</frozen-after-approval>

## Code Map

- `convex/schema.ts`: startup Brief pin, command lookup index and `seedBatches.roleOpen` metadata required by the new writers.
- `convex/ai/iterative.ts`, `convex/ai/brief.ts`, `convex/generations.ts`: workflow branch, strict seeds-only Brief prerequisite, idempotent initialization/retry, phase projection and seed-attempt reaping.
- `convex/lib/seedRevisions.ts`: minimum Story 2 canonical DTO, stable encoding/hash, dispatch snapshot loader, `encodeBatchContext`/`decodeBatchContext`; Story 3 retains decisions, staleness, challenge, readiness and read DTOs.
- `convex/lib/seedDispatch.ts`: pure dedupe class/key, command and attempt identity.
- `convex/lib/seedContract.ts`: tags, sentence/word checks, role-aware schemas and validation.
- `convex/seedRuns.ts`: default-runtime dispatch, claim, complete, fail, settle, supersede and lease ownership.
- `convex/ai/seeds.ts`: Node action only; claim, frozen input assembly, bounded provider call, completion/failure.
- `convex/ai/promptDefinitions.ts`, `promptProgram.ts`, `trustedContext.ts`: seed/feedback scaffolds, topology stage, prompt version and delimited input budget.
- `convex/ai/providers.ts`, `openrouter.ts`, `instrument.ts`: seed-only retry/timeout options and the two role slots, preserving all existing defaults.
- `convex/projects.ts`, `projectErasure.test.ts`: terminalize seed work in the deletion transaction and prove no resurrection.
- Focused contract, pipeline, lifecycle, reaper, provider, prompt and context-boundary tests named below.

## Tasks & Acceptance

- [x] **Lifecycle and frozen Brief:** Add the `seeds` topology stage and conditional post-Brief branch. `runGenerationBriefStage` may expose its outcome without changing legacy fail-open callers. Seeds initialization accepts only the generation's persisted Brief id and frozen `generationArtifacts` settings projection/length target; retry schedules a resume action using the pinned seeds-specific Brief path over frozen `generationSources`, then the same initializer. Never re-enter the generic latest-reusable lookup after the startup pin. Require `requireReportEditAccess`, seeds workflow, active generation and deletion guards on public retry, with each authorization branch tested. It does not call `startIterativeGeneration` or re-resolve mutable profile/project inputs. Phase projection is additive. The running/no-summary seed initialization path must not fall into the existing reaper rule that treats absent section runs as generic startup failure: record an initialization error and preserve the retryable state. Batch lease scans use their 10-minute expiry, not the legacy 30-minute generation cutoff. Normal reservations remain `sections`.
- [x] **Canonical snapshot boundary:** Implement only the AD-36 primitives dispatch needs now: versioned item DTO, role/kind/id sort, sorted-key serialization, contribution/context hashes, complete active-predecessor plus own-feedback/target snapshot load, immutable row round-trip and bounded prompt projection. Story 3 later owns mutation-driven recomputation, selection revision changes, stale explanations, approval challenges and readiness. Dispatch writes rows and revision in one transaction; the action decodes only those rows.
- [x] **Dispatch and ownership:** Implement AD-34 identities, the approved dedupe matrix, one-pending fence, two-request reservation counter, batch/context writes, prior-state transition, scheduling and text-free event. Claim CAS checks queued status, active generation, `awaiting_input`, workflow, deletion barrier and `pendingBatchId`. Every terminal path is idempotent. Completion/failure with a known count settles that count once; the reaper settles the reserved count conservatively when actual requests are unknown. Once `settledAt` exists, late actual-count callbacks do not alter settlement or double-count usage. Test queued expiry, a one-request crash and late settlement separately. A shared `MutationCtx` helper in `generations.ts` owns generation-field changes in the caller's transaction.
- [x] **Contract and completion:** Implement the six tags and display labels, deterministic one-sentence/25-word fixtures including abbreviations and decimals, 1–2 bullets/tags, 3–5 Batch size, diversity rules, 1–3 feedback results, and role-11 links validated for role, same-generation membership and dispatch-time activity against the frozen snapshot only. Never read live selections in the action; Story 3 revalidates current links at approval. Validate provenance against frozen `generationSources` bytes. Completion persists only validated rows and follows the AD-33 writer matrix; feedback outputs are unselected and linked. Failure/late/consecutive-failure behavior matches the matrix above.
- [x] **Node action and prompt boundary:** Add only policy/scaffold text to `promptDefinitions.ts`; include it and the `seeds` stage in `promptProgram`. Build the system prompt from policy plus frozen style projection, and the user message through trusted-context markers from objective, frozen Brief, frozen sources, decoded decisions/feedback, frozen settings and length target. Capture request bytes in the dispatch/edit/claim test. Use `maxRetries: 0`, 90-second timeout and `max_tokens: 1200` on both direct Anthropic and OpenRouter through seed-scoped client options and HTTP transport stubs; preserve every existing provider default.
- [x] **Metering, recovery and deletion:** Persist `seedBatches.roleOpen` at dispatch for AD-39 foreground latency: true only when initially dispatched by an open; an open that reuses a prefetched Batch leaves its original false value unchanged, so it remains excluded from foreground-dispatch latency. Add optional schema metadata for compatibility and assert the value on actual dispatch. Validate event role scope, exactly one actor, and completion/failure/late emission without client text. Add `generation:seeds:<roleId>` and `generation:seedFeedback:<roleId>` to the closed slot contract. Count each transport request; never reject on usage. Extend the existing reaper with bounded indexed continuation over both queued and running leases, including more than one page. Extend project terminalization to clear `pendingBatchId` and fail non-terminal Batches before purge. Test post-purge callbacks and detached retained usage.
- [x] **Scope guards:** Stored seeds generations are refused by legacy approve/regenerate; cancellation supports both workflows and fences attempts. No public `seeds.*` decision/readiness/sign-off API, workspace route, Summary, prose write or prefetch caller ships in this story. Extend the report-authorization and proposal regressions to prove seed paths cannot write report prose or `chatProposals`.
- [x] **Verification:** Focused suites cover `seedDispatch`, `seedRevisions` round-trip/interleaving, `seedContract`, `ai/seeds`, lifecycle/Brief retry, reaper paging, erasure, prompt scaffolds/version, context boundary, instrument slots and provider HTTP options. Then run `bash scripts/loop-verify.sh` and three independent `gpt-6-astra` medium reviews against the baseline after implementation.

## Verification

- Owner checkpoint: the frozen intent and both policies were approved on 2026-09-18 before implementation.
- Implementation gate: `bash scripts/loop-verify.sh`; no component suite unless implementation unexpectedly touches component code.
- Provider evidence must cross the real request boundary with HTTP transport stubbed for both gateways; constructor-only tests are insufficient.
- Required behavioral witnesses: dispatch/R1 edit/claim request bytes; open/prefetch race; redelivered command; exact two-request repair; late callback after deletion/purge; multi-page queued/running reaping; missing-Brief retry without analysis rerun.

## Execution Notes

The user-confirmed agent-tree workflow prepared this checkpoint. The native BMAD launcher remains absent, so this is not a native orchestrator run. The owner accepted the checkpoint with “do it” on 2026-09-18, authorizing implementation and both proposed policies.

The dark rollout is deliberate: Story 2 makes stored/test `seeds` generations executable but does not create them through normal reservation. Activation waits for the decision APIs, sign-off and workspace slices. This avoids routing a writer into an incomplete workflow.

## Suggested Review Order

1. Pending checkpoint decisions and dark-rollout boundary.
2. Brief prerequisite, retry seam and lifecycle ownership.
3. Immutable snapshot/revision slice boundary with Story 3.
4. Dispatch identity, attempt state, settlement and recovery.
5. Contract/provenance and provider request boundary.
6. Deletion, no-prose guarantees and verification witnesses.

## Checkpoint review record

Independent reviewer: `gpt-6-astra`, medium. The first review required clarification of context-independent command identity, the full retry matrix, feedback completion, conservative reaper accounting, foreground dispatch metadata and context budget units. Those corrections are incorporated above. The Brief proposal now preserves FR-41 through a durable startup pin instead of adopting a newer writer edit after failure. Final Astra medium re-review found the spec ready for the owner checkpoint with all material findings addressed. Its minor pending-Batch wording correction is incorporated. Review evidence: `.git-local-evidence/story2-spec-review-final.md`. This is spec review, not implementation approval or test evidence. Implementation is authorized by the owner checkpoint recorded above.


## Implementation decisions and evidence

The approved checkpoint was implemented through the user-confirmed agent-tree workflow. This is not a native BMAD orchestrator run; the native deferred-work ledger remains untouched.

The prompt limit is 600,000 UTF-8 bytes, using the existing trusted-context ceiling of 150,000 tokens times four characters as a conservative byte ceiling. The 64,000-byte logical row, 512,000-byte snapshot and 128-item collection limits are conservative processing bounds, not selection or usage caps. They leave room for metadata, the complete frozen Brief and settings, policy scaffolding and one bounded repair instruction. Fixed context overflow rejects dispatch before writes; source excerpts alone may be shortened with explicit notices. Exact boundaries and one-unit overflow have focused tests.

New optional metadata persists the startup Brief pin (including explicit absence), its input hash, and foreground dispatch identity. Indexed command identity is independent of context revision. Two additional indexes bound active decision and feedback reads to the roles contributing to the snapshot. Generation helpers own seed counter/version changes inside each attempt transaction.

The normal Convex codegen command was attempted and refused because this worktree has no configured CONVEX_DEPLOYMENT. New-module references derive their argument and result types from registered function exports through typed makeFunctionReference calls. Generated files were not edited, and no deployment was configured or changed.

The initial post-analysis seed branch, frozen Brief retry, legacy section refusal, authorization branches, cancellation, deletion, immutable claim input, command redelivery, feedback lineage, conservative recovery settlement, and prompt/provider boundaries are exercised by focused tests. Ordinary reservations remain sections. Canonical verification and independent implementation reviews are recorded below when complete.

## Final verification and review

`bash scripts/loop-verify.sh` passed all nine steps on 2026-09-18: Convex typecheck, Svelte check with zero errors and warnings, 205 test files and 2,999 tests, test discovery, production build, and both uploader harnesses (93 PowerShell and 47 Bash checks). No component files changed; the optional local browser suite was not run. Provider tests stub the real SDK HTTP transport; no deployment or live model evaluation was performed.

Three independent `gpt-6-astra` medium review layers covered blind correctness, edge cases and verification gaps. Their accepted implementation and evidence findings were corrected and independently rechecked. An Astra medium review lead closed T1-T8 and rejected T9 because the hypothesized feedback retargeting has no supported writer. No material finding remains open. The final additional witness directly calls completion with an out-of-snapshot advancement reference and proves that no invalid Seed persists.

Local evidence is preserved under `.git-local-evidence/`: `story2-verify-final.log`, the three initial and correction review reports, `story2-review-triage.md`, `story2-review-closure.md`, and manifests identifying the reviewed and final artifacts. Evidence files are not part of the commit.
