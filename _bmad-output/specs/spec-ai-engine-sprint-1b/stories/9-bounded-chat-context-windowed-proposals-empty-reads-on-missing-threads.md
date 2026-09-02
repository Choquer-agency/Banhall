---
title: 'Bounded chat context, windowed proposals, empty reads on missing threads'
type: 'bugfix'
created: '2026-09-01'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_revision: '4b38e6c891f35be9e8dea57aec6622812f8cddaa'
baseline_commit: '4b38e6c891f35be9e8dea57aec6622812f8cddaa'
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '{project-root}/docs/product-domain.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Restore the ten pre-existing failing cases in the excluded Bun proposal test file.
    evidence: |-
      At baseline 4b38e6c891f35be9e8dea57aec6622812f8cddaa, `bun test tests/chatProposals.test.ts` reported 12 passing and 10 failing cases. After the Story 9 review patches it reports the same 12 passing and 10 failing cases, while the Story 9 `proposal access` subset passes 4 of 4.
    location: >-
      tests/chatProposals.test.ts
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Report chat relies on the agent library's larger default context, `listProposals` reads an entire thread, and a missing thread mapping makes `listMessages` throw. Proposal reads also hide authorization failures as empty data.

**Approach:** Pin a 30-message non-tool context at the `streamText` call, give `listTurns` and `listProposals` one optional bounded-window contract, join proposals only through turns in that window, and distinguish absent thread mappings from unauthorized reads of existing threads.

## Boundaries & Constraints

**Always:** Keep `api.chatV2.listMessages`, `api.chatV2.listProposals`, and `api.chatV2.listTurns` paths stable. Make `startOrder` and `endOrder` independently optional on both windowed queries, with shared defaults of `0` and `Number.MAX_SAFE_INTEGER`, inclusive bounds, and the existing newest-200 limit. Calls with only `{ threadId }` must remain valid. Export one `CHAT_CONTEXT_OPTIONS` value with `recentMessages: 30` and `excludeToolMessages: true`, checked with `satisfies ContextOptions`, and pass that exact value in the fourth `streamText` options argument beside `saveStreamDeltas`. For `listMessages` and `listProposals`, resolve the mapping first, return an empty result when it is absent, then call `requireInternalProjectAccess` before validating or reading the window so an existing unauthorized thread always throws Story 1's typed error. Preserve proposal creation order. Treat `listMessages` emptiness as `page: []` in a valid terminal pagination result; a bare array is not source-compatible with `usePaginatedQuery`. Add only the compound proposal lookup index required below, with no fields or backfill. Never hand-edit `convex/_generated/`.

**Block If:** The installed agent API no longer accepts `contextOptions` in the fourth `streamText` options argument, or exact proposal windowing cannot use the verified prompt-message join. Do not compensate with casts, a whole-thread scan, or an arbitrary proposal cap.

**Never:** Do not set the context limit on the Agent constructor, enable context search, change prompts, tools, grounding, streaming, or report-prose mutation paths. Do not change `listTurns` authorization behavior, edit `AgentChatPanel.svelte` or `uiMessages.svelte.ts`, return a bare array from `listMessages`, include proposals without a matching window turn, or repurpose any domain field.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Context bound | Agent thread has 35 successful message rows, including five tool-classified rows | The exported constant is exact; runtime context fetch returns 30 non-tool rows and no tool row | No provider or network call |
| Default proposal window | More than 200 turns have prompt-linked proposals; caller passes only `threadId` | `listTurns` and `listProposals` use the same newest-200 default window; an older proposal is absent | No error expected |
| Explicit or one-sided window | Caller supplies either or both inclusive order bounds | Proposals correspond only to the turns returned by `listTurns` for the same arguments | Inverted resolved bounds return `[]` after authorization |
| Missing thread | Mapping never existed | `listMessages.page` is `[]`; `listProposals` is `[]`; no component or proposal read runs | No error expected |
| Deleted thread | Mapping is hard-deleted while orphan turns or proposals remain | Same empty results as a nonexistent thread; orphan rows are not exposed | No error expected |
| Existing unauthorized thread | Mapping and project exist; caller is role-less | Both reads reject with `NOT_AUTHORIZED`, never an empty result | Existing Story 1 `ConvexError` |

