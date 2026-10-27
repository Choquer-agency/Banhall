# Phase D: search-first evidence (plan, 2026-10-26, revised after review)

Part of `docs/todos/context-pipeline-mvp-push.md` (D1, D2 and P0 item 5), under part 2 of the first "2026-10-26" entry in `docs/product-domain.md`: "Drafting and chat get a short list of every file (name, kind, labels, size) plus tools to search the pieces and read exact ranges, instead of the first files in upload order", "Source links stay exact" and "the Inputs band names what each draft used".

Plan review, round 1: gpt-6-astra (medium) and Claude Opus 5.5 (requested high; it reported running at low). Both said "go after changes". This version takes their changes.

## What is true today

- **Section drafting never reads files.** It gets the analysis, the Brief, the plan and Brain examples. File text reaches four steps only:
  - the analyzer (at most 12 files, about 40,000 characters each, in trust order);
  - the Brief (frozen order until 600,000 characters);
  - Seeds (frozen order until about 530,000 bytes);
  - the facts check (whole files or none, within 48,000 bytes).
- **What a draft freezes:** the first 50 project files and up to 12 company files, each cut at 200,000 characters.
- **Chat loads the first 12 live files with text** (20,000 characters each) into every message. Its search re-reads up to 16 whole files. Search pieces exist for live files, but only company files use them.
- **Only the analyzer records what it used.**
- **Search pieces point into each file's live stored text.** A draft's frozen rows are cut and have Word marks taken out.
- **Chat still reads every file row each message.** Until the text-move migration has run, those rows still hold full text (checklist, "migration not yet run"). Failure 1 is fixed only once that migration has run.

## Step 1 (D2): chat reads files by search when they do not all fit

