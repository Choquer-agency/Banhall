---
title: 'Report chat parity, Phase A: defects and quick wins'
type: 'feature'
created: '2026-10-19'
status: 'done'
review_loop_iteration: 4
baseline_commit: '5d32c078'
context:
  - '{project-root}/_bmad-output/planning-artifacts/research/chat-parity-plan-2026-10-19.md'
  - '{project-root}/docs/product-domain.md'
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem.** Research on 2026-10-19 compared Banhall's report chat with ChatGPT and Claude, in five read-only research reports summarized in the plan in `context`. It found defects and missing basics that writers notice first:
- Stop is ignored while the model thinks silently.
- Ordinary refusals show raw server errors and the crash toast.
- Esc closes the whole assistant.
- Turning on Brain or web search changes the tool list and rewrites the prompt cache.
- Favicons leak full source links.
- The saved-message filter lets unknown parts through.
- Apply is shown to people the server will refuse.
- The writer sees "Working…" for minutes, with no reasoning or progress.
- Long jobs end with "say continue".
- The model silently stops seeing older turns.
- Unsent drafts are lost.
- There is no offline state.
- Messages have no size limit.
- The model retypes the whole Completion Report.
- A writer's settings document reaches the chat cut to 5,000 tokens.

**Approach.** Fix the defects. Add server-built progress, Anthropic reasoning summaries, a structured Continue offer and button, the Completion Report on the card, a file list plus a settings-document allowance in the evidence, a visible context-loss divider with a matching note to the model, drafts, a connection state, and message limits. No new AI capabilities (reading files, auto-continue, edit, web cards) come in this phase. Those are Phases B to D.

**Owner decisions, 2026-10-19:**
- **Reasoning:** show Anthropic's thinking summaries. This overrides, for summaries only, the September 8 rule that private reasoning stays out of the browser.
- **Completion Report:** it moves onto the card (a CAP-13 change).
- **Stop:** stays open to anyone on the report. Do not restrict it.
- **Agent setup:** Opus 5.5 high for the orchestrator, workers and reviewer.
- **Order:** Phase A, then check in with the owner.

## Boundaries & Constraints

**Always:**
- Agents propose, humans apply. No path may let an AI tool change report prose directly.
- Schema changes only add optional fields (widen only), with no backfill.
- Client data stays private: fictional data in tests and fixtures only.
- Copy uses plain hyphens only (dashfix) and plain language (copywriting). Use design-system tokens and bits-ui primitives, max font weight 500.
- Raw tool arguments and results never reach the browser. Reasoning reaches it only as Anthropic's summary text, capped, and never after a `searchBrain` call in the same turn.
- A thread that never toggles Brain or web search sends the same tool list on every turn.
- Every change carries tests at the level the repo uses: unit, convex-test, SDK with HTTP stubbed, and component.

**Ask First:**
- Any change to `applyProposal`, `saveProposal` validation, or card state transitions beyond what this spec lists.
- Raising `CHAT_MAX_OUTPUT_TOKENS` or `CHAT_MAX_STEPS`.
- Any dependency change.

**Never:**
- Hand-edit `convex/_generated/`.
- Commit outside your own worktree branch, or push.
- Touch the Projects page, the shell or top-bar files that the Projects dialogs session owns: `src/lib/components/projects/**`, `src/lib/components/shell/**`, `WorkspaceChrome`, `PageTopBar`.

## Contracts (shared by all packages; names are fixed)

**`chatTurns` optional fields** (`convex/schema.ts`):
- `progress?: { phase: "reading" | "thinking" | "tool" | "writing" | "retrying"; tool?: string; section?: "242" | "244" | "246"; step: number; since: number }`
- `continuation?: { reason: "lines_left" | "step_limit" | "cut_off"; nextSection?: "242" | "244" | "246"; remaining?: number }`
- `historyStartOrder?: number`: the oldest message `order` the model read for this turn. Absent means the whole thread.

`chatV2.listTurns` returns all three on each turn it already returns.

**Refusal codes** (`ConvexError` with `data.code`), shown with plain copy and no crash toast:
- `CHAT_TURN_ACTIVE`, with `data.senderName?: string`. Replaces the generic `INVALID_STATE` for the "a reply is still being written" refusal.
- `CHAT_SPEND_BUDGET_EXCEEDED`, which already exists. Adds `data.retryAfterMs?: number`.
- `CHAT_QUEUE_LIMIT_EXCEEDED`, which already exists.
- `CHAT_MESSAGE_TOO_LONG`, with `data.maxChars: number`.

