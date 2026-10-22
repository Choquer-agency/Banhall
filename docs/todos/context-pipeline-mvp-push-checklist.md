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
- [ ] Release suite, all six fixtures. Each one:
  - signs off;
  - shows "The model Self-check ran on every Section" as passing;
  - has no row reading "did not complete".
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
