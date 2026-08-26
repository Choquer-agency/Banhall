---
title: 'Bounded chat context and safe empty thread reads'
type: 'bugfix'
created: '2026-08-26'
status: 'done'
baseline_revision: '5135f00614a0092a2a3bb739d449963c91919a96'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** CAP-8. The report chat sends the whole thread history (agent default: 100 recent messages, tool messages included) to the model on every turn, `listProposals` collects every proposal a thread ever produced regardless of what the panel has loaded, and `listMessages` throws `Thread not found` on a missing thread so a stale subscription renders as an error instead of an empty conversation.

**Approach:** Pass explicit `contextOptions` (`recentMessages: 30`, `excludeToolMessages: true`) on the `reportChatAgent.streamText` call; give `listProposals` the same `startOrder`/`endOrder` window `listTurns` already takes and resolve proposals through the turns in that window; make `listMessages` return an empty page for a thread with no `agentChatThreads` row. Frontend: `AgentChatPanel.svelte` passes the window it already computes for `listTurns`.

## Boundaries & Constraints

**Always:**
- Public function paths `api.chatV2.listMessages`, `api.chatV2.listProposals`, `api.chatV2.listTurns` stay; `listProposals` gains two required args (`startOrder`, `endOrder`) — its only caller is `AgentChatPanel.svelte`, update it in the same change.
- Export `CHAT_CONTEXT_OPTIONS` from `convex/ai/chatAgentV2.ts` as a `const` object `{ recentMessages: 30, excludeToolMessages: true }` typed `ContextOptions` (from `@convex-dev/agent`), and pass that exact object as `contextOptions` in the third argument of the existing `streamText` call. Do not set it on the `Agent` constructor: the story anchors it on the call site and the constructor default would silently apply to any future callsite.
- `listProposals` reads with `withIndex` only (no `.filter`): turns via `chatTurns.by_agentThreadId_and_order` (same bounds and `take(200)` as `listTurns`), proposals via a new `chatProposals` index `by_agentThreadId_and_promptMessageId` (`["agentThreadId", "promptMessageId"]`). Return order: ascending `createdAt`, ties by `_creationTime` (the previous `.order("asc")` on `by_agentThreadId` was creation order).
- `listProposals` keeps its existing early returns (`[]` for missing thread, `[]` for no access) and adds `[]` when `startOrder > endOrder`.
- `listMessages` on a missing thread returns `{ page: [], isDone: true, continueCursor: "", streams: undefined }` — the same shape the happy path returns — and must not call `listUIMessages`/`syncStreams` (no component read for an unknown thread). Access denial for an existing thread still throws via `requireInternalProjectAccess` (unchanged).
- Schema change is additive: one new index, no new fields, no backfill.

**Block If:**
- `npm run check` rejects the literal empty page as a `PaginationResult<UIMessage>` (verified: `listUIMessages` returns `Promise<PaginationResult<UIMessage>>` from `convex/server`, whose required fields are exactly `page`, `isDone`, `continueCursor`); do not paper over with a cast.
- `AgentChatPanel.svelte` needs proposals from outside the loaded message window to render something the panel shows today (it does not: `correlateProposals` only attaches proposals to loaded messages, and orphans are rendered under the loaded transcript).

