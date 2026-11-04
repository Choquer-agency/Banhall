# B1, second part: drafts record the text versions they used, not their own copies

Plan, 2026-10-27, revised after two rounds of review (round 1: Claude Opus 5.5, requested high, it reported low, and gpt-6-astra, medium; round 2: gpt-6-astra, medium; each "go with changes"). Part 4 of the first 2026-10-26 entry in `docs/product-domain.md`:

> each file's text version is stored once and never changed, and a draft records which versions and ranges it used with their fingerprints, instead of its own full copy. A version a draft uses is kept even after the file is removed from the project, until the project (or, for company files, the company file and every draft using it) is erased.
>
> Drafts made before the change keep their own copies. Nothing is converted until a pass proves byte for byte that a draft's copy matches the stored version.

The first part (2026-10-26, eleventh entry) kept a file's earlier text as a version when the server reads it again. This part changes what each draft stores. A dated entry in `docs/product-domain.md` records it when it lands.

## Today

- Each draft freezes one `generationSources` row per transcript, project file and company file, each with its own full copy of the text it read (`content`, up to 500,000 characters for a transcript and 200,000 for a file), plus `contentHash`, `truncated` and `originalLength` (the whole file's or transcript's length, not the length read). Briefs prepared ahead freeze `briefPreparationSources` rows the same way.
- A project with 20 files and 10 drafts holds 200 copies of mostly the same text. Rows near the 1 MiB document limit are a known risk.
- No shared helper reads a row's text: about 25 places read `row.content` (the code map of 2026-10-27, widened by the reviews).
- Digests, fact packs and the writer's Storyline are made for one draft and exist only on its rows.

## What changes

1. **A store of text versions, written once.**
   - `sourceTextVersions`: `textHash`, `textLength`, `textBytes` (UTF-8), `createdAt`, and its owner: `projectId` for a project file's text, or `companyFileId` (and `clientId`) for a company file's text. Indexes `by_projectId_and_textHash` and `by_companyFileId_and_textHash`.
   - `sourceTextVersionPieces`: `versionId`, `start`, `text`, and the same owner fields (so erasure deletes them by index); 32,000-character pieces cut as `documentTextPieceEnds` cuts them, with the 900,000-byte check. Index `by_versionId_and_start`, `by_projectId`, `by_companyFileId`.
   - The same text frozen by ten drafts of a project is stored once. A company file's text is stored once per file, so a company merge (which moves the file) never splits it.
