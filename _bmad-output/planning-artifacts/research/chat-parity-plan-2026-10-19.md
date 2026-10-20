# Report chat: closing the gaps with ChatGPT and Claude

Research date: 2026-10-19. Branch: `feat/clients-and-projects-redesign` at 5d32c078.

**Method.** Five read-only research agents covered:
1. reading files;
2. speed and long jobs;
3. edit and regenerate;
4. web sources and reasoning display;
5. a parity audit of everything else.

Each one checked this codebase (with file and line references, all held in its report) and the installed SDK versions, and looked up current Anthropic, OpenAI and Claude documentation. No code was changed, no deployment was touched, and no client data was read.

**The question.** The owner asked how to close every gap between Banhall's report chat and what writers expect from ChatGPT and Claude.

**The answer.** Every gap can be closed. The work is about 45 to 60 developer days, done in four phases. Phase A fixes real defects first. Several items need an owner decision or a `docs/product-domain.md` amendment before they are built (see "Decisions for the owner").

## Defects found during the research (fix first)

These are bugs, not missing features.

| Defect | What happens | Fix | Effort |
|---|---|---|---|
| Stop is ignored while the model thinks | The agent only notices Stop when it writes the next stream chunk. A step that thinks silently writes nothing, so Stop takes effect only when that step ends, which can take up to 2 minutes, and the tokens are still billed. | While a reply runs, check `isTurnActive` every 2 s and abort the model request. | S |
| Refusals show raw server errors | "A reply is still being written", the project budget limit and the queue limit show as raw Convex error text with request IDs, and they raise the global crash toast. | Use `userErrorMessage`, give each refusal a chat-specific code that is handled quietly, name who is replying, and show when the budget resets. | S |
| Esc closes the whole assistant | The page Esc handlers ignore `defaultPrevented`, so closing a menu also closes the panel (likely; confirm in a browser). | Return early when the event was already handled, and keep the panel open while the composer has text. | S |
| Per-message tools break caching | Turning on Brain or web search for one message changes the tool list, which rewrites the cache for tools, system prompt and history. That costs about $0.125 instead of $0.01 for that turn and the next. | Register the tools on every turn and enforce permission inside each tool. | S |
| Favicons send full links to Google | The source favicon request carries the whole source URL. | Send only the hostname. | S |
| The saved-message filter lets unknown part types through | The stored-message sanitizer passes unknown part types, while the live stream sanitizer blocks them. | Make it block unknown types too. | S |
| Apply shown to people who cannot apply | The server refuses them. | Gate the button on `getProjectEditAccess`, as the Files panel does. | S |
| Brain step details never show | The query label and source chips read tool input and output that the sanitizer replaces. | Restore them from a stored record, or remove them. | S |

## Gap 1: reading files (largest gap)

**Today.**
- The chat sees at most 12 documents. Each is cut to its first 5,000 tokens, with 60,000 tokens in total.
- It never sees images, scanned PDFs or raw transcripts.
- In the 2026-10-19 replay, a writer's settings document was cut to 5,000 tokens. Generation reads up to 75,000 characters of the same document.
- Text is extracted in the browser (pdf.js, mammoth, xlsx) and stored on `projectDocuments.content`, up to 400,000 characters. The original bytes are stored too.
- A full-text search index (`search_content`) already exists. Only Contextual Research uses it.

**What others do.** Claude reads named files in full and shows PDFs to the model as pages, as text plus images. Above the context limit it switches to search. ChatGPT mixes full context with search.

**Recommended design: open files only for the current turn.**
- A read or view tool stores only a short receipt as its result.
- The file content is added to the request for that turn through `prepareStep` and is not stored in the agent's message tables. This keeps client text out of new tables, keeps the storage-sweep rule intact, leaves the cached prefix untouched, and keeps the recovery pass clean.

| Phase | What | Effort |
|---|---|---|
| 0 | A "FILES IN THIS PROJECT" list in the cached evidence (name, category, status, size, whether it can be viewed). The detected settings document gets its own allowance of up to 75,000 characters, outside the 12 slots. The notices say "open it with readDocument". | S, 1-1.5 d |
| 1 | `readDocument`: paged reading, 40,000 characters per page, at most 120,000 per call and 240,000 per turn, scoped to the thread's project, archived files excluded. | M, 2-3 d |
| 2 | `searchDocuments`: a keyword search over chunks, reusing `selectProjectEvidence` and the existing search index, with no embeddings. It returns cited excerpts with their page numbers. | S, 1.5-2 d |
| 3 | `viewFile`: sends the stored original PDF or image to the model as a document or image block (vision). Limits: images up to 5 MB; PDFs up to 10 MB and 30 pages; 12 images and 30 MB per turn. Original bytes go inline, never through the Files API or a URL. Reading a page range of a large PDF needs `pdf-lib`, a new dependency. | M, 3-5 d (+1-2 for page ranges) |
| 4 | A "Read a file in full" picker in Message options, so the writer can pin up to 5 project files into the next message. This needs owner approval: it partly reverses 2026-10-19 (second). | M, 3 d |
| 5 | `readTranscript`: paged by speaker turn, with speaker roles. Only after an amendment to decision 26. | S-M, 2-3 d |

