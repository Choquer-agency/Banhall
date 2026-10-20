---
title: 'Report chat parity, Phase B: reading files, continuing on its own, web sources, Undo'
type: 'feature'
created: '2026-10-20'
status: 'done'
review_loop_iteration: 3
baseline_commit: 'ca427fb4'
context:
  - '{project-root}/_bmad-output/planning-artifacts/research/chat-parity-plan-2026-10-19.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-chat-parity-phase-a.md'
  - '{project-root}/docs/product-domain.md'
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem.** After Phase A (amendment 2026-10-19 seventh), the report chat still falls short of ChatGPT and Claude in five ways writers notice:
- It cannot open a project file or a transcript. It sees a 5,000-token slice of up to 12 documents and never a transcript.
- A long job stops after each Line and waits for the writer to press Continue.
- Web answers name sources only in prose, with no source cards or numbered citations, and web search must be turned on for every message.
- An applied card cannot be undone except by restoring the whole report from Version history.
- In a shared report, nobody can see who asked what. A writer who switches tabs also gets no signal when a long reply is ready.

**Approach.**
- Add three reading tools: `readDocument`, `searchDocuments` and `readTranscript`. Opened text reaches the model for the current turn only and is never stored in the agent's tables.
- Continue a long job automatically, as linked turns.
- Store a small record per web search and show source cards and numbered citations. Make web search a per-conversation setting.
- Add Undo for an applied card.
- Show authors on shared conversations.
- Add a "reply ready" signal.
- Stop a pass before the action window runs out, and add an admin timing report.

Phase C items stay out of this phase: `viewFile` for PDFs and images, edit and alternatives, the pin-a-file picker, the Vet preset, archiving conversations, and the accessibility and copy pass.

**Owner decisions, 2026-10-19 (not to be re-asked):**
- **Transcripts.** The chat may read them whenever it needs to, names as written. This needs an amendment to decision 26.
- **Auto-continue.** On, with no cap beyond the project's daily chat budget. Stop on any link ends the chain.
- **Web search.** Set per conversation, with source cards and numbered citations.
- **Undo for an applied card.** Approved.
- **Stop.** Stays open to anyone on the report. A confirmation before stopping someone else's reply is allowed; a restriction is not.
- **Agent setup.** Opus 5.5 high for the orchestrator, the workers (each in its own worktree) and the reviewers.

**Lead decisions, 2026-10-20 (reported to the owner, reversible):**
- **Web search default.** On by default for every conversation, including existing ones, and switchable per conversation. The plan recommended "Default on", and the owner answered "on per conversation".
- **What Undo does.** Undo moves a card from `applied` back to `pending`, so it can be applied again or dismissed. No new card state is added.
- **Step limit.** Rises from 5 to 8 per pass. A pass now stops before the action window runs out, so the longer limit is safe, and reading tools need the extra steps.
- **No page numbers in citations.** PDF page boundaries are not stored, so file excerpts are cited by part (40,000-character parts), not by page. Page numbers come with `viewFile` in Phase C.
- **Kill switches.** `ai.chatDocumentTools` and `ai.chatAutoContinue` are admin settings that default to on.

## Boundaries & Constraints

**Always:**
- Agents propose, humans apply. No path may let an AI tool change report prose directly. Undo is a human action.
- Schema changes only add optional fields, tables, union values or indexes (widen only). No backfill.
- Client data stays private: tests and fixtures use fictional data only. Opened file and transcript text never enters a stored tool result, a new table, a log line or the browser through any path other than the model's own reply.
- Copy uses plain hyphens only (dashfix) and plain language (copywriting). Use design-system tokens and bits-ui primitives, and max font weight 500.
- Raw tool arguments and results never reach the browser. The Phase A sanitizers stay deny-by-default.
- Every turn sends the same tool list in the same order. New tools are appended at the end.
- Every change carries tests at the level the repo uses: unit, convex-test, SDK with HTTP stubbed, and component.

**Ask First (the root asks the owner):**
- Any card state or transition beyond `applied -> pending` by `undoProposal`.
- Raising `CHAT_MAX_OUTPUT_TOKENS`, or the step limit beyond 8.
- Any dependency change.