2. **What a version holds: the text drafts read, whole.** A version is the exact text a draft reads, after the cut to its length limit and, for a Word file, after its Markdown marks are taken out (`quotableWordText`). That is the text quotes are checked against, so it is what must never change. Its `textHash` is the row's `contentHash`, as today. The range a draft used is always the whole version. A company file can be cut at different points in different drafts (the limit depends on the other files), and each cut is its own version: recorded, not hidden.
3. **New draft rows refer to their text.**
   - Project files and company files: `generationSources.textVersionId`, a new `textLength` (the characters read), and no `content`.
   - Transcripts: no store. A transcript row never changes and is only archived, never deleted, until its project is erased, so the draft row refers to it (`transcriptId`, already there) with `textLength` (the characters read; `originalLength` stays the whole transcript's length, as today). Its text is the transcript's text up to `textLength`.
   - Digests, fact packs and the Storyline keep their text on the row: they are made for one draft, and nothing would be shared.
   - **Brief preparations keep their own copies** (an exception to "the same"): a preparation for an intake draft has no project yet and its intake text can change, and preparation text is purged 1 to 7 days after it ends. Adopting a prepared Brief maps its rows to the draft's rows by `contentHash` and the resolved text.
4. **One way to read a row's text.**
   - `sourceRowText(ctx, row)` in `convex/lib/sourceText.ts`: `row.content` when the row has it (every row written before this change), else the version's pieces, or the transcript's text up to `textLength`.
   - Checked on write, not on every read: the writer hashes the text once and stores the version only if its hash matches; a reader compares the version's `textHash` and `textLength` (or, for a transcript, `textLength` and, when the transcript was not cut, its `contentHash`) with the row, and throws a named error on any difference. Full re-hashing runs in tests and in the later conversion pass.
   - `sourceRowSlice(ctx, row, start, end)` reads only the pieces a quote needs (report saves, citation checks).
   - Every reader resolves the text where it reads the row: the queries that hand rows to actions, and the mutations that read rows themselves (Brief persistence and adoption, where `generationBriefKey` runs, Seed completion, report provenance, reading facts). Each returns rows **in exactly the old shape** (`content` filled in, the new fields left out; `SourceRowWithText`, a type apart from the stored row), so the Brief reuse hash (`briefInputsHash`) and the Brief key see the same rows as before: no Brief stops being reused. Tests pin both hashes equal for an old row and its new-style equivalent, through the real mutations (adoption and Brief persistence) on content-free rows, and quote checks the same way (report provenance, Seed completion).
5. **Kept as long as a draft uses it.**
   - A project version is deleted only with its project (`PROJECT_SCOPED_TABLES`: the versions and their pieces, with indexed, bounded deletion). Removing a file never deletes a version a draft froze; the file's own earlier-text versions (`projectDocumentTextVersions`) keep their rules.
   - A company version goes when its company file has been removed and no draft row refers to it. A sweep runs when a company file is removed and when a project is erased (for the company versions that project's rows used): in one transaction it checks `generationSources.by_textVersionId` for any reference and deletes the version row only when there is none; its pieces are deleted after, page by page. Reservation looks a version up by file and hash and writes a new one when it finds none, so a reservation racing the sweep stores the text again instead of referring to a deleted version. The page-by-page piece cleanup deletes by the deleted version's id only, so it never touches the pieces of a replacement version (a test runs the interleaving to the end of the cleanup).
6. **Old drafts keep their copies.** No row is converted by this change. A later one-off pass, owner-run, dev first, may convert a row only after it proves byte for byte that the row's copy equals the stored text. That pass is not part of this step.

## Readers to switch (the typecheck lists them once `content` is optional)

- Drafting input: `lib/generations/inputs.ts` `getGenerationInput`.
- Condensing and fact packs: `transcriptDigests.ts` `getCondenseInputs`, `freezeDigestSource`, `freezeFactsSource`, `getFactInputs`.
- Settings documents: `writerProfiles.ts` `getSettingsDocumentCandidate`, `getGenerationWriterSettings`; `lib/briefInputsHash.ts` `briefSettingsSource`.
- The Brief: `lib/generations/brief.ts` `readBriefSourceRows`, `getCitationSpeakers`, `persistDerivedBrief`, `briefWithoutExcludedQuotes`; `briefAdoption.ts` `adoptPreparedBrief` and `verifiedSourceMapping`; `lib/briefPreparationKey.ts` `speakerEvidenceView` and `briefKeyManifest`; `readingFacts.ts` `copyBriefToReadingFacts`.
- Speakers: `lib/citationSpeakers.ts` `loadReady` (`startsWith` over the transcript) and the quote relocation (`otherOccurrences`); `lib/intakeDrafts.ts` project speaker reader.
- Quotes: `reports.ts` `createProvenance`; `seedRuns.ts` `completeAttempt`, the prefetch quote check and `quoteRepairContext`.
- Seeds: `seedSnapshotLoader.ts` `loadFrozenSeedActionInput`.
- Summary Self-check: `seedStage.ts` `loadFactsSourceDocuments`.
- The Summary recovery copy (`reservation.ts` `retryFromSummaryHandler`): copies `content` for an old row and the reference (`textVersionId`, `textLength`) for a new one, including a recovery of a recovery.
- Brief preparations (`briefPreparations.ts` `getPreparationRun`, `completePreparation`, `getPreparationCitationSpeakers`) keep reading their own copies; they change only where they meet draft rows (adoption).
- Readers of labels only (`getContextInclusion`, `getBrief`, `getSourceAttribution`, chat's open questions) keep reading the row and get cheaper.

## Limits

- **Reservation** (one mutation). Today it writes every copy: at most 50 project files of 200,000 characters each, the transcripts (cut to 500,000 characters each, 2,000,000 in all), and company files only while everything frozen stays under 5 MiB. The 5 MiB cap covers company files only, so a project whose own 50 files are all at the limit already passes a transaction's 16 MiB today (round 2). After this change: it reads each file's text as today (to hash it), looks each text up by hash (one index read each) and writes pieces only for text not stored yet; a transcript writes nothing. It never reads stored pieces. A later draft of the same project writes almost nothing.
  - Explicit accounting: before writing, reservation adds up the bytes it will write (new pieces and rows) and the bytes it read; over 12 MiB in all, it refuses by name ("This draft's files are too large to freeze at once; leave some files out and start again") instead of failing on the limit, and writes nothing. Today the same project fails on the limit with no message.
  - As built (after the review of 2026-10-27): reads and writes are checked apart, since Convex limits each to 16 MiB on its own; one 12 MiB total would refuse the largest supported case. Before each read and each stored text, the transaction's real usage is checked, and the draft is refused once what remains could not take one more 1 MiB document and 256 KiB; where the runtime cannot report it, reads and writes are counted and refused past 14 MiB.
  - Tests with transaction limits on: the largest supported case (50 files of 200,000 one-byte characters and 2,000,000 characters of transcripts) reserves; 50 files of four-byte characters is refused by name; a second draft of the same project writes no pieces.
- **Readers that load every row's text** (`loadFrozenSeedActionInput` within 8 MiB, `getGenerationInput`, adoption, `loadFactsSourceDocuments`): the same bytes as today plus small piece overhead, counted in their budgets; `textBytes` lets a reader skip a row that cannot fit without reading it. Evidence is never silently reduced to fit.
- **The sweep**: one version per transaction, its pieces in bounded pages that reschedule.

## Things that must not change

- Every quote check reads the same text it reads today: same bytes, same offsets.
- Requests to the models are byte for byte as before for the same inputs (tests pin a drafting request, a Brief request and a Seed request).
- The Brief reuse hash and the Brief key, for the same inputs (above).

## Tests

- The store: one version for the same text frozen twice, including two reservations at once; pieces cut and joined back byte for byte, a 4-byte character never split; a project version kept after its file is removed and deleted with its project, pieces included; a company version kept after its file is removed while a draft uses it, and swept (version and pieces) once the last project using it is erased; identical text in two company files stored per file; a company merge reusing the file's versions; a reservation racing the sweep storing the text again.
- `sourceRowText` and `sourceRowSlice`: an old row; a file row by version; a transcript row by prefix, cut and not cut, after the transcript is archived; an oversized historical transcript; each mismatch refused by name.
- Each switched reader: the same result on a new-style row as on an old-style row with the same text (table-driven), including the speaker check on a cut transcript, adoption of an old preparation row onto a new draft row, and the Brief reuse hash and key equal across both shapes.
- The Summary recovery copy of old rows, new rows, and a recovery of a recovery.
- A full ordered draft on new-style rows (the `generationSeedSignoff` chain) with the same requests as on old-style rows.
- Storage: ten drafts of a project with unchanged files store each file's text once.
- Erasure: no orphan pieces and no dangling references; project erasure leaves other projects' and company pieces that are still used.

## Order of work

1. Make `content` optional, add `textLength` and `textVersionId` (optional), the store tables, `sourceRowText` and `sourceRowSlice`, and switch every reader the typecheck names. No writer changes yet, so every row is still old and nothing behaves differently. Done 2026-10-27 (with a test that four readers return the same for old-style and hand-made new-style rows).
2. Erasure and the company sweep. Done 2026-10-27.
3. Write new rows (reservation, the recovery copy), with the old-shape return from every query that hands rows to actions. Done 2026-10-27.
4. The decision entry; live check on the live copy: a draft of a project with Word, PDF and company files; the Brief, Seeds, sign-off, the report, and a second draft that stores no new text. Done 2026-10-27 (the decision entry "2026-10-27 (sixth)"; live results in `docs/todos/context-pipeline-mvp-push.md`), then the review fixes.

Each step is its own commit with the full gate; step 3 lands only after steps 1 and 2.

## Owner questions

None expected: this is the approved part 4. Recorded exceptions: Brief preparations keep their own copies; a company file cut at different points stores each cut.
