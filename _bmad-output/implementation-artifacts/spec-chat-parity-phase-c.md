---
title: 'Report chat parity, Phase C: PDFs and images, pinned files, edit and alternatives, conversations, Vet, copy and feedback'
type: 'feature'
created: '2026-10-20'
status: 'done'
review_loop_iteration: 3
baseline_commit: '0aff7cf3'
context:
  - '{project-root}/_bmad-output/planning-artifacts/research/chat-parity-plan-2026-10-19.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-chat-parity-phase-b.md'
  - '{project-root}/docs/product-domain.md'
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem.** After Phases A and B (amendments 2026-10-19 seventh and 2026-10-20 first), the report chat still lacks several things writers use in ChatGPT and Claude:
- It cannot look at a PDF's pages or an image.
- A writer cannot hand it a specific file.
- Editing a message or regenerating a reply leaves the old reply in what the model reads.
- Conversations cannot be renamed, archived or sorted by use.
- Copying a reply pastes raw markdown, and card wording cannot be copied.
- Starter prompts send on click and use the wrong wording.
- A feedback vote cannot be changed or explained.
- Many chat controls are smaller than 44 px.
- The client's 2026-10-16 idea, "vet against public sources", is missing.

**Approach.**
- A `viewFile` tool sends a stored original PDF or image inline to Anthropic, and a picker pins up to 5 project files into a message.
- Alternatives inside one conversation: Edit and Regenerate make a sibling turn, and the model reads only the active path.
- Rename, archive, sort by last activity, and an admin-only delete.
- A "Vet against public sources" preset.
- Rich copy and "Copy wording".
- Regenerate after Stop.
- Starters that fill the composer.
- Changeable votes with a reason.
- 44 px touch targets.

**Owner decisions, 2026-10-19 and 2026-10-20 (not to be re-asked):**
- Original PDFs and images may go to Anthropic, inline only.
- Writers may pin a file into a message.
- Anyone on the report may edit a message; the alternative is labelled with who made it.
- Archiving conversations is approved, and admins may delete.
- Stop stays open to anyone.
- "I trust": continue phase by phase, push each finished phase, and test on a local copy.

**Lead decisions, 2026-10-20 (reported to the owner, reversible):**
- **One shared path per conversation.** A conversation has one active path (`activeTipPromptMessageId`). Edit, Regenerate and the switcher move it for everyone looking at that conversation. This is simpler and safer than a path per viewer, and the model, cards, jobs and chains all follow one path.
- **Media limits.** Images up to 5 MB each. PDFs up to 8 MB and 30 pages. At most 12 images and 8 MB of originals per reply. These fit Anthropic's 32 MB request limit and its 10 MB base64 image limit, and they fit the chat action's 64 MiB memory, since base64 plus the request body is about 3x the raw size. No page ranges, so no new dependency.
- **Page counts.** Page counts are worked out on the server the first time a PDF is viewed, then stored.
- **Delete.** Admin delete is permanent. Archive is reversible and keeps everything readable.
- **Feedback reasons.** A reason is offered on thumbs down only, from a short fixed list plus optional text.

## Boundaries & Constraints

**Always:**
- Agents propose, humans apply.
- Widen-only schema changes (optional fields, new indexes, new union values).
- Fictional data in tests.
- dashfix and copywriting for all copy.
- Design tokens, bits-ui primitives, max font weight 500.
- Same tool list on every turn, new tools appended.
- Opened or pinned file content is never stored in the agent tables, a new table, logs or the browser, except through the model's own reply and reasoning summary (2026-10-20 first, accepted path).
- Never use `toModelOutput` or save file parts.
- No `cache_control` on media; the chat already uses its breakpoints.
- Every change carries tests at the repo's levels.

**Ask First:**
- Any new dependency.
- Raising `CHAT_MAX_OUTPUT_TOKENS` or the step limit.
- Any card state or transition beyond what this spec lists.

