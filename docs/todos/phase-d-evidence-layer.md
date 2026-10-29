# Phase D, steps 3 and 4 together: one evidence layer (plan, 2026-10-28, revised after review)

Owner decision: entry "2026-10-28 (fourth)" in `docs/product-domain.md`. It replaces steps 3 and 4 of `docs/todos/phase-d-search-first.md`, which assumed every frozen file could be read whole. The F5 stress run showed that it cannot (`_bmad-output/test-artifacts/stress/2026-10-27`).

Plan reviews:
- **Round 1.** Claude Opus 5.5 (requested high; it reported running at low), "go with changes", 5 P1 findings against the first version, which had a draft refer to every file and choose per step from all of them. This version takes its simpler design: keep each draft's frozen pool, but fill it by relevance from every file.
- **Round 2.** Claude Opus 5.5 (requested high; it could not see its effort), "go with changes": step 1 can go ahead with the fixes now in its section; step 2 needed a joined row's text and positions, a cap on contributing files and a design for the start's reads, now in "Step 2 in detail"; the facts pass needed its frozen facts to be citable. Two points were the owner's to decide (questions 16 and 17).

## Goal

A project of any size, new or old: every step finds the evidence that matters to it in every file, with exact quotes, at today's time and price per step. The steps are the analysis, the Brief, the Seeds and each Line's facts check; chat already does this.

## What is true today

- **Files are cut into search pieces.**
  - Each project and company file is read on the server, cut into pieces along its structure (`documentSearchPieces`, about 600 tokens each) and labelled. Files from before Phase B4 wait for the owner's backfill pass.
  - A piece's positions and its fingerprint (`textHash`) are those of the file's stored text, Word marks included.
  - Keyword search runs within a project or a company (`searchProjectPieces`, `searchCompanyPieces` in `convex/lib/searchPieces.ts`); a query takes at most 16 terms.
- **A draft freezes a pool at its start** (`selectFrozenEvidence`), as text versions it keeps (`sourceTextVersions`, deduplicated; transcript rows point at their transcript). The pool is:
  - the transcripts, never left out by the total;
  - then up to 50 project files in upload order, each cut at 200,000 characters with Word marks removed;
  - then up to 12 company files, from the 12 newest with text and within 600,000 characters together (`eligibleCompanyFiles`);
  - until all frozen text reaches about 3 MiB (`FROZEN_TOTAL_BYTES`). Rows are capped at 123 (`MAX_FROZEN_SOURCE_ROWS`); the Seed loader fails above 128.

  The placeholder map that hides names is built from the same pool in the same transaction.
- **Each step reads the pool in order.**
  - The analysis: at most 12 files of about 10,000 tokens each (`DEFAULT_CONTEXT_BUDGET`, `buildAnalyzerContext`).
  - The Brief: 600,000 characters (`buildBriefUserMessage`).
  - Seeds: a prompt of at most 600,000 bytes (`buildSeedPrompt`). A Seed attempt reads every frozen row's whole text first (`loadFrozenSeedActionInput`).
  - The facts check: whole rows or none, within 48,000 bytes, so a file over 48,000 bytes is never checked against.

  Each budget has its own unit (characters or UTF-8 bytes); any chooser works in its step's unit.
- **Interview fact packs exist but are usually off.** Interviews have verified fact packs (`transcriptFacts`, Anthropic citations, every quote byte-checked) only when the facts setting is on (`transcriptFactsMode`, off by default). Files have none.
- **Each step records what it read** (`generationSourceUse`, at most 200 entries), and the Inputs band shows it.
- **Chat** lists every file and searches the pieces (D2).

## The design

### 1. The pool is filled by relevance from every file (option 3)

**What stays the same.** A draft still freezes one pool at its start, of the same size (about 3 MiB), as text versions it keeps. It is still made in the same transaction as the placeholder map, and it is still read by today's readers. Retries, prepared Briefs, Summary recovery, project copies and erasure keep working as they do.

**What changes: how the pool is filled.**
- Every file has a chance:
  - the interviews always go in, as today, and so do the settings document and writer's notes, whole (the Brief's wording rules depend on the settings document, found by its name or first line);
  - the rest of the pool is filled with the parts of the project's and the company's files that best match the draft's subject, not with whole files in upload order;
  - company files, the past context such as last year's report, get a guaranteed share, so a large project cannot push them out;
  - at most 50 project files and 12 company files contribute parts, picked by their best part's score, so the row caps hold.