**Never:**
- Hand-edit `convex/_generated/`.
- Commit outside your own worktree branch, or push.
- Touch files the Projects dialogs session owns: `src/lib/components/projects/**`, `src/lib/components/shell/**`, `WorkspaceChrome`, `PageTopBar`, `ProjectTopBar`.
- Store files through the agent component (storage-sweep rule).

## Contracts (shared by all packages; names are fixed)

**Schema** (`convex/schema.ts`, all optional or new):
- **`chatTurns`:**
  - `origin?: "auto_continue"`: a turn the server started to continue a job.
  - `autoContinueSkipped?: "budget" | "no_progress" | "off"`: why a finished turn with a `continuation` did not continue on its own.
  - `chainStoppedAt?: number`: Stop pressed just after this turn finished, so its chain must not continue.
- **`agentChatThreads`:**
  - `createdBy?: Id<"users">`, set when the row is created.
  - `webSearch?: boolean`. Absent means on.
- **`chatProposals`:**
  - `appliedChange?: { revisionNumber: number; appliedAt: number; appliedBy: Id<"users">; hunks: Array<{ before: string; after: string }> }`. `before` and `after` are JSON strings of runs of top-level Tiptap blocks.
  - `undoneAt?: number`
  - `undoneBy?: Id<"users">`
- **`reportSnapshots.reason`:** adds `"pre_chat_undo"`. Version history labels it "Before undo".
- **New table `chatWebSearches`:**
  - Fields: `projectId`, `reportId`, `agentThreadId`, `promptMessageId`, `query` (the query exactly as sent, after name stripping), `status: "ok" | "failed"`, `sources: Array<{ n: number; url: string; title: string; domain: string }>` (at most 5 per search), `createdAt`.
  - Indexes: `by_agentThreadId_and_promptMessageId` and `by_projectId`.
  - Listed in `convex/lib/projectScopedTables.ts`.
  - A record is written only for a search that was actually sent. A search refused for names, turned off or over its limit writes nothing.

**Functions:**
- `chatV2.listTurns` also returns `origin?`, `autoContinueSkipped?`, `senderName?` and `fromCurrentUser: boolean`. `senderName` uses `turnSenderName`, so it never carries an email.
- `chatV2.listThreads` also returns `createdByName?`, `startedByCurrentUser: boolean` and `webSearch: boolean`. For old rows, the creator falls back to the first turn's `userId`.
- `chatV2.setThreadWebSearch({ threadId, enabled })`, mutation. Requires the same project access as `sendMessage`.
- `chatV2.sendMessage({ ..., allowWeb? })`. `allowWeb` now means "the conversation's web setting at send time". When given, it is written to the thread (or seeds a new thread). The turn always uses the thread's stored setting. A send without it uses the stored setting.
- `chatV2.listTurnWebSources({ threadId })`, query. Returns `Array<{ promptMessageId, query, status, sources }>` in creation order.
- `chatV2.undoProposal({ proposalId })`, mutation.
  - Requires `requireReportEditAccess`.
  - Refuses with `INVALID_STATE` when the card is not applied or has no `appliedChange`.
  - Refuses with `PROPOSAL_UNDO_CONFLICT` when the applied text changed since.
- `chatV2.listProposals` also returns `undoable: boolean` and `undoneAt?`. Hunks never go to the browser.
- `chatV2.reportChatActivity({ reportId })`, query. Returns `{ active: boolean; mineActive: boolean; mineLastFinishedAt: number | null }` over the report's conversations.
- `chatV2.continueChain({ agentThreadId, promptMessageId })`, internal mutation. See W2.
- `aiUsage.chatTimingReport({ sinceMs? })`, admin-only query. For chat steps it returns:
  - p50 and p90 of `durationMs` and `firstTokenMs`, by effort;
  - stop-reason counts;
  - step counts per turn.

  Numbers only.

**Tools** (appended to `buildChatTools`, in this order):
1. `readDocument({ file, part?, parts? })`
2. `searchDocuments({ query })`
3. `readTranscript({ transcript, fromTurn?, turns? })`