**Limits:**
- `MAX_CHAT_MESSAGE_CHARS = 20_000`
- `MAX_CHAT_HIGHLIGHT_CHARS = 12_000`

Both are enforced in `sendMessage` and mirrored by a counter in the composer.

**Reasoning summaries:**
- `CHAT_THINKING` uses `display: "summarized"`.
- The live stream and saved-message sanitizers (`convex/lib/chatPublicOutput.ts`) pass `reasoning` parts' text, capped at 4,000 characters per part.
- They drop reasoning for every step after a `searchBrain` call in the same turn.
- Every other unknown part type is dropped (deny by default) in both places.
- Reasoning never enters feedback snapshots or learning digests.

**Continue offer:** a reply with a `continuation` shows a "Continue with Line N" button (or "Continue", when there is no section). It sends the writer message "Continue with Line N." through the existing send path.

**Completion Report on the card:**
- `proposeBulkEdits` results no longer ask the model to retype the checklist.
- The chat prompt says the card shows it, so the reply only summarizes.
- Bulk cards render their `chatProposalItems` checklist (ids, statuses, reasons), as `NothingToApplyCard` already does.

</frozen-after-approval>

## Work packages (each worker owns its files; the root integrates)

### W1: chat engine (backend)
**Owns:**
- `convex/ai/chatAgentV2.ts`
- `convex/lib/chatPublicOutput.ts` and its test
- new internal mutations in `convex/chatV2.ts`: `markTurnProgress`, `setTurnContinuation`, `setTurnHistoryStart`
- the `listTurns` return shape
- `chatTurns` fields in `convex/schema.ts`
- Brain and web tool permission: `convex/ai/chatWebSearch.ts`, and the `searchBrain` tool in `chatAgentV2.ts`
- the chat usage handler fields
- SDK tests

**Tasks:**
1. **Stop watcher.** While a pass runs, poll `isTurnActive` every 2 s (`CHAT_STOP_POLL_MS`) and abort the model request through a controller chained by hand to the timeout signal. Stop must take effect within about 2 s, even during hidden thinking, with one usage row and no failure message.
2. **Stable tool list.** Register `searchBrain` and `searchWeb` on every turn. Enforce the per-message permission inside the tool body, with a fixed text when it is off. Pin this in an SDK test: identical `tools` bytes for turns with and without the toggles.
3. **Measurement.** On chat usage rows, record `durationMs`, `stopReason` and effort per step, plus time to first token where available. Add a "chat step timing" log line with numbers only.
4. **Reasoning summaries.** Set `display: "summarized"` and update the sanitizers as in Contracts. `preserveReasoningSignature` must still work, and `isThinkingOnlyReply` must still drop thinking-only replies from history.
5. **Progress.** Write `chatTurns.progress` on each phase change (reading, thinking, tool with name, Line and step, writing, retrying), only while the turn runs. `onChunk` is awaited, so queue the write instead of blocking the stream.
6. **Continuation.** At turn end, set `continuation` from the deviation-inventory counts (Lines still holding Deviations not revised in this turn), the step-limit path and the cut-off paths.
7. **Context loss.** Record `historyStartOrder` from `chatContextOptions`. When older turns were left out, add one sentence to the per-turn tail (not the cached head): "Earlier turns of this conversation are not shown to you; if the writer refers to them, say so and ask them to restate what matters."
8. **Completion Report on the card.** Change the tool result text, `BULK_EDIT_SIZE_RULE` and the chat prompt wording (`prompts.ts` chat section only), with tests.

### W2: evidence and server limits (backend)
**Owns:**
- `convex/ai/chatEvidence.ts` and its tests
- `convex/chatV2.ts` regions `getChatContextV2` and `sendMessage` only
- `convex/ai/prompts.ts` `CHAT_EVIDENCE_GUIDANCE` only
- related convex-test files

