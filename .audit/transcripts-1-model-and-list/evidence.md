# Evidence · transcripts-1-model-and-list
commit: 3d60b9f (code + docs of the findings-1 fix; this file lands in the commit on top of it)   branch: factory/transcripts-1-model-and-list   baseline: 470557d8eab88847b54edfe31bda04132a9a7552   date: 2026-09-03T21:39:40Z   kind: feature
(implementation commits: f8c218d schema, 32218f3 helper + queries, 0c7998d amendment, 7182d7b audit trail, 3d60b9f findings-1 fix, and this evidence commit)

## Coverage

| AC | Proof | Ladder |
|---|---|---|
| AC1 ordered metadata, no content; legacy rows by createdAt labelled "Interview transcript" | `convex/transcripts.test.ts` :: "returns metadata in position order, without content (AC1)", "orders legacy rows by createdAt and labels them Interview transcript (AC1)", "sorts a positioned row ahead of legacy rows regardless of createdAt (AC1)" ✓ (ran in `npx vitest run convex/transcripts.test.ts`) | 4 |
| AC2 empty legacy row not returned | `convex/transcripts.test.ts` :: "drops empty and whitespace-only rows (AC2)", "skips empty legacy placeholder rows (AC2, AC6)" ✓ | 4 |
| AC3 no access → `[]` / `null`; with access `{ _id, label, content }` | `convex/transcripts.test.ts` :: "returns [] for callers without internal access (AC3)", "returns the labelled body for a caller with access (AC3)", "defaults the label for a legacy row (AC3)", "returns null for callers without internal access (AC3)", "returns null, never a throw, for a transcript of an unreadable project (edge case)" ✓ (unauthenticated, roleless and anonymous callers each asserted) | 4 |
| AC4 additive schema widen, tsc green, nothing else changed | `npx tsc -p convex/tsconfig.json --noEmit` exit 0; `git show --stat f8c218d` = `convex/schema.ts` only; `npm test` 1132 passed (existing suites still insert `generations` with a required `transcriptId`) | 4 |
| AC5 dated domain amendment | `rg -n "Multiple transcripts per project" docs/product-domain.md` → `docs/product-domain.md:1485`; every code pointer in the amendment re-checked by `sed -n` after the findings-1 reword (see `## Findings-1 fix`) | 4 |
| AC6 `getTranscript` returns the helper's first element | `convex/transcripts.test.ts` :: "returns the first transcript of the ordered set (AC6)", "returns null with no transcripts and without access (AC3, AC6)" ✓; `convex/transcripts.ts:26-31` | 4 |

Edge cases from the ticket also covered: equal `position` tie-broken by `createdAt` ("breaks a position tie by createdAt"), more than 20 rows capped ("returns at most MAX_TRANSCRIPTS_PER_PROJECT rows"), whitespace-only content dropped, cross-project id → `null`. The pure helpers `transcripts-2` will consume are unit-tested now: `buildTranscriptPromptText` (single part byte-identical, N parts headered, empty) and `findQuoteInParts` (offset, first-part-wins, misses).

## Gates

| command | exit | note |
|---|---|---|
| `bash scripts/loop-verify.sh` | 0 | full gate: tsc + `npm run check` + `npm test` |
| `npx tsc -p convex/tsconfig.json --noEmit` | 0 | no output |
| `npm run check` | 0 | 5867 files, 0 errors, 0 warnings |
| `npm test` | 0 | 116 files, 1132 tests passed |
| `npx vitest run convex/transcripts.test.ts` (ticket `verify:`) | 0 | 20 tests passed |
| 9 `done_when:` predicates | 0 each | see below |

Every row re-run at `3d60b9f` after the findings-1 edits; same exits, tails below.