**Reading constants:**
- `CHAT_READ_PART_CHARS = 40_000`
- `CHAT_READ_MAX_CALL_CHARS = 120_000`
- `CHAT_READ_MAX_TURN_CHARS = 240_000`: shared by all three tools, across the turn's passes.
- Search returns at most 8 excerpts of up to 1,500 characters each.

**Engine constants:**
- `CHAT_MAX_STEPS = 8`
- `CHAT_MIN_STEP_REMAINING_MS = 90_000`

**Admin settings** (`appSettings`; anything other than `"off"` means on):
- `ai.chatDocumentTools`
- `ai.chatAutoContinue`

**Copy** (fixed; dashfix and copywriting apply):

| Where | Text |
|---|---|
| Auto-continue chip | "Continuing with Line 244" / "Continuing" |
| Skip note, budget | "Stopped continuing automatically: this project's daily chat budget is used up." |
| Skip note, no progress | "Stopped continuing automatically because the last reply made no progress." |
| Stop confirmation | Title "Stop {name}'s reply?"; body "{name} started this reply. Stopping it ends it for everyone."; buttons "Stop reply" and "Keep going" |
| Undo | Button "Undo"; conflict "This passage changed after it was applied, so it can't be undone here. Use Version history to go back." |
| Web setting | Switch "Search the web in this conversation"; chip "Web search on"; trace line "Searched the web: {query}"; row title "Sources" |
| Reading progress | "Reading a project file…", "Searching project files…", "Reading a transcript…" |
| Reply-ready tab title | prefix "Reply ready - ", only while the tab is hidden |
| Notification opt-in | "Notify me when a reply is ready"; notification title "Banhall", body "Your reply is ready." (never any client or report text) |

</frozen-after-approval>

## Work packages (each worker owns its files; the root integrates)

All three start from `ca427fb4` on `feat/clients-and-projects-redesign`. Shared hot files: `convex/schema.ts`, `convex/chatV2.ts`, `convex/ai/chatAgentV2.ts`, `convex/ai/prompts.ts`, `convex/appSettings.ts`, `AgentChatPanel.svelte` and `AssistantTurn.svelte`. Change these only in your listed regions and keep the edits small. Put new logic in new modules. The root resolves merge conflicts.

### W1: reading files (backend, plus three progress labels)

**Owns:**
- New `convex/ai/chatDocumentTools.ts` and its tests.
- New `convex/chatDocuments.ts`: internal queries that read documents, transcripts and search.
- `convex/ai/chatEvidence.ts`: file handles, the transcripts block and the notices.
- `convex/chatV2.ts`: the `getChatContextV2` region only.
- `convex/ai/prompts.ts`: `CHAT_EVIDENCE_GUIDANCE` and the reading lines of the chat lane.
- `convex/appSettings.ts`: a `chatDocumentToolsEnabled` reader.
- In `convex/ai/chatAgentV2.ts`:
  - the three tool registrations in `buildChatTools`;
  - one per-turn `DocumentReadTurn`, created next to `newWebSearchTurn`;
  - one call in `prepareStep` to the injection helper.
- `convex/aiUsage.ts`: `chatTimingReport`.
- `src/lib/chat/turnParts.ts`: progress labels for the three tools only.

**Tasks:**
1. **Handles.**
   - The FILES IN THIS PROJECT list gives each row a handle (`F1` to `F60`) in its existing stable order.
   - A new TRANSCRIPTS block in the cached head lists each active transcript (not archived, not superseded) with a handle (`T1`...), its label, its number of speaker turns, its characters, and its speakers with their roles (interviewer, client, other, unknown).
   - Names pass through `sanitizeFileName` and `neutralizeMarkers`.
   - The notices for files left out by the budget now say they can be opened with `readDocument`.
   - Files with no readable text still cannot be opened. Their notice says so.
