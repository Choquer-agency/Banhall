# Test checklist: context pipeline MVP push

Branch `fix/summary-self-check-linear` (worktree `../Banhall-selfcheck`). Every change in the push lands on this branch as its own commit. Each commit gets a section below with three kinds of checks:

- **Automated, offline:** the verification script and unit tests. The agent runs these before each commit.
- **Automated, live on localhost:** the real app and real AI calls against an isolated local backend, driven by scripts.
- **Manual:** a person tries it in the browser on localhost.

Tick each box as it passes. Write down anything odd next to it, with the project and the time.

## Running the app on localhost

Two isolated setups. Neither writes to the dev or production deployment.

1. **With a copy of the dev data (for manual testing).** From the main checkout, run:

   ```bash
   node scripts/chat-live/run.mjs --project <a project id> --target fix/summary-self-check-linear --serve --skip-scenarios --serve-hours 4
   ```

   - It copies a snapshot of the dev deployment into a local backend in a temporary folder, pushes this branch's code, and starts the app on port 5180.
   - It creates a throwaway admin login and writes it to `login.txt` in its private folder.
   - It deletes everything when it stops.
   - The copy holds client data, so it needs the owner's approval each time.
   - AI calls are real and cost money. The harness's own guide puts a full chat run at a few dollars.
   - From an agent session, start it detached (`nohup node scripts/chat-live/run.mjs ... &`). A tool time limit that kills it skips its cleanup and leaves the copy of dev data in the temporary folder (seen on 2026-10-23; removed by hand).
2. **Fictional projects only (for the automated release suite).** `node scripts/seed-plan-eval.mjs --deployment local --as <internal email> --confirm-spend` runs the scripted Step by step fixtures end to end on a local backend and writes a judging pack under `_bmad-output/test-artifacts/seed-plan-eval/`. It uses no client data. Each fixture costs real model calls.

## Commit 1: the final check's answer grows by a fixed amount per pick (6ab0eafc)

What changed: the check that runs after "Sign off and generate PD" no longer repeats every pick's id in each verdict, no longer throws out a real answer for running past the size budget, and accepts Briefs of up to 64 entries. The record is in `docs/product-domain.md`, entry "2026-10-22 (third)".

### Automated, offline (done 2026-10-22)

- [x] `bash scripts/loop-verify.sh`: all 9 steps pass, 7,105 tests in 456 files, production build.
- [x] Seeds component tests: 213 of 213 (`npx vitest run --config vitest.component.config.ts --no-file-parallelism src/lib/components/seeds/`).
- [x] Design reviewed before code, and code reviewed after, by Claude Opus 5.5 (high effort) and gpt-6-astra (medium effort). Both said ship.

### Automated, live on localhost

- [x] **Emily's exact plan, on a local copy of dev** (2026-10-22, 16:06 to 16:13, commit 6ab0eafc, project `k971kjme7ayfb7pw79z9kkzjfd8fz6gr`, generation `k572dywr70z3zqsyc5he49jj5d8fy2ep`). Sign-off was accepted, where dev refused it twice on 2026-10-09. The PD completed.
  - Every Line's final check came back complete: Line 242 12 of 12, Line 244 17 of 17, Line 246 15 of 15. No "did not complete" or "Not checked" rows.
  - Real answers ran 4,453 to 5,718 bytes, against projections of 10,795 to 13,603 and a ceiling of 131,072. Each Line ran its check twice (before and after its repair).
  - The one follow-up was used twice: Line 242 had 5 labels missing, and Line 246 had 3 plan checks missing. Both were filled.
  - Cost: 18 AI calls, $1.61.
  - Found, not caused by this change: the post-draft QA call stopped at its 4,096-token answer limit (`generation:post_qa`, `stopReason` max_tokens). This is the same fixed-limit bug class; it is added to P0 item 4.