`done_when` run by hand, each exit 0: `test -f convex/lib/transcripts.ts`, `test -f convex/transcripts.test.ts`, `rg -q 'transcriptDigests: defineTable' convex/schema.ts`, `rg -q 'by_transcriptId_and_sourceContentHash_and_condenseVersion' convex/schema.ts`, `rg -q 'export const listTranscripts' convex/transcripts.ts`, `rg -q 'export const getTranscriptContent' convex/transcripts.ts`, `rg -q 'transcript_digest' convex/schema.ts`, `rg -q 'Multiple transcripts per project' docs/product-domain.md`, `npx vitest run convex/transcripts.test.ts`.

## Output tails

Both re-run at `3d60b9f`, after the findings-1 edits.

### bash scripts/loop-verify.sh  (exit 0, /tmp/gate-fix.log)
```
> banhall-app@0.1.0 check
> svelte-kit sync && svelte-check --tsconfig ./tsconfig.json

1788471501626 START "/Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/transcripts-1-model-and-list"
1788471501658 COMPLETED 5867 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

> banhall-app@0.1.0 test
> vitest run

 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/transcripts-1-model-and-list

 Test Files  116 passed (116)
      Tests  1132 passed (1132)
   Start at  14:38:22
   Duration  8.99s (transform 17.40s, setup 0ms, import 20.83s, tests 18.23s, environment 6.64s)
```
(`npx tsc -p convex/tsconfig.json --noEmit` is the script's first step and printed nothing; run again standalone, exit 0.)

### npx vitest run convex/transcripts.test.ts  (exit 0)
```
 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/transcripts-1-model-and-list

 Test Files  1 passed (1)
      Tests  20 passed (20)
   Start at  14:38:38
   Duration  486ms (transform 151ms, setup 0ms, import 182ms, tests 59ms, environment 66ms)
```

### 8 shell `done_when` predicates  (exit 0 each)
```
test -f convex/lib/transcripts.ts => exit 0
test -f convex/transcripts.test.ts => exit 0
rg -q 'transcriptDigests: defineTable' convex/schema.ts => exit 0
rg -q 'by_transcriptId_and_sourceContentHash_and_condenseVersion' convex/schema.ts => exit 0
rg -q 'export const listTranscripts' convex/transcripts.ts => exit 0
rg -q 'export const getTranscriptContent' convex/transcripts.ts => exit 0
rg -q 'transcript_digest' convex/schema.ts => exit 0
rg -q 'Multiple transcripts per project' docs/product-domain.md => exit 0
```

## Findings-1 fix
`.audit/transcripts-1-model-and-list/findings-1.md`, three `medium/act`. Each
claim was checked against the tree before acting; all three held.

**1 — `docs/product-domain.md:1508` recorded an invariant that does not hold yet.**
`rg -n 'query("transcripts")' convex/` at `7182d7b` returns nine hits, of which
six are non-test project reads, not the two the bullet named:

```
convex/lib/transcripts.ts:71      the helper itself
convex/projects.ts:1056           deleteProject cascade      (permanent exception)
convex/debugTools.ts:201          admin orphan scan          (permanent exception)
convex/pdReviews.ts:257           .first()  legacy reader
convex/reviewFromProject.ts:88    .first()  legacy reader
convex/projects.ts:558            .first()  legacy reader (getScienceCodeSuggestionContext)
convex/debugTools.ts:46           .first()  legacy reader
```

Bullet reworded at `docs/product-domain.md:1504-1516`: the two permanent
exceptions stay, and the four `.first()` readers are named as legacy with
`transcripts-4` as the migration. That the migration is real is checked, not
assumed — `.factory/tickets/transcripts-4-copies-and-readers.md:20-22`,
`:33-34` name all four, and its `done_when` (`:9`) pins exactly one remaining
`query("transcripts")` in `convex/projects.ts` and in `convex/debugTools.ts`
and zero in the other two files. Every code pointer added to the amendment was
re-read with `sed -n` and shows the line it claims. Ladder 4 (the claim is now
a grep a reviewer reruns).

**2 — three `decisions.tsv` plan rows cited ranges that do not resolve.**
`git show 470557d:.factory/tickets/transcripts-1-model-and-list.md | wc -l` = 43,
so `:44` and `:52-56` are past EOF; `:36-40` lands on `## Edge cases`, not the
implementation notes the row claims. The resolving ranges at baseline are
`:31-36` implementation notes, `:36` the no-writer rule, `:25-28` Verification
(`+4` at HEAD, the four `deferred:` frontmatter lines). Three superseding rows
appended (the file is append-only); the wrong rows stay, as the protocol
requires. Ladder 4 (`sed -n` on the baseline blob prints the claimed text).

**3 — the empty-placeholder UI regression had no `deferred:` row.**
Confirmed rather than assumed: `convex/ingestionPort.ts:208-212` inserts
`content: ""`, and `convex/projects.ts:715` inserts `args.transcriptContent`,
which `project/new` allows to be empty when files carry the project
(`src/routes/project/new/+page.svelte:379-380`, `hasAnySource` is true on
`textualFileCount > 0`). At baseline `getTranscript` was a bare `.first()`
(`git show 470557d:convex/transcripts.ts`), so such a project returned the
empty row and the page rendered an empty box; the helper drops empty rows, so
it now returns `null`. `CurrentProjectPage.svelte:1723` and
`PreviewProjectPage.svelte:2224`/`:2241` branch on truthiness, so `null` (none)
and `undefined` (loading) both fall to `Loading transcript...` (`:1731`,
`:2232`, `:2249`) — a permanent false loading state. `FilesPanel.svelte:477`
(row hidden) and `src/routes/project/new/+page.svelte:212` (prefill guard)
degrade cleanly. Not fixed here: AC2 and AC6 mandate the `null` and the ticket
forbids UI edits (`:40`). Recorded in the ticket's `deferred:` list, pointing
at `transcripts-5`, whose Edge cases bullet 1 already requires the readers to
wait on `data !== undefined` — which is what removes the false loading text.
Ladder 2 for the rendered symptom (`file:line` on both branches, no running
app driven); ladder 4 for the query behaviour change, which
`convex/transcripts.test.ts` :: "skips empty legacy placeholder rows (AC2, AC6)"
asserts.

## Live surface
untested: this ticket adds no user-visible surface. Nothing calls `listTranscripts` or `getTranscriptContent` yet (the UI migrates in `transcripts-5`), no writer sets `label`/`position`/`contentHash` yet (`transcripts-3`), and no code writes `transcriptDigests` yet (`transcripts-7`). The queries were driven end to end through the real Convex function surface with `convex-test` (real auth helpers, real schema validation, real index reads), which is the highest surface that exists at this commit. The repo has no `.factory/verify/SKILL.md`.

## Not proven
- `transcriptDigests` and the new index accept real writes — nothing inserts into the table at this commit, so only schema validation and the index definition are exercised. Command a human can run once `transcripts-7` lands: `npx vitest run convex/transcriptDigests.test.ts`. To check the deployed schema accepts the widen now: `npx convex dev --once`.
- `generationSources.kind: "transcript_digest"` and `digestId` are declared but never written here; same follow-up ticket.
- The caps `MAX_TRANSCRIPTS_PER_PROJECT` and `MAX_TOTAL_TRANSCRIPT_CHARS` are enforced by no writer at this commit. The read-side cap is tested; the write-side lands in `transcripts-3`. Human check afterwards: `npx vitest run convex/projects.test.ts`.
- Payload size claim (metadata list versus full content) is argued from the code shape, not measured against a running deployment.
- The `Loading transcript...` regression in finding 3 is proven from the query change (test) and the two `{#if transcript}` branches (`file:line`), not by loading a placeholder-only project in a browser. Exact check a human can run after `transcripts-5`: create a project through the ingestion port (empty transcript row), open `/project/<id>?workspace=current`, and confirm the transcript block shows no rows instead of `Loading transcript...`.
