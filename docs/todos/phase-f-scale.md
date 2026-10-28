# Phase F: scale and release

Plan, 2026-10-27, revised after a review (Claude Opus 5.5, requested high, it reported low: "go with changes", every change taken). Run order items F1 to F6 in `docs/todos/context-pipeline-mvp-push.md` (work plan P2 items 11 to 13). B1's second part landed first, so F5 and F6 measure the app as it ships.

## F1. Request size: measure, then set the budgets from it

**Today.** Every evidence budget turns tokens into characters at 4 characters a token (`CHARS_PER_TOKEN`, `convex/ai/trustedContext.ts`): drafting and analysis (`buildTrustedContext`), the Brief (`briefRequest.ts`), Seeds, chat evidence (`chatEvidence.ts`, `chatV2.ts`) and the review agent. Brief preparation reserves spend against its daily cap at 3 characters a token. Nothing measures how far off that is. Every current Anthropic model but Haiku 4.5 has a 1M-token window, and the budgets are about 150k tokens, so a request is far from the window; the risk is cost and the budgets meaning less than they say, not a refused request. When a request is over the window, the API already says so (`model_context_window_exceeded`, handled in `structured.ts`).

**Change.**
1. **Measure every Anthropic request.** The instrumented client records, on each `aiUsage` row, the characters it sent (`requestChars`) and, of those, the evidence characters (`evidenceChars`, the text of document, transcript and tool-result blocks), measured on the request as sent (after `adaptAnthropicRequest` and `cacheGenerationPrefix`; text only: no JSON framing, no base64). The ratio is computed over all input tokens: input plus cache writes plus cache reads.
2. **Report it.** Admin usage shows characters per token by call site, from the last 30 days, with how many requests it rests on.
3. **Set the budgets from it.** Once there is enough data (the release suite and the stress test give it), the constant becomes a per-call-site value in one table (`charsPerTokenFor(callSite)`), defaulting to 4, and Brief preparation's reservation never below the measured ratio. Changing a budget changes what drafts read, so the new values land as their own change with a decision entry and the requests pinned in tests.
4. **The window guard is the API's own answer.** No pre-count on the normal path. Where the API answers that a request is over the window, the builders that own evidence (drafting, analysis, the Brief) rebuild once at build time with the evidence budget cut by the share the API reported, before anything is recorded (`recordContextBudget`), so every candidate and the Inputs band read the same smaller context; still over, the step fails by name ("This step's evidence is too large for the model; leave some files out"). The error is never retried and never moves the call to the OpenRouter fallback. Chat trims its oldest history and tool results instead.
5. The token count endpoint is used only in tests and the measurement script, never on a request's path.

Steps 1 and 2 done 2026-10-27 (decision entry "2026-10-27 (seventh)"): `convex/ai/requestSize.ts`, `aiUsage.requestChars` and `evidenceChars`, and `aiUsage.requestSizeReport` on the Admin usage page. Report chat (`chat_v2`) sends through the AI SDK, not the instrumented client, so it is not measured; its budget keeps 4 characters a token until a later step measures it. After the review (Claude Opus 5.5, requested high, it reported low, "ship after fixes"): `evidenceChars` is everything sent in user turns (files, transcripts, tool results and the step's own instructions), not only document, transcript and tool-result blocks as planned; the table groups by call site and model, since models count tokens differently; and its figure is for the whole request, so step 3 takes each budget's value from evidence-only counts (the measurement script with the token count endpoint, step 5), not from this table.

Steps 3 and 4 are parked (2026-10-27). Step 3 waits for evidence-only counts: the token count script (step 5) over the stress test's requests (F5, which waits for the owner's spend cap), since the run itself records whole-request characters and the part sent in user turns; the first live figures (Seeds 2.83, the analyzer 3.10 characters per whole-request token) say the budgets send more tokens than they assume, which matters for cost, not for the window. Step 4 is a safety net that today's models almost never need: every model on the tracks has a 1,000,000-token window, and only Haiku 4.5, which no track uses any more, has 200,000; its wording waits for the owner (question 9).

**Tests.** Through the SDK with `fetch` stubbed: `requestChars` and `evidenceChars` on the usage row for a cached, a tool-using and a citations-mode request; the ratio over all input tokens; an over-window answer rebuilt once at build time with the Inputs band matching; a second over-window answer failing by name with no retry and no fallback.

## F2. Project copies in batches

**Today.** Duplicating a project (`projectDuplication.copyProjectContentBetween`, also used by `reviewFromProject.createReviewFromProject`) creates every destination row in one mutation (`projects.prepareProjectContentCopy`): up to 250 files with their whole text (silently capped at 250 files, 250 evidence rows and 100 PD reviews), the evidence rows and the report. A project with many large files passes a mutation's limits and the copy fails.