- [x] **Release suite, all six fixtures** (2026-10-22, local copy running commit 6ab0eafc's functions, $5.84). Packs are in `/tmp/seed-plan-eval-out/2026-10-22/`, a private folder, fictional data only.
  - carried-old-selections: 14 of 14 passed.
  - changed-advancement-links: 22 of 22 passed.
  - skipped-role-supported: 12 of 12 passed.
  - withdrawn-feedback: 12 of 13 passed. The miss is a wording heuristic on the Seeds, before sign-off.
  - writer-settings-document: 15 of 16 passed. The miss is a wording heuristic: one required term was never used.
  - exclusion-conflict: inconclusive. The AI-written Brief derived no Claim Exclusion, so the fixture stopped before sign-off. To be rerun.
  - "The model Self-check ran on every Section" passed in every fixture that drafted. Self-check requests took about 4 seconds each.
- [ ] **Human verdicts.** The reviewing manager judges each fixture's pack pass or fail (`docs/release-checklist.md`). The suite is release-blocking.
- [ ] A new large-plan fixture (to be added): 20 picks in one step and a 46-entry Brief. Pass when it signs off and drafts with no "Not checked" rows.
- [ ] The local backend's logs show one line per Line's final check, in this form: "Line 244 first answer N UTF-8 bytes for X labels and Y plan checks (projected P, ceiling 131072)". Pass when N stays well under 131,072 and no line carries report text.

### Manual on localhost

- [ ] **Emily's case.**
  1. Open the copy of the project refused on 2026-10-09, or any project with a full Step by step plan.
  2. Approve every step and press "Sign off and generate PD".
  3. Pass when there's no refusal and the PD drafts.
- [ ] **A big step.**
  1. In a Step by step run, tick 20 or more picks in one step (for example Technological objective).
  2. Sign off.
  3. Pass when it signs off and drafts.
- [ ] **A big Brief.**
  1. Use a project whose Brief has 37 to 46 Confidence Map entries and Glossary Terms.
  2. Sign off.
  3. Pass when it signs off and drafts.
- [ ] **The new refusal message.**
  1. Use a Brief with more than 64 entries and writer instructions (the agent can set one up on the local copy).
  2. Sign off.
  3. Pass when the message reads "This project's Brief and writer instructions have more entries than the final check can read at once, so sign-off cannot finish. Your picks and edits are kept. Please report this so we can fix it.", and the picks are still there afterwards.
- [ ] **Nothing else moved.**
  1. Run an ordinary Single draft.
  2. Run a small Step by step plan.
  3. Pass when both draft as before.

### Known limits (expected, not failures)

- About 35 picks in a single step is refused by a different limit, on the size of the plan sent to the AI.
- A section that is very large overall is still refused at sign-off.
- Real data on dev (71 final checks since July): at most 5,524 output tokens, median 1,676, and none cut off. Splitting a section into several rounds is low priority until real plans get near these limits.

## Commit 2: a table for document text, and deletes clear it (step 1 of 5 of the text move)

What changed: a new `projectDocumentTexts` table and the one helper every reader will use (`convex/lib/documentText.ts`). Nothing writes pieces yet, so the app behaves exactly as before. Deleting a file, or erasing a project, now also deletes its pieces. The design and the order of the five steps are in `docs/product-domain.md`, entry "2026-10-22 (fourth)".

### Automated, offline

- [x] `bash scripts/loop-verify.sh`: all 9 steps pass, 7,110 tests in 457 files.
- [x] `convex/lib/documentText.test.ts`:
  - pieces never split a character, including at every piece edge;
  - reading back gives exactly `content.slice` for 49 ranges, including a pair cut at 199,999 / 200,000;
  - the facts are right;
  - an unmoved row reads from `content`;
  - a missing piece fails closed;
  - rewriting replaces the pieces;
  - deleting a file deletes them.
- [x] The project erasure test now covers the new table.
- [x] Design reviewed before code: Claude Opus 5.5 (high effort) and gpt-6-astra (medium effort), both said "go with changes". All changes adopted.
- [ ] `convex/documentScale.test.ts` (50 files of 400,000 characters). On today's code it fails while uploading, past about 40 files, with "Read too much data in a single function execution". It goes in with step 3, when it passes.

### Manual on localhost

- [ ] Nothing visible changes. Upload, preview, archive and delete a file, and confirm each works as before.

## Commit 3: readers go through the helper, except chat and search (step 2 of 5 of the text move)

What changed: the file list, the Files panel preview, upload duplicate checks, PD reviews, the Reference PD comparison, chat's file reading tool, the evidence frozen at generation start, the blank checks, intake's fingerprint check and the debug tools all read text through `convex/lib/documentText.ts`. Rows still keep their text, so nothing visible changes yet. An unused query (`getContextDocsForGeneration`) is removed.

### Automated, offline

- [x] `bash scripts/loop-verify.sh`: all 9 steps pass, 7,116 tests in 459 files.
- [x] `convex/documentTextReaders.test.ts`. A file whose text lives only in pieces, with `content` cleared as after the clear pass, gives the same answer as the same file still on its row, for each of these:
  - the file list's sizes, word counts and statuses;
  - the preview's whole text;
  - chat file reads at piece edges and across an emoji;
  - the frozen evidence: the same text, hash, `truncated` and `originalLength`, including an emoji cut at 199,999 / 200,000;
  - upload duplicates: the same name and text are found; the same text under another name, other text and blank files stay new.
- [x] `tests/documentTextGuard.test.ts`: the TypeScript checker finds every direct read of a document's `content` outside the helper. Only the paths of the next steps remain, and they are listed:
  - chat context, 2;
  - search, 5;
  - project copy, 1.

### Manual on localhost

- [ ] **Files panel.** Preview a long file and download it as text. Both show the whole file.
- [ ] **Upload.** Upload the same file twice. It's kept once. Upload it under a new name. A second file appears.
- [ ] **PD review.** Start a PD review. It runs on the chosen PD.
- [ ] **Reference PD.** In chat, ask for the comparison with a Reference PD. It finds and compares it.

## Commit 4: a chat turn reads text only for the files it shows (step 2, part 2, of the text move)

What changed: each chat turn reads every file's facts. It reads text only for:
- the writer settings document, in full;
- the first 12 files with text, to just past the part shown;
- every other file's opening 2,000-character preview, which the settings rule needs.

A pinned file is read through the same scoped file read the chat's tools use. The evidence the model sees is unchanged.

### Automated, offline

- [x] `bash scripts/loop-verify.sh`: all 9 steps pass, 7,117 tests in 460 files.
- [x] `convex/chatContextText.test.ts`. A project of 17 files was built twice, with each file's text moved in one copy and kept on the row in the other. The files include a settings document with leading spaces, long files with a forged marker inside the part shown, a blank file and an image. Both copies give the same chat messages, the same record of what was cut and kept, and the same system text. The moved copy carries the full text only for the settings document; every other file carries at most 21,000 characters.
- [x] Pinned files keep their cut and their notice (`convex/ai/chatViewFile.test.ts`).
- [x] The guard's list no longer includes the chat context.

### Manual on localhost

- [ ] **Chat.** In a project with more than 12 files, ask the Assistant about a file near the end of the list. It names the file in its list and can open it with its reading tool.
- [ ] **Pinned files.** Pin a long file to a message. The reply quotes it, and says where it was cut if the file is longer than the allowance.
- [ ] **Settings document.** A writer settings document still applies in chat.

## Commit 5: search finds files through the text pieces (step 2, part 3, of the text move)

What changed: chat search and research search a new index on the text pieces, limited to the project. While files are still moving, they also search the old index. Hits are grouped by file, and pieces are read until they name 16 different files (12 for research), never past 112 pieces, so one long file can't take every slot. Each kept file is read whole and split into excerpts as before. A hit whose file is gone, archived or in another project is dropped.

### Automated, offline

- [x] `bash scripts/loop-verify.sh`: all 9 steps pass, 7,120 tests in 461 files.
- [x] `convex/documentTextSearch.test.ts`:
  - the same excerpts at the same positions for moved and unmoved copies of a project;
  - each file once when one file is mid-move, one moved and one not;
  - archived files and a gone file's pieces never found;
  - a file with 25 matching pieces doesn't crowd out 3 short files.

  The first version of the crowding test failed and caught a real gap, which is now fixed.
- [x] The guard's list now holds only the project copy (step 3).

### Automated, live on localhost

- [ ] Search ranking on a real backend. convex-test doesn't rank like production. Run chat search on a project with many files and compare its top excerpts with the same search on the old code.

### Manual on localhost

- [ ] **Chat search.** Ask the Assistant to search the files for a phrase that appears in an older, longer file. It finds and quotes the right file.
- [ ] **Research.** Run a research request with a selected sentence. Its project evidence lists the right files.

## Commit 6: every writer stores text as pieces (step 3 of 5 of the text move)

What changed: uploads, intake, the OneDrive import, reports reused as a previous PD, project copies and review-from-project now store a file's text as pieces with its facts on the row, and no `content`. `content` is optional in the schema. A new file looks up no pieces, so a blank upload still runs 2 database queries.

### Automated, offline

- [x] `bash scripts/loop-verify.sh`: all 9 steps pass, 7,124 tests in 462 files.
- [x] `convex/documentScale.test.ts`, with `transactionLimits: true` and 50 files of 400,000 characters. It failed on the old code while uploading, past about 40 files. Now:
  - the file list reads under 1 MiB;
  - a new upload reads under 1 MiB, and a duplicate upload is found without a new row;
  - a chat turn's context reads under 2 MiB;
  - a 400,000-character file in a 3-byte script (about 1.2 MB) is stored and read back whole. convex-test doesn't enforce the 1 MiB row limit, so this shows the new path works, not that the old one failed.
- [x] The guard's list is empty: no code outside the helper reads a document's `content`.
- [x] Tests that checked text on the row now read it through the helper.

### Manual on localhost

- [ ] **New uploads.** Upload a PDF, a Word file and a pasted note. Each shows its size and word count, previews in full, can be searched in chat, and is read by a new draft.
- [ ] **Old files.** A file uploaded before this change still previews, searches and drafts.
- [ ] **Project copy.** Duplicate a project with files. The copies preview in full.

## Commit 7: the one-off copy and clear passes for existing files (steps 4 and 5 of 5 of the text move)

What changed: `convex/documentTextMigration.ts` adds three internal functions, run by hand, never on a schedule:
- `backfillDocumentTexts`, the copy pass: moves old files' text to pieces and keeps `content`;
- `clearMovedDocumentContent`, the clear pass: clears `content` only where the pieces read back exactly;
- `documentTextMoveStatus`: counts per page.

Each pass reads at most 4 MiB a page, skips projects being deleted and schedules its own next page. The architecture map's data section names the new table.

### Automated, offline

- [x] `bash scripts/loop-verify.sh`: all 9 steps pass, 7,127 tests in 463 files.
- [x] `convex/documentTextMigration.test.ts`:
  - a dry run writes nothing;
  - the copy pass keeps `content`, fills a missing processing status (a truncated file reads "ready_truncated"), skips a deleting project, and moves nothing on a second run;
  - the clear pass clears 2 files and leaves the one whose piece was changed, and readers return the same text after the clear;
  - eight 900,000-character files are handled across pages within the 16 MiB read limit.

### Owner actions (by hand, dev first, then production)

1. [ ] `npx convex run documentTextMigration:documentTextMoveStatus '{}'`, then each page by its `continueCursor`, to count unmoved files.
2. [ ] `npx convex run documentTextMigration:backfillDocumentTexts '{"dryRun":true}'`, then `'{}'`. Check the status until every file is moved.
3. [ ] Use the app for a day: chat, search, previews and drafts on old projects.
4. [ ] `npx convex run documentTextMigration:clearMovedDocumentContent '{"dryRun":true}'`, page by page: pass each page's `continueCursor` back in until `isDone`. Every page must report `mismatched: 0` and an empty `mismatchedIds`. Then `'{}'`.
5. [ ] A later entry drops `content` and the old search index.

### Automated, live on localhost

- [x] **On a local copy of dev** (2026-10-22, 17:44 to 18:10, commit d9735be5).
  - **Files:** 303 in all. 31 belong to projects that no longer exist; both passes skip them, and they stay counted as unmoved.
  - **Status before:** 301 unmoved, plus the 2 harness fixture files already stored the new way.
  - **Copy pass:** moved every file of a live project.
  - **Clear pass:** a dry run of every page would clear 270 and found 0 mismatches. The real pass then cleared all 270.
  - **Same at all three points.** A script recorded these for the project with the most files (27 files), before the copy, after it and after the clear, and all five matched:
    - the file list;
    - every file's whole text;
    - the chat turn's context;
    - the search terms;
    - three chat searches.
  - **Found:** the local backend refused some pages ("limited to 4 MiB bytes written per second"). They went through on retry, and pages are now 2 MiB, 1.5 seconds apart.
- [x] **The same local copy, moved to commit 34cbb600 with its data already cleared:** the file list, texts, chat context and searches still match the snapshot from before the move.
- [x] **writer-settings-document on commit 34cbb600:** 16 of 16 checks passed (15 of 16 on the earlier code), and 0 of the settings document's 20 rules were broken. The uploaded settings document is stored as pieces and read by the Brief and the drafting.
- [ ] **exclusion-conflict, inconclusive again.** On both the earlier and the new code, the AI-written Brief derived no Claim Exclusion, so the fixture stops before sign-off. The text move doesn't cause it: the first run predates the move. It is likely the newer model (PR #29 moved Briefs to Sonnet 5.5). Listed as its own item.
- Live cost so far: $1.61 (Emily's PD) + $5.84 (release suite) + $2.10 (two fixtures) = $9.55.

## Commit 8: fixes from the code review of the text move

Two code reviewers, Claude Opus 5.5 (high effort) and gpt-6-astra (medium effort), both said "ship after fixes". Every finding is fixed:

- The server refuses text over 1,000,000 characters, with a message the writer can act on. Deleting a file removes its pieces in batches, so any file can be deleted.
- One file whose pieces are incomplete is left out of a chat turn, a search or research, never failing the whole call. Frozen evidence and previews still fail rather than read wrong text.
- Pieces end between words where they can, so search never misses a word that falls on a piece edge.
- Research reads its candidates within 5 MiB and the moved files' text within 8 MiB. Eight 900,000-character files in a 3-byte script used to pass the 16 MiB read limit.
- A row near the 1 MiB limit has its text cleared in the copy pass itself, so the pass never stalls. The clear pass names any file whose pieces differ.
- Migration pages are spaced out (seen live).
- Pinned files say why they are not shown.
- The safe-range read matches `safeRange` for empty ranges too.
- The design record names the right functions and the right pinned-file rule.

### Automated, offline

- [x] The new tests:
  - a word at a piece edge is still found once `content` is cleared;
  - a damaged file is left out of search and chat;
  - research with eight very large files stays in bounds. It fails with "Read too much data" when the budget is removed;
  - the cap, and deleting a file with 70 pieces;
  - the safe range;
  - the near-limit row;
  - a chat turn compared with the old full-text evidence: byte for byte the same.
- [x] `bash scripts/loop-verify.sh`: all 9 steps pass, 7,134 tests in 463 files.

## Commit 9: fixes from round 2 of the code review

Claude Opus 5.5 (high effort), round 2: "ship after fixes". Fixed:

- **The copy pass no longer applies the new 1,000,000-character cap to text already stored.** An older row may hold up to about 1,048,000 characters, and the cap would have stopped the pass on that page for good. Such rows are moved and counted (`overCap`), and a dry run counts them too. Project copies keep any length the source has.
- **Opening or pinning a damaged file reads as "unavailable".** It no longer fails the chat turn.
- **Research's matching pieces have their own 2 MiB budget,** so file rows always have room. A file left out by the evidence budget is logged.

### Automated, offline

- [x] `bash scripts/loop-verify.sh`: all 9 steps pass, 7,136 tests in 463 files.
- [x] New tests:
  - a 1,040,000-character older row is moved, and a dry run counts it;
  - the near-limit row is made realistic (1.044 MB, which with its facts would pass the limit);
  - a damaged file read through `readDocumentForChat`, the query behind the reading tool and pinned files, returns "unavailable". The full tool and pinned flow is checked by reading the code, not by a test;
  - a searched research request over 12 large matching files stays in bounds.

### Review round 3

- [x] gpt-6-astra (medium effort): "ship", no blocking findings.
- Coverage gaps it noted, none blocking:
  - the damaged-file test calls the query, not the whole tool or pinned flow;
  - the research test does not assert the log line for a file left out;
  - copying and deleting an over-cap project file are shown by reading the code.
- [ ] Manual check of the gaps above: pin a damaged file on a local copy. This needs a file with a piece deleted by hand, so the agent can set it up on request.

## Commits 11 to 13: tiers move on Mondays only, a failing new model moves back within the hour, and a retry leaves a moved-back model (c4d36c08, 6df764ef and the round 2 fixes)

Owner, 2026-10-23: "This cron should run weekly not daily. We want the transition to be seamless and not disruptive in any way that writers would need to start over on a PD." Decision record: `docs/product-domain.md`, entry "2026-10-23".

What changes:

- The model list still refreshes daily. Tiers move only on the Monday run (08:45 UTC: 04:45 Toronto in summer, 03:45 in winter).
- An hourly check moves a failing new model back, only in the first 7 days after a move; after that admins get a daily notice. It watches the deploy-day move from its first run.
- A model a tier moved back from can be allowed again (`modelCatalog:allowTrackModelAgain`, by hand).
- A retry, "Retry failed drafts" or a Summary recovery of a failed draft moves off a model its tier moved back from and says so in the progress log. A running draft keeps its models.
- The one-off role migration never undoes an admin's tier choice.

### Automated, offline

- [x] `bash scripts/loop-verify.sh`: all 9 steps pass, 7,156 tests in 463 files. Admin component tests: 14 of 14.
- [x] Design reviewed before code, and code reviewed after in two rounds (both rounds' findings fixed), by Claude Opus 5.5 (high effort requested; it reported low) and gpt-6-astra (medium effort). Both rounds ended "ship after fixes".
- [x] New tests: the cron table; refresh without tier moves; the Monday run; the deploy-day move watched from the first check, with earlier failures counted; day 6.9 and day 8; the daily notice; allow again; the migration keeping an admin choice; retries after a move back (single, helper role only, comparison, failed drafts, a slot that keeps its frozen model, Summary recovery and its control).

### Automated, live on localhost (2026-10-23, 18:07 to 18:32 UTC, a copy of dev, $3.25)

- [x] **Account check.** Dev's Anthropic key is not held to Anthropic's history check for newer models (edited replay returned 200; with the beta header alone it listed `thinking_mismatch_allowed`). So chat keeps working when it moves to Sonnet 5.5. Cost about $0.01.
- [x] **Deploy mid-draft.** The copy started on `origin/main` (`bbbb2710`). Emily's plan (frozen on GPT-6.1 Sol, Sonnet 5 and Haiku 4.5) was signed off at 18:07:11; the new code was pushed at 18:07:38. The draft completed at 18:10:54 on its frozen models: three Lines drafted with their final checks, plan coverage complete, consistency pass with 0 findings, QA 58 of 100. 11 calls, $0.93, none cut off.
- [x] **Schedules accepted.** The local backend accepted all three cron strings on push.
- [x] **Chat across the deploy.** A chat turn on an old thread (earlier turns on Sonnet 5) started on the old code and finished on the new one, on Sonnet 5.5.
- [x] **Old thread, new model.** Three more turns on another Sonnet 5 thread ran on Sonnet 5.5: an edit card, applied; a follow-up after the edit; a file search.
- [x] **Move back (simulated failures).** 10 failed and 10 successful Sonnet 5.5 calls recorded through `recordCallOutcome`, then the hourly check: the Sonnet tier moved back to Sonnet 5 (42 percent of 24 calls). The admin log shows it; no alerts-board rows.
- [x] **Old thread after the move back.** A turn on the thread full of Sonnet 5.5 history ran on Sonnet 5 and answered correctly ("We edited paragraph 1 of Line 242").
- [x] **Retry after the move back.** A Single draft frozen on Sonnet 5.5, marked failed by hand (simulated), was retried: the retry froze Sonnet 5, logged "Sonnet 5.5 is no longer used for its tier, so this attempt runs on Sonnet 5.", and completed (22 calls, $1.20, QA 78 of 100, none cut off).
- [x] **Allow again, then the Monday move.** `allowTrackModelAgain` returned true, then false. A real daily refresh moved nothing. A real Monday run (`moveTiers: true`) passed Sonnet 5.5's readiness check and moved the tier forward; every other tier was up to date.
- [x] **Picking a candidate** on the October 15 comparison frozen on six older models (MiMo included) completed and created the report.
- [x] **Admin page** (`/admin/models`, in a browser): the new wording, every tier's state and the log of the move back, the allow-again notice and the Monday move.
- [x] **Errors.** No alerts-board rows; the only failed model calls were the 10 injected; no "outcome not recorded" or "Could not record a model redirect" lines. "Brain search failed" lines come from the copy having no Voyage key (the harness copies only the Anthropic and OpenRouter keys).
- Not run live, covered by tests: Summary recovery after a move back, "Retry failed drafts" after a move back, the round 2 fixes (the live copy ran 6df764ef), and a Step by step plan without a stored freeze.
- [x] **Owner decision.** A plan not yet signed off had to be cancelled and retried after a move back, starting a new Seeds stage. The owner asked for the picks to be kept and drafting to use the new model instead: commit 14 below.

## Commit 14: a plan keeps the writer's picks after a move back, and drafts on the tier's current model (82f56c1a)

Owner, 2026-10-23: "instead of needing the writer to start over to keep their selects but when generation after sign-off uses the new model." Decision record: `docs/product-domain.md`, entry "2026-10-23 (second)".

What changes:

- A step the writer starts in a draft (a Seeds request, sign-off, "Draft the rest", a QA run, a retry of the drafting inputs or the Seeds start) moves the draft off a model its tier moved back from, onto the tier's current model. The progress log says so once.
- The writer's picks, wording, Feedback, Summary and finished Lines stay exactly as they are. Work already running finishes on its model.
- The settings beside sign-off show the model the draft will run on.

### Automated, offline

- [x] Design reviewed before code by Claude Opus 5.5 (high effort requested; it reported low) and gpt-6-astra (medium effort): both "go with changes", all adopted but two (see the decision record). Code review after, two rounds: round 1 Opus "ship", Astra "ship after fixes"; round 2 Astra "ship", Opus "ship after one fix" (Opus reported low effort each time). All fixed.
- [x] `bash scripts/loop-verify.sh` on 1a0bc2bf (after both review rounds): all 9 steps pass, 7,172 tests in 463 files. One earlier run timed out two slow tests while the machine was loaded (load average 17); both passed alone and on the rerun.
- [x] New tests: the rewrite and its record; a model already frozen kept exactly; a comparison; a row with no freeze; QA leaving the writer model and waiting out a redraft; a retry after the rewrite; the redirect kept for a model the generation left; chained moves; a new action reading the changed freeze; sign-off after a move back keeping exactly the picks with every first-Line request on Sonnet 5; the settings beside sign-off; a Seeds request; the drafting-inputs retry; the Seeds-start retry with its analysis on the new model; a Batch queued before the move running on its own model; "Draft the rest"; the legacy section flow.

### Automated, live on localhost (2026-10-23, 20:15 to 20:34 UTC, a copy of dev, $1.79)

- [x] **A plan frozen on Sonnet 5.5.** A new Step-by-step plan on "Integrated Ore Sorting Grade Uplift Advancements" froze Sonnet 5.5 for the writer model and five roles (Haiku 5.5 for the retrieval Brief). Three Seeds picked on Sonnet 5.5.
- [x] **Move back mid-plan.** 12 failed and 8 successful Sonnet 5.5 calls recorded through `recordCallOutcome`, then the hourly check moved the Sonnet tier back to Sonnet 5 (20:24 UTC). The plan was not touched until the writer's next step.
- [x] **Before the next step,** the settings beside sign-off already named Sonnet 5.
- [x] **The next Seeds request** moved the plan's writer model and five roles to Sonnet 5, kept the Sonnet 5.5 entry, wrote one `modelMoves` record and one progress line. Every later Batch ran on Sonnet 5; the three Sonnet 5.5 picks stayed picked.
- [x] **Sign-off** (20:30 UTC): the signed-off Summary held exactly the 11 picks; the three Lines were created on Sonnet 5; no second move line. The draft completed at 20:33 with all three Lines checked, no "Not drafted" Section, QA 58 of 100.
- [x] **Calls by phase:** before the move 5 on Sonnet 5.5 and 1 on Haiku 5.5 ($0.29); Seeds after the move 12 on Sonnet 5 ($0.40); after sign-off 16 on Sonnet 5 plus QA. After the move, no call went to Sonnet 5.5. 35 calls, $1.79 in all.
- [x] **Errors.** No alerts-board rows. Four Sonnet 5 calls failed in ways seen before: three Seeds answers with a bullet over 25 words (one Batch failed and its retry was shown, 2 failures in about 86 Sonnet 5 Batches on this copy's history), and one QA answer cut off at its output limit (QA still finished, 58 of 100; the open post-QA limit item). "Brain search failed" is the copy's missing Voyage key.
- Not run live, covered by tests: "Draft the rest" and a QA run after a move back, the drafting-inputs and Seeds-start retries, and the legacy section flow. The live copy ran 82f56c1a; the review fixes after it are covered by tests.

### Manual on localhost

- [ ] **Admin page.** Open `/admin/models`. The Automatic updates text says "Every Monday morning". Each tier shows its model, the one before it and "Move back".
- [ ] **A draft started before the deploy.** Sign off a plan, deploy, and confirm it finishes without anyone doing anything.
- [ ] **Chat on an old conversation.** Continue a conversation from before the deploy. It answers and remembers earlier turns.

### Owner actions, in order (production)

1. [ ] Run the account check on production's Anthropic key: `ANTHROPIC_API_KEY="$(npx convex env get ANTHROPIC_API_KEY --prod)" node scripts/anthropic-history-check.mjs` from a machine whose Convex CLI reaches production (about $0.01; on dev it says "NOT HELD"). If it says "HELD", stop: chat would fail after the move until it sends append-only history.
2. [ ] Deploy. If production does not yet run the 2026-10-22 tier change, the deploy moves Sonnet 5 to 5.5 and Haiku 4.5 to 5.5 at once; drafts in progress keep their models.
3. [ ] Right after the deploy: `npx convex run modelCatalog:pointRolesAtTracks '{}'` and `npx convex run modelCatalog:resolveModelCatalogAlerts '{}'` (both safe to run again).
4. [ ] Within the first hour, `/admin/models` shows "Move back" for the moved tiers. Watch the model log for a day.
5. [ ] If a tier moves back for a reason that was not the model (an outage), allow it again: `npx convex run modelCatalog:allowTrackModelAgain '{"track":"claude-sonnet","modelId":"claude-sonnet-5-5"}'`.


## Phase A: AI answers no longer fail on fixed size limits

Owner, 2026-10-26: "continue and finish all ... ensure everything works as expected", and check big plans in batches instead of refusing them. Decision record: `docs/product-domain.md`, entry "2026-10-26 (second)". One commit, because its three parts share their request pins and tests.

What changes:

- **Long answers stream** and are read to the end, so they are not lost to the 240-second request timeout. Quotes, thinking and its signature come through the stream intact.
- **A cut-off answer gets the model's full room** on its retry, for the analyzer, the Brief, QA (and post-draft QA), chronology, the older Self-check, consistency and PD review. The judges also ask for 16,384 answer tokens first, up from 4,096.
- **A dense stretch of transcript is never kept part way.** A draft reads the transcript the usual way; background extraction reads the stretch in halves or quarters; a text still too dense is marked and not tried again.
- **A big Line's final check runs in parts**, up to 8 at once, instead of being refused at sign-off.

### Automated, offline

- [x] Design reviewed twice before code by Claude Opus 5.5 (high requested, it reported low) and gpt-6-astra (medium): both "go with changes" each round; adopted all but two findings (see the decision record).
- [x] A regression found by the agent that rewrote the sign-off tests (a claim no longer refused a plan check too big for any request) is fixed and tested.
- [x] Code review after, of 8c3d83dd: gpt-6-astra (medium) and Claude Opus 5.5 (high requested, it reported low), both "ship after fixes". All findings fixed but one, which is accepted and recorded (the uncounted 402 request). The fixes are the second Phase A commit.
- [x] `bash scripts/loop-verify.sh` on the final code (01a56218): all 9 steps pass, 465 test files, 7,212 tests.

### Automated, live on localhost

- [x] **Emily's plan** (the 2026-10-09 case), on a local copy of dev at 01a56218, 2026-10-26: signed off and drafted in 13 requests ($1.11). Each Line's final check fit one request (18 to 26 labels, 12 to 17 plan checks); post-draft QA finished with 3,985 answer tokens, not cut off. No request asked for over 16,384 answer tokens, so none streamed.
- [x] **A big plan**, on the same copy, 2026-10-26: a Step by step run with 40 picks in one step (passive limitations; the step was regenerated ten times and every idea picked) signed off. Line 242's final check, 10 labels and 54 plan checks, ran in 2 requests (38 and 16 plan checks), both answered, twice (before and after its repair); the other Lines fit one request. The draft completed and post-draft QA finished (2,364 answer tokens). 48 requests, $2.61, Seeds included.
- [ ] **A long transcript** in background extraction: facts become ready, or the run is marked too dense and the draft reads the transcript.

### Manual on localhost

- [ ] **Sign off a big plan.** Pick 40 ideas in one step (or use a Brief with many entries). Sign-off works. The PD drafts, and the Compliance Note lists every plan check.
- [ ] **Post-draft QA on a long PD.** Run QA on a finished PD. It finishes with a scorecard, no "cut off" error.
- [ ] **A long interview.** Upload a 1 to 3 hour transcript and draft. The draft finishes. The progress log either uses verified facts or says the transcript was read the usual way.

### Owner actions

- [ ] None before release beyond the earlier commits' steps. The prompt version moves on deploy, so a Brief prepared just before the deploy is prepared again once.

## Phase B2: files the browser got nothing from are read again on the server

Decision record: `docs/product-domain.md`, entry "2026-10-26 (third)".

What changes:

- **A file with nothing read** (no text, or only a "stopped reading" line) is read again on the server from its stored original, once. A file with read text keeps it; a PDF stopped part way waits for text versions (B1).
- **OneDrive imports read PDFs**, each in its own action. Before, every imported PDF arrived empty.
- **Existing files** are read by a one-off pass, run by hand.

### Automated, offline

- [x] Code review of 075f1cad by gpt-6-astra (medium) and Claude Opus 5.5 (high requested, it reported low): both "ship after fixes". All findings fixed but one, which is recorded (email dates); see the decision record.
- [x] `bash scripts/loop-verify.sh` on the final code: all 9 steps pass, 470 test files, 7,243 tests (a first run lost one transcript test to a 30-second timeout while other jobs loaded the machine; the same test timed out on the commit before this change, and the rerun passed).

### Automated, live on localhost

- [x] **On a local copy of dev at cd7bfe9c, 2026-10-26.** The copy holds 303 files; the snapshot carries no stored originals, so the one-off pass (dry run, then real) queued the 4 empty PDF and Outlook files, and each reading found no original and stopped without claiming the file, as designed. Files uploaded to the copy the way the browser uploads them: a PDF with no text and a PDF with only the stop line were each filled with the server's text (ready, page count for chat); a PDF with pages read before its stop line was not queued and kept its text; the CRA Schedule 60 Word template with no text was filled (4,685 characters).

### Manual on localhost

- [ ] **Upload a PDF with no text layer you can read in the browser** (or one whose first page times out). A minute later it shows its text and is ready. Upload a long PDF the browser stops part way: it keeps its pages and says where it stopped.
- [ ] **Upload a scanned PDF.** It stays without text (the Azure reader comes later), and nothing breaks.

### Owner actions

- [ ] Deploy, then run the one-off pass on dev, then on production: `npx convex run documentReading:queueServerReadings '{"dryRun":true}'` and read its last log line for the count, then the same without `dryRun`. Reading costs no AI.

## Phase B4, step 1: Word files as Markdown

Owner, 2026-10-26: "should be properly markdown so we can see italic, bolds and headings and properly backfilled for any current/past files to all work". Decision record: `docs/product-domain.md`, entry "2026-10-26 (fourth)".

What changes:

- **Word files keep their headings, bold, italic, lists and tables** as Markdown, read the same way in the browser and on the server, and the file preview shows them formatted.
- **Quotes still match.** Drafts freeze a Word file without its bold and italic marks, so a quote the AI gives without them is found and checked as before.
- **Older Word files** are re-read as Markdown when text versions (B1) land, so past drafts and saved quotes keep matching.

### Automated, offline

- [x] Code review of 7498ea46 by gpt-6-astra (medium) and Claude Opus 5.5 (it reported running below the requested high effort): both "ship after fixes"; every finding fixed (see the decision record). One fix reaches chat: no reply can load an image any more.
- [x] `bash scripts/loop-verify.sh` on the final code: all 9 steps pass, 473 test files, 7,269 tests. `npm run test:component`: 1,952 of 1,954 passed, 1 skipped, 1 failed on a sub-pixel width (16.87482 against 16.875) in the shell toast captures, which this change does not touch; that file passes on its own (6 of 6).

### Manual on localhost

- [ ] **Upload a Word file with headings, bold text and a table.** Open its preview: the headings, bold, italic and table show formatted, with no stars or pipes.
- [ ] **Draft with it.** A Brief entry or Seed quoting a bolded sentence links to the right place in the file.
- [ ] **Upload a Word PD for review** whose Line headings are bold or styled as headings. The three Sections are found.

## Phase B4, step 2: search pieces, project search and file labels

Decision record: `docs/product-domain.md`, entry "2026-10-26 (fifth)".

What changes:

- **Each project file is cut into search pieces** of about 600 tokens along its pages, sheets, messages and headings, a minute after its text is written.
- **A search within one project** finds the pieces best first, never from another project, an archived file or older text.
- **Claude Haiku labels each file** (kind, fiscal year, title, two-line summary) with names hidden. Labels describe files; they are never evidence.

### Automated, offline

- [x] Code review of f6bcb74e by gpt-6-astra (medium) and Claude Opus 5.5 (below the requested high effort): both "ship after fixes"; every finding fixed (see the decision record).
- [x] `bash scripts/loop-verify.sh` on the final code: all 9 steps pass, 477 test files, 7,306 tests.

### Automated, live on localhost

- [x] **On local copies of dev, 2026-10-26.** At f6bcb74e: the backfill marked 266 files; 236 were cut into 2,210 pieces; 30 files of deleted projects stayed due forever (the queue problem both reviewers found); 159 files labelled for about $0.0007 a file; labels read right (kind, fiscal year end, title, summary); searches for "ore sorting sensor calibration", "grade uplift rejection rate" and "XRT sensor throughput trial" on Emily's project found her ore sorting files. At a61e1489 (the fixes): 237 files cut into 2,210 pieces with no retry, and the 30 files of deleted projects left the queue without being cut; labels ran on their own each minute. A writer settings file was labelled with a kind outside the list, fixed in 13e698a1 (read as "other").

### Manual on localhost

- [ ] Nothing to see yet: Phase D shows the file list and search in drafting and chat.

### Owner actions

- [ ] Deploy, then on dev and then production run `npx convex run searchPieces:markSearchPiecesDue '{"dryRun":true}'` and the same without `dryRun`. The sweeps cut the pieces and label the files over the next minutes (about $0.003 a file in Haiku calls).

## Phase C, step 1: company files stored, with permissions, a log and merging

Decision record: `docs/product-domain.md`, entry "2026-10-26 (sixth)".

What changes:

- **A company can hold files** for every project linked to it, with their text, search pieces and labels kept like project files.
- **Consultants, Managers and Admins read and add them; only Managers and Admins archive, restore or remove them.** Financial users cannot see them. Every change is logged with who and when.
- **Merging companies moves their files** to the kept company in the same step.

### Automated, offline

- [ ] Code review by two reviewers.
- [ ] `bash scripts/loop-verify.sh` on the final code.

### Automated, live on localhost

- [ ] On a local copy of dev: add files to a company, see them cut and labelled, search them, merge two companies and see the files move.

## Phase C, step 2: the company page's Files tab

Decision record: `docs/product-domain.md`, entry "2026-10-26 (sixth)", the Files tab bullet.

What changes:

- **A company's view on the Projects page has Projects and Files tabs.** Files lists the company's files with their summary, kind, length, who added them and when.
- **Upload files** adds files to the company. Managers and Admins can archive, restore and remove them.
- **The merge dialog** says how many company files move.

### Automated, offline

- [ ] Code review by two reviewers (with step 1's fixes).
- [ ] `npm run test:component` and `bash scripts/loop-verify.sh` on the final code.

### Manual on localhost

- [ ] As a Consultant, open a company on the Projects page, choose Files, upload a PDF, a Word file and a scanned PDF; each appears, the Word file previews formatted, the scan gets its text from the server within a minute.
- [ ] As a Manager, archive a file, find it under Show archived files, restore it, and remove another after confirming.
- [ ] Merge two companies that both have files; the dialog says how many move, and afterwards the kept company lists them all.

## Phase C, step 3: drafts read the company's files

Decision record: `docs/product-domain.md`, entry "2026-10-26 (seventh)".

What changes:

- **A draft reads the project's company's files** after the project's own: the newest 12, at most 600,000 characters, as "company files" the AI is told are about the company, not necessarily this project or year.
- **They never count as this year's source**, and their company's former names are hidden like every other name.
- **The start dialog lists them** so a writer can leave one out, and **the Inputs band names the ones a draft used.**

### Automated, offline

- [x] Code review by two reviewers, two rounds (Claude Opus 5.5, below high as it reported, and gpt-6-astra, medium).
- [ ] `bash scripts/loop-verify.sh` and `npm run test:component` on the final code.

### Automated, live on localhost

- [ ] A Step-by-step run on a project whose company has files: the Brief and Seeds cite them where they help, the Inputs band names them.

### Manual on localhost

- [ ] Start a run on a company's project: the dialog lists its company files last; untick one and check the Inputs band leaves it out.

## Phase C, step 3: chat finds and opens company files

Decision record: `docs/product-domain.md`, entry "2026-10-26 (eighth)".

What changes:

- **The assistant sees a list of the company's files** (names only) and can search and open them, after the project's own files. It never gets their text unless it opens one.

### Automated, offline

- [x] Code review by two reviewers, two rounds (Claude Opus 5.5, below high as it reported, and gpt-6-astra, medium). Round 2 fixes are in the seventh and eighth decision entries.
- [ ] `bash scripts/loop-verify.sh` on the final code.

### Manual on localhost

- [ ] On a company's project, ask the assistant about something only a company file says: it searches, opens the company file and answers, naming it as a company file.


## A Brief answer that leaves fields out

Decision record: `docs/product-domain.md`, the Sonnet 5.5 entry, bullet "A Brief answer that leaves fields out (2026-10-26, live check)".

What changes:

- **Found live:** on Sonnet 5.5 a Brief came back with a storyline and claims but no exclusions, confidence entries or glossary terms, and was saved as if complete.
- **Now the Brief is asked again**, naming the fields it left out, and fails if the second answer leaves fields out too.
- **The root cause:** without a forced tool call, Sonnet 5.5 sometimes wrote lists as tool markup or broken JSON, so fields arrived as strings or the whole answer was lost (the analyzer failed the same way). Every request to a model that refuses a forced call now sends its tools strict, so answers always match their schema.
- **A Brief saved with nothing in it is not reused.**

### Automated, offline

- [x] `convex/ai/structured.test.ts`, `convex/ai/brief.test.ts`, `convex/ai/strictTools.test.ts` and the pinned request tests.
- [x] Live: every strict schema compiles on Sonnet 5.5 and Opus 5.5, and through OpenRouter.
- [ ] `bash scripts/loop-verify.sh` on the final code.

### Automated, live on localhost

- [ ] A Step-by-step draft on the InnovMine project: the Brief has confidence entries and glossary terms.

## Phase D, step 1: chat reads files whole when they fit, otherwise by search

Decision record: `docs/product-domain.md`, entry "2026-10-26 (ninth)". Plan: `docs/todos/phase-d-search-first.md`.

What changes:

- **A small project's files still go into every chat message whole.**
- **When they do not all fit**, the assistant gets the list of files and finds what it needs with search, instead of seeing the first 12 files in upload order.
- **Search uses the files' search pieces** when they are up to date, and cuts each excerpt around the words found.

### Automated, offline

- [x] Code review by two reviewers (gpt-6-astra, medium; Claude Opus 5.5, low as it reported). Fixes in the ninth decision entry.
- [ ] `bash scripts/loop-verify.sh` on the final code.

### Automated, live on localhost

- [x] A project whose files do not fit (Insporos, a 52,000-character writer's notes file): asked about something only the prior-year report says, the assistant searched three times and answered from it, saying the finding was last year's and that no numeric threshold exists.

### Manual on localhost

- [ ] The same, in the browser, on a project with many files and on a small one.

## Phase D, step 2: every step records what it read

Decision record: `docs/product-domain.md`, entry "2026-10-26 (tenth)".

What changes:

- **Each file in the Brief's Inputs band says which steps read it**, and whether they read it whole, in part or condensed: the analysis, the Brief, Seeds (per step) and the facts check.
- **A step records only once its request has answered**, so a failed step never shows as having read a file.
- **A Summary recovery shows the reads of the draft it recovers**, and a reused Brief shows what the draft that made it read.

### Automated, offline

- [x] Code review by two reviewers (Claude Opus 5.5, low as it reported; gpt-6-astra, medium), both "ship after fixes". Fixes in the tenth decision entry.
- [x] A second look at the fixes by one reviewer (gpt-6-astra, medium): "ship after fixes"; fixes in the tenth decision entry ("Re-check of 5bf930b9").
- [ ] `bash scripts/loop-verify.sh` and `npm run test:component` on the final code.

### Automated, live on localhost

- [x] A Step-by-step draft: the band names, for each file, the steps that read it. On InnovMine (7 files with text, 1 image) after the review fixes: each file read whole by the analysis, the Brief and the first Seed step ("company_context"), one record each; the image has none.

### Manual on localhost

- [ ] Open the Brief's Inputs band on a finished draft and read the line under each file.

## B1, first part: older Word files read again as Markdown

Decision record: `docs/product-domain.md`, entry "2026-10-26 (eleventh)".

What changes:

- **Word files stored before Word was kept as Markdown are read again** from their original, so their headings, bold, italics, lists and tables show.
- **The plain text they had is kept** as an earlier version, never lost.

### Automated, offline

- [x] Code review by two reviewers (gpt-6-astra, medium; Claude Opus 5.5, low as it reported), both "ship after fixes". Fixes in the eleventh decision entry.
- [ ] `bash scripts/loop-verify.sh` on the final code.

### Automated, live on localhost

- [x] A Word file uploaded as an older browser tab would send it (plain text) was read again on the server as Markdown (heading, bold, italics, a table), and its plain text was kept as version 1. The check found the version naming the wrong reader; fixed (`textReader`).
- [x] After the review fixes (69f67364): a Word file whose plain text is its own words became Markdown with the plain text kept as a version; a previous-year upload kept its header and the writer's note (escaped) before the Markdown; text that is not the file's words was kept, with no version.

### Owner, once, dev first

- [ ] Run `documentReading:queueServerReadings` (dry run first). It now also reads older Word files as Markdown. Each project with a changed file gets one new Brief head start.

### Manual on localhost

- [ ] Open an older Word file's preview: headings, bold and lists show.

## Phase E, first part: removing a Brain source withdraws its lessons

Decision record: `docs/product-domain.md`, entry "2026-10-26 (twelfth)". Plan: `docs/todos/phase-e-learning.md` (E2a).

What changes:

- **Revoking or removing a Brain source withdraws the writer feedback it was made from**, so new style lessons no longer learn from it.
- **Published style guidance that drew on that feedback is turned off** until an Admin publishes a version that did not use it. The Admin reviews page says why, and offers no Publish button on a version that drew on it.

### Automated, offline

- [x] Code review by two reviewers (gpt-6-astra, medium; Claude Opus 5.5, low as it reported), both "ship after fixes". Fixes in the twelfth decision entry.
- [ ] `bash scripts/loop-verify.sh` and `npm run test:component` on the final code.

### Automated, live on localhost

- [x] Feedback approved, a style set that admitted it published, its Brain source revoked: guidance turned off with the reason, that version marked, and publishing it again refused. The one-off pass ran (nothing older to link on this copy).

### Owner, once, dev first

- [ ] Run `brain:linkBrainFeedbackSources` once. It links older approved feedback to its Brain source and withdraws feedback of sources already revoked; if published style guidance drew on such feedback, it is turned off.

### Manual on localhost

- [ ] On `/admin/reviews`, with published style guidance built from approved feedback, revoke that feedback's Brain source: the guidance shows as turned off, with the reason, and that version has no Publish button.

## Phase E, second part: Step-by-step choices and reviews teach the style lessons, and chat reads them

Decision record: `docs/product-domain.md`, entry "2026-10-26 (thirteenth)". Plan: `docs/todos/phase-e-learning.md` (E2b).

What changes:

- **Seed rewordings, Seed Feedback, the choices made at sign-off, review decisions and internal review comments** are kept as learning signals, with names hidden, and feed the style lessons. Each kind needs two or more writers on two or more projects before it counts.
- **Chat reads the published style lessons**, as drafts do.

### Automated, offline

- [ ] Code review by two reviewers.
- [ ] `bash scripts/loop-verify.sh` and `npm run test:component` on the final code.

### Automated, live on localhost

- [x] An internal comment on the Insporos report became a review-comment signal with the company's name hidden ("[CLIENT_1_FIRST]"). The one-off pass made signals for older Seed edits, Feedback and sign-offs (42 signals in all, none holding a client's name). With a style set published, a chat turn recorded the set it read.

### Owner, once, dev first

- [ ] Run `learningSignals:backfillLearningSignals` once, to make signals for older Seed edits, Feedback, reviews and comments.

### Manual on localhost

- [ ] Leave an internal comment on a report, then check `/admin/reviews` after the next nightly build: the style lessons list "Review comments" among their inputs once enough writers and projects have them.

## Phase E, third part: writer memory suggestions

Decision record: `docs/product-domain.md`, entry "2026-10-27". Plan: `docs/todos/phase-e-learning.md` (E1a). The page and the use in drafts, Seeds and chat come in the next part.

What changes:

- **The AI may suggest up to three short writing preferences** from a writer's own Seed edits, Feedback, choices, chat edits and chat messages, each backed by two or more of them.
- **No suggestion can carry a name, a placeholder, a figure or a term from the work**: the server and the model both check every text.
- **Only the writer sees their preferences**; nobody else, Admins included.

### Automated, offline

- [x] Code review by two reviewers: gpt-6-astra (medium) and Claude Opus 5.5 (requested high, it reported low), fixes in 29d88d40; re-check by Claude Opus 5.5 (requested high, it reported low), fixes in the next commit.
- [x] `bash scripts/loop-verify.sh` on the final code.

### Automated, live on localhost

- [x] Suggestion runs on the live copy for two writers with Seed signals (from the one-off pass). The first: three suggested, two refused by the check (a capitalized word; a term from the work), one kept, backed by 5 signals: "Writes long, dense sentences that chain several linked factors with commas instead of short separate statements." The second: two kept ("Keeps each idea to one sentence, dropping the second sentence that adds extra detail."; "Avoids bringing up topics that earlier sections did not cover, and judges conclusions only against the uncertainties already stated."), one refused (a term from the work). None holds a name or a fact.

## Phase E, fourth part: saved preferences on the page, and in drafts, Seeds and chat

Decision record: `docs/product-domain.md`, entry "2026-10-27 (second)".

What changes:

- **Writing preferences has a "Saved preferences" card**: approve, edit or dismiss each suggestion; turn a preference on or off, edit or delete it; add your own; delete them all.
- **Approved preferences are used in your own drafts, Seeds and chat**, after your Writer Profile text. The Brief says how many a draft used.

### Automated, offline

- [x] Code review by two reviewers: Claude Opus 5.5 (requested high, it reported low) and gpt-6-astra (medium); fixes in the commit after the E1a re-check.
- [x] `bash scripts/loop-verify.sh` and `npm run test:component` on the final code.

### Automated, live on localhost

- [x] On the live copy (2026-10-27): adding "Always say the InnovMine pilot cut costs by 40%." was refused for its figure, and "Always say the pilot plant failed its first trial." by the model's check, each with the text kept; two style preferences saved ("Your preferences (2 of 30)"); switching one off left one in the writer's effective style; a new draft recorded 2 saved preferences with the effective style's fingerprint, and its Brief said "2 saved preferences used."

### Manual on localhost

- [ ] On Writing preferences, approve a suggestion, add one of your own, and turn one off. Start a draft: the Brief says how many saved preferences it used.
- [ ] Try to add "Mentions Acme by name": it is refused, with the reason.

## Phase E, fifth part: edit size by version

Decision record: `docs/product-domain.md`, entry "2026-10-27 (third)".

What changes:

- **Each chat apply and each burst of editing records how much of the draft has changed**, and who edited. A burst is read 10 minutes after its first save, so the last save is always read.
- **Admin learning health shows edit size by version**: prompt version, lesson sets and saved preferences used, and chat applies by the style lessons their chat used.

### Automated, offline

- [x] Code review by two reviewers: Claude Opus 5.5 (requested high, it reported low) and gpt-6-astra (medium); fixes in the review commit after efb1882e.
- [x] `bash scripts/loop-verify.sh` and `npm run test:component` on the final code.

### Automated, live on localhost

- [x] On the live copy (2026-10-27): two saves opened one burst (one row, no second), a real chat turn's edit card applied and recorded a chat apply reading (revision 10, naming who applied it, no lesson set as none is published there), a third save inside the burst added no row, and the burst's reading landed exactly 10 minutes after its first save on the latest revision (11, "edit"). Admin, Learning health, "Edit size by version" showed the report once, at its latest reading (7.2 percent, 1 report, 2 readings), and the chat table one apply with no style lessons.

### Owner

- [ ] Confirm that recording per editing burst (up to 10 minutes) and at each chat apply meets "each report edit's size is recorded".

### Manual on localhost

- [ ] Edit a report for a minute, wait 10 minutes, and apply a chat card. On Admin, Learning health, "Edit size by version" counts the report, and the chat table names the chat's style lessons (or None).

## Phase E, fifth part: evaluation projects

Decision record: `docs/product-domain.md`, entry "2026-10-27 (fourth)".

What changes:

- **Release suite projects are marked as evaluation projects**, so their fictional work never teaches the lesson sets, writer memory, edit size or the Brain.

### Automated, offline

- [x] Code review by two reviewers: Claude Opus 5.5 (requested high, it reported low) and gpt-6-astra (medium); fixes in the review commit after efb1882e.
- [x] `bash scripts/loop-verify.sh` on the final code.

### Automated, live on localhost

- [x] One release suite fixture on the live copy (2026-10-27, both arms of the compare run below): each project was marked as an evaluation project, and the scripted Seed edits and Feedback made no learning signal.

## Phase E, fifth part: comparing drafts with and without a change

Decision record: `docs/product-domain.md`, entry "2026-10-27 (fifth)".

What changes:

- **The release suite can compare a change**: `--compare lessons --lesson-set <id>` or `--compare preferences` runs each fixture twice, without and with it, and the pack shows the two side by side.

### Automated, offline

- [x] Code review by two reviewers: Claude Opus 5.5 (requested high, it reported low) and gpt-6-astra (medium); fixes in the review commit after efb1882e.
- [x] `bash scripts/loop-verify.sh` on the final code.

### Automated, live on localhost

- [x] `node scripts/seed-plan-eval.mjs --deployment local --as <reviewer> --confirm-spend --compare preferences --fixture skipped-role-supported` on the live copy at 3f724739 (2026-10-27, $2.33): the "without" draft used 0 saved preferences although the acting reviewer has 2 switched on, the "with" draft used 3, both passed all 12 automatic checks, and `compare.md` said so. The preferences showed in the text: "the team" 6 times without and 0 with, "we" 0 times without and 26 with, and the mean sentence 32.1 words without and 23.6 with (16 of 55 sentences over 25 words, against 23 of 41). This run predates the review fix that gives both arms the same title.

## B1, second part: drafts refer to stored text instead of copies

Decision record: `docs/product-domain.md`, entry "2026-10-27 (sixth)". Plan: `docs/todos/b1-text-versions.md`.

What changes:

- **A draft no longer keeps its own copy of each file's text.** The text is stored once and every later draft of the project refers to it, so a project with many drafts takes far less room. Transcripts are referred to where they are kept.
- **Nothing a writer sees changes**: the Brief, Seeds, drafts, quotes and chat read the same text as before.
- **A project whose files are too large to read at once is refused by name** ("This project's files are too large to read at once. Remove files or transcripts you no longer need, then start again.") instead of failing with a platform error.

### Automated, offline

- [x] Code review by two reviewers: Claude Opus 5.5 (requested high; it reported low) and gpt-6-astra (medium), 2026-10-27, each "ship after fixes"; every finding fixed or recorded in the decision entry.
- [x] Round 2 review of the fixes (08ea6469): Claude Opus 5.5 (requested high; it reported low), "ship after fixes"; fixed in the next commit.
- [x] Round 3 review of the round 2 fixes (24cad190): gpt-6-astra (medium), "ship after fixes"; fixed in the next commit.
- [x] Round 4 review of the round 3 fixes (5def13ba): Claude Opus 5.5 (requested high; it reported low), "ship after fixes"; fixed in the next commit.
- [x] Round 5 review of the round 4 fixes (cc533821): gpt-6-astra (medium), "ship after fixes"; fixed in the next commit.
- [x] Round 6 review of the round 5 fixes (180f3fee): Claude Opus 5.5 (requested high; it reported low), "ship after fixes"; fixed in the next commit.
- [x] Round 7 review of the round 6 fixes (2b760a8e): Claude Opus 5.5 (requested high; it reported low), "ship after fixes"; fixed in the next commit.
- [x] Round 8 review of the round 7 fixes (acd9d6c7): Claude Opus 5.5 (requested high; it reported low), "ship after fixes"; fixed in the next commit.
- [x] Round 9 review of the round 8 fix (8d4a07a1): gpt-6-astra (medium), "ship", no findings.
- [x] `bash scripts/loop-verify.sh` on the final code (8d4a07a1): 8,143 tests passed.
- [x] `bash scripts/loop-verify.sh` on the fixes (08ea6469): 7,602 tests passed.

### Automated, live on localhost

- [x] A draft of a project with Word, PDF and company files on the live copy (2026-10-27, on the code before the review fixes): every new row refers to its text, none holds a copy; 30 of 30 Brief quotes and the Seed's quote match the stored text exactly; a second draft of the same project stored no new text (3 versions, 4 pieces before and after); a Single report on another project cited its transcript 14 times, every citation exact. Sign-off of a Step by step draft was not run live; the sign-off suite runs on new-style rows.
- [x] After the review fixes (2026-10-27, at 4b047280): a Step by step draft of the same project started on the live copy under Convex's real limits and was cancelled; its three rows (two project files, one company file) refer to stored text with no copies, and the project still holds 3 versions, so it stored nothing new.


## F1, steps 1 and 2: how many characters each request sends

Plan: `docs/todos/phase-f-scale.md`, F1. Decision record: `docs/product-domain.md`, entry "2026-10-27 (seventh)".

What changes:

- **Every Anthropic request records its size.** Its usage row keeps the characters it sent and the part sent in user turns, measured on the request as sent.
- **Admin, AI usage and cost, shows characters per token** by feature and model for the last 30 days, with how many requests each rests on. Nothing a writer sees changes; the budgets stay at 4 characters a token until there is evidence-only data.

### Automated, offline

- [x] Code review: Claude Opus 5.5 (requested high; it reported low), "ship after fixes"; fixed in the next commit, checked live (the table by feature and model on the live copy's Admin page).
- [x] `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`: 7,716 unit tests and 1,988 browser tests passed.

### Automated, live on localhost

- [x] One Step by step draft on the live copy (2026-10-27): every Anthropic call's usage row recorded its characters, and the Admin table read them back: Seeds 2.83 characters per token (2 requests, 200,843 characters), the analyzer 3.10, the retrieval brief 1.54 (a short request, where the tool definitions' fixed cost weighs most). All below the 4 the budgets assume.
- [ ] After the release suite or the stress test: the Admin table shows each drafting step's characters per token.

### Manual on localhost

- [ ] Admin, AI usage and cost: the "Characters per token" table reads clearly, and says when nothing is measured yet.

## F2: project copies file by file

Decision record: `docs/product-domain.md`, entry "2026-10-27 (eighth)". Plan: `docs/todos/phase-f-scale.md`, F2.

What changes:

- **Duplicating a project with many large files works.** Each file's text is copied in its own step, so no copy hits the platform's limits, and nothing is cut off at 250 files.
- **A file that changed or was removed in the original while it was being copied shows "Could not copy".** Add it again if it is needed.
- **While files are still being copied, starting a draft says so and asks you to try again in a minute.** This normally lasts seconds, and only after a crash longer.

### Automated, offline

- [x] Code review by two reviewers, round 1: gpt-6-astra (medium) and Claude Opus 5.5 (requested high; it reported low), each "ship after fixes"; fixes in the next commit.
- [x] Round 2 review of the fixes (bf610f75): gpt-6-astra (medium), "ship after fixes"; fixes in the next commit.
- [x] Round 3 check of the round 2 fixes (7f0df798): gpt-6-astra (medium), "ship after fixes"; fixes in the next commit.
- [ ] Round 4 check of the round 3 fixes.
- [ ] `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` on the final code.

### Automated, live on localhost

- [x] Duplicate a project with files and a report on the live copy (2026-10-27, at 85f2f08a): InnovMine copied in 435 ms; all 5 files have the same text, none pending, the report came along, and the receipt maps each; originals were cloned where the source had one (the three older snapshot rows never had a stored original).
- [ ] Review from project on the live copy: the review project has every support file.
- [ ] F5's stress project (50 files of 400,000 characters) duplicated on the live copy.

### Manual on localhost

- [ ] Duplicate a project in the wizard: the copy finishes before the new project opens, and its Files panel shows every file as ready.
- [ ] A file shown as "Being copied" or "Could not copy" reads clearly, with no Replace button while it is being copied.