**Never:**
- Hand-edit `convex/_generated/`.
- Push.
- Touch `src/lib/components/projects/**`, `src/lib/components/shell/**`, `WorkspaceChrome`, `PageTopBar` or `ProjectTopBar`.
- Store files through the agent component.

## Contracts (fixed names shared by all packages)

**Schema (all optional or new):**
- `projectDocuments.pageCount?: number`. The server stores it the first time a PDF is viewed.
- `chatTurns`:
  - `parentPromptMessageId?: string`. Absent means the turn with the next lower order.
  - `alternativeOf?: string`: the first sibling's `promptMessageId`, used as the group key.
  - `alternativeKind?: "edit" | "regenerate"`
  - `refineProposalId?: Id<"chatProposals">`. `sendMessage` writes it from now on.
  - `writerTextLength?: number`: the writer's own text length in the stored prompt.
  - `pinnedDocumentIds?: Id<"projectDocuments">[]`
  - New index `by_agentThreadId_and_alternativeOf`.
- `agentChatThreads`:
  - `activeTipPromptMessageId?: string`. Absent means the newest turn.
  - `lastActivityAt?: number`
  - `archivedAt?: number`
  - `archivedBy?: Id<"users">`
- `researchSessions.preset?: "vet"`.
- `chatAnswerFeedback`:
  - `updatedAt?: number`
  - `changeCount?: number`
  - `reasonCode?: "wrong" | "ignored_request" | "made_up" | "too_long" | "other"`
  - `reasonText?: string` (at most 500 characters)
  - `learningSnapshot` version 2 may carry the de-identified reason.
- `proposalWordingEditEvents`: new index `by_proposalId`, for delete.

**Functions:**
- **Tool `viewFile({ file })`**, appended after `readTranscript`.
- **`chatV2.sendMessage`** takes `pinnedDocumentIds?: Id<"projectDocuments">[]`:
  - at most 5, de-duplicated;
  - each must be in the same project and not archived;
  - stored on the turn and passed to `streamChatReply` as `pinnedDocumentIds`.
- **`chatV2.sendAlternative({ threadId, ofPromptMessageId, kind: "edit" | "regenerate", content? })`.** It checks the same access and admission as a send, and refuses with `CHAT_TURN_ACTIVE` while a reply runs. The source must be a finished turn on the active path. It rebuilds the highlight and refine blocks on the server from the source turn, never from client text, and copies the source's `pinnedDocumentIds`. It saves a new prompt, inserts the turn with the source's parent, sets the tip, and schedules the reply. It returns `{ threadId, messageId }`.
- **`chatV2.setActiveAlternative({ threadId, promptMessageId })`** sets the tip to the newest leaf under that alternative. It refuses with `CHAT_TURN_ACTIVE` while a reply runs.
- **`chatV2.listTurns`** also returns, per turn:
  - `alternatives?: { index: number; count: number }`, only when the turn's group has more than one;
  - `alternativeKind?`
  - `alternativeAuthorName?`
  - `pinnedFiles?: { documentId; name }[]`
- **Path filtering.** `listMessages`, `listTurns` and `listProposals` return only the active path's rows. Applied cards stay on the path where they were applied.
- **Conversation management:**
  - `chatV2.renameThread({ threadId, title })`: 1 to 80 characters after trimming; anyone with project access.
  - `chatV2.archiveThread({ threadId })` and `chatV2.restoreThread({ threadId })`: anyone with project access.
  - `chatV2.listArchivedThreads({ reportId })`
  - `chatV2.deleteThread({ threadId })`: admin only; refused while a reply runs.
- **`chatV2.listThreads`** leaves archived conversations out. It sorts by `lastActivityAt ?? createdAt`, newest first, over the report's newest 200 rows by creation, and returns 50.
- **`research.startResearch`** takes `preset?: "vet"`. The instruction is built on the server from a constant, plus any optional writer text, which still goes through redaction.
- **`chatFeedback.submitFeedback`** lets the voter change their vote. It accepts `reasonCode` and `reasonText` on thumbs down only, and clears them when the vote flips. The learning digest reads changed votes as new signals.

