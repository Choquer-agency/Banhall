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
  - a damaged file opened through the reading tool returns "unavailable";
  - a searched research request over 12 large matching files stays in bounds.