2. **readDocument.**
   - `file` is a handle or an exact file name (case-insensitive).
   - It is scoped to the thread's project: check `doc.projectId` against the `agentChatThreads` row and the report. Archived files are excluded.
   - It returns parts of `CHAT_READ_PART_CHARS`. `part` is 1-based, and `parts` is at most 3, so at most 120,000 characters per call.
   - It reserves the turn budget synchronously, before any `await`.
   - The tool **result is a short receipt with no excerpt**, for example `Opened F3 "name", parts 1-2 of 5 (80,000 of 183,000 characters).`
   - The text is held in the per-turn map under the `toolCallId`.
   - On every later step of the same pass, `prepareStep` replaces that tool result's output in `messages` with the receipt plus the text, in the same evidence data markers and trust label as project documents. The bytes must be identical on every step.
   - Never use `toModelOutput`, because it is persisted.
   - Fixed texts cover: no such file, a file with no text, the budget used up, and the setting off.
3. **searchDocuments.**
   - Uses Unicode-aware terms, so accented French words count. Do not change Contextual Research's `queryTerms`; share `documentChunks` and the scoring where you can.
   - Searches project files through `search_content` (project filter, then drop archived rows, within the `chatReadBudget` pattern) and active transcripts in memory.
   - Returns up to 8 excerpts of up to 1,500 characters. Each carries its location, such as `F3 part 2` or `T1 turns 40-46`.
   - The excerpts are injected the same way. The receipt only counts what was found.
4. **readTranscript.**
   - `transcript` is a handle or an exact label.
   - Pages by speaker turn, up to 40,000 characters per call.
   - Each line reads `[turn 12, 00:14:32] Interviewer (label as written): text`, using the turn's stored text with names as written.
   - A transcript with no parsed turns pages by characters.
   - Injected the same way.
5. **The recovery pass** starts clean: opened text is not carried over, but the turn budget is shared.
6. **The setting off** keeps all three tools registered. They return "Opening files is turned off for this workspace."
7. **Guidance.** Rewrite `CHAT_EVIDENCE_GUIDANCE` and the reading lines. They must say:
   - the files and transcripts lists show what exists;
   - open with the tools when the blocks don't hold what you need;
   - text opened in earlier turns is not kept, so reopen it;
   - never claim to have read or checked what you did not open in this turn;
   - images and scans cannot be opened yet;
   - quote sparingly.

   Update the pinned guidance tests.
8. **Logging.** One "chat document read" log line per call: tool name, characters and parts. No names, no text.
9. **`chatTimingReport`.** Admin only (`requireRole(ctx, ["admin"])`), reading `aiUsage` chat rows through an existing index, bounded.

**Tests:** an SDK test with real AI SDK and agent and `fetch` stubbed (pattern: `convex/chatParity.sdk.test.ts`):
- the saved tool row holds only the receipt;
- the injected text is present on each later step's request with identical bytes, and absent from saved messages;
- the per-call and per-turn budgets hold;
- another project's file and archived files are refused;
- with the setting off, the fixed text is returned;
- the `tools` bytes are identical across turns;
- the recovery pass starts clean.

Also add convex-test coverage for `chatDocuments.ts` and update the evidence and prompt suites.

### W2: continuing on its own, authors, reply ready, time stop (full stack)

**Owns:**
- `convex/chatV2.ts` regions:
  - `sendMessage`, only to set `createdBy` when it creates the thread row;
  - `abortStreaming`;
  - `listTurns`;
  - `listThreads`, the author fields;
  - new `continueChain`;
  - new `reportChatActivity`.
- `convex/ai/chatAgentV2.ts` regions:
  - `CHAT_MAX_STEPS` and `stopWhen`;
  - the time stop;
  - the end-of-action call to `continueChain`, after every message has been saved.
- `convex/lib/chatTurnState.ts`.
- `convex/appSettings.ts`: a `chatAutoContinueEnabled` reader.
- The schema fields for `chatTurns` and `agentChatThreads.createdBy`.
- Frontend:
  - In `AgentChatPanel.svelte`: author labels, the auto-continue chip, the Stop confirmation, and the notification opt-in.
  - In `AssistantTurn.svelte`: the skip note beside Continue.
  - New `src/lib/chat/replySignal.svelte.ts`: tab title and notification.
  - `src/lib/components/project/shell/PanelToolbar.svelte`: one optional prop for ring and dot.
  - The floating Assistant pill in `CurrentProjectPage.svelte`.
  - The activity query wiring in `CurrentProjectPage.svelte` and `PreviewProjectPage.svelte`.