**Constants:**
- `CHAT_VIEW_MAX_IMAGE_BYTES = 5_000_000`
- `CHAT_VIEW_MAX_PDF_BYTES = 8_000_000`
- `CHAT_VIEW_MAX_PDF_PAGES = 30`
- `CHAT_VIEW_MAX_TURN_BYTES = 8_000_000`
- `CHAT_VIEW_MAX_IMAGES = 12`
- `CHAT_MAX_PINNED_FILES = 5`
- Admin setting `ai.chatVision` (anything other than "off" means on).

**Copy (fixed; dashfix and copywriting apply):**
- **Pin picker:**
  - menu item "Read a file in full";
  - picker heading "Choose up to 5 project files to read with this message";
  - chip shows the file name, with a remove button labelled "Remove {name}".
- **Edit:**
  - button "Edit";
  - inline editor buttons "Send" and "Cancel";
  - switcher arrows labelled "Previous response" and "Next response", with the text "2 / 3" and the accessible name "Response 2 of 3";
  - author line "Edited by {name}" or "Regenerated by {name}" ("you" for your own).
- **Conversations:**
  - "Rename", "Archive", "Archived conversations", "Restore";
  - admin only: "Delete permanently", confirmed by "Delete this conversation for everyone? This can't be undone." with buttons "Delete" and "Keep".
- **Vet:** button "Vet against public sources".
- **Copy:** reply copy "Copy"; card menu "Copy wording"; announced "Copied".
- **Feedback reasons:**
  - "Wrong"
  - "Didn't follow my request"
  - "Made something up"
  - "Too long"
  - "Other"

  Optional text placeholder: "What went wrong? (optional)". After a vote: "Feedback recorded. You can change it."
- **Starters:**
  - "Tighten the uncertainty framing in Line 242"
  - "Find every mention of the prototype"
  - "Check this report for banned words"
  - "Make Line 244 (work performed) more chronological"

</frozen-after-approval>

## Work packages (each worker owns its files; the root integrates)

All three start from `0aff7cf3`. Shared hot files are `convex/schema.ts`, `convex/chatV2.ts` (`sendMessage`, `listThreads`, `listTurns`), `convex/lib/chatChain.ts`, `convex/ai/chatAgentV2.ts`, `AgentChatPanel.svelte`, `AssistantTurn.svelte` and `ProposedEditCard.svelte`. In each of these, keep your edit to your region, put the logic in a new module, and add only a one-line helper call to `sendMessage`. The root merges.

### W1: PDFs and images, pinned files (backend plus the picker)