**Tasks:**
1. **File list.** `getChatContextV2` passes each document's `_id`, `processingStatus`, `fileType`, text length and whether an original exists. The cached head gets a "FILES IN THIS PROJECT" block (at most 60 rows, the rest counted) showing name, category label, status and size. File names go through `sanitizeFileName` and `neutralizeMarkers`.
2. **Settings document allowance.** Detect the writer settings document with the existing rule (`convex/lib/settingsDocument.ts`, `chooseSettingsSource`). Give it up to `MAX_INSTRUCTIONS_CHARS` (75,000 characters), outside the 12-document slots and the per-document cap. Keep it inside the cached head and within the total budget logic.
3. **Refusal codes and limits.** Add the codes and limits from Contracts in `sendMessage`. `senderName` comes from the active turn's sender. `retryAfterMs` comes from the rolling 24-hour window.

### W3: chat UI (frontend)
**Owns:**
- `src/lib/components/chat/**`
- `src/lib/chat/**`
- `src/lib/errors.ts`
- the Esc handlers in `src/lib/components/project/CurrentProjectPage.svelte` and `PreviewProjectPage.svelte`, and nothing else in those files
- `primitives/sourceContext.ts`
- component tests

**Tasks:**
1. **Refusals.** Show `userErrorMessage` text for the Contracts codes, with no crash toast. Copy and Stop failures stop calling `console.error`.
2. **Esc.** The page handlers ignore an Esc event that was already handled (`defaultPrevented`), and do not close the panel while the composer holds text.
3. **Favicons** send only the hostname.
4. **Apply gating.** Gate Apply (and other actions the server would refuse) on `projects.getProjectEditAccess`.
5. **Progress label.** Read it from `turn.progress` with elapsed time, holding each label at least 1.5 s. After 60 s in one thinking phase, add a quiet hint: "Big requests can take a few minutes. You can stop and ask for one Line at a time."
6. **Reasoning summary.** Show it in the trace while streaming ("Thinking…", expandable), with the live region announcing only phase changes. Mark the answer `aria-busy` while it streams and announce once when it is ready. Respect reduced motion.
7. **Continue button** from `turn.continuation`, guarding against double clicks.
8. **Context-loss divider** above the first message older than `historyStartOrder`: "The assistant no longer reads messages above this line." Plus a one-time notice suggesting a new conversation.
9. **Drafts.** Keep unsent drafts in `sessionStorage`, keyed by `reportId` and conversation. Restore them on select, clear them on send, and reopen the last conversation used.
10. **Connection state** from Convex's `subscribeToConnectionState`: "Connection lost. Your message will send when you're back online." Pause the elapsed timer while offline.
11. **Composer counter and labels.** A character counter for the limits. Relabel the report-selection pill (it is not "Pasted text").
12. **Bulk card checklist.** Bulk cards render their Completion Report checklist.

## Verification
- **Per worker:** targeted unit, convex-test, SDK and component tests; `npx tsc -p convex/tsconfig.json --noEmit`; `npm run check`.
- **Root after integration:**
  - `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`.
  - A review by Claude Opus 5.5 at high effort.
  - A real replay of the 2026-10-19 PD13 c turn on an isolated local backend: progress, summaries, Stop during thinking, the Continue offer and the card checklist. Client data is deleted afterwards.
  - Browser checks of Esc, the divider, drafts and the offline state against the local backend.
- **Amendment:** `2026-10-19 (seventh)` in `docs/product-domain.md`, written by the root from the integrated result.

## Verification record (2026-10-19)
- **Reviews.** Four rounds, all by Claude Opus 5.5 at high effort:
  - Round 1, backend and frontend separately: ship after fixes (P1 Continue on cut-off replies; P2 Stop before a pass, handled Deviations, new-conversation drafts; P3s).
  - Round 2: all round 1 findings fixed; new P2 on handled items being an absolute ban, and on positional ids.
  - Round 3: a prompt-text job boundary reset too easily, fixed with fingerprints.
  - Round 4: matching was too strict on rewording, fixed by matching on fingerprint or on id within the job; the fingerprint is kept off the browser.
- **Real replays.** Run on an isolated local backend with a dev snapshot of a senior writer's PD13 c project and his own prompts:
  - full chain: all Lines finished through Continue, 18 distinct items, no duplicates;
  - Stop during thinking: the model request was cancelled 1.8 s after Stop;
  - interrupted chain (a question, then a typed continue): 18 distinct items, no duplicates.
  - The client data and the local backend were deleted afterwards.
- **Screens.** Verified with browser component tests and screenshots, not in a live session.