Everything is behind admin flags (`ai.chatDocumentTools`, `ai.chatVision`). The rollout goes dev, then one writer, then all. A "chat document read" log records counts only. Add the read tools to the medium-effort step set only if cut-offs rise.

**Amendments needed.**
- Rule 8 of 2026-10-19 (first) and the guidance text change: the chat can open files.
- CAP-4: tool output caps.
- Decision 26 and the chat exception list: transcripts, and the documents the chat already sends.
- Original file bytes going to Anthropic.
- The storage-sweep rule.

## Gap 2: speed

**Where the time goes.**
- Decoding output tokens is about 90% of a reply. The step that plans over the deviation list (8,900 to 12,800 tokens) is 60 to 70% of it.
- Sonnet 5 decodes at roughly 65 to 140 tokens per second, so plan on 8 to 15 s per 1,000 output tokens.
- The medium-effort step also rewrites the message cache, which costs a few seconds of prefill.
- The model retypes the whole Completion Report in its closing text.
- Nothing runs in parallel.
- The writer sees only "Working… 1m 32s". "Thinking…" never appears.

**Options, in order.**

| Step | What | Saves | Effort |
|---|---|---|---|
| Measure | Record duration, stop reason, time to first token and effort per step on the chat usage rows. Read thinking tokens when the provider reports them. | Needed to judge everything else | S, 1 d |
| Progress labels | The server writes the turn phase ("Reading the report…", "Listing the deviations in Line 244…", "Writing suggestions for Line 244…", "Thinking… 48s") from turn state and fixed tool fields only, never model text. After 60 s it adds a hint to ask for one Line at a time. | Perceived speed | S-M, 2-3 d |
| Completion Report on the card | The card shows the checklist from `chatProposalItems`, and the model stops retyping it. This is a CAP-13 wording change. | 4-12 s per reply | S |
| Lower effort on the list step | Medium to low, behind an evaluation of blocked and conflicting decisions. | 40-110 s if thinking halves | S, after the eval |
| Paragraph-anchored edits | The model names the Line and paragraph, and the server resolves the exact text, instead of the model copying `targetText` verbatim. | 10-35 s per reply, fewer stale targets | M |
| Plan once, draft in parallel | One planning step, then parallel drafting sub-requests per group of paragraphs that share the cached prefix. Cards appear as each finishes. | A 3-Line job in about 60-115 s instead of 3 replies of 95-222 s | L, 5-8 d |
| Move chat to Sonnet 5.5 | About 2x throughput at the same price. Sonnet 5 is now marked Legacy. | Possibly 45-110 s | M, needs an SDK update and an eval |

**Not recommended now.**
- Haiku 5.5 for drafting SR&ED prose (quality risk).
- Condensing the writer's preferences into a short rule list (risks dropping rules). Test it before adopting it.

**Model migration warning.** Sonnet 5.5, Opus 5.5 and Fable 5.1 check whether earlier history was edited ("thinking block binding"). It applies to Anthropic accounts created on or after 2026-08-31. This chat edits history on purpose:
- the evidence tail is not replayed;
- tool rows are dropped;
- cut-off tool results are rewritten;
- thinking-only replies are dropped.

On such an account the next request would fail with a 400. Moving needs `@ai-sdk/anthropic` 3.0.133 or later (with `ai` 6.0.311), the `drop_block` handling, the repo's dependency protocol, and its own amendment. Find out when the Anthropic account was created first.

**Side finding.** Helper roles default to `claude-haiku-4-5-20251001`. Its tentative retirement date ("not sooner than 2026-10-15") has passed, although it is still listed as Active. Plan a replacement.

## Gap 3: long jobs stop and wait