**Owns:**
- `convex/ai/chatDocumentTools.ts`
- `convex/chatDocuments.ts`
- a new `"use node"` module for counting PDF pages with the existing `pdfjs-dist` (no new dependency; verify it runs in Convex's Node runtime, and if it cannot, use a byte-pattern page count and refuse when unsure)
- `projectDocuments.pageCount`
- `appSettings` `chatVisionEnabled`
- the `pinnedDocumentIds` validation helper and its one call in `sendMessage`
- `chatTurns.pinnedDocumentIds`
- the `streamChatReply` `pinnedDocumentIds` argument and its per-turn tail injection in `chatAgentV2.ts`
- the guidance lines on viewing and pinning in `prompts.ts`
- the picker and its chips in the composer, plus the pinned-file chips on writer messages

**Tasks:**
1. **`viewFile`.**
   - Resolve the file by handle the way `readDocument` does. Only files with an original (`storageId`) and a PDF or image type can be viewed. A PDF whose page count is unknown is counted on the server and the count is stored.
   - Reserve the image count and bytes synchronously before any await, and release them on failure.
   - Read the bytes with `ctx.storage.get` inside the tool, and encode them as base64 once.
   - The tool result is a receipt only. The receipt and the media part (`image-data`, or `file-data` with `application/pdf`; media type normalised from the extension) go into the turn's `opened` map, and `withOpenedText` puts them back on every later step in the same bytes.
   - Fixed texts cover:
     - too big;
     - too many pages, saying to use `readDocument` for the text instead;
     - the turn's allowance used up;
     - not an image or PDF;
     - setting off.
   - The files list marks which files can be viewed.
2. **Pinned files.**
   - In the per-turn tail, add one ephemeral user message after the options note, holding the pinned files:
     - text files as `openedDocumentBlock`s, sharing the 240,000-character reading allowance (cut with a notice);
     - PDFs and images as file parts, under the same media caps.
   - Never saved. The recovery pass includes it again. Automatic links carry no pins.
   - Composer: "Read a file in full" in Message options opens a picker (bits-ui) of the project's non-archived files, with up to 5 chips. Pins are cleared after send, like a per-message option.
   - Writer messages show their pinned file names.
3. **Guidance.** The model may view a PDF's pages or an image with `viewFile` when the text is not enough (scans, figures, layout). Pinned files are already in front of it.
4. **Amendment points:**
   - pinning partly reverses 2026-10-19 (second): the chat still takes no uploads, drag and drop or paste;
   - original bytes go to Anthropic inline;
   - the limits.

**Tests:**
- SDK, with `fetch` stubbed:
  - the request carries an Anthropic `image` and `document` block inside `tool_result`, with base64;
  - the saved tool row holds only the receipt;
  - identical bytes on every later step;
  - no `cache_control` on media;
  - each cap and fixed text;
  - pins appear in the tail and nowhere stored;
  - the recovery pass re-sends pins.
- Convex tests for the page count path.
- Component tests for the picker.

### W2: edit and alternatives (full stack)

**Owns:**
- New `convex/lib/chatPath.ts` (the active path, sibling index and count).
- Schema: the `chatTurns` alternative fields and `agentChatThreads.activeTipPromptMessageId`.
- `chatV2.sendAlternative`, `setActiveAlternative`.
- Path filtering in `listMessages`, `listTurns` (alternatives fields), `listProposals`, `currentJob`, `threadCoverageRows`, `getThreadCoverageState` and the decision memory.
- Parent and tip writes in `sendMessage` (one helper call) and in `chatChain.ts`, where the tip and parent are used instead of "newest turn".
- The history `contextHandler` path fetch in `chatAgentV2.ts` / `chatEvidence.ts`.
- Frontend:
  - the Edit button and inline editor;
  - the switcher;
  - the author line;
  - Regenerate rewired to `sendAlternative` (including after Stop, once the turn is no longer streaming).

**Tasks:**
1. **The path.**
   - `activePath` reads the newest 200 turns once and walks parents from the tip. Older turns count as linear.
   - Every alternative saves a new prompt. Never reuse a `promptMessageId`.
   - `sendMessage` and automatic links append to the tip.
2. **The model reads only the path.** The `contextHandler` replaces `recent` with the path's rows (still windowed, with thinking-only replies dropped). It keeps the prompt and `existingResponses`. `historyStartOrder` comes from path rows.
3. **Server-side rebuild.** The writer's text is taken from `writerTextLength`; legacy turns are cut at the first server marker. The highlight comes from `turn.highlight`. The refine block comes from `turn.refineProposalId` with the same checks as a send, and is dropped when that card is no longer pending. An edit applies the size limits to the new text.
4. **Cards and memory.**
   - Coverage and decision memory read the path's cards, plus applied cards from any path.
   - Pending cards on another path keep their state and are hidden while that path is not active.
   - No new card state.
5. **Chains.**
   - A link's parent is the turn it continues.
   - "Newest turn" checks become "the tip".
   - `chainBefore` walks parents.
   - A switch while a reply runs is refused.
6. **Screens.**
   - Edit is offered on finished writer messages on the path, but not on automatic links.
   - Inline editor: Enter sends, Escape cancels.
   - The switcher appears under a writer message whose group has more than one alternative, with arrows and "2 / 3".
   - Author line.
   - Loading more when a filtered page is short.
7. **Amendment points:**
   - glossary "Chat alternative";
   - Regenerate now makes an alternative;
   - card visibility per path;
   - one shared path per conversation (lead decision).

**Tests:**
- convex-test:
  - the tree and the tip;
  - `sendAlternative` rebuilds and refusals;
  - path filtering of messages, turns and cards;
  - coverage on the path, plus applied cards from anywhere;
  - chain and tip.
- SDK: the model's request has no sibling reply (the leak test).
- Component:
  - Edit, Escape, the switcher;
  - Regenerate after Stop;
  - author lines.

### W3: conversations, Vet, copy, starters, feedback, touch targets (full stack)

**Owns:**
- `renameThread`, `archiveThread`, `restoreThread`, `listArchivedThreads`, `deleteThread`.
- The `listThreads` sort and the archived filter.
- `lastActivityAt` writes: one helper call in `sendMessage`, and one in `chatChain.ts` where a link is inserted.
- `sendMessage` restores an archived conversation on send (helper).
- Vet:
  - `research.startResearch` `preset`;
  - `researchSessions.preset`;
  - the button beside "Research this selection" in `EditorToolbar.svelte` and its wiring.
- Feedback:
  - `chatFeedback.ts`;
  - the digest read in `convex/ai/learning.ts`;
  - the `chatAnswerFeedback` fields;
  - `FeedbackBar.svelte`.
- Copy:
  - rich copy in `AssistantTurn.svelte` / `AgentChatPanel.svelte` `copyMessage`;
  - "Copy wording" in `ProposedEditCard.svelte`, including for applied and stale cards.
- Starters (`AgentChatPanel.svelte`).
- 44 px floors (`pointer-coarse:`) across chat components.
- `docs/design-system.md`, the `FeedbackBar` note only.

**Tasks:**
1. **Conversations.**
   - The thread picker gets Rename (inline), Archive, an "Archived conversations" view with Restore, and admin "Delete permanently" with confirmation.
   - A send without a `threadId` skips archived conversations.
   - Archived conversations stay readable.
   - Delete first removes the thread row, then pages through `chatTurns`, `chatProposals`, `chatProposalItems`, `proposalWordingEditEvents`, `chatWebSearches`, `chatAnswerFeedback` and the agent component thread (`deleteAgentChatThread`), as a scheduled job. `aiUsage` rows stay as billing data.
2. **Vet preset.**
   - Use the constant instruction from the explorer's draft, put through dashfix and copywriting.
   - The feed labels the session "Vet against public sources".
3. **Copy.**
   - Copy the rendered answer as `text/html` plus `text/plain` through `ClipboardItem`, with citation pills turned into "[n]".
   - Fall back to `writeText`.
   - "Copy wording" copies the card's proposed text.
   - Announce "Copied".
4. **Starters** fill an empty composer and focus it; they no longer send on click.
5. **Feedback.**
   - Votes can be changed; reasons are offered on thumbs down.
   - Learning snapshot v2 carries the de-identified reason.
   - The digest prompt uses a stated reason instead of "Never infer which detail…".
   - Digests read changed votes as new signals (an `updatedAt` index or equivalent).
6. **44 px floors** on every chat control in the explorer's list.
7. **Amendment points:**
   - archive and admin delete, which amend "queryable" and "Permanent deletion";
   - Vet, which amends 2026-10-19 (sixth) "Not built";
   - feedback and the learning loop;
   - starters wording.

**Tests:**
- convex-test:
  - rename, archive and restore, and the list order;
  - send skips archived conversations;
  - admin-only delete, and every keyed table emptied;
  - the Vet preset instruction, which the client cannot change;
  - feedback change, reason validation and the snapshot v2 de-identification;
  - the digest reading a changed vote.
- Component:
  - picker actions;
  - copy (`ClipboardItem` stubbed);
  - Copy wording;
  - starters;
  - feedback reasons;
  - coarse-pointer sizes.

## Verification
- **Per worker:** targeted tests, `npx tsc -p convex/tsconfig.json --noEmit`, `npm run check`, and component tests for the touched components.
- **Root:**
  - `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`.
  - Claude Opus 5.5 high review rounds until there are no P1 or P2 findings.
  - A real local replay with a dev snapshot:
    - viewFile on a PDF and an image;
    - a pinned file;
    - Edit and Regenerate, checking the model's request has no sibling reply;
    - archive and restore;
    - web search with sources (with the OpenRouter key copied to the local backend);
    - client data deleted afterwards.
- **Amendment:** `2026-10-20 (second)` in `docs/product-domain.md`.

## Verification record (2026-10-20)
- **Reviews.** Three rounds, all by Claude Opus 5.5 at high effort.
  - Round 1, two reviewers (engine; product and screens):
    - P2: when the history read failed, sibling replies reached the model.
    - P2: parallel views over-reserved the media allowance.
    - P2: the image cap was above some routes' limit (now 3.75 MB and 8000 px).
    - P2: an unbounded delete removed the row first.
    - 16 P3s.
  - Round 2: all round 1 findings fixed, and five new P3s (vote announcements on load, list-based deletion detection, card actions while deleting, untested guards, the settle timing), all fixed.
  - Round 3 (the writer-message label and round 2 fixes):
    - P2: the note could point at a spoofed label. Fixed: the note now says "outside every marked block", and chat data neutralizes the label.
    - P3s fixed or recorded.
- **Real replay.** An isolated local backend with a dev snapshot. Client files were not exported: two fictional files (a 3-page PDF and a PNG chart) were uploaded through the app's own path.
  - viewFile, image: answered correctly.
  - viewFile, PDF:
    - the model saw the pages;
    - the page count was worked out with pdf.js in the Node runtime and stored with its storage id.
  - A pinned file was summarized, and the turn stored the pin.
  - Alternatives:
    - an Edit made a sibling, and the edited reply said no earlier question had been asked (no leak);
    - after switching back, a new message saw the original path;
    - Regenerate made a third alternative.
  - Regenerate after Stop worked.
  - Rename, archive, restore and status worked. Delete was refused for a non-admin and finished for an admin.
  - Web search, on by default:
    - one record with the stripped query and two numbered canada.ca sources;
    - the reply cited [1] and [2].
  - The replay found that plain requests could be read as text inside the evidence. Fixed with a request-only label on writer messages, plus neutralization. Requests that read like an injection test can still be declined; realistic requests were answered.
  - The snapshot, the local database, the scripts and the worktree were deleted afterwards.
- **Contract changes after review.**
  - `CHAT_VIEW_MAX_IMAGE_BYTES` is 3,750,000 (not 5,000,000), plus an 8000 px limit.
  - New fields:
    - `projectDocuments.pageCountStorageId`
    - `agentChatThreads.deletingAt`, `deletingBy` and `purgeHeartbeatAt`
    - `chatTurns.actionEndedAt`
  - New query: `chatV2.threadStatus`.
  - New cron: `resumeStalledThreadPurges`.
- **Gate.** `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` on the final commit; the result is recorded in the handoff.

## Live browser test and second-model review (2026-10-20, owner request)
- **Setup.** Live test in a real headless Chromium against the app on localhost:5180, backed by a local Convex backend loaded with a fresh dev snapshot. The shared dev deployment was only read (export, keys). A local test admin account was created through the app's invite and sign-up path.
- **What worked in the browser:**
  - empty state, starters (fill the composer, Line wording) and Message options (web search on by default, "Read a file in full");
  - the full deviation job continuing on its own, with:
    - live progress and the reasoning trace;
    - cards with their Completion Report;
    - "Continuing with Line 246" chips;
    - the launcher's working label;
  - Apply then Undo, restoring the editor text exactly;
  - a thumbs-down reason and a changed vote, with the announcement;
  - Copy writing `text/html` and `text/plain` with no raw markdown;
  - Edit with the "2 / 2" switcher and "Edited by you", and switching back;
  - pinning a file from the picker (14 files) with its name on the message;
  - web search with numbered citation pills and a Sources row (`rel="noopener noreferrer"`, `referrerpolicy="no-referrer"`);
  - rename, archive and the Archived list;
  - author labels ("You", "Larry Rinaldo") and the Stop confirmation for someone else's reply (focus on "Keep going");
  - Regenerate after Stop;
  - the reply-ready label with the panel closed;
  - the Vet button and pill;
  - admin delete through its dialog;
  - no console errors.
- **Found by the live test:** environment values set after a local backend starts do not reach its Node actions until a restart. This is a local tooling quirk, not a product defect; the chat reported the failed search plainly.
- **Second-model review.** Claude Fable 5.1, three reviewers (engine, server and data, frontend), default effort.
  - Frontend P2: Phase C refusals raised the crash toast. Fixed by listing them as handled refusals.
  - P3s fixed:
    - file names now neutralize the writer label, marker lines included;
    - the prompt lane names viewFile and pins, and pinned files' position is corrected;
    - the amendment wording on the stored-prompt exception is corrected;
    - delete now asks the component in the same transaction as the row delete;
    - sign-in is checked before conversation lookups;
    - the delete refusal codes are pinned;
    - Esc keeps the Assistant open with pins or Brain on;
    - the tooltip no longer covers the pinned chips.
  - Recorded as limitations: the Undo record on the card row, the bits-ui warnings, and the Vet button size.
- **Generated types.** `convex/_generated/api.d.ts` was regenerated by `convex dev` on the final commit (new modules only).


## Follow-up fixes and the automated live test (2026-10-21, owner request "do the fixes")
- **Limitations fixed:**
  - the Undo record moved off the card row into `chatProposalAppliedChanges`;
  - toolbar buttons (Vet, Research and the format buttons) have a 44 px floor on touch screens;
  - bits-ui 2.18.1 to 2.19.5 removes most `derived_inert` warnings (247 to 12 in the three worst files). Two focus handoffs that relied on the old deferred focus now do their own (the file picker and the rename field).
- **Local key quirk handled.** `scripts/chat-live` sets the provider keys and local auth values, restarts the local backend, and runs one real web search through the Node action before any scenario. It stops with a plain reason if the key did not arrive.
- **Automated live run.** `node scripts/chat-live/run.mjs --project <id> --base ca427fb4` on `bea99ae2`: all 17 scenarios passed in one run (deviation job with 3 cards and 2 automatic links in 270 s, Apply and Undo, feedback, Copy, edit and alternatives, pinned file, image view, web search with sources, conversation actions, Stop for someone else's reply, Regenerate after Stop, reply ready, Vet, Esc, admin delete). Web search worked on the first try. Cleanup removed the worktree, snapshot, account and screenshots.
- **Harness fixes found on the way:** scenarios that wait on a reply now use their own conversation (a shared one made later scenarios wait on earlier replies); the open check reads the Assistant dialog's `inert` state (the panel stays mounted when closed); the inline editor's Send is found by `data-message-editor` (it is not a form); the dev server is warmed before scenarios (its first rebundle answers 504 "Outdated Optimize Dep"); and the favicon service's 404 for a site with no icon is ignored (it still serves its default globe image).
- **Reviewer.** Claude Fable 5.1 at default effort reviewed the follow-up fixes and the harness; its P1 (a key could appear in an error message) and P2 (no cleanup on Ctrl-C) are fixed.
