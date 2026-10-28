# F5 stress test, live (2026-10-27)

The plan is item F5 in `docs/todos/phase-f-scale.md`, and the decision is entry "2026-10-27 (thirteenth)" in `docs/product-domain.md`.

**Where it ran.** A fresh local copy at 6673a1ce, later 39d3a6b6, with real models (Sonnet 5.5, Haiku 5.5). The data came from the earlier live copy's snapshot. Every project was an evaluation project with invented names, so nothing fed learning. The scripts were `scripts/stress/generate.mjs` and `run.mjs`, plus one-off drivers that are not committed (`part2.mjs`, `upload100.mjs`, `startdraft.mjs`, `dup.mjs`).

**Spend.** $20.38 of the owner's $40 cap. `spend-all.json` breaks it down by feature and model. About $7.50 went on the first runs whose generated text the models refused (see 1 below).

## What passed

Every case passed except three: two drafts started in the same second (3 below); every check failing at once, which could not be produced live; and a 46-entry Brief, which was not tested (the model's Brief had 10 entries).

| Case | Result |
|---|---|
| 50 files of 400,000 characters, one at 1,000,000, one over it | 52 uploads in 4.2 s (the slowest 0.17 s). The file over the maximum was refused by name ("too long to keep (1,000,001 characters; the most is 1,000,000)"). |
| Search pieces and file labels, about 21M characters of files | 197 s for 51 files, every file labelled, no label refusals once the text was sentences. |
| 100 files, about 41M characters of files | 101 uploads in 10.8 s; search pieces and labels in 534 s (`results-100c.json`). The draft froze 14 files and the interview. Its Inputs band listed all 101: 12 read by drafting, 2 frozen past drafting's 12-file cap, and 87 "not captured" (`inputs-band-100-files.json`). |
| 3-hour interview (161,895 characters) | Frozen whole. |
| 20 picks in one step | Uncertainties: 20 picks from 6 Batches in 76 s. |
| A 46-pick plan, sign-off | Every step approved with 46 picks (`results-part2.json`). Sign-off went through, and the report was ready 1.1 min after it. A plan this size was refused at sign-off before P0 item 2. |
| A 46-entry Brief | Not tested live: the Brief the model wrote for this project had 10 entries. |
| Every check failing | Not reachable live. Every pick was edited to state a figure no source holds (46 edits), but the facts check counts wording the writer typed as supported, so those checks passed (Line 242: 36 checks applied; Line 244: 18 applied, 4 not; Line 246: 15 applied). The worst-case answer size is pinned by the unit tests that size every verdict at its limit. |
| Previous year on a first-year project | Opened skipped, as the twelfth entry says. |
| Chat at scale | Three turns on the 51-file project. It searched every file, including ones the draft never froze, and read 40,000 characters of a 400,000-character file and a part of the 1,000,000-character file from its middle. The longest answer was 7,417 tokens and ended normally. The third turn summarized both earlier answers correctly, with 36,666 input tokens. |
| Duplicating the stress project | 51 files (21M characters) and the report copied in 6.0 s. The copy job finished with nothing left pending (F2's live proof). |
| Two drafts at once | Started 20 seconds apart, both reached their Seeds side by side (1.2 and 0.9 min). Started in the same second, both failed (3 below). |
| Erasing | Two large projects (152 files, all their search pieces) erased in about 75 s. |

## What failed, and what was done

1. **The models refused the generated text** (`results-part1.json`). Words in random order were refused:
   - by Sonnet 5.5 on every Brief try ($4.40);
   - by Haiku 5.5 on 73 of 171 file labels (about 4 in 10), and on every speaker check.

   Side by side on 3 small files (`refusals.json`, read before those projects were erased):
   - words in random order drew refusals on a label, a Brief prepared ahead and the speaker check;
   - sentences drew none of these.

   The generator now writes sentences from templates (6673a1ce).

   The label call read a refusal as a schema error. It now records "refusal" (9826fea0). Sentences drew no label refusals, so that fix was not seen live.

   On sentences, Haiku 5.5 still refused the Brain search query (`generation:retrieval_brief`) 3 times in 6 (`refusals.json`). A refused query falls back to one built from the project's title and transcript, and logs an error. The Brain is not set up on this copy, so nothing used it here. Haiku 5.5's hourly counts hold 22 failures in 392 calls by 04:50 (about 6 percent, under its 20 percent), and its tier did not move (`tier-check.json`). Its per-call outcome rows and its usage rows are the same 392 calls, hour by hour, but 82 of those calls were refused (`haiku-outcomes.json`). The label and structured call paths settle a refusal as a failure, so the counts and the code disagree; the cause was not found.

   On the release fixtures, these features never refused: 0 of 277 labels, 0 of 32 retrieval briefs, 0 of 22 speaker checks.
2. **No step's first Batch could start on a large project.** The writer saw "Seed context for company_context exceeds the prompt limit", and Retry failed the same way. The draft froze 50 files of 200,000 characters (about 10 MB), past the Seed read budget. The frozen total now comes from that budget (about 3 MiB) and holds a project's own files too (39d3a6b6). After the fix, the same project froze 14 files and went to a report.
3. **Two large drafts started in the same second both failed.** The local backend's write rate limit refused the next writes ("Too many writes per second... 4 MiB"), whether or not they were large. The writer sees "The generation did not complete. Try again.", and a retry works.
   - Before the fix, one large draft alone also failed this way once, while labels and the Brief prepared ahead were writing; it starts by writing up to 10 MB.
   - One draft's stored error reads "The AI provider rejected the request", which is wrong: it was the write rate limit.
   - The error says the limit depends on the deployment's size, so cloud deployments likely have one too. That was not checked.
   - **Proposed:** retry a start's writes briefly when the rate limit refuses them.
4. **The Brief prepared ahead could not be taken up.** On the 10 MB draft, `adoptPreparedBrief` read past a transaction's 16 MiB, and the draft made its own Brief ($0.55 more). This was not seen after fix 2.
5. **The Sonnet tier moved back on its own.** The hourly production error check moved Sonnet 5.5 back to Sonnet 5 at 04:15 UTC. The move records what the check saw: 12 failures in 55 calls, 21.8 percent (`tier-moves.json`); the limit is 20 percent with at least 20 calls. The failures were mostly the refused Briefs from 1 and two Seed answers that failed validation. The two drafts started at 04:19 ran on Sonnet 5.
   - So one project's content can move every writer's tier back for 7 days on a quiet deployment.
   - The copy was put back on Sonnet 5.5 with `allowTrackModelAgain` and the weekly check.
   - **Question for the owner:** which failures should count.

## Not covered

- Feedback was not run live; it is covered by a test at the frozen total.
- Every check failing at once could not be produced live; see the table.
- A 46-entry Brief was not tested live.
- The label refusal fix was not seen live.