**Recommended.**
1. **Continue button.** The turn stores a structured offer (`chatTurns.continuation`: reason, next Line, items left), set from the deviation inventory counts and the step-limit and cut-off paths. The reply shows "Continue with Line 244", which sends in one click. Effort S.
2. **Auto-continue as linked turns.** When a reply finishes a Line and Lines remain, the server saves a "Continue with Line 244" prompt and schedules the next turn. Each Line gets its own 540 s window, Stop, Regenerate, feedback and cards, and the stale-turn reaper stays unchanged. Limits and safeguards:
   - at most 2 automatic continues (3 Lines per request), plus a per-job cost cap;
   - the project budget is checked on every link;
   - Stop on any link ends the chain;
   - continue prompts show as a muted chip ("Continuing with Line 244");
   - an admin flag (`ai.chatAutoContinue`) turns it on.

   Effort M, 3-4 d.
3. **Time-based stop.** Keep 5 steps per pass, and start no new step with less than 90 s left in the window.

**Not recommended.** More passes inside one action (still capped at 540 s, and later passes cannot see earlier tool rows), or simply raising the step limit.

**Amendments.** Rule 6 of 2026-10-19 (first), the size rule in 2026-10-01 (first) Rule B1, and a new kind of turn the server starts (its origin, limits and budget checks).

## Gap 4: edit-and-resend, and real regenerate

**Today.** Regenerate is already offered on every finished reply, but it resends the prompt at the end of the thread. The model still sees the old reply and every later turn, so on an earlier turn it means "ask again", not "regenerate". There is no edit.

**What others do.** Both vendors changed this in 2026:
- **ChatGPT:** edits and regenerates make versions, now reached through a "View versions" modal instead of inline arrows.
- **Claude.ai:** keeps hidden branches with arrows, although its merged chat and Cowork experience lists branching as unavailable.
- **Claude Code:** has `/rewind` and `/branch`.

**Recommended: alternatives inside one thread.** A thread's turns form a tree: each edit or regenerate is a new turn that points to its parent. The browser shows one path at a time with a "‹ 2 / 3 ›" switcher under the writer message, and the model reads only the current path plus the current report.
- **Data.** New optional fields on `chatTurns`: `parentPromptMessageId`, `alternativeOf`, `alternativeKind`, `refineProposalId`. This is a widen-only migration with no backfill: old rows get an implicit parent.
- **Server.** A new `chatV2.sendAlternative` rebuilds the highlight and refine blocks on the server instead of trusting raw markers. The app builds the path history for the model. Decision memory covers the path, plus applied cards from every alternative.
- **Cards.** Applied cards stay applied and stay in the report. Pending cards on another alternative keep their state, are hidden while the writer views another path, and still go stale on apply if their passage changed. There is no new card state or transition, and agents still only propose.
- **UI.** An Edit button on finished writer messages (inline editor; Enter sends, Escape cancels), an accessible switcher, and Stop that works from any path.
- **Naming.** Do not call alternatives "branches" (a Draft branch is a domain term) or "versions" (report Version history). Use "response 2 of 3".
- **Effort.** L, 7-9 d.
- **Amendment.** A glossary entry for "Chat alternative", the changed meaning of Regenerate, and the card rules.

## Gap 5: web sources, and reasoning display

