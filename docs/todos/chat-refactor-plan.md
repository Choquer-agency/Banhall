# Report-assistant chat refactor plan

> **Status: Phases 0-4 shipped.** Reasoning is ON for report chat.
>
> **Phase 4 as built differs from the plan below.** The plan specified
> `thinking: { type: "enabled", budgetTokens: 4096 }`. Shipped instead:
> `thinking: { type: "adaptive", display: "summarized" }`.
> - `adaptive` (Sonnet 4.6/Opus 4.6+) lets the model scale thinking to the
>   task, rather than paying a fixed 4,096-token budget to tighten one
>   sentence. Closer to how the same model behaves on claude.ai.
> - `display: "summarized"` is REQUIRED for reasoning text to be returned at
>   all; the default for current models omits it, and the trace's reasoning
>   disclosure would render nothing.
> - Redacted thinking arrives as a reasoning part with empty text and is
>   dropped in `turnParts.ts`, so it can't produce an empty disclosure or a
>   false “Thought for 5s”.
> - `maxOutputTokens: 16384` per step. Thinking, tool-call JSON, and answer
>   text share this budget; adaptive thinking on Sonnet 5 defaults to high
>   effort, so a tight ceiling risks truncating a reply with finishReason
>   “length”. Watch for those in `aiUsage` if it needs tuning.
> - Reasoning tokens are billed inside `usage.outputTokens`, so `aiUsage`
>   totals stay correct; the installed provider does not break them out
>   separately, so per-feature reasoning cost is not separately reportable.
>
> **The thinking signature must survive multi-step tool turns.**
> `@convex-dev/agent` installs `smoothStream({ chunking: /[\p{P}\s]/u })` for
> `saveStreamDeltas`, and that transform drops `providerMetadata` on flushed
> chunks. Anthropic sends a thinking block's signature on a final EMPTY
> `reasoning-delta`, so whenever reasoning ends on punctuation the signature is
> swallowed and step 2+ sends back an unsigned thinking block, which the SDK
> discards. `convex/ai/reasoningSignature.ts` re-attaches it upstream of the
> smoothing; `reasoningSignature.test.ts` covers it and documents the upstream
> bug, so the transform can be deleted once `ai` fixes `smoothStream`.
>
> **Reasoning is chat-only, and deliberately so.** Before switching it on
> anywhere else, each call site needs adapting:
> - The section/pipeline agents read `response.content[0].type === "text"`
>   (`section242Agent.ts:29`, `section244Agent.ts:29`, `section246Agent.ts:29`,
>   `pipeline.ts:115`, `financialAgent.ts:102`, `changelogPipeline.ts:113`,
>   `scienceCodeSuggestions.ts:59`). With thinking on, `content[0]` is a
>   thinking block. Consequences differ — the section and financial agents
>   throw, compression returns the original text, changelog falls back, and
>   science-code suggestion returns `null` — and because adaptive thinking may
>   skip trivial calls, the failure is intermittent. Each must find the first
>   `text` block first.
> - `convex/ai/structured.ts` uses forced `tool_choice`. This is compatible
>   with `adaptive` thinking (Anthropic only forbids forced tool choice with
>   manual `{ type: "enabled" }`), so it is not a blocker there — but it does
>   rule out the fixed-budget variant for those pipelines.
>
> **Amendments made during implementation** (UX review, superseding the copy
> table in §1):
> - Tool copy speaks of *suggestions*, not *proposals*, matching
>   `ProposedEditCard`'s writer-facing vocabulary.
> - Completed labels carry the detail worth reading at a glance:
>   `Searched The Brain for “…”`, `Found 3 passages`.
> - The summary reports an **outcome**, not a step count
>   (`Worked for 12s · 2 suggestions`). A step count is a loop counter a report
>   writer can neither act on nor judge.
> - One stable live verb (`Working…`). Alternating Working/Thinking made the
>   header flicker as reasoning and tools interleaved.
> - `proposeEdit` / `proposeReplacements` / `highlightPassages` render **no**
>   input/output payload: the proposal card and “Jump to” chips below the trace
>   already show the same content, actionably. Only `searchBrain` has a body.
> - Tool results are never rendered raw — every one is written *for the model*
>   (second person, names non-existent buttons, retry instructions, and The
>   Brain's is a whole prompt block of “NEVER copy their facts” directives).
>   `searchBrain` is summarized (“Found 2 writing patterns…”); its outage
>   notice is restated without the “Tell the writer…” instruction; every other
>   tool renders no body at all.
> - Unknown tools are described generically; no camelCase names, no JSON dumps.
> - Trace steps default **closed**; auto-opening the newest step made the rail
>   jump on every tool call under a stick-to-bottom scroller.
> - `saveProposal` carries the final stop fence — see §2.

Status: implementation plan
Scope: `AgentChatPanel.svelte` and the report-assistant pipeline only
Stack: SvelteKit 2, Svelte 5 runes, Tailwind v4, bits-ui, svelte-streamdown, Convex, `@convex-dev/agent` 0.6.4, AI SDK v6, `@ai-sdk/anthropic` 3.0.92

## Decisions and invariants

1. The raw AI SDK `UIMessage.parts` array is normalized once, in a pure TypeScript module. Svelte renderers never rediscover tool names, status mappings, proposal ownership, ordering, or summary counts.
2. A **step** in user-facing copy means one unique tool call (`toolCallId`). `step-start` is ignored for counting and rendering because its persisted reconstruction is not reliable.
3. The new `chatTurns` row is operational metadata for one prompt/reply cycle. It is not a project workflow stage, generation state, report branch, or suggestion lifecycle. Suggestions stay scoped to their exact report/revision lineage (`docs/product-domain.md:33-38`).
4. Proposal cards are native, actionable output artifacts, not trace diagnostics. They remain visible when the trace collapses, appear before the final answer text, and are ordered by their owning `toolCallId`. The collapsed trace hides reasoning/tool input/tool output only.
5. Existing `AgentChatPanel` props remain source-compatible. The project page does not pass `isFull` or `onToggleFull`, and that remains valid (`src/lib/components/chat/AgentChatPanel.svelte:50-88`, `src/routes/project/[id]/+page.svelte:1173-1188`).
6. Existing behavior remains: proposal actions and preview, “Jump to” references, research feed, thread menu, uploads, composer context pills, stop, retry, separators, copy, stick-to-bottom behavior, and load-earlier pagination.
7. No duration is fabricated for a historical turn without a `chatTurns` row. It gets a collapsed `4 steps`/`Thought` trace, not `Worked for …`.
8. The interaction follows the explicit-event/native-renderer principle in [Agent-Native’s Native Chat UI](https://www.agent-native.com/docs/native-chat-ui): structured tool events become first-party in-chat UI rather than markdown or an iframe.

The current seam is the problem: `messageText()` keeps only `type === "text"` and discards reasoning and tools (`AgentChatPanel.svelte:118-124`), while proposals are correlated separately and appended after all markdown (`AgentChatPanel.svelte:295-352`, `1029-1040`). The target creates one deeper normalization seam with better locality and a small, testable interface.

## 1. Target UX specification

### Assistant-turn anatomy

An assistant turn has up to three visible layers, in this order:

1. **Trace summary/disclosure** — one row that is open while the turn is active and collapsed once the turn reaches a terminal state.
2. **Action artifacts** — `ProposalCard` or numbered “Jump to” references, placed in owning tool-call order. These never disappear when the trace is collapsed.
3. **Answer text** — streaming markdown through the existing `MessageContent`/svelte-streamdown path (`MessageContent.svelte:29-43`).

Copy action appears only after the assistant message is terminal and copies answer text only. It does not copy hidden reasoning, tool inputs, tool outputs, or proposal-card text. Existing proposal controls and callbacks remain unchanged (`ProposalCard.svelte:10-40`, `43-85`).

### State machine and exact copy

| State | Entry condition | Visible behavior and exact copy | Exit |
|---|---|---|---|
| Idle | No current prompt, or viewing a completed historical turn | No placeholder. A historical trace is collapsed. Turns with neither tools nor reasoning show no trace row. | Writer sends a prompt. |
| Queued | `chatTurns.status === "queued"`; the writer message exists but `streamChatReply` has not started | A left-aligned assistant row appears immediately with `Queued…`. No timer and no bouncing dots once turn metadata is present. The old `Loader` remains a compatibility fallback only while metadata has not arrived. | `markTurnStarted` sets `running`, or stop sets `aborted`. |
| Thinking | Turn is running and the latest reasoning node has `state === "streaming"` | Outer trace is open. Summary: `Thinking… · 5s`. Reasoning step label: `Thinking…`; its disclosure is open and streams plain, pre-wrapped reasoning text. Do not show provider/model names or redacted/provider metadata. | Reasoning becomes done, a tool starts, text starts, or terminal state. |
| Tool running | A tool part is `input-streaming` or `input-available` | Outer trace is open. Summary: `Working… · 12s · 2 steps`. The current tool step is open by default. `input-streaming` has accessible status `Preparing input`; `input-available` has accessible status `Running`. The input block updates without replacing the step. | `output-available` or `output-error`. |
| Tool done | Tool part is `output-available` | Step changes to its past-tense label, status `Complete`, and a primary check/dot. Its disclosure contains labeled `Input` and `Output` sections. It closes by default when the next tool begins, but remains user-expandable. | Another trace node, answer text, or terminal state. |
| Tool error | Tool part is `output-error` | Step uses its exact failure label below, accessible status `Failed`, and red error treatment. Disclosure retains the input and shows a user-safe error output. A failed step does not automatically make the whole turn failed; the agent may recover in a later step. | Another trace node or terminal state. |
| Text streaming | A text part has `state === "streaming"` or the message is streaming with text | Markdown streams in place. Existing trace stays open. Summary is `Working… · 12s · 4 steps`; with no tools it is `Working… · 12s`. No second loader is rendered. | Message and turn become terminal. |
| Finished | `chatTurns.status === "completed"` (fallback: message status `success`) | On the live-to-terminal transition, outer trace closes once. With tools: `Worked for 12s · 4 steps`. With reasoning but no tools: `Thought for 5s`. With neither: no trace row. Proposal artifacts and answer text remain visible. | User may expand the summary to review the trace. |
| Failed | `chatTurns.status === "failed"` or message status `failed` | Trace closes once. With a start time: `Failed after 12s · 2 steps`; without one: `Failed before starting`. Expand reveals completed/error steps, but not raw provider/Convex exceptions. The answer area shows `I couldn’t finish that response. Try again.` and existing retry UI remains available. | Retry creates a new turn. |
| Aborted | `chatTurns.status === "aborted"` | Trace closes once. With a start time: `Stopped after 8s · 2 steps`; queued abort: `Stopped before starting`. Preserve partial text, completed steps, and proposal artifacts. Do not append a failure message. | A later prompt creates a new turn. |

Live time ticks once per second from `startedAt`; it is not based on message `_creationTime`. `formatDuration` uses `0s` while live, a minimum terminal duration of `1s`, `59s`, then `1m 00s`, `1m 01s`, and so on. `endedAt` freezes the terminal value. The timer itself is `aria-hidden`; an `aria-live="polite"` region announces state-label changes, not every second.

The trace starts open for a live turn. A user may close it while work continues. Completion/abort/failure applies the automatic close only on that state transition; opening a historical terminal trace is never undone by a reactive effect.

### Exact tool labels

Both `input-streaming` and `input-available` use the running label. The status text differentiates “Preparing input” from “Running.”

| Static part type | Running | Done | Error |
|---|---|---|---|
| `tool-proposeEdit` | `Proposing an edit…` | `Proposed an edit` | `Couldn’t propose an edit` |
| `tool-proposeReplacements` | `Proposing replacements…` | `Proposed replacements` | `Couldn’t propose replacements` |
| `tool-highlightPassages` | `Finding passages…` | `Found passages` | `Couldn’t find passages` |
| `tool-searchBrain` | `Searching The Brain…` | `Searched The Brain` | `Couldn’t search The Brain` |
| Unknown future `tool-*` | `Running {Humanized name}…` | `Ran {Humanized name}` | `{Humanized name} failed` |

Disclosure formatting is tool-specific:

- `proposeEdit`: `Target passage` and `Proposed wording`.
- `proposeReplacements`: numbered `Find` / `Replace with` pairs.
- `highlightPassages`: numbered `Passage` values.
- `searchBrain`: `Query`.
- Successful output: the tool’s string output under `Output`.
- Error output: `This step failed. Try again.` unless the backend already provides an explicitly user-safe domain error. Raw provider and Convex request text is never shown, consistent with `docs/product-domain.md:241-251`.
- Unknown tools: read-only formatted JSON fallback with sorted object keys; circular/non-JSON values become `Output unavailable`.

Tool input/output areas are capped and internally scrollable so a Brain result or long passage cannot take over the rail.

### Proposal placement

`normalizeTurnParts()` splices a proposal node immediately after its matching tool node by exact `toolCallId`. `AssistantTurn` extracts proposal nodes as persistent action artifacts and renders them below the one trace disclosure, in the same tool-call order, before answer text. This is the only deliberate visual departure from literal DOM adjacency: it prevents the auto-collapsed trace from hiding an unapplied suggestion or remounting `ProposedEditCard` and losing its local preview/edit state (`ProposedEditCard.svelte:44-67`).

Legacy proposal ownership keeps the current fallbacks in the current order:

1. exact `toolCallId`;
2. assistant message sharing the prompt message’s `order`;
3. legacy `messageId`;
4. closest earlier assistant `_creationTime`;
5. orphan bucket.

Continue suppressing superseded intermediate pending refinement cards (`AgentChatPanel.svelte:311-329`). Orphans render in the existing final assistant block.

## 2. Data model and backend changes

### Additive schema

Add this table beside `agentChatThreads`/`chatProposals` in `convex/schema.ts` (the current agent chat tables are at `convex/schema.ts:403-462`):

```ts
chatTurns: defineTable({
  agentThreadId: v.string(),
  promptMessageId: v.string(),
  order: v.number(),
  status: v.union(
    v.literal("queued"),
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("aborted"),
  ),
  startedAt: v.optional(v.number()),
  endedAt: v.optional(v.number()),
  stepCount: v.number(),
})
  .index("by_agentThreadId_and_promptMessageId", [
    "agentThreadId",
    "promptMessageId",
  ])
  .index("by_agentThreadId_and_order", ["agentThreadId", "order"]),
```

No `projectId`, `reportId`, title, usage, finish reason, provider, error string, array of steps, or duplicated trace payload belongs here. Project/report authorization comes from the existing unique `agentChatThreads` mapping (`chatV2.ts:42-48`). Tool/reasoning payloads remain in the agent component’s message parts. The table stores only the terminal metadata that the public `UIMessage` cannot provide durably.

`order` is stored because `saveMessage()` returns the saved message as well as `messageId`, and the prompt and reply share an order. The current stop path already relies on that invariant (`AgentChatPanel.svelte:540-550`, `chatV2.ts:207-225`). It gives the frontend an exact, stable join and permits a bounded range query.

This is a widen-only change. Do not backfill durations: historical start/end timestamps cannot be reconstructed honestly.

### `convex/chatV2.ts`

Change `sendMessage`:

1. Destructure `{ messageId, message }` from `saveMessage` instead of only `messageId` (`chatV2.ts:191-195`).
2. In the same Convex mutation, insert one `chatTurns` row before scheduling:

```ts
{
  agentThreadId,
  promptMessageId: messageId,
  order: message.order,
  status: "queued",
  stepCount: 0,
}
```

3. Keep the existing return `{ threadId, messageId }`; do not break the panel’s send contract (`chatV2.ts:197-203`).

Add public query `listTurns`:

```ts
args: {
  threadId: v.string(),
  startOrder: v.number(),
  endOrder: v.number(),
}
```

Behavior:

- Resolve `threadRow`, return `[]` when missing or inaccessible. (`listProposals` later diverged: it returns `[]` only for a missing mapping and throws the typed authorization error for an existing thread; `listTurns` keeps the empty-on-unauthorized policy.)
- Reject `startOrder > endOrder`.
- Query `chatTurns` through `by_agentThreadId_and_order`, equality on `threadId`, inclusive `gte(startOrder)` and `lte(endOrder)`, descending, `.take(200)`, then reverse the bounded result before returning it. This always keeps the newest loaded turns; orders older than the 200-turn metadata window use the historical no-duration fallback.
- This is reactive and bounded to the orders already loaded by message pagination; it does not collect a whole thread. Convex queries must use indexes and bounded reads (`convex/_generated/ai/guidelines.md:242-256`).

Add internal mutation `markTurnStarted`:

```ts
args: {
  agentThreadId: v.string(),
  promptMessageId: v.string(),
  startedAt: v.number(),
}
returns: { shouldRun: boolean; status: ChatTurnStatus }
```

Look up by `by_agentThreadId_and_promptMessageId`. Transition `queued -> running`, setting `startedAt` only if absent. Repeated `running` calls are idempotent and return `shouldRun: true`; terminal states return `false`. Missing rows return `running` compatibility behavior without inserting guessed metadata, so an in-flight deployment is not broken.

Add internal mutation `finishTurn`:

```ts
args: {
  agentThreadId: v.string(),
  promptMessageId: v.string(),
  requestedStatus: v.union(v.literal("completed"), v.literal("failed")),
  endedAt: v.number(),
  stepCount: v.number(),
}
returns: { status: ChatTurnStatus }
```

Rules:

- `queued`/`running` transition to `requestedStatus`, with `endedAt` and nonnegative integer `stepCount`.
- An existing `aborted` status wins the race; retain its `endedAt`, update `stepCount` to the larger of stored and supplied counts, and return `aborted`.
- Existing `completed`/`failed` are idempotent and never move backward.
- A missing row returns `requestedStatus` without inserting guessed timing data; this is the deploy-skew compatibility path.
- Never overwrite `startedAt`.

Change `abortStreaming` without changing its arguments:

- Resolve a turn by `by_agentThreadId_and_order`.
- If it is `queued` or `running`, patch it to `aborted` with `endedAt: Date.now()`.
- Call the existing `abortStream`.
- Return `true` when either the app-side turn was stopped or the component stream was aborted.
- This makes stop work during the queue gap while preserving the current `{ threadId, order }` caller contract.

All new functions have validators, and authorization remains server-side (`convex/_generated/ai/guidelines.md:81-95`, `162-183`).

### `convex/ai/chatAgentV2.ts`

Keep the four existing tools and `stopWhen: stepCountIs(5)` unchanged (`chatAgentV2.ts:24-164`, `205-207`).

At the first line of `streamChatReply.handler`:

1. Set `const startedAt = Date.now()`.
2. Call `markTurnStarted`.
3. Return without loading context or starting a stream when `shouldRun` is false; this is the queued-abort fence.

**Stop needs three fences, not one** (found in review). Context loading takes
long enough that the writer can press stop *after* `markTurnStarted`:

1. `markTurnStarted` — covers the scheduler gap.
2. `isTurnActive`, immediately before `streamText` — covers context loading.
3. `saveProposal` re-checks turn status before inserting — covers the
   irreducible gap between (2) and the model's first tool call. This is the
   one that matters: a suggestion card appearing after the writer pressed stop
   is the visible harm, and this mutation is the single write path for every
   proposal tool, so the check lands atomically with the insert.

Track step count locally with `const toolCallIds = new Set<string>()`. Add an `onStepFinish` callback to the `streamText` call options; add each `step.toolCalls[].toolCallId`. Persist `toolCallIds.size`, not model-step count and not `step-start` count. Keep `{ saveStreamDeltas: true }` (`chatAgentV2.ts:273-283`).

Completion:

- After `consumeStream()`, call `finishTurn(requestedStatus: "completed", endedAt: Date.now(), stepCount)`.
- In `catch`, call `finishTurn(requestedStatus: "failed", ...)` first.
- Only when its returned status is `failed`, save the safe assistant message `I couldn’t finish that response. Try again.`.
- When it returns `aborted`, save no failure text.
- Log the real exception server-side; remove the current raw exception interpolation from user-visible content (`chatAgentV2.ts:284-294`).

### Optional reasoning generation

The frontend handles `reasoning` parts from Phase 1 whether or not Anthropic thinking is enabled. In the final opt-in phase, enable it at the `streamText` call site—not on unrelated generation pipelines—with:

```ts
providerOptions: {
  anthropic: {
    thinking: { type: "enabled", budgetTokens: 4096 },
  },
},
```

The fixed 4,096-token budget is the planned default. It must be confirmed before Phase 4 because it changes latency and billed output. Do not add a new table or app setting for one constant. Render only the AI SDK `reasoning` text; ignore redacted blocks and provider metadata.

### Files changed or generated

- Change `convex/schema.ts`.
- Change `convex/chatV2.ts`.
- Change `convex/ai/chatAgentV2.ts`.
- Add `convex/chatTurns.test.ts`.
- Regenerate Convex types after the schema/function changes; do not hand-edit `convex/_generated/*`.

## 3. Frontend architecture

### Central normalization seam

Add `src/lib/chat/turnParts.ts`. Its final public interface is:

```ts
import type { UIMessage } from "@convex-dev/agent";
import type { Doc } from "../../../convex/_generated/dataModel";

export type ToolName =
  | "proposeEdit"
  | "proposeReplacements"
  | "highlightPassages"
  | "searchBrain"
  | (string & {});

export type ToolPartState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

export type ToolDetail =
  | { kind: "fields"; fields: { label: string; value: string }[] }
  | { kind: "replacements"; items: { find: string; replaceWith: string }[] }
  | { kind: "passages"; items: string[] }
  | { kind: "text"; text: string }
  | { kind: "json"; text: string };

export type TextRenderNode = {
  kind: "text";
  key: string;
  text: string;
  state: "streaming" | "done";
};

export type ReasoningRenderNode = {
  kind: "reasoning";
  key: string;
  text: string;
  state: "streaming" | "done";
};

export type ToolRenderNode = {
  kind: "tool";
  key: string;
  toolName: ToolName;
  toolCallId: string;
  state: ToolPartState;
  label: string;
  accessibleStatus: "Preparing input" | "Running" | "Complete" | "Failed";
  input: ToolDetail;
  output?: ToolDetail;
};

export type ProposalRenderNode = {
  kind: "proposal";
  key: string;
  proposal: Doc<"chatProposals">;
  toolCallId?: string;
  association: "toolCallId" | "legacy";
};

export type TurnRenderNode =
  | TextRenderNode
  | ReasoningRenderNode
  | ToolRenderNode
  | ProposalRenderNode;

export type TurnTiming = {
  status: "queued" | "running" | "completed" | "failed" | "aborted";
  startedAt?: number;
  endedAt?: number;
  stepCount: number;
};

export type NormalizedTurn = {
  nodes: TurnRenderNode[];
  text: string;
  traceNodes: (ReasoningRenderNode | ToolRenderNode)[];
  proposalNodes: ProposalRenderNode[];
  toolCount: number;
  hasReasoning: boolean;
};

export function correlateProposals(
  messages: readonly UIMessage[],
  proposals: readonly Doc<"chatProposals">[],
): {
  byMessageId: ReadonlyMap<string, Doc<"chatProposals">[]>;
  orphans: Doc<"chatProposals">[];
};

export function normalizeTurnParts(
  message: UIMessage | undefined,
  proposals: readonly Doc<"chatProposals">[],
): NormalizedTurn;

export function formatTurnSummary(
  turn: NormalizedTurn,
  timing: TurnTiming | undefined,
  messageStatus: UIMessage["status"] | undefined,
  now: number,
): string | null;
```

Normalization rules:

1. Read parts in array order. Ignore `step-start`, sources, files, and unknown non-tool parts in this refactor.
2. Coalesce adjacent text nodes and adjacent reasoning nodes.
3. Accept only static `tool-*` parts for the four current tools, while preserving the generic fallback.
4. Normalize AI SDK tool states to the four supported states. Future approval/denied states are out of scope and fall back to a failed generic node rather than crashing.
5. De-duplicate by `toolCallId`, preserve the first position, and use the most advanced state (`output-error`/`output-available` over input states).
6. Splice exact proposal matches after their tool node; append legacy-owned proposals after trace nodes in stable `createdAt` order.
7. `toolCount` is unique tool IDs. For a terminal summary, prefer durable `timing.stepCount`; while live, prefer `Math.max(timing.stepCount, toolCount)`.
8. Never mutate, proxy, or `structuredClone()` `message.parts`, tool inputs, or tool outputs. `createUIMessages` must retain its `$state.raw` storage and `$state.snapshot` handoff because the AI SDK clones stream data and deep Svelte proxies throw `DataCloneError` (`uiMessages.svelte.ts:63-80`, `119-156`).

Add `src/lib/chat/turnParts.test.ts` as the interface’s test surface.

### New Svelte files

#### `src/lib/components/chat/AssistantTurn.svelte`

```ts
interface Props {
  message?: UIMessage;
  proposals?: Doc<"chatProposals">[];
  timing?: TurnTiming;
  copied?: boolean;
  onCopy?: (messageId: string, text: string) => void | Promise<void>;
  onRefine: (proposal: Doc<"chatProposals">) => void;
  onBeforeApply?: () => Promise<unknown>;
  onReferenceText?: (texts: string[], scrollTo?: string) => void;
  onReviewReplacements?: (
    pairs: { find: string; replaceWith: string }[],
    proposalId: string,
  ) => void;
  onPreviewProposal?: (
    pairs: { find: string; replaceWith: string }[],
    on: boolean,
  ) => void;
  reviewingId?: string | null;
}
```

Responsibilities: call `normalizeTurnParts`, render one assistant `Message`, insert one `TurnTrace` at the first trace position, render persistent proposal artifacts before answer text, stream markdown nodes, and retain copy behavior. It accepts `message === undefined` for a queued turn that has metadata before an assistant UIMessage exists.

#### `src/lib/components/chat/TurnTrace.svelte`

```ts
interface Props {
  nodes: (ReasoningRenderNode | ToolRenderNode)[];
  timing?: TurnTiming;
  messageStatus?: UIMessage["status"];
  now?: number; // test/story override; component clock is the default
}
```

Responsibilities: one-second clock with cleanup, live/terminal state transition, outer `<details>`, collapsed summary, default-open behavior, right-edge chevron, and composition of the existing `ChainOfThought` primitives. It does not know Convex documents or proposals.

#### `src/lib/components/chat/ToolTraceStep.svelte`

```ts
interface Props {
  node: ToolRenderNode;
  open?: boolean; // bindable
}
```

Responsibilities: map input states to `active`, output to `complete`, error to `failed`; render `ChainOfThoughtStep`, `ChainOfThoughtTrigger`, `ChainOfThoughtContent`, and `ChainOfThoughtItem`; render the normalized Input/Output detail shapes. It makes no tool-name decisions.

#### `src/lib/components/chat/ReasoningTraceStep.svelte`

```ts
interface Props {
  node: ReasoningRenderNode;
  open?: boolean; // bindable
}
```

Responsibilities: render `Thinking…`/`Thought`, plain pre-wrapped content, and active/complete status through the same ChainOfThought primitives.

#### `src/lib/components/chat/ChatProposalArtifact.svelte`

```ts
interface Props {
  proposal: Doc<"chatProposals">;
  onRefine: (proposal: Doc<"chatProposals">) => void;
  onBeforeApply?: () => Promise<unknown>;
  onReferenceText?: (texts: string[], scrollTo?: string) => void;
  onReviewReplacements?: (
    pairs: { find: string; replaceWith: string }[],
    proposalId: string,
  ) => void;
  onPreviewProposal?: (
    pairs: { find: string; replaceWith: string }[],
    on: boolean,
  ) => void;
  reviewing?: boolean;
}
```

Responsibilities: move the existing `proposalView` snippet without changing behavior: numbered “Jump to” references or `ProposalCard`, including refinement focus/scroll callbacks (`AgentChatPanel.svelte:585-624`).

### Existing frontend files to change

- `AgentChatPanel.svelte`
  - Replace `messageText`, `messageToolCallIds`, and `grouped` with `correlateProposals`.
  - Subscribe to `api.chatV2.listTurns` using min/max orders from currently loaded messages.
  - Build `turnsByOrder`; both the writer prompt and assistant reply use the same `order`.
  - Replace assistant markup and bottom `Loader` with `AssistantTurn`; retain `Loader` only when the trailing writer message has no metadata yet.
  - Keep user-message rendering, day separators, thread/header logic, research feed, composer, uploads, retry, stop, and scroll callbacks in place.
  - Preserve `createUIMessages(... initialNumItems: 80)` and `loadMore(40)` (`AgentChatPanel.svelte:207-211`, `993-1003`).
- `src/lib/components/chat/primitives/ChainOfThoughtTrigger.svelte`
  - Keep the existing props.
  - Make its layout `justify-between`, give the label wrapper `flex-1`, keep the left status/icon static, and always render one right-edge down chevron that rotates up when open. This brings the primitive into compliance with the design-system disclosure rule (`docs/design-system.md:83-85`).
- `src/routes/styleguide/+page.svelte`
  - Add specimens for queued, working with one active tool, completed collapsed, error, and reasoning. Keep the existing research specimen (`styleguide/+page.svelte:204-241`) as a regression check.
- Do not change `ProposalCard.svelte`, `ProposedEditCard.svelte`, `ResearchFeed.svelte`, `MessageContent.svelte`, `ChatContainer.svelte`, or the project page contract unless a verification failure proves a compatibility fix is required.

## 4. Design-system compliance

The trace is quiet, compact operational UI inside an existing white assistant surface. It does not become another `.card`, use a second accent, or add new global tokens.

| Element | Required classes/tokens |
|---|---|
| Outer summary | `min-h-11 w-full`, `flex items-center gap-2`, `text-xs font-medium text-ink-muted`, `hover:bg-primary-wash`, `focus-visible:outline-none`; no border-width change |
| Live summary state | status icon/dot `text-primary` or `bg-primary`; `animate-pulse motion-reduce:animate-none`; copy remains `Working…`/`Thinking…` |
| Timer/count | `text-data text-ink-muted`; timer digits use the mono/tabular role defined at `layout.css:104-110` |
| Open summary | label `text-ink-secondary`; chevron `ml-auto text-primary rotate-180` |
| Closed chevron | right edge, down orientation, `text-ink-faint`; `transition-transform motion-reduce:transition-none` uses the global 300ms default (`layout.css:50`, `docs/design-system.md:83-88`) |
| Trace list | existing `ChainOfThought` and connector `bg-primary/20` (`ChainOfThoughtStep.svelte:18-22`) |
| Step label | existing `text-xs font-medium text-ink-muted`; active `text-ink-secondary`; pending `text-ink-faint` |
| Completed state | `text-primary`; never green merely for generic completion |
| Error state | `text-red-600`, `border-red-200`, `bg-red-50`; error must also have icon/text, never color alone |
| Input/output label | `text-label` |
| Input/output body | `text-xs leading-relaxed text-ink-secondary`, `whitespace-pre-wrap break-words` |
| Input/output well | `rounded-lg border border-line-soft bg-chrome p-2.5`, `max-h-64 overflow-auto` |
| Proposal/reference area | existing `border-line`, `border-line-soft`, `bg-white`, `text-ink-*`, and `primary-wash` behavior; no restyling in this refactor |

Use semantic aliases in all new code: `ink`, `ink-secondary`, `ink-muted`, `ink-faint`, `line`, and `line-soft` (`docs/design-system.md:25-37`, `layout.css:42-48`). Use `primary-wash` for every new light-surface hover (`docs/design-system.md:89-90`). No arbitrary hex values, arbitrary pixel text sizes, provider colors, gradients, or new shadows.

Accessibility requirements:

- Native `<details>/<summary>` semantics for outer trace and individual steps.
- Right-edge chevron points down closed and up open.
- At least 44px summary/toggle target (`min-h-11`), matching the product contract’s mobile minimum (`docs/product-domain.md:249-251`).
- `aria-expanded` comes from native disclosure state; status text remains available to screen readers.
- State announcements are polite; terminal failure text uses `role="alert"` once.
- Focus is visible through color/outline without changing border width.
- Reduced motion disables pulse/rotation transitions; all other transitions are at least 300ms.

## 5. Sequenced implementation phases

Each phase lands with green checks and can be released independently.

### Phase 0 — behavior-neutral extraction

1. Add `turnParts.ts` with existing text extraction and proposal-correlation behavior, plus tests.
2. Add `ChatProposalArtifact.svelte` by moving `proposalView` exactly.
3. Add `AssistantTurn.svelte` that still renders joined markdown first, then all owned proposal artifacts, then copy actions.
4. Switch `AgentChatPanel` to those modules. Do not render tools/reasoning, add queries/schema, alter Loader logic, or change copy/classes.

Verification:

- DOM order and copy are unchanged.
- Apply/reject/refine/edit wording/show changes/review individually all work.
- Jump-to links, copy, retry, stop, research feed, thread switching, load earlier, and composer pills work.
- `npm run check` and `npx vitest run` pass.

### Phase 1 — render already-available structured parts

1. Extend `normalizeTurnParts` to all final node types and exact labels.
2. Add `TurnTrace`, `ToolTraceStep`, and `ReasoningTraceStep`.
3. Render live tool states from existing static tool parts; ignore `step-start`.
4. Splice proposal nodes at exact tool calls and render persistent artifacts before answer text.
5. Collapse terminal traces. Without timing metadata, summary is `1 step`, `4 steps`, or `Thought`; live summary is `Working…`/`Thinking…` without seconds.
6. Update `ChainOfThoughtTrigger` and styleguide specimens.

Verification:

- Exercise all four tools and all four tool states with fixtures/dev traffic.
- A proposal card appears once, is associated with the correct tool, and remains visible after collapse.
- A Brain search output is constrained to its disclosure.
- Historical persisted tool parts reconstruct the same trace after reload.
- ResearchFeed’s existing chain-of-thought UI still opens, closes, and displays connectors correctly.

### Phase 2 — durable timing and terminal state

1. Add `chatTurns`, `listTurns`, `markTurnStarted`, `finishTurn`, and race-safe abort handling.
2. Record queued turn rows in `sendMessage`.
3. Record start/end/tool count and safe failures in `streamChatReply`.
4. Subscribe by loaded order range in `AgentChatPanel`.
5. Add queued placeholder, ticking elapsed time, final summary formats, and exact failed/aborted states.
6. Retain no-metadata fallbacks for deploy skew and historical turns.

Verification:

- Artificial scheduler delay visibly holds `Queued…` with no timer.
- Timer starts at `running`, ticks, freezes at terminal state, and remains identical after reload.
- Stop during queued and running states both produce `Stopped…`; neither later becomes completed/failed.
- A thrown context/model error produces one safe failure message and `Failed after…`.
- A normal tool turn records unique tool-call count, not model steps.
- Loading earlier messages expands the turn query’s order range without losing the newest 200 timings; older loaded turns fall back to step-only summaries.

### Phase 3 — hardening and parity sign-off

1. Test long inputs/outputs, rapid tool-state replacement, duplicated parts, missing proposals, orphan proposals, zero-text tool turns, and unknown future tool names.
2. Verify live scroll behavior: pinned users follow trace growth; scrolled-up users are not pulled down; sending re-pins as today (`AgentChatPanel.svelte:445-447`, `ChatContainer` contract in `docs/design-system.md:104-108`).
3. Verify keyboard/screen-reader behavior and reduced motion.
4. Confirm responsive behavior in the narrow rail and any full-width host that later passes `onToggleFull`.
5. Run the interface detector over changed Svelte targets after implementation, not during planning.

### Phase 4 — enable optional Anthropic reasoning

1. After product/cost approval, add the fixed 4,096-token `providerOptions.anthropic.thinking` setting only to report chat.
2. Verify reasoning streams, persists, collapses, and is omitted from copy.
3. Verify a reasoning-only answer summarizes as `Thought for …`; reasoning plus tools summarizes as `Worked for … · N steps`.
4. Compare latency and usage before/after; revert the provider option, not the renderer, if the cost/latency tradeoff is unacceptable.

## 6. Verification plan

### Required automated commands

Run after every phase:

```sh
npm run check
npx vitest run
```

After Phase 2 backend work also run:

```sh
npx convex codegen
npx tsc --noEmit -p convex/tsconfig.json
```

All commands must exit 0. `npm run check` must report 0 Svelte errors and no new accessibility warnings; the migration contract explicitly requires `0 ERRORS` (`docs/svelte-migration.md:84-90`).

### Required unit tests

`src/lib/chat/turnParts.test.ts`:

- joins/coalesces text and preserves text order;
- normalizes reasoning streaming/done;
- maps all four static tool names and all four requested states to exact labels/statuses;
- ignores `step-start`;
- de-duplicates repeated `toolCallId` while preserving first position and terminal state;
- counts unique tool calls;
- formats each tool’s input and output;
- falls back safely for unknown tools/non-JSON output;
- splices exact proposals immediately after their tool;
- preserves current prompt/order/message/time proposal fallbacks and refinement suppression;
- leaves unmatched proposals as orphans;
- formats queued/live/completed/failed/aborted summaries, duration boundaries, and singular/plural steps;
- uses durable terminal `stepCount` and live max(tool count, stored count).

`convex/chatTurns.test.ts` with `convex-test`:

- queued insert shape and both indexes;
- `queued -> running -> completed`;
- idempotent repeated start/finish;
- failed finalization;
- abort before start fences the action;
- abort during running wins against later completed/failed finalization;
- late finalization may increase partial `stepCount` without changing aborted status/end time;
- bounded authorized `listTurns` order range;
- inaccessible thread returns no metadata;
- existing `abortStreaming` argument contract remains valid.

### Manual regression checklist

Run on `/project/[id]` at desktop and the narrowest supported rail:

- Empty state starters and composer.
- New conversation and historical thread switching.
- Send plain prompt; streaming markdown remains smooth.
- Each of the four tools: progressive label, done label, input, output, collapse, reload.
- Single edit, multiple replacements, highlight references, and Brain search.
- Proposal Apply, Apply all, Reject, Edit wording, Refine with AI, Review individually, Show changes, Show in document.
- “Jump to” one and many references.
- Highlight-to-chat and research-selection composer pills.
- ResearchFeed history, cancel, sources, feedback, proposal, and its ChainOfThought disclosure.
- File upload success, unsupported type, parse-without-text warning, attachment/category pills.
- Stop while queued, thinking, tool-running, and text-streaming.
- Send failure and retry/dismiss.
- Copy success feedback; copied content excludes trace details.
- Day separators across a date boundary.
- Load earlier once and repeatedly.
- Stick-to-bottom, scroll-up freeze, ScrollButton, and send re-pin.
- Reload during a live turn and after completion.
- Keyboard-only disclosure navigation, visible focus, screen-reader status, and reduced motion.

## 7. Risks and explicit non-goals

### Risks and mitigations

- **Streaming proxy cloning:** touching parts incorrectly can revive `DataCloneError`. Keep stream arrays `$state.raw`, snapshot only at the existing AI SDK handoff, and make normalization read-only (`uiMessages.svelte.ts:63-80`, `119-156`).
- **Deploy skew:** a new frontend may see old backend data and vice versa. Every timing prop/query result is optional; existing `Loader`, message status, and tool-count fallbacks stay until the whole rollout is stable.
- **Abort/finalize race:** app-side `aborted` is terminal and wins; `finishTurn` is the sole terminal reconciler.
- **Proposal duplication/misownership:** exact tool IDs win, each proposal ID is emitted once, and legacy fallbacks are covered by unit tests.
- **Long/sensitive tool data:** disclosures are capped, read-only, and access remains thread/project authorized. Provider metadata and raw provider errors are not rendered.
- **Reasoning cost/privacy:** reasoning remains a separate final phase. Only surfaced reasoning text is shown; provider identity, signatures, redacted blocks, and hidden metadata are excluded.
- **Primitive regression:** changing the chevron affects ResearchFeed and `/styleguide`; both are mandatory regression targets.
- **Historical timing:** no trustworthy backfill exists. Omitting duration is more accurate than inferring it from `_creationTime`.
- **Very long threads:** timing metadata is bounded to the newest 200 loaded turns. Older turns still render persisted text/tools/proposals and step-only summaries; load-earlier behavior itself is unchanged.
- **Schema hotspot:** `convex/schema.ts` may contain unrelated concurrent work. The implementer must preserve it and make only the additive table edit.

### Non-goals

- No React, JSX, hooks, Next.js APIs, or replacement chat framework.
- No change to the `AgentChatPanel` page-level props contract.
- No rewrite of `createUIMessages`, pagination, the agent component, or stream persistence.
- No new agent tools, higher step limit, approval flow, sources UI, usage UI, or finish-reason UI.
- No change to proposal validation, application, revision targeting, or suggestion lifecycle.
- No change to project workflow stages, generation state, ownership, handoffs, report branches, or production outcomes.
- No redesign of ResearchFeed, composer, thread menu, file ingestion, empty state, or report editor.
- No native widget registry, iframe, arbitrary generative UI, or execution of tool-returned HTML/JavaScript.
- No duration backfill for pre-`chatTurns` history.
- No storage of raw reasoning/tool payloads in the app schema.
- No user preference or admin setting for the initial thinking budget; Phase 4 either ships with 4,096 or remains disabled.

## Human confirmation before implementation

The implementer has no open design choices. The product owner only needs to confirm two planned product decisions:

1. Proposal cards remain visible below the collapsed trace instead of being hidden inside it.
2. Phase 4 may enable Anthropic thinking with a fixed 4,096-token budget; otherwise Phases 0-3 ship with reasoning rendering ready but generation disabled.