- **The subject**, built from evidence that is always included:
  - the interviews (their fact packs when the setting is on, otherwise a deterministic term picker over the transcript or its digest);
  - the writer's storyline;
  - the settings document's glossary.

  Queries are capped in number, at 16 terms each, and how their results are merged is fixed.
- **How parts are chosen.** Every part of every file is scored by one pure scorer, with no search cut-off in between, so the same inputs give the same pool. Search ranking is not used: it keeps only its first hits in its own order, which can change as the index changes. The scorer is `chunkScore` over `foldForSearch`, moved to `shared/`, with a rarity weight computed over the candidates, so common project words do not tie everything and fall back to upload order. The parts are:
  - the stored pieces of each file whose fingerprint matches its current text, read page by page;
  - for a file without current pieces (still waiting, failed, or from before the backfill), and for the New project head start, the same cut done in memory, so a head start and its first run score the same parts.
- **How a row holds its parts, how many files join, and where it runs:** see "Step 2 in detail".

### 2. Each step chooses within the pool

- **One pure function per step.** Each step picks its parts from the pool with a pure function, in its own unit: the analysis, the Brief, Seeds and the facts check (by the Line's claims and quotes). Retries send the same bytes, and the prepared Brief's key holds by construction. The settings document and writer's notes stay in every step, as trust order keeps them today.
- **Seeds share one choice.** Seeds use one choice per Brief version, in the shared cached block, never one per role, so Seed requests keep their cache and their price.
- **Name-safe edges.** Every excerpt's start and end go through one shared, tested cut, so no excerpt starts or ends inside a word and no name fragment is sent unmasked (today `cutToBudget` protects only the end).
- **Quotes are checked against what was sent.** Every quote checker (the Brief's, the Seeds', the facts check, citations) searches only the ranges its step sent, so a quote cannot bind to text the step never saw, such as another speaker's turn. Seed guidance in offsets mode shows each excerpt's start, or files use excerpt-only citations.
- **Every excerpt is traceable.** Each one keeps its row, text fingerprint, start and end, and the record of what each step read gains the ranges: `generationSourceUse` gets an optional range field, and a step that sends two parts of one row records both (a schema widen, so step 1 is not schema-free).

### 3. Every file's facts, read once (option 4)

- **What is read.** One pass per file text version, in the background, reads the file with Word marks removed and names hidden (as labels and interview facts do, company files with the company's names too). It sends plain-text documents, whose citations point at sentences, not whole blocks, in windows of about 30,000 tokens; a dense spreadsheet is split until its answer fits. Positions never come from the model: names are restored, then the checker finds each quote in the marks-removed text, and a fact is kept only when every quote is found. The structured mode (OpenRouter) cites line numbers, as interviews cite turns.
- **Where facts are stored.** Per file, text fingerprint and facts version (`fileFacts`, with a run row like `transcriptFactRuns`), with their own search index within the project or the company.
- **When a file is read.** On upload or change, and again when the facts version moves. Old files are read by a one-time owner pass, after the Word Markdown backfill so text changes do not re-run it.
- **Running safely.**
  - The pass runs at low concurrency and backs off on rate limits.
  - It pauses while drafts run, since it shares the account's limits.
  - Whether it counts against a writer's run limits, and whether its failures count in the hourly tier check, are the owner's to decide (questions 16 and 17). Recommended: charged to the system, and left out of the tier check, so one project's content cannot move a tier.
  - OpenRouter has no citations, so there it uses the structured mode.
- **Cost.** Measured on the largest real project first, and compared on the release fixtures. A rough estimate for the 100-file stress project (41 million characters, about 350 windows): tens of dollars on a Haiku-class model, more on Sonnet. The owner sees the measured number, and sets the limit, before the pass is turned on for every file.
- **How drafts use the facts.** A draft freezes, beside its pool, the facts of the files it may use, as a new frozen source kind whose text joins the placeholder map. A fact's quoted sentences are frozen with it as parts of its file's row, so every frozen fact can be cited (rule 2). Facts are not small (likely 1 to 2 MB on the 100-file project), so they come out of the pool's 3 MiB, ahead of plain parts, ranked by the same scorer.

### 4. What else has to follow

- **Summary recovery** copies the choices and ranges, through its `sourceIdMap`.
- **The prepared Brief.** Its key hashes the pool's subject and the chooser's version, and `BRIEF_DERIVATION_VERSION` moves (prepared Briefs are made again on deploy day). The preparation freezes in a scheduled mutation, so it gets the same action step as a draft's start (step 2).
- **Seed checks** read and search only the ranges their Batch was sent, not every row.
- **Rules that already apply to frozen rows:**
  - `withCurrentCompanyFiles` applies to chosen company parts;
  - `sweepCompanyTextVersions` counts them;
  - `previousYearMaterial` reads the pool.
- **`fileFacts` follow the company.** They are registered with the project's erasure, and the company's ones follow company merges, removals and erasure.
- **The Inputs band** shows, per file, what the pool holds and what each step read, for any number of files.

## Step 1, Seeds in detail (2026-10-28, revised after review)

Built in step 1: the shared chooser (`shared/evidenceChoice.ts`), the facts check (entry "(fifth)"), the Brief (entry "(sixth)"), Seeds (entry "(seventh)"), the analysis (entry "(eighth)") and the record's parts (entry "(tenth)"). The live check found and fixed a reused-Brief fault (entry "(ninth)").

Design review: Claude Opus 5.5 (requested high; it reported running at low), "go with changes". The changes are in below.

- **When it applies.** Only when the frozen sources pass the Seed source allowance (`buildSeedTrustedContext`, `convex/ai/trustedContext.ts`). Below it, every source is sent whole as today, byte for byte, so the cached block of small drafts is unchanged.
- **One choice per Brief version, in the shared cached block.**
  - The subject is the Brief's own text (Storyline, each entry's text and quote, the glossary terms).
  - The allowance is already computed only from generation-stable inputs. Every path (first Batch, retry, Regenerate, Feedback, prefetch) goes through one builder, so every role sends the same shared block and the cache holds.
- **What is sent.**
  - The interviews (or their fact packs or digests), the writer's Storyline, the settings document and writer's notes an internal user uploaded go in whole (cut only where the allowance runs out, as today). The Seed sources gain `uploaderRole` for this, from the loader through the claim.
  - Every other source sends the parts that best match.
  - Parts are chosen on the raw text, so ranges are raw positions, and charged by the UTF-8 bytes of the text as sent (marker-neutralized), with every block's label, marker lines, notice and join counted before choosing. A randomized test checks the assembled prompt always fits.
  - A source sent in parts shows its parts joined by "[...]" lines and a notice. No position lines: offsets were never trusted, and relocation finds the excerpt.
  - A source with nothing sent is named in the omitted-sources block, as today.
  - The new words sit only in the parts' block, never in the guidance, so small drafts are unchanged.
- **Quotes found only in what was sent.**
  - The sent view of a row is its chosen ranges plus every span a Brief entry cites on it, since the Seed prompt allows citing a Brief entry's quote. Rows the chooser never weighed (a transcript read through its digest or fact pack, the pack and digest rows) are searched as today.
  - The action passes each source's sent ranges to `completeAttempt` and `quoteRepairContext` as an optional, shape-checked argument. A missing argument (an action started before deploy) means no mask, as today.
  - `validateBatch` checks citations against rows with everything outside the sent view blanked (`maskOutside`, positions kept), in the action and in `completeAttempt`.
  - The speaker check keeps each row's real text and only limits its search for another place of the same words to the sent view.
  - Fact mode: documents get the same sent view; fact spans are unchanged.
- **Inside a mutation.** `dispatchSeedAttempt` (also run from a writer's Approve) checks the prompt's size without choosing parts, since nothing it can refuse depends on which parts are chosen.
- **The record.** A Batch's sent bytes are the sum of its parts', so "in part" follows, and the record keeps the parts themselves (entry "(tenth)").
- **Tests.**
  - Small drafts are byte for byte unchanged.
  - Over the allowance: a fact in a late file is sent.
  - Two roles of one draft send the same shared block.
  - A citation found only in unsent text is refused, in the action and in `completeAttempt`.
  - A citation of a Brief entry's quote outside the parts is accepted.
  - A dash run before a chosen part keeps the positions right.
  - The prompt always fits.
- **Prompt version.** The Seed prompt version moves, with its pinned checks.

## Step 2 in detail

- **A row's text.** A contributing file's row holds its chosen parts joined by a fixed separator, Word marks removed, and quote positions count within the row, not the file. A small parts map per row (row start and end, stored-text start and end, `textHash`) gives source links and the Inputs band their place in the file. One shared helper refuses a quote match that crosses a separator, and every checker uses it: the Brief's, the Seeds' (`seedContract.ts`), citations, reports, the facts check and `verifiedSourceMapping`. `truncated` and `originalLength` keep their meaning: the row holds part of a longer file.
- **Settings-document detection** still reads a whole file (it always goes in whole).
- **Where it runs.** An action, before the start's transaction:
  - it scores every part, reads the chosen parts' text and cuts them on name-safe edges;
  - the start's transaction gets the part texts and each file's fingerprint, checks only the stored fingerprints (nothing changed in between), freezes the rows and builds the placeholder map over the texts it was given;
  - the Brief prepared ahead and the New project head start use the same action step;
  - reads are measured on the 100-file project, as is the time the start gains.
- **Before it works on an old project,** two owner passes must have run there: the text move (unmoved rows hold whole text, which would pass the read limit) and the pieces backfill.
- **Company files.**
  - Relevance looks at every company file with text, not only the 12 newest. The start dialog lists them all for unticking, and at most 12 contribute.
  - The guaranteed share is set in step 2's design review (proposed: up to a fifth of what the interviews leave).
  - Entry "(third)"'s dialog note ("Read last, newest first, while there is room") and the meaning of `companyFilesLeftOut` change with it, in step 2's decision entry.
- **Interviews can still fill the pool.** Up to 20 transcripts are never left out, as today; a project whose interviews alone pass 3 MiB keeps today's behaviour.
- **Stored text.** Joined-part versions are reused only when the same parts are chosen, so each draft with a different subject may keep about 3 MiB more for the project's life. Measured, and counted by `sweepCompanyTextVersions`.

## Order of work

1. **Choose within the pool by relevance** (the earlier plan's step 3), with one pure scorer, name-safe edges, quotes checked against what was sent, and ranges in the record of reads (a schema widen). Same pool, same cost. Useful on its own: today the Brief and Seeds read only the first few frozen files, and the facts check never sees a file over 48,000 bytes.
   - Offline recall test inside the pool (a fact sharing only rare words); retry byte equality; prepared Brief still adopted.
   - The time to cut and score 3 MiB inside a mutation, measured, since the Brief's key is computed in mutations.
2. **Fill the pool by relevance from every file.** Includes the measurement of where it runs, files without pieces, the head start, the one coordinate system, and rows within caps.
   - Offline recall test: a fact only in file 95 of 100 reaches every step.
   - Live: the 100-file stress project end to end, and the release suite compared with today.
3. **Option 4, behind a switch:** the facts pass, its search index and the one-time pass for old files. Cost measured and brought to the owner; turned on only with the owner's OK and limit.
4. **Pool and steps use facts.** The recall test and the release suite again.
5. **Only if the recall test shows misses:** choosing per step from every file outside the pool, then vector search (needs the Voyage card, question 6), then tools for drafting.

Each piece is designed, reviewed, built, tested offline, reviewed again and checked live, with a decision entry where it changes what writers see.

## How we know it works

- **Recall:** facts placed deep in large projects reach every step. Misses are counted before and after each step of work.
- **Exactness:**
  - quotes carry nonzero offsets;
  - repeated quotes, Unicode and Word marks are handled;
  - a part edge falls next to an escape;
  - every quote is checked against the stored text.
- **Same bytes:** a retry and a prepared Brief see the same pool and the same choice.
- **Scale:**
  - 100 files and a 3-hour interview, live: the draft starts and every step runs;
  - the start's added time, measured;
  - the cost per draft, the same as today.
- **Quality:** the release suite's checks and the owner's verdicts, compared with today.

## Known risks

- **Keyword search finds words, not meaning.** Facts from every file and the recall test cover most of it; vector search is the next step if they do not.
- **The pool is still 3 MiB.** On a very large project, a relevant part can still fall outside it. The facts of every file cover it, and step 5 exists for what remains.
- **Choosing at the start adds time.** Measured on the 100-file project.
- **Interviews that alone pass 3 MiB** still leave no room for files, as today.