**Tasks:**
1. **`continueChain`, one transaction, called at the very end of `streamChatReply`.** Continue only when all of these hold:
   - the turn is `completed`, or `failed` with a `cut_off` continuation;
   - it has a `continuation`;
   - it has no `chainStoppedAt`;
   - it is the newest turn of the thread, and no turn there is queued or running;
   - the setting is on;
   - the turn made progress: either the continuation is `lines_left`, or the turn saved any proposal (`turnSavedAnyProposal`);
   - when the previous turn was also an automatic link, `remaining` dropped or `nextSection` changed;
   - the project's rolling 24-hour chat spend is within budget.

   Then, in the same transaction:
   - save the writer-role message `Continue with Line N.` (or `Continue.`) under the original sender's `userId`, the same text `continueMessage` makes, so job and coverage logic already treat it as a Continue;
   - insert a queued turn with `origin: "auto_continue"`;
   - schedule `streamChatReply`, with Brain off and web from the thread setting (`webSearch !== false`).

   Otherwise, record `autoContinueSkipped` when the reason is `budget`, `no_progress` or `off`. Automatic links do not count toward the queue limit.
2. **Stop on a chain.**
   - Stop on a queued or running link works as today and ends the chain, because a stopped turn never continues.
   - `abortStreaming` on the newest turn that finished less than 30 seconds earlier and has a `continuation` records `chainStoppedAt` instead of refusing.
3. **Time stop and step limit.**
   - `CHAT_MAX_STEPS` becomes 8. The recovery pass keeps its own limit.
   - A new step does not start with less than `CHAT_MIN_STEP_REMAINING_MS` left in the action window.
   - A pass stopped for time ends exactly like the step limit: closing note and `step_limit` continuation.
   - Update the step-limit tests.
4. **Authors.**
   - `createdBy` is set on new threads.
   - `listTurns` and `listThreads` return the author fields from Contracts.
   - In the panel, writer messages show their author's name ("You" for your own) when the conversation has messages from more than one person.
   - The thread picker shows "Started by {name}" for conversations someone else started.
   - Automatic links render as the muted chip, not as a writer message.
5. **Stop confirmation.** When the active turn's sender is someone else, Stop asks first (bits-ui AlertDialog, the copy from Contracts). It never restricts Stop.
6. **Reply ready.** `reportChatActivity` drives:
   - a working ring on the Assistant toggle (`PanelToolbar`) and on the floating pill while any reply on the report runs;
   - a dot when one of your replies finished after you last had the panel open. "Seen" is per report, in `localStorage`.
   - The tab title gets the prefix only while the tab is hidden, and is restored on focus.
   - The optional notification: an opt-in in the panel's menu, browser permission asked on opt-in, fired only while the tab is hidden, generic text only.

   The panel is lazy-mounted, so all of this lives at page level.
7. **Skip note.** The newest turn's Continue button shows the skip note for `budget` or `no_progress`.

**Tests:**
- convex-test for the chain:
  - a link is scheduled with the exact text and `origin`;
  - Stop on a link ends the chain;
  - Stop just after a turn finished ends it too;
  - a skip for each of budget, no progress and setting off;
  - a newer writer turn wins;
  - the lease holds;
  - the queue limit is not counted.
- SDK test for the time stop and the 8-step limit.
- Tests for `reportChatActivity` and the author fields.
- Component tests: chip, author labels, Stop confirmation, ring and dot, skip note, title prefix (with document visibility stubbed).

### W3: web sources and per-conversation setting, Undo (full stack)

**Owns:**
- `convex/ai/chatWebSearch.ts` and `convex/ai/chatWebSearchNode.ts` (add `domain`).
- The `chatWebSearches` table and its `projectScopedTables` entry.
- `convex/chatV2.ts` regions:
  - new `setThreadWebSearch`;
  - new `listTurnWebSources`;
  - the `allowWeb` resolution in `sendMessage`, through a helper and nothing else in that function;
  - the `listThreads` `webSearch` field;
  - `applyProposal` and `markProposalApplied`;
  - new `undoProposal`;
  - the `listProposals` fields.
