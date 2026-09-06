---
title: Bound repeated work in streaming and usage views
type: refactor
created: 2026-09-06
status: done
baseline_commit: 201e46bd72c89ac2d59ad41022102b88b3f8433f
review_loop_iteration: 0
context:
  - "{project-root}/AGENTS.md"
  - "{project-root}/docs/svelte-migration.md"
---
<frozen-after-approval reason="User authorized implementing audited performance improvements">
## Intent
Stop replaying every accumulated text chunk for each streamed update, while preserving established tool and metadata behavior. Bound the usage dashboard's initial history request to a clearly selected 30-day calendar range, retaining explicit All time and custom range controls. These are sequential audited improvement units authorized by the user.
## Boundaries & Constraints
Always preserve persisted-message authority and exact assembled text/tools/proposals. Use the official AI SDK readUIMessageStream persistently per active stream, preserving its authoritative processing of text, reasoning, steps, metadata and tools. The alternative incremental helper has proven parity defects and must not be used. Feed each accepted chunk once; retain pending input and current state rather than full processed history. Preserve duplicate/gap acceptance rules and guard stale asynchronous publication by thread/version. Never change backend permissions, amounts, exact totals, timezone conventions, or add a silently incomplete query cap. No new telemetry vendors or schema.
## I/O & Edge-Case Matrix
| Scenario | Input | Expected | Error |
|---|---|---|---|
| Standard stream | successive batches with steps, text/reasoning and metadata | exact existing output, process each chunk once | authoritative SDK handles invalid sequences |
| Special chunk | tool, metadata, transient data, step or error | existing SDK semantics | mirror error suppression/ID assertions; no lost tool/proposal |
| Delivery | duplicate, gap/resend, interleaved streams | no duplicate text, contiguous cursors | retain resend behavior |
| Lifecycle | status update, stream removal, thread switch, skip | correct current-thread projection and cache cleanup | no stale async results |
| Usage | initial, preset and custom dates | initial last30 calendar days, explicit exact All time available | auth gate unchanged |
</frozen-after-approval>
## Code Map
- src/lib/chat/uiMessages.svelte.ts:147 full accumulated derive in reactive effect; current cancellation only drops outdated results. Keep final persisted merge and hasPersistedMessage semantics.
- src/lib/chat/agentInternal.ts is the existing SDK import boundary. Installed node_modules/@convex-dev/agent/dist/deltas.js updateFromUIMessageChunks documents current error handling and ID assertion. Official ai readUIMessageStream owns reconstruction; reuse blankUIMessage/statusFromStreamStatus/joinText through existing boundary where appropriate. Backend emits start-step, so text-only benchmarks are insufficient.
- src/lib/test/convex-svelte-stub.svelte.ts supports exact query variants, paginated rows and cursor assertions. Add small real createUIMessages component harness to verify transport/state wiring.
- src/routes/admin/usage/+page.svelte starts null date bounds; keep All time and end-of-local-day conversion, change default to30days with local calendar arithmetic (DST-safe).
- .audit/performance-audit-20260906/chat-derive-profile.mjs provides baseline stress fixtures. New script should compare successive batches against full replay, including exact output parity and processing time.
## Tasks & Acceptance
- [x] Add persistent official SDK projection, settled batch acknowledgments, memory cleanup and stale async guards; support cloneable plain values. Close input and wake pending pulls on disposal, settle acknowledgments, drain/catch consumer, cancel scheduled publication. Coalesce browser publication per animation frame.
- [x] Add exact SDK parity fixtures and browser hook tests for matrix behaviors. No mocks of the actual reconstruction helpers.
- [x] Set usage default to30days with truthful preset selection; verify initial bounded query and explicit All time/custom requests through rendered route.
- [x] Record repeatable before/after streaming-session benchmark using100/1000/5000chunks and equivalent final output, measuring total processing and largest batch separately.
Acceptance: Given standard framed streaming updates, prior chunks are not replayed and every batch output matches existing SDK. Given tool/metadata/error chunks or lifecycle changes, output/ordering/persisted precedence remain correct. Given default usage page, initial query contains local start/end covering30calendar days; selecting All time removes bounds without truncating totals.
## Design Notes
Use a highWaterMark0 input stream and acknowledge batches when the parser requests the next input after their final chunk. Test every prefix, including non-yielding step boundaries. SDK clones snapshots, so costs still grow with message size; claim reduced replay work, not constant-time appends. Mirror missing-tool suppression, other error behavior and custom ID assertions. Dispose all stream resources on removal/thread/skip/unmount; status-only updates must remain visible. Preserve current persisted merge and acknowledgment code.

## Spec Change Log
2026-09-06 investigation: actual app streams include step framing and provider metadata. The installed incremental helper differs from the authoritative SDK at intermediate prefixes. Replaced the proposed narrow helper fast path with persistent official SDK reconstruction; user-facing intent and compatibility constraints are unchanged. Keep all parser/report work and tested protocol semantics. Exploratory timings are not final evidence; rerun serially after implementation.

## Verification
Run focused Node SDK parity and browser lifecycle/usage tests. Parent runs canonical loop-verify and complete component suite after all units. Record actual runtime conditions and limitations; Node timings are not field INP. Do not commit or push from implementation subtask. Touch only streaming helper/integration/tests, usage range/tests, and tracked benchmark scripts.

## Final Verification

All nine steps of `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` passed on the final implementation: 2,090 unit tests, 580 browser component tests, both typechecks, discovery guard, production build and both uploader harnesses. Focused independent review findings were resolved and reinspected. Final sequential benchmark results, source hashes, limitations and reproduction commands are committed in [performance evidence](../../docs/performance-improvements-2026-09-06/README.md).

## Suggested Review Order

**Persistent parsing**

- Consume accepted chunks once through the authoritative SDK.
  [persistentProjection.ts:9](../../src/lib/chat/persistentProjection.ts#L9)

**Subscription lifecycle**

- Dispose stream resources and reject stale publications without clearing transient loading state.
  [uiMessages.svelte.ts:79](../../src/lib/chat/uiMessages.svelte.ts#L79)

**Usage range**

- Bound the initial calendar range; preserve explicit All time and custom dates.
  [+page.svelte:30](../../src/routes/admin/usage/+page.svelte#L30)

**Verification**

- Verify concurrent queued batches against the original SDK output.
  [persistentProjection.test.ts:91](../../src/lib/chat/persistentProjection.test.ts#L91)

- Compare every batch and distinguish total processing from largest-batch cost.
  [streaming-probe.mjs:20](../../scripts/performance/streaming-probe.mjs#L20)

## Astra High Review Findings

- [x] [Review][Patch] Quote YAML context paths.

Astra high follow-up: all patch findings above are resolved. The complete nine-step gate and independent reinspection passed; [review and verification record](../../docs/performance-improvements-2026-09-06/astra-high-review.md).