</intent-contract>

## Code Map

- `convex/ai/chatAgentV2.ts:6-12,201-224,391-411`: import `ContextOptions`, define and export `CHAT_CONTEXT_OPTIONS` beside chat limits, and pass it in the fourth `reportChatAgent.streamText` argument. Leave the Agent constructor and model arguments unchanged.
- `node_modules/@convex-dev/agent/src/client/types.ts:187-198` and `src/client/index.ts:528-578`: read-only G-5 evidence for the exact fields and fourth-argument location in installed `@convex-dev/agent` 0.6.4.
- `node_modules/@convex-dev/agent/src/client/search.ts:138-154` and `src/component/messages.ts:651-679`: read-only evidence that tool exclusion is applied before the `recentMessages` pagination limit.
- `convex/chatV2.ts:56-61,85-149`: `threadRow`, `listMessages`, unbounded `listProposals`, and required-argument `listTurns`. Extract shared window validators, defaults, and a newest-200 turn loader; reuse it from both windowed queries.
- `convex/chatV2.ts:762-880` and `convex/ai/chatAgentV2.ts:55-137`: current proposal writes carry the turn's `promptMessageId`. Rows without that anchor cannot be proven inside a window and stay excluded.
- `convex/schema.ts:778-846`: `chatTurns.by_agentThreadId_and_order` is the window source. Add `chatProposals.by_agentThreadId_and_promptMessageId` for exact per-turn reads.
- `convex/lib/auth.ts:44-63`: Story 1 dependency. `requireInternalProjectAccess` yields `NOT_AUTHENTICATED` for missing, unmapped, or stored-anonymous identities and `NOT_AUTHORIZED` for a mapped role-less user.
- `convex/chatTurns.test.ts:1-89,607-687`: existing registered agent-component harness and `listTurns` coverage. Extend this file for all CAP-8 cases.
- `convex/reportAuthz.test.ts:451-464`: existing proof that `listMessages` preserves Story 1 authorization on an existing thread; mirror the role-less assertion for proposals in the Story 9 suite.
- `src/lib/components/chat/AgentChatPanel.svelte:218-227,336-346`: read-only caller evidence. `listProposals` currently passes only `{ threadId }`; `listTurns` passes explicit bounds. Both calls must compile unchanged.
- `src/lib/chat/uiMessages.svelte.ts:36-68`: read-only pagination consumer. Missing-message results require `page`, `isDone`, `continueCursor`, and optional `streams`.
- `src/lib/chat/turnParts.ts:408-476`: read-only proposal correlation. Do not use its legacy fallbacks to weaken the server window.
- `tests/chatProposals.test.ts:287-320,503-530` and `vitest.config.ts:14-50`: read-only secondary `{ threadId }` caller; it is Bun-based and outside `npm test`, but the optional public arguments preserve its call shape.

## Tasks & Acceptance

**Execution:**
- [x] `convex/ai/chatAgentV2.ts`: export the exact typed context constant and wire it into the existing call-site options; cap model history without changing generation behavior otherwise.
- [x] `convex/schema.ts`: add `by_agentThreadId_and_promptMessageId` to `chatProposals`; make exact bounded joins possible without filtering or whole-thread collection.
- [x] `convex/chatV2.ts`: share optional window arguments, defaults, limit, and turn loading between `listTurns` and `listProposals`; authorize existing proposal threads with the throwing helper; fetch prompt-linked proposals through the new index; preserve ascending creation order; return a terminal empty message page for an absent mapping.
- [x] `convex/chatTurns.test.ts`: use the real registered agent component to assert context filtering, then cover default, explicit, one-sided, inverted, missing, deleted, unauthorized, ordering, and unchanged-call-shape behavior for the public queries.