- New `convex/lib/appliedChange.ts`.
- The snapshot reason, and its label in `src/lib/components/history/VersionHistory.svelte`.
- The web lines of the chat lane in `convex/ai/prompts.ts`.
- If `convex/ai/chatAgentV2.ts` needs to pass `promptMessageId` into the web search turn, only the `newWebSearchTurn` call.
- Frontend:
  - the web switch in Message options (`AgentChatPanel.svelte` / `ComposerOptions`);
  - the Sources row and citations: `AssistantTurn.svelte`, `primitives/MessageContent.svelte` and new source components under `src/lib/components/chat/`;
  - Undo in `ProposedEditCard.svelte` / `ProposalCard.svelte`.

**Tasks:**
1. **Per-conversation web search.**
   - Store the setting on the thread, and make `sendMessage` resolve it as in Contracts.
   - Continue, Regenerate and automatic links use the thread setting.
   - The composer shows the switch, which persists per conversation and is not cleared on send, plus a chip while it is on. A new unsaved conversation keeps the switch locally until its first send.
   - Update the "sixth" behaviour tests that pin "cleared after each send".
2. **Search records and numbering.**
   - `WebSearchTurn` numbers sources across the whole turn: the first search is `[1]` to `[5]`, the next continues from there, and the same URL keeps its number.
   - The model's result lists `[n] title - url` and tells it to cite as `[n]`.
   - Write a `chatWebSearches` row per sent search. It needs the turn's `promptMessageId`, the same way the proposal tools get theirs.
   - Keep only `http` and `https` URLs, with credentials stripped. Titles are plain text, at most 200 characters.
   - The answer text is never stored.
3. **Citations in the browser.**
   - Pass Streamdown `sources` only for that turn's numbers, keyed `"1"`...`"n"`.
   - An `inlineCitationPreview` snippet shows the number.
   - A theme override uses design tokens.
   - Keep `allowedImagePrefixes` empty.
   - `[GAP: ...]`, inventory ids and any unmatched brackets must render as plain text, exactly as today. Test this with and without sources.
   - Show a Sources row under the reply: number, favicon by hostname, title and domain. Links open in a new tab with `rel="noopener noreferrer"` and `referrerpolicy="no-referrer"`.
   - The trace shows "Searched the web: {query}".
4. **Undo.**
   - **Recording.** At apply, in both `applyProposal` and `markProposalApplied`, compute the changed runs of top-level blocks between the stored and the new Tiptap document and store them in `appliedChange` (a total of up to 400,000 characters; above that, store nothing and offer no Undo).
   - **Matching.** `undoProposal` finds each hunk's `after` run exactly once in the current document, using a canonical comparison (sorted keys, no null or empty `attrs` or `marks`). Verify this against how the editor re-saves content. The runs must not overlap.
   - **Writing.** It then puts `before` back, all or nothing, in one transaction:
     - a `pre_chat_undo` snapshot;
     - content, `contentHash`, `revisionNumber + 1` and `provenanceForEdit`, as in apply;
     - `persistDeterministicFindings`;
     - the card goes back to `pending` with `appliedChange` cleared and `undoneAt` and `undoneBy` set;
     - `pruneSnapshots`.
   - **Refusals.** A run that is missing or not unique refuses with `PROPOSAL_UNDO_CONFLICT`.
   - **What stays as it was.** Record-only cards and cards applied before this change have no Undo. Cards that went stale because of the apply stay stale. Coverage is unchanged, since a pending card counts as handled.
   - **On the card.** The applied status row shows Undo, gated like Apply (edit access, `onBeforeApply` to flush the editor first). A conflict is shown in the card's own error slot, with no crash toast (handled refusal).

**Tests:**
- convex-test for Undo:
  - exact restore including marks;
  - restore after an unrelated edit elsewhere;
  - a conflict when the passage changed;
  - bulk cards;
  - a stepper apply;
  - re-apply after Undo;
  - permission;
  - the snapshot reason;
  - the size cap.
- Tests for `chatWebSearches` numbering, deduplication, no record for refused searches, and erasure (the project-scoped tables test).
- An SDK test showing the citation instruction in the tool result.
- Component tests:
  - citation numbers;
  - `[GAP: ...]` unchanged;
  - the Sources row and safe links;
  - the web switch persisting per conversation;
  - Undo gating, success and conflict.