- **Small projects stay as today, but whole.** When every readable file fits the head's file allowance whole, they all go in: the settings document first, then trust order. This keeps the cheap cached head for small projects. Only when they do not all fit does the turn get the files list (name, category, trust, size, and the label title and summary when the labels are current) plus the tools, with no file text. Never "the first files in upload order".
- **Unchanged:** the settings document, pinned files (at most 5) and the reading-tools-off path (today's capped path, byte for byte).
- **The prompt wording changes.** The chat guidance describes file blocks in the head, so its wording and pins move.
- **`searchDocuments` uses search pieces for files whose pieces are current.**
  - A file counts as current only when its pieces' version is the cutter's current version and their text hash matches the file's text.
  - Every other file with text is searched the old way: a file waiting for pieces, one whose pieces failed four times, or one from before the backfill.
  - When that fallback runs out of budget, the result says the search was not complete.
- **Each excerpt keeps its file, text hash, start and end.**
  - It is cut around the best match, not the piece's first 1,500 characters.
  - It is ranked with the same scorer as transcripts and fallback files.
  - It keeps the file's category and uploader role, so trust labels stay.
  - It is placed by the parts `readDocument` opens ("F3 part 2", or "parts 2 to 3" across a boundary), plus its page when known.
  - A part is a way to open the text, not a saved source link (chat saves none today).
- **Before shipping:** the pieces backfill (`markSearchPiecesDue`) and the text-move passes run, dev first. Both are already owner-only steps.
- **Tests:**
  - a turn with many large files carries no file text, and one whose files fit carries them whole;
  - a hit's part opens the excerpt's text, including one across a part boundary;
  - a file whose pieces are stale, failed or missing is still found;
  - trust labels;
  - pinned files, the settings document and the tools-off path unchanged.
- **Live:** a small project (whole) and a large one (list). Ask about something only one late file says; the chat finds and opens it.

## Step 2 (P0 item 5, with the old step 4): every step records what it read

- **An append-only table, `generationSourceUse`,** with one row per source per step run: generation, project, step, batch or attempt, the frozen row, the ranges sent in the row's own offsets, and read whole, cut, or left out. It is registered with the project's erasure (`PROJECT_SCOPED_TABLES`). Rows are written once and never patched, so Seed Batches running at once do not conflict.
- **What each step writes:**
  - The Brief and Seeds write what they already compute and today throw away (`buildBriefUserMessage`, `buildSeedPrompt`).
  - The facts check writes its whole-or-none choice.
  - The analyzer keeps its own record and writes the same rows.
- **An adopted or reused Brief** records what its own run read, matched by content hash, not recomputed against the new draft's rows.
- **The Inputs band shows, per file,** which steps read it and how much, names the files no step read, and keeps its handling of history, condensed transcripts and company permissions.
- No request changes.

## Step 3 (D1 interim): drafting picks file text by relevance, not upload order

**Needs the owner first.** This replaces the approved "tools to search the pieces and read exact ranges" for drafting with one request per step. The amendment goes in `docs/product-domain.md` with the owner's answer. The question for the owner, in two sentences: "Each drafting step stays one request with the same time and price, and file text is chosen by relevance instead of upload order. Tools for drafting are tried later in a measured test only if this misses evidence."

- **In memory, from the draft's own frozen rows.** Inside each request builder, frozen rows are cut with the shared cutter (`splitSearchPieces`) and scored with a pure scorer (`chunkScore` over `foldForSearch`), with ties broken by row order and offset.
  - No pieces are stored.
  - The selection is a pure function of the rows, so prepared Briefs keep matching (`briefPreparationKey` hashes the Brief message), and a retry sends the same bytes.
  - The CPU time of cutting 5 MiB is measured inside a mutation, since the key is computed there.
- **One selection per draft for Seeds,** in the shared cached block, never per role. Its subject comes from the Brief (glossary terms, claim quotes, Confidence Map entries) and every role's objective. Anything for one role only goes after the cache boundary. A test shows two roles of one draft send the same shared block.
- **Search subjects come from evidence that is always included:**
  - transcripts or their fact packs, the writer's storyline, and the settings document's glossary;
  - through a deterministic term picker;
  - for the analyzer and the Brief alike, since the Brief writes the storyline itself.

  Whatever feeds a selection goes into the Brief's preparation key and inputs hash, and `BRIEF_DERIVATION_VERSION` moves.
- **Trust order stays.** Selection runs within trust tiers, and company files take at most a fixed share.
- **Citations stay exact.**
  - Every excerpt carries its row, text hash and its start and end in the row.
  - The prompt shows those offsets, so a quote's offsets are the row's.
  - Separate ranges stay separate, so no quote spans a gap.
  - Every excerpt edge goes through the same name-safe cut as the budget cuts, so no name fragment reaches the model unmasked.
- **The facts check joins.** It picks by the Line's claims and quotes instead of whole files or none.
- **The files list in drafting** marks each file as read whole, read in excerpts, or not read.
- **Tests:**
  - an offline recall test: a fact only in file 25 of 30 reaches the analyzer, the Brief, Seeds and the facts check;
  - nonzero offsets, repeated quotes, Unicode and Word marks;
  - retry byte equality;
  - preparation adoption still working.
- **Rollout note.** The prompt hash moves once, so prepared and reusable Briefs for drafts with files are made again on deploy day.

## Step 4 (D1 complete): fact-finding reads every piece

- A background facts pass reads every frozen file in pieces, the way transcript facts read windows, and keeps facts with exact quotes. Steps that cannot fit a file read its facts.
- It gets its own decision entry first, with cost per file and time measured on the largest real project.
- D1 is not ticked until this lands. Until then, "nothing is missed because it was not searched for" is a known limit.
- **Every file, not every frozen range.** Files past the 50th, or past 200,000 characters, are not frozen today. Reading them is B1's shared text versions (a draft records versions and ranges, not copies), so step 4 follows B1.

## Tools for drafting (later, measured)

Only if steps 3 and 4 miss evidence in tests. It would need tool messages in `GenerationClient`, an automatic tool choice, OpenRouter conversion and name masking of tool results. The A/B covers quality, time and cost.

## What this plan does not do

- **No vectors.** Keyword search first, vectors only if tests show misses (plan item 7).
- **No model reads text an earlier step did not freeze.**