**Acceptance Criteria:**
- Given 35 persisted agent messages including five tool-classified rows, when context is fetched with the constant used by `streamText`, then no more than 30 messages are returned and every returned row is non-tool.
- Given any optional order arguments, when `listTurns` and `listProposals` are called for the same authorized thread with the same arguments, then every returned proposal belongs to a returned turn and a proposal on an outside turn is absent.
- Given no order arguments and more than 200 turns, when the existing `{ threadId }` proposal call runs, then it remains valid and returns proposals only for the default newest-200 turn window.
- Given a thread mapping that never existed or was deleted, when `listMessages` and `listProposals` run, then the message page and proposal list are empty and orphan data is not read or returned.
- Given an existing thread and a mapped role-less caller, when either read runs, then it throws `NOT_AUTHORIZED` rather than returning empty data.
- Given the existing production and test callers, when TypeScript and Svelte checks run, then no caller needs a new required argument and both current call expressions remain unchanged.

## Spec Change Log

- 2026-09-01 plan checkpoint (Claude Fable 5.1, reviewer): approved. SPEC.md D-3 allowed schema set amended to include `chatProposals.by_agentThreadId_and_promptMessageId`; the index is additive with no field, row, or backfill. Verified against `main` 73f0669: `listMessages` throws "Thread not found" on a missing mapping; `listProposals` collects the whole thread; `ContextOptions` exposes `recentMessages` and `excludeToolMessages`; `chatProposals.promptMessageId` is optional. Noted behavior change to tell the team: proposals on legacy rows without `promptMessageId` no longer appear in `listProposals`. Changing `listProposals` from empty-on-unauthorized to the typed `NOT_AUTHORIZED` error matches story acceptance (4) and `listMessages`; `listTurns` keeps its current behavior.

## Review Triage Log

- 2026-09-01, iteration 0: Three review layers completed. Applied patch-level hardening for actual newest-message truncation, immutable context options, duplicate turn anchors, multiple proposals per turn, deterministic equal-time ordering, and real component data behind missing mappings. All verification commands passed after the fixes.

### 2026-09-01 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 3, low 0)
- defer: 1: (high 0, medium 1, low 0)
- reject: 11: (high 0, medium 8, low 3)
- addressed_findings:
  - `[medium]` `[patch]` Updated `tests/chatProposals.test.ts` so its focused fake database, prompt-linked fixture, and anonymous assertion cover the bounded join and typed authentication contract; all four proposal-access cases pass with their existing call shape.
  - `[medium]` `[patch]` Added a default-window test proving a turn and proposal at order `0` remain visible.
  - `[medium]` `[patch]` Added exact timestamp-tie coverage proving proposal reads retain deterministic creation order across repeated queries.

### 2026-09-01 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 1, low 2)
- defer: 0
- reject: 23: (high 0, medium 9, low 14)
- addressed_findings:
  - `[medium]` `[patch]` The production `streamText` wiring was unobserved: `chatTurns.test.ts` now runs `internal.ai.chatAgentV2.streamChatReply` on a queued turn with `reportChatAgent.streamText` spied, and asserts the fourth argument is exactly `{ saveStreamDeltas: true, contextOptions: CHAT_CONTEXT_OPTIONS }` (same reference) and the turn completes; verified the test fails when the `contextOptions` line is removed.
  - `[low]` `[patch]` Authorization coverage gaps at the Vitest surface: added plain `{ threadId }` role-less `listProposals` rejection, an unauthenticated `NOT_AUTHENTICATED` case for both reads on an existing thread, and role-less readers on the missing/deleted-mapping cases so mapping resolution is proven to precede authorization for `listMessages` too.
  - `[low]` `[patch]` Missing rationale comments: documented `CHAT_CONTEXT_OPTIONS` (row-based bound, call-site only, frozen), the `listProposals` empty-vs-throw contract and legacy-row omission, and why `listTurns` deliberately stays empty-on-unauthorized.