**Web sources.**
- **Recommended.** Save one small record per search in a new table, `chatWebSearches`: the query exactly as sent after name stripping, its status, and up to 5 sources with number, URL, title and domain. Never the answer text. Render source cards and numbered inline citations, using svelte-streamdown's built-in citation pills (already installed) and a Sources row under the reply. Effort M, 2.5-3.5 d.
- **Not now.** Anthropic's own web search tool cannot be used, because it runs the model's query before we can strip names. Native `search_result` citation blocks are not supported by the installed SDK (nor by 4.x for sending), so defer them.
- **"Vet against public sources"** (the client's idea from the 2026-10-16 meeting): a second button beside "Research this selection" that starts Contextual Research with a fixed vetting instruction. Effort S, 1 d as a preset; M for a claims-only mode.
- **Default on.** Make web search a conversation-level or per-writer setting instead of per message, with the same name stripping and limits. Effort S. This is an owner decision.

**Reasoning display.**
- **Recommended: keep the September 8 rule.** Show server-built progress labels (shared with Gap 2) and elapsed time, never model text.
- Reasoning summaries (`display: "summarized"`) are written by a separate model we cannot steer. They could paraphrase system rules, other clients' Brain material or injected web text, and they would need an amendment. Not recommended.
- If chat moves to Sonnet 5.5, Anthropic's `display: "updates"` gives short progress notes designed for users. Revisit it then.

## Other gaps from the parity audit (ranked by harm)

| # | Gap | Fix | Effort | Amendment |
|---|---|---|---|---|
| 1 | Silent context loss. The model sees only the newest 30 message rows (about 15 exchanges), and neither the writer nor the model is told. | Store the oldest order the model read on each turn and draw a divider ("The assistant no longer reads messages above this line"). Tell the model that earlier turns are not shown. Later, a "Keep for this project" action saves a message as Writer's notes. | M (L with keep) | Yes |
| 2 | No undo for an applied card. The only way back is restoring the whole report from Version history. | Store the applied text pairs. Add `undoProposal`, which reverses them if the passage is unchanged, takes a snapshot and refreshes provenance, and show Undo on the card. | M | Yes (new transition) |
| 3 | Two people on one report. Messages carry no author, anyone can stop anyone's reply, and a send continues the newest thread whoever started it. | Show author names on messages and owners on threads. Confirm before stopping someone else's reply, or limit Stop to the sender. | S-M | Only if Stop is limited |
| 4 | Unsent drafts are lost when switching conversation or reloading. | Keep drafts in `sessionStorage` per report and conversation, and reopen the last conversation used. | S | No |
| 5 | No connection state. Offline, a message sits at "Sending…" with no Retry. | Use Convex's connection state: show "Connection lost…" and pause the timer. | S | No |
| 6 | No signal when a long reply finishes. | Show a working ring and a "reply ready" dot on the launcher, a tab title prefix, and an optional browser notification with generic text. | S-M | No |
| 7 | No message size limits. A long paste rides along in history for about 15 exchanges, and a report selection is labelled "Pasted text". | A counter, server caps with plain refusals, a token budget on history, and a corrected label. | S-M | Yes (limit) |
| 8 | Conversation management. No rename, the list is sorted by creation, and there is no archive or delete. | Rename, sort by last activity, and archive or admin delete. | S to M | Yes for delete (chat stays queryable today) |
| 9 | Accessibility. The whole transcript is a live region, so streaming text may be read token by token. Smooth scrolling ignores reduced motion. Some targets are 24-28 px. | Mark the reply `aria-busy` and announce it once when ready, respect reduced motion, and use 44 px targets. | S | No |
| 10 | Copy pastes raw markdown into Word, and card wording cannot be copied. | Copy rich text plus plain text, and add "Copy wording" to the card. | S | No |
| 11 | No Regenerate after Stop, and the starter prompts send on click and say "section 242". | Allow Regenerate after Stop, put starters into the composer for editing, and fix the wording. | S | No |
| 12 | A feedback vote cannot be changed and has no reason. | Allow changing the vote, and add a reason on thumbs down. | S-M | Yes (learning loop) |
| 13 | No search, pin, share, export, voice or per-message timestamps. | Defer. Operating-system dictation already works in the text box. | - | - |

## Strengths to keep and to tell writers about

- **Nothing changes until a person applies it.** Edits arrive as review cards with Apply, Dismiss, Edit wording and Refine. They preview as tracked changes in the report, flag themselves when they no longer match, protect headings, and take a snapshot on every apply. Neither ChatGPT nor Claude documents a tracked-changes view.
- **It re-reads the current report every turn**, uses [GAP: …] instead of inventing facts, raises client questions, and says what it cannot see.
- **The firm's standards are built in:** the SR&ED structure, house rules, each writer's preferences, and deviation lists with stable ids and completion reports.
- **Replies are durable.** They survive reloads and resume, run one at a time per conversation, and are cleaned up if stuck.
- **Client confidentiality is protected.** Brain and web search are opt-in, names are stripped before any web search, model output cannot load images, and private reasoning stays private.

## Proposed order

| Phase | Contents | Effort |
|---|---|---|
| A. Defects and quick wins | All defects above. Progress labels. Continue button. Files phase 0 (settings document allowance and file list). Context-loss divider. Drafts. Connection state. Esc. Size limits. | about 8-10 d |
| B. Reading and continuing | `readDocument` and `searchDocuments`. Auto-continue as linked turns. Web source cards and citations. Undo an applied card. Finish notification. Author labels. Speed measurement. | about 12-15 d |
| C. Parity features | `viewFile` (PDFs and images). Edit and alternatives. Pick-a-file picker. Vet preset. Conversation management. Accessibility and copy. | about 15-20 d |
| D. Evaluation-gated speed | Lower effort on the list step. Paragraph-anchored edits. Parallel drafting. Sonnet 5.5 migration with its SDK update. Haiku helper replacement. | about 10-15 d |

Each phase needs an approved amendment, a review by Claude Opus 5.5 at high effort, the full gate with the component suite, and a real replay like the 2026-10-19 one before it ships.

## Decisions for the owner

1. **Transcripts.** May the chat read raw interview transcripts? Unmasked, only with a per-message opt-in, or not at all?
2. **Files and composer.** May the composer offer "Read a file in full" (pinning existing project files)? Should "Add a file" ever return to the chat?
3. **Original bytes.** Is it acceptable for original PDF and image bytes, not only extracted text, to go to Anthropic?
4. **Auto-continue.** On by default? How many Lines per request, and what per-job cost cap?
5. **Speed trade-offs.**
   - Lower effort on the list step if the evaluation holds?
   - Move chat to Sonnet 5.5 (needs the Anthropic account creation date and an SDK update)?
   - Haiku 5.5 for drafting (not recommended)?
6. **Completion Report.** Move it onto the card (a CAP-13 change)?
7. **Edit.**
   - Anyone on the project or only the sender?
   - Pending cards on other alternatives stay pending (recommended)?
   - The term "response 2 of 3"?
8. **Web.**
   - Show the query as sent?
   - Numbered citations plus a Sources row?
   - Default per message, per conversation, per writer or per project?
   - Vet as a preset or a claims-only mode?
9. **Reasoning.** Keep the September 8 rule, with no reasoning summaries (recommended)?
10. **Undo, Stop and archive.**
    - Undo for applied cards (a new transition)?
    - Limit Stop to the sender?
    - Allow archiving or deleting conversations (chat is queryable per report today)?

## Owner answers (2026-10-19)

- **Agent setup:** confirmed. Opus 5.5 high for the orchestrator, worker (own worktree) and reviewer; Opus 5.5 high explorer; GPT-6-Astra high researcher on Codex "Conquer"; GPT-6-Astra medium as an optional second judge.
- **Phases:** Phase A first, then check in with the owner.
- **Transcripts:** the chat may read them whenever it needs to, names as written. Needs an amendment to decision 26.
- **Original PDFs and images to Anthropic:** yes, inline only.
- **Auto-continue:** on, with no cap beyond the project's daily budget. Stop ends the chain.
- **Sonnet 5.5:** the owner is not sure when the account was created; the lead verifies it with a test request before the move.
- **Edit a message:** anyone on the report; the alternative is labelled with who made it.
- **Web search:** on per conversation, with source cards and numbered citations.
- **Approved:** undo an applied card, the Completion Report on the card, archiving conversations (admins can delete).
- **Not approved:** limiting Stop to the sender. Stop stays open to anyone on the report.
- **Pin a file into a message:** yes.
- **Reasoning:** show Anthropic's thinking summaries. This overrides the September 8 rule for summaries only; mitigations are in the Phase A spec.
- **Lower effort on the list step:** yes, if the evaluation holds.

## Key sources (checked 2026-10-19)

- Anthropic:
  - PDF support: https://platform.claude.com/docs/en/build-with-claude/pdf-support
  - Vision: https://platform.claude.com/docs/en/build-with-claude/vision
  - Files API: https://platform.claude.com/docs/en/build-with-claude/files
  - Citations: https://platform.claude.com/docs/en/build-with-claude/citations
  - Search results: https://platform.claude.com/docs/en/build-with-claude/search-results
  - Effort: https://platform.claude.com/docs/en/build-with-claude/effort
  - Prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
  - Thinking: https://platform.claude.com/docs/en/build-with-claude/thinking
  - Web search tool: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
  - Model deprecations: https://platform.claude.com/docs/en/about-claude/model-deprecations
- Throughput (Artificial Analysis):
  - Sonnet 5: https://artificialanalysis.ai/models/claude-sonnet-5-medium/providers
  - Sonnet 5.5: https://artificialanalysis.ai/models/claude-sonnet-5-5/providers
  - Haiku 5.5: https://artificialanalysis.ai/models/claude-haiku-5-5/providers
- Claude help:
  - Files: https://support.claude.com/en/articles/8241126
  - Projects: https://support.claude.com/en/articles/11473015
  - Artifacts and editing: https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them
  - Chat and Cowork: https://support.claude.com/en/articles/16761823-claude-cowork-and-chat-are-one-claude
  - Usage limits: https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work
- ChatGPT (help pages read through Wayback snapshots because of 403s):
  - Release notes: https://help.openai.com/en/articles/6825453-chatgpt-release-notes
  - Version switcher change (community, 2026-10-19): https://community.openai.com/t/inline-message-version-arrows-appear-to-have-been-removed-from-the-current-chatgpt-frontend/1407768
- OpenRouter web search: https://openrouter.ai/docs/guides/features/web-search