## Verification
- **Per worker:**
  - targeted tests;
  - `npx tsc -p convex/tsconfig.json --noEmit`;
  - `npm run check`;
  - `npm run test:component` for the components touched.
- **Root after integration:**
  - `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`.
  - A review by Claude Opus 5.5 at high effort (one or two reviewers per round), until there are no P1 or P2 findings.
  - A real replay on an isolated local backend with a dev snapshot:
    - the PD13 c job continuing on its own across Lines with no typed Continue;
    - Stop on a link;
    - a question that needs a file outside the evidence (readDocument) and one that needs a transcript (readTranscript);
    - Undo of an applied card.
  - The client data is deleted afterwards.
  - Web search in the replay needs the OpenRouter key on the local backend, which needs owner approval. Without it, the SDK and component tests stand in.
- **Amendment:** `2026-10-20 (first)` in `docs/product-domain.md`, written by the root from the integrated result. It amends:
  - Rule 8 of 2026-10-19 (first);
  - the decision 26 exception list (transcripts);
  - the step limit;
  - 2026-10-19 (sixth): the option becomes per conversation, and sources are shown;
  - Rule 6 and the Continue rules of 2026-10-19 (seventh): automatic links;
  - the card transitions (Undo) in AD-4.

## Verification record (2026-10-20)
- **Reviews.** Three rounds, all by Claude Opus 5.5 at high effort:
  - **Round 1** used two reviewers, one for the engine and reading tools, one for Undo, web and the screens.
    - P2: the 90 s time stop was shorter than one step, so a timed-out turn lost its chain.
    - P2: Undo could report success and leave a duplicated paragraph when touching runs were not merged (a fuzz test found it).
    - Fourteen P3s, all fixed.
  - **Round 2:** all round 1 findings fixed. Four new P3s (first counts as progress, a timed-out partial reply, the Undo byte check, no record without a key), all fixed.
  - **Round 3:** reviewed the round 2 fixes and the waiting rule. Approved with three P3s: blocked rows now count for nothing; whole-Line items, paraphrased continues and the note gap are recorded as known limitations.
- **Real replay** on an isolated local backend with a dev snapshot of a senior writer's PD13 c project and his own prompts:
  - **Run 1:** the job continued on its own. The head turn plus three automatic links, 421 s, no failures. It found the waiting-card defect: one link rewrote Line 242 again, giving 6 duplicate items. Fixed with "waiting on a pending card".
  - **Runs 2 and 3, after the fix:**
    - Run 2 did all three Lines in one reply of 6 steps.
    - Run 3 was the head turn plus two automatic links.
    - Both ended with 18 distinct items (17 resolved, 1 blocked) and no duplicates.
  - **Stop on a running link:** the link ended as stopped, with no offer and no further link.
  - **Reading:**
    - readTranscript opened 41 speaker turns.
    - searchDocuments ran 4 calls in parallel.
    - Replies cited turn numbers and parts.
    - Stored tool results were receipts of 130 to 218 characters.
    - No 160-character window of transcript or file text was found in tool rows, stored replies or 58 stream deltas.
  - **Undo on a real card:** the report came back byte for byte (same hash). The card returned to pending, a `pre_chat_undo` snapshot was taken, and `appliedChange` never reached the browser.
  - **No failures anywhere:** no failed replies, no recovery passes, no thinking-only cut-offs.
  - **Not run:** web search, because the OpenRouter key was not copied to the local backend (it needs owner approval). The SDK and component tests cover it.
  - **Clean-up:** the snapshot, the local database, the replay worktree and the scripts were deleted afterwards.
- **Contract changes after review:**
  - `CHAT_MIN_STEP_REMAINING_MS` is 150_000, not 90_000 (round 1 P2).
  - `chatWebSearches` gains `toolCallId` and the `by_agentThreadId` index.
  - `chatTurns.continuation` gains an optional `waiting` list.
- **Gate.** `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` on 3dcc63d6 passed all 10 steps (6,873 unit tests, 1,879 component tests); the final run on e3bc23a5 is recorded in the handoff.