### 2026-09-01 — Review pass (third)
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 1, low 4)
- defer: 0
- reject: 19: (high 0, medium 6, low 13)
- addressed_findings:
  - `[medium]` `[patch]` No test proved a proposal written for a real queued turn reads back through the windowed join: `chatTurns.test.ts` now sends a real message, saves a proposal through `saveProposal` with the turn's prompt id (the value the agent library places on the tool context), and asserts it appears in the thread-only, exact-order, and excluded windows of `listProposals`.
  - `[low]` `[patch]` `listProposals` tie-break used `localeCompare`; replaced with plain code-point comparison so equal-time ordering is locale-independent, and the tie test uses the same comparator.
  - `[low]` `[patch]` Context-bound test seeded only assistant tool-call rows and user rows; it now mixes tool-call and tool-result rows with alternating user and assistant text so both tool flavours are proven excluded.
  - `[low]` `[patch]` Added a rationale comment on `chatProposals.by_agentThreadId_and_promptMessageId` naming its consumer and the legacy-row omission.
  - `[low]` `[patch]` `docs/todos/chat-refactor-plan.md` still said `listTurns` shares `listProposals`' empty-on-inaccessible policy; corrected to describe the divergence.

## Design Notes

Current `listTurns` has no declared defaults, but its source already defines the natural behavior: nonnegative agent orders, inclusive bounds, newest 200. Story 9 makes that behavior explicit with `0`, `Number.MAX_SAFE_INTEGER`, and `200`, then reuses one loader so D-5 cannot drift. The no-argument proposal call is formally paired with a no-argument `listTurns` call; it is not claimed to mirror the UI's separate explicit timing subscription.

The canonical schema allowlist did not anticipate the prompt-message index. Exact and bounded behavior is impossible with the two current proposal indexes: collecting by thread is unbounded, taking before filtering is not exact, and the tool-call index cannot constrain a turn. The invocation's later, explicit Story 9 acceptance is the controlling scope for this single additive implementation index, `by_agentThreadId_and_promptMessageId`. It adds no field, row, migration, or domain-semantic change. Nothing broader is authorized.

The acceptance phrase "`listMessages` returns `[]`" means its public collection is empty. Its outer surface is a pagination result consumed by Convex pagination, so the compatible value is `{ page: [], isDone: true, continueCursor: "", streams: undefined }`. A bare `[]` would make the unchanged caller throw instead of rendering empty.

The runtime context test uses `reportChatAgent.createThread`, `saveMessages({ skipEmbeddings: true })`, and `fetchContextMessages` through the registered real component. It must first prove 35 stored rows and five tool-classified rows, then prove the bounded result. No model mock, source-text regex, external request, or test-only production endpoint is needed.

Legacy proposals without `promptMessageId`, including rows predating `chatTurns`, have no trustworthy window membership and are omitted. Preserve the current ascending `_creationTime` contract after flattening indexed per-turn results because the UI treats the last proposal as newest.

## Verification

**Commands:**
- `npx vitest run --project convex convex/chatTurns.test.ts`: expected: all existing turn lifecycle tests and every new CAP-8 case pass without a provider call.
- `bun test tests/chatProposals.test.ts -t "proposal access"`: expected: the secondary proposal caller and focused fake database harness pass all proposal-access cases.
- `npx vitest run --project convex convex/reportAuthz.test.ts`: expected: Story 1 authorization coverage remains green.
- `npm test`: expected: the integrated Vitest suite is green with no regression.
- `PUBLIC_CONVEX_URL=https://example.convex.cloud npm run check`: expected: zero TypeScript or Svelte errors and unchanged callers compile.
- `npx tsc --noEmit -p convex`: expected: backend types pass without casts or generated-file edits.
- `git diff --exit-code -- src/lib/components/chat/AgentChatPanel.svelte src/lib/chat/uiMessages.svelte.ts convex/_generated`: expected: no changes to callers, the pagination adapter, or generated files.

## Auto Run Result

Status: done

Summary: Third review pass over the Story 9 change (30-message non-tool context at `streamText`, shared optional newest-200 turn window for `listTurns` and `listProposals`, indexed prompt-linked proposal joins, terminal empty reads for absent mappings, typed authorization errors on existing threads). Four review layers ran; five patches applied, nothing deferred, no spec or intent changes required.