**Never:**
- Do not change what the model receives beyond `contextOptions` (system prompt, grounding block, tools, thinking, transforms untouched).
- Do not touch `correlateProposals` or its legacy fallbacks in `src/lib/chat/turnParts.ts`.
- Do not add search options (`searchOptions`, vector/text search) to the context.
- Do not change `listTurns`, `sendMessage`, `saveProposal`, or the turn lifecycle mutations.
- No AI write path to report prose (unchanged by this story).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Context options wired | `CHAT_CONTEXT_OPTIONS` imported in a test | Equals `{ recentMessages: 30, excludeToolMessages: true }`; `streamText` call in `chatAgentV2.ts` passes `contextOptions: CHAT_CONTEXT_OPTIONS` | No error expected |
| Proposals inside window | Thread with turns orders 1..5, each with one proposal via its `promptMessageId`; `listProposals({ startOrder: 2, endOrder: 4 })` as an authorized writer | Exactly the 3 proposals of turns 2..4, ascending `createdAt` | No error expected |
| Proposals outside window | Same thread; `listProposals({ startOrder: 5, endOrder: 5 })` | Only turn 5's proposal | No error expected |
| Inverted window | `startOrder: 4, endOrder: 2` | `[]` | No error expected |
| Missing thread | `listProposals` with an `agentThreadId` that has no `agentChatThreads` row | `[]` | No error expected |
| No access | Anonymous / unmapped identity calls `listProposals` on a real thread | `[]` | No error expected |
| Missing thread messages | `listMessages` with unknown `threadId`, `paginationOpts { cursor: null, numItems: 80 }`, `streamArgs: undefined`, authorized identity | `{ page: [], isDone: true, continueCursor: "", streams: undefined }` | No throw |
| Existing thread, no access | `listMessages` on a real thread by a role-less identity | Rejects with `NOT_AUTHORIZED` (current behavior) | `ConvexError` from `requireInternalProjectAccess` |

</intent-contract>

## Code Map