**Change.**
1. **A copy job.** A `projectCopyJobs` row holds the source and destination, who copies (their access is checked again on every step), the receipt the wizard needs (`documents`: each source row and the row it became), a lease, and each file's state. It is deleted with either project (`PROJECT_SCOPED_TABLES`).
2. **Prepare** (one mutation, as today): the destination project's rows without file text: files marked `textCopyPending` with their facts (fingerprint, length, preview) copied from the source, transcripts, evidence rows, PD reviews and the report; every source row paged, none silently capped.
3. **Copy each file whole** in its own mutation (at most about 1,048,000 characters, which fits): it checks again that the source file exists, its fingerprint is the one recorded at prepare, and neither project is being erased; it writes the text, clears the mark, attaches the file's cloned original, and sets search pieces due then. A file that cannot be copied is marked "could not copy" and its clone deleted.
4. **The action waits for every file** in the normal case, as today, so the wizard and review-from-project see a finished copy. "Pending" covers only a crash: the job continues itself (`ctx.scheduler.runAfter(0, ...)`), and a cron resumes stalled jobs under their lease.
5. **While any file is pending,** starting a draft is refused by name ("This project is still being copied"), and search pieces, server reading, file labels and the text move skip pending files; the file list shows them as being copied. This is a new rule on starting a draft, so it lands with a decision entry.

Done 2026-10-27 (decision entry "2026-10-27 (eighth)"), with the refusal while copying pending the owner's answer to question 3.

**Tests.** A copy of 60 files of 400,000 characters, with the bytes each mutation reads and writes asserted under the limits (convex-test does not enforce them); a copy stopped after file 10 and resumed by the job; a source file erased or changed mid-copy; the destination erased mid-copy (nothing written after, clones released); a draft refused while pending; both callers; the receipt unchanged.

## F3. Brain filters and the Voyage comparison

Waits for the owner (questions below). The comparison also needs a card on the Voyage account; without it the free tier's 3 requests a minute make re-embedding a test set impractical.

## F4. The exclusion-conflict fixture

Closed 2026-10-27: rerun live after the Self-check fix (decision entry "2026-10-27 (ninth)"), 15 of 15 checks passed.

## F5. Stress test, live

On the live copy, with real models, a spend cap set first (owner question 8 in `docs/todos/context-pipeline-mvp-push.md`):
- a project of 50 files of 400,000 characters each, one file at the 1M-character maximum and one over it (refused by name), a 3-hour transcript, 20 picks in one step, a 46-entry Brief, every check failing at once; then a step past it (100 files);
- chat at scale: a long history and tool reads across the 50 files;
- duplicating the stress project (F2's live proof);
- the search-piece sweep and file labels over about 20M characters (time and cost);
- two drafts running at once (rate limits).

Record per step each answer's size, why it stopped, time and cost (with F1's measurements), and Convex function errors and log lines. Pass: no step fails on a limit the writer is not told about; named refusals are expected.

**Ready 2026-10-27:** `scripts/stress/generate.mjs` (53 files, 22.2 million characters, company "Zorvelyar Works" for seed 7, scanned against the live copy's 111 client, company, project, speaker and user names with no match) and `scripts/stress/run.mjs` (the company, the evaluation project, the uploads, search pieces and labels, the first draft to its Seeds, stopping at the spend cap). The live run waits for the cap.

**Run 2026-10-27** ($20.38 of the $40 cap). Pack `_bmad-output/test-artifacts/stress/2026-10-27` (`summary.md`).
- **Passed:** every case above, the duplicate (51 files in 6.0 s), chat over every file, and two drafts started 20 seconds apart.
- **Fixed:**
  - the generated text was refused by the models (now sentences, 6673a1ce);
  - a refused file label was named a schema error (9826fea0);
  - no step's first Batch could start on a large project (the frozen total, 39d3a6b6, decision entry "2026-10-27 (thirteenth)").
- **For the owner:** two drafts started in the same second fail on the backend's write rate; the Sonnet tier moved back on its own after the refusals; company files past the total are not listed (questions 12 to 15).
- **For F1 step 3:** characters per whole-request token from the run (`spend-all.json`): Seeds 2.65, the Brief 2.71, the analyzer 2.70, Self-check 2.33, labels 2.58. That is below the 4 the budgets assume, as the first figures said.

**Data.** A seeded generator in `scripts/stress/` that writes sentences from templates with invented names (no model writes the text, so no real company name can appear), its output scanned against every client and company name on the live copy before upload. A dedicated fictional company and test user, marked as evaluation projects, so nothing feeds writer memory, lessons or the Brain; erased afterwards through the normal erasure path.

## F6. Release suite, live

All six fixtures on the live copy at the release commit, the pack written, cost reported; then the owner's human verdicts and manual checks (the checklist's "Manual on localhost" items) at the end.

## Owner questions (batched)

1. Brain filters (F3): Rule (no question): a draft never shows a project its own report, a duplicate's source or a review project's source as an exemplar. Question: should drafting prefer the same company's earlier years, and may chat's Brain search be limited to a company or a fiscal year when the writer asks?
2. Voyage (F3): add a card to the Voyage account, so the comparison of `voyage-4-large` and `voyage-context-4` against `voyage-3-large` can run.
3. Copies (F2): recommended: a copy finishes before the new project opens (it takes seconds per file); "still copying" only after a crash. Agree?
4. Stress test (F5): a spend cap (recommended $40).
5. F1: the words a writer sees when a step's evidence is too large: "This step's evidence is too large for the model. Leave some files out and start again." Agree?