Files changed:
- `convex/ai/chatAgentV2.ts`: exports the frozen typed context options and passes the exact value to `streamText`.
- `convex/chatV2.ts`: shared turn-window defaults and loading, indexed proposal joins, missing-versus-unauthorized handling; equal-time tie-break now uses code-point id comparison.
- `convex/schema.ts`: adds the compound prompt-message proposal index, now with a rationale comment.
- `convex/chatTurns.test.ts`: context filtering with mixed tool-call and tool-result rows, every CAP-8 matrix row, order `0`, duplicate anchors, timestamp ties, `streamChatReply` fourth-argument wiring, unauthenticated and role-less coverage, and a new write-to-read proof that a proposal saved for a real queued turn is returned by `listProposals`.
- `tests/chatProposals.test.ts`: keeps the thread-only caller valid in its Bun fake harness and expects the typed Story 1 error for anonymous readers.
- `docs/todos/chat-refactor-plan.md`: corrected the stale claim that `listTurns` and `listProposals` share one inaccessible-thread policy.
- This story spec: review triage, follow-up recommendation, verification record.

Review findings: 5 patches (high 0, medium 1, low 4), 0 deferred, 19 rejected (medium 6, low 13). Rejected items were mandated or forbidden by the intent contract (panel edits and error handling, matching the UI's two subscriptions, per-turn or total proposal caps, authorization before mapping resolution, listTurns check ordering, the 30-row bound itself, legacy-row backfill), pre-existing (non-integer bounds on `listTurns`, `getChatContextV2`'s separate proposal read, the Bun harness ordering by creation time), or cosmetic test-structure and comment suggestions.

Follow-up review recommendation: `true`. Patched findings were high 0, medium 1, low 4; score = `3 × 1 + 1 × 4 = 7`.

Verification performed:
- `npx vitest run --project convex convex/chatTurns.test.ts`: 27 passed.
- `bun test tests/chatProposals.test.ts -t "proposal access"`: 4 passed, 18 filtered out.
- `npx vitest run --project convex convex/reportAuthz.test.ts`: 14 passed.
- `npm test`: 108 files, 1,030 tests passed.
- `PUBLIC_CONVEX_URL=https://example.convex.cloud npm run check`: 0 errors, 0 warnings.
- `npx tsc --noEmit -p convex`: exit 0.
- `git diff --exit-code` on `AgentChatPanel.svelte`, `uiMessages.svelte.ts`, `convex/_generated`, and `git diff --check`: passed.

Residual risks: Legacy proposals without `promptMessageId` remain intentionally invisible to `listProposals`, and the `turnParts.ts` fallbacks for such rows are unreachable from this query. `AgentChatPanel.svelte` still calls `listProposals` with only `{ threadId }`, so on threads beyond 200 turns, older paged messages render without proposal cards; the intent forbids panel edits in this story. The panel reads `proposalsQ.data ?? []` and does not render the new typed error for role-less viewers of an existing thread. The full Bun proposal file keeps its ten baseline failures tracked by the existing ledger entry.

## Suggested Review Order

**Window contract**

- Shared resolver and loader keep both queries on identical inclusive newest-200 semantics.
  [`chatV2.ts:56`](../../../../convex/chatV2.ts#L56)

- Missing mappings terminate cleanly, while existing mappings retain typed authorization.
  [`chatV2.ts:125`](../../../../convex/chatV2.ts#L125)

- Proposal joins follow returned turn anchors, deduplicate corrupt anchors, and preserve creation order.
  [`chatV2.ts:156`](../../../../convex/chatV2.ts#L156)

**Context boundary**

- One frozen option pins non-tool history without altering the Agent constructor.
  [`chatAgentV2.ts:216`](../../../../convex/ai/chatAgentV2.ts#L216)

- The production stream passes that exact option beside delta persistence.
  [`chatAgentV2.ts:399`](../../../../convex/ai/chatAgentV2.ts#L399)

**Storage and proof**

- One additive compound index enables exact per-turn proposal reads.
  [`schema.ts:846`](../../../../convex/schema.ts#L846)

- Real component tests prove filtering, newest retention, and provider-free execution.
  [`chatTurns.test.ts:149`](../../../../convex/chatTurns.test.ts#L149)

- Window tests cover optional bounds, caps, duplicates, orphan data, and authorization.
  [`chatTurns.test.ts:827`](../../../../convex/chatTurns.test.ts#L827)