- `convex/ai/chatAgentV2.ts:224` -- `reportChatAgent = new Agent(...)`: leave the constructor alone. `:391-411` -- the single `reportChatAgent.streamText(ctx, { threadId }, { promptMessageId, system, tools, providerOptions, maxOutputTokens, experimental_transform, onStepFinish }, { saveStreamDeltas: true })` call; add `contextOptions: CHAT_CONTEXT_OPTIONS` to the third argument. Import `type ContextOptions` from `@convex-dev/agent` (already a dependency of this file's `Agent` import). Define and export `CHAT_CONTEXT_OPTIONS` next to `CHAT_MAX_OUTPUT_TOKENS`/`CHAT_THINKING` constants.
- `node_modules/@convex-dev/agent/dist/client/types.d.ts:150-165` -- `ContextOptions`: `excludeToolMessages?: boolean`, `recentMessages?: number` (default 100). `dist/client/index.d.ts:1393` -- `streamText` third arg accepts `contextOptions`. Read-only evidence.
- `convex/chatV2.ts:53-59` -- `threadRow(ctx, agentThreadId)` helper reused by every query.
- `convex/chatV2.ts:84-104` -- `listMessages`: `if (!thread) throw new Error("Thread not found")` at `:92` is the line to replace with the empty-page return; keep `requireInternalProjectAccess` after the thread check.
- `convex/chatV2.ts:107-120` -- `listProposals`: today `by_agentThreadId` + `.order("asc").collect()`. Rebuild per Boundaries. `convex/chatV2.ts:122-147` -- `listTurns`: the window pattern to mirror (`startOrder > endOrder` guard, `by_agentThreadId_and_order` with `.gte/.lte`, `.order("desc").take(200)`, reverse). Its `turns[].promptMessageId` is the join key into proposals.
- `convex/chatV2.ts:851-866` -- `saveProposal` insert writes `promptMessageId` on every new row (all three tools in `chatAgentV2.ts:57-134` pass it). Read-only.
- `convex/schema.ts:803-846` -- `chatProposals` table; indexes at `:845-846` (`by_agentThreadId`, `by_agentThreadId_and_toolCallId`). Add `.index("by_agentThreadId_and_promptMessageId", ["agentThreadId", "promptMessageId"])`. `chatTurns` table (search `chatTurns: defineTable`) already has `by_agentThreadId_and_order`. Read-only.
- `src/lib/components/chat/AgentChatPanel.svelte:225-227` -- `proposalsQ = useQuery(api.chatV2.listProposals, () => selectedThreadId ? { threadId } : "skip")`. `:336-346` -- `startOrder`/`endOrder` derived from loaded `messages` and the `turnsQ` args closure; mirror that closure for `proposalsQ` (skip when `startOrder < 0`, pass the primitive bounds). `:383-385` -- the "latest proposal" auto-scroll effect reads `proposalsQ.data` last element; window-bounded data keeps the newest turn (loaded newest-first, 80 items) so behaviour is unchanged.
- `src/lib/chat/uiMessages.svelte.ts:44-68` -- consumer of `listMessages`: `usePaginatedQuery` reads `page/isDone/continueCursor`; `streamListQ.data?.streams` is optional-chained, so `streams: undefined` is safe. Read-only.
- `src/lib/chat/turnParts.ts:416-475` -- `correlateProposals`; read-only, no change.
- `convex/chatTurns.test.ts` -- **home for the new tests.** Reuse `createTest`/`setup`/`insertTurn` and the `listTurns` describe (lines ~600-680) that seeds `agentChatThreads` + `chatTurns` rows directly. Add a `describe("listProposals")` and `describe("listMessages")`. Anonymous/role-less fixtures: see `convex/reportAuthz.test.ts:1-120` (`isAnonymous: true` user, user with no `role`), `errorCode` helper at `:99-107` (copy, do not import across test files).

## Tasks & Acceptance

**Execution:**
- `convex/schema.ts` -- add `by_agentThreadId_and_promptMessageId` index to `chatProposals` -- bounded proposal reads without `.filter`.
- `convex/ai/chatAgentV2.ts` -- export `CHAT_CONTEXT_OPTIONS`; pass `contextOptions: CHAT_CONTEXT_OPTIONS` in the `streamText` call -- cap model context at 30 recent non-tool messages.
- `convex/chatV2.ts` -- `listMessages` returns the empty page on a missing thread; `listProposals` takes `startOrder`/`endOrder`, resolves turns in the window, gathers each turn's proposals via the new index, sorts ascending by `createdAt` then `_creationTime` -- bounded reads and no throw on stale thread ids.
- `src/lib/components/chat/AgentChatPanel.svelte` -- pass `startOrder`/`endOrder` to `listProposals`, skipping while `startOrder < 0` -- the only caller must supply the window.
- `convex/chatTurns.test.ts` -- add `listProposals` and `listMessages` describes covering every I/O matrix row, plus a `CHAT_CONTEXT_OPTIONS` equality assertion -- deterministic proof of CAP-8.

**Acceptance Criteria:**
- Given a thread with more than 30 persisted messages, when a turn streams, then the agent's context fetch is configured with `recentMessages: 30` and `excludeToolMessages: true` (verified by the exported constant being the object passed at the call site; no test-time model call).
- Given an `AgentChatPanel` with a selected thread and loaded messages, when messages load, then `listProposals` is subscribed with the same `startOrder`/`endOrder` the `listTurns` subscription uses and proposal cards attach to their messages exactly as before.
- Given a browser subscription to `listMessages` for a thread id that no longer maps to an `agentChatThreads` row, when the query runs, then it resolves with an empty page and no stream data instead of throwing.
- Given `npm test -- chatTurns` and `npm run check`, when run, then both are green.

## Design Notes

- Proposal rows written before `promptMessageId` was recorded (before commit `86c8008`, 2026-07-24) or before `chatTurns` existed (before `8fa3a2e`, 2026-07-28) have no turn to anchor to and will no longer be returned. That is a ~4-day pre-launch window of dev data; `correlateProposals` legacy fallbacks (`messageId`, creation time) still apply to rows that do have a turn but no `toolCallId`. Record nothing else; no migration.
- `listProposals` reads at most 200 turns and one indexed query per turn. Implement the per-turn fetch with `Promise.all` over the turns array, then flatten and sort.
- Empty-page literal for `listMessages`:
  ```ts
  if (!thread) {
    return { page: [], isDone: true, continueCursor: "", streams: undefined };
  }
  ```
  Keep the object structurally identical to the happy-path return so the frontend `ListMessagesQuery` contract is unchanged.

## Verification

**Commands:**
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test -- chatTurns` -- expected: all cases pass including the new `listProposals`/`listMessages` describes.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test -- turnParts` -- expected: unchanged and green (correlation untouched).
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm run check` -- expected: 0 errors (new `listProposals` args satisfied by `AgentChatPanel.svelte`).

## Spec Change Log

## Review Triage Log
### 2026-08-26 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 1, low 3)
- defer: 0
- reject: 17
- addressed_findings:
  - `[medium]` `[patch]` `abortStreaming` had the `listMessages` empty-page replacement pasted into its missing-thread branch (mutation returned a pagination object instead of throwing, with a subscription comment that made no sense in a mutation; violates the Never clause on turn lifecycle mutations). Restored `throw new Error("Thread not found")` in `convex/chatV2.ts`.
  - `[low]` `[patch]` No test covered `abortStreaming` on an unknown thread. Added `describe("abortStreaming")` in `convex/chatTurns.test.ts` asserting the throw.
  - `[low]` `[patch]` `proposalsQ` in `AgentChatPanel.svelte` referenced `startOrder`/`endOrder` ~110 lines before their declaration (worked only because the args closure is lazy). Moved `proposalsQ` and the dependent `grouped` derived below `turnsQ`; removed the "evaluated lazily" caveat from the comment.
  - `[low]` `[patch]` Docblock promised `createdAt` ties break by `_creationTime` but no test exercised a tie. Added a `listProposals` case with three proposals sharing `createdAt` on one turn.

## Auto Run Result

**Summary:** CAP-8 shipped. `reportChatAgent.streamText` now passes `contextOptions: CHAT_CONTEXT_OPTIONS` (`recentMessages: 30`, `excludeToolMessages: true`, exported from `convex/ai/chatAgentV2.ts`). `listProposals` takes `startOrder`/`endOrder`, resolves the turns in that window via `chatTurns.by_agentThreadId_and_order`, and gathers each turn's proposals via the new `chatProposals.by_agentThreadId_and_promptMessageId` index, sorted by `createdAt` then `_creationTime`. `listMessages` returns an empty page for a thread with no `agentChatThreads` row. `AgentChatPanel.svelte` passes the `listTurns` window to `listProposals`.

**Files changed:**
- `convex/ai/chatAgentV2.ts` — export `CHAT_CONTEXT_OPTIONS`; pass it as `contextOptions` at the `streamText` call site.
- `convex/chatV2.ts` — `listMessages` empty page on missing thread; window-bounded `listProposals`.
- `convex/schema.ts` — additive `by_agentThreadId_and_promptMessageId` index on `chatProposals`.
- `src/lib/components/chat/AgentChatPanel.svelte` — `listProposals` subscribed with `startOrder`/`endOrder`, skipped while `startOrder < 0`.
- `convex/chatTurns.test.ts` — `CHAT_CONTEXT_OPTIONS`, `listProposals`, `listMessages`, `abortStreaming` describes.

**Review findings:** 4 patched (medium 1, low 3), 0 deferred, 17 rejected (legacy pre-`chatTurns` proposals dropped is accepted in Design Notes; per-turn `Promise.all`, `take(200)`, and source-inspection verification of the call site are prescribed by the contract; remaining items were style, speculative, or pre-existing behaviour the contract keeps).

**Follow-up review recommendation:** true — patched counts: high 0, medium 1, low 3; score 3×1 + 3 = 6 (≥ 5).

**Verification:**
- `npm test -- chatTurns` — 26 passed.
- `npm test -- turnParts` — 46 passed.
- `npm run check` — 0 errors, 0 warnings.

**Residual risks:**
- Proposals with no matching `chatTurns` row or no `promptMessageId` (pre-2026-07-28 dev data) are no longer returned; no migration by design.
- The call-site wiring of `contextOptions` is verified by a source-text regex test, which is brittle to reformatting and does not exercise runtime; a follow-up could replace it with a `streamText` spy through `@convex-dev/agent/test`.
- Model no longer sees prior tool calls/results; refinement prompts rely on the proposal summary that `getChatContextV2` injects.
