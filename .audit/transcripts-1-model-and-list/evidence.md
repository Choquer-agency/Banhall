# Evidence · transcripts-1-model-and-list
commit: 0c7998dc8b05ef8f43a039365fe033908510d659   branch: factory/transcripts-1-model-and-list   baseline: 470557d8eab88847b54edfe31bda04132a9a7552   date: 2026-09-03T21:28:39Z   kind: feature

## Coverage

| AC | Proof | Ladder |
|---|---|---|
| AC1 ordered metadata, no content; legacy rows by createdAt labelled "Interview transcript" | `convex/transcripts.test.ts` :: "returns metadata in position order, without content (AC1)", "orders legacy rows by createdAt and labels them Interview transcript (AC1)", "sorts a positioned row ahead of legacy rows regardless of createdAt (AC1)" ✓ (ran in `npx vitest run convex/transcripts.test.ts`) | 4 |
| AC2 empty legacy row not returned | `convex/transcripts.test.ts` :: "drops empty and whitespace-only rows (AC2)", "skips empty legacy placeholder rows (AC2, AC6)" ✓ | 4 |
| AC3 no access → `[]` / `null`; with access `{ _id, label, content }` | `convex/transcripts.test.ts` :: "returns [] for callers without internal access (AC3)", "returns the labelled body for a caller with access (AC3)", "defaults the label for a legacy row (AC3)", "returns null for callers without internal access (AC3)", "returns null, never a throw, for a transcript of an unreadable project (edge case)" ✓ (unauthenticated, roleless and anonymous callers each asserted) | 4 |
| AC4 additive schema widen, tsc green, nothing else changed | `npx tsc -p convex/tsconfig.json --noEmit` exit 0; `git show --stat f8c218d` = `convex/schema.ts` only; `npm test` 1132 passed (existing suites still insert `generations` with a required `transcriptId`) | 4 |
| AC5 dated domain amendment | `rg -n "Multiple transcripts per project" docs/product-domain.md` → `docs/product-domain.md:1485` | 4 |
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

`done_when` run by hand, each exit 0: `test -f convex/lib/transcripts.ts`, `test -f convex/transcripts.test.ts`, `rg -q 'transcriptDigests: defineTable' convex/schema.ts`, `rg -q 'by_transcriptId_and_sourceContentHash_and_condenseVersion' convex/schema.ts`, `rg -q 'export const listTranscripts' convex/transcripts.ts`, `rg -q 'export const getTranscriptContent' convex/transcripts.ts`, `rg -q 'transcript_digest' convex/schema.ts`, `rg -q 'Multiple transcripts per project' docs/product-domain.md`, `npx vitest run convex/transcripts.test.ts`.

## Output tails

### bash scripts/loop-verify.sh
```
> banhall-app@0.1.0 check
> svelte-kit sync && svelte-check --tsconfig ./tsconfig.json

1788470801530 START "/Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/transcripts-1-model-and-list"
1788470801570 COMPLETED 5867 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

> banhall-app@0.1.0 test
> vitest run

 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/transcripts-1-model-and-list

 Test Files  116 passed (116)
      Tests  1132 passed (1132)
   Start at  14:26:42
   Duration  13.63s (transform 21.08s, setup 0ms, import 27.71s, tests 22.80s, environment 12.60s)
```
(`npx tsc -p convex/tsconfig.json --noEmit` is the script's first step and printed nothing; run again standalone, exit 0.)

### npx vitest run convex/transcripts.test.ts
```
 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/transcripts-1-model-and-list

 Test Files  1 passed (1)
      Tests  20 passed (20)
   Start at  14:24:02
   Duration  469ms (transform 145ms, setup 0ms, import 178ms, tests 53ms, environment 68ms)
```

## Live surface
untested: this ticket adds no user-visible surface. Nothing calls `listTranscripts` or `getTranscriptContent` yet (the UI migrates in `transcripts-5`), no writer sets `label`/`position`/`contentHash` yet (`transcripts-3`), and no code writes `transcriptDigests` yet (`transcripts-7`). The queries were driven end to end through the real Convex function surface with `convex-test` (real auth helpers, real schema validation, real index reads), which is the highest surface that exists at this commit. The repo has no `.factory/verify/SKILL.md`.

## Not proven
- `transcriptDigests` and the new index accept real writes — nothing inserts into the table at this commit, so only schema validation and the index definition are exercised. Command a human can run once `transcripts-7` lands: `npx vitest run convex/transcriptDigests.test.ts`. To check the deployed schema accepts the widen now: `npx convex dev --once`.
- `generationSources.kind: "transcript_digest"` and `digestId` are declared but never written here; same follow-up ticket.
- The caps `MAX_TRANSCRIPTS_PER_PROJECT` and `MAX_TOTAL_TRANSCRIPT_CHARS` are enforced by no writer at this commit. The read-side cap is tested; the write-side lands in `transcripts-3`. Human check afterwards: `npx vitest run convex/projects.test.ts`.
- Payload size claim (metadata list versus full content) is argued from the code shape, not measured against a running deployment.
