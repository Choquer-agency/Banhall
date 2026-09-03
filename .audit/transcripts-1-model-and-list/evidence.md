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

## QA · 2026-09-03T21:50:00Z · claude-code / claude-fable-5-1
commit: 0436111169081d1bd31cf881af7c43ab2e30dbccb   verdict: test-verified
(HEAD is the evidence commit; it touches only this file. Code, tests and docs are identical to `3d60b9f`, the sha the implementer cites.)

| check | result | ladder | note |
|---|---|---|---|
| gates: `bash scripts/loop-verify.sh` | passed | 4 | exit 0; tsc silent, svelte-check 5867 files 0 errors, vitest 116 files / 1132 tests |
| ticket verification: `verify:` + 9 `done_when:` | passed | 4 | 8 shell predicates exit 0. The file-specific `npx vitest run convex/transcripts.test.ts` is outside the QA allowlist here (denied in four forms); the same file ran inside the gate's `npm test`: the three vitest projects' include globs resolve to exactly 116 files (68 convex incl. `tests/aiUsage.test.ts`, 5 shared, 43 src non-component), `convex/transcripts.test.ts` among them, and the run fails loud on any failing case |
| smoke | skipped | – | no `smoke` commands supplied |
| criteria coverage | passed | 4 | every AC has a test read and asserting it; table below |
| evidence audit | passed | 4 | commit chain, test names, tails and ladder levels all hold; one line pointer drifted by one (below) |
| kind proof | skipped | – | `kind: feature`; no reproduction, pin or measurement to rerun |
| live drive | skipped | – | no `.factory/verify` skill in the repo; the diff adds no user-reachable surface (nothing calls the two new queries yet) |

### Output tails

`bash scripts/loop-verify.sh` (exit 0):
```
1788472061716 COMPLETED 5867 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

> banhall-app@0.1.0 test
> vitest run

 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/transcripts-1-model-and-list

 Test Files  116 passed (116)
      Tests  1132 passed (1132)
   Start at  14:47:42
   Duration  12.93s (transform 25.66s, setup 0ms, import 32.93s, tests 26.56s, environment 11.08s)
```

8 shell `done_when` predicates chained with `&&` → printed `ALL_DONE_WHEN_OK` (exit 0).

### Criteria coverage (verified)
- AC1 → `convex/transcripts.test.ts::listTranscripts` "returns metadata in position order, without content (AC1)" ✓ asserts label order [first, second, third], positions [0,1,2], exact metadata shape of row 0 and `not.toHaveProperty("content")` on every row; "orders legacy rows by createdAt and labels them Interview transcript (AC1)" ✓ asserts createdAt [100, 500] and both labels; "sorts a positioned row ahead of legacy rows regardless of createdAt (AC1)" ✓   [4]
- AC2 → "drops empty and whitespace-only rows (AC2)" ✓ asserts length 1 from three seeds; "skips empty legacy placeholder rows (AC2, AC6)" ✓   [4]
- AC3 → "returns [] for callers without internal access (AC3)" ✓ loops unauthenticated, roleless, anonymous; "returns the labelled body for a caller with access (AC3)" ✓ asserts `{ _id, label, content }` exactly; "returns null for callers without internal access (AC3)" ✓ same three callers; "returns null, never a throw, for a transcript of an unreadable project" ✓   [4]
- AC4 → schema diff read at `470557d..HEAD`: `transcripts.label/position/contentHash` optional; `transcriptDigests` with both named indexes and the eleven ticket fields; `generations.transcriptIds/inputMode(full|digest)/digestIds` with `transcriptId` still required; `generationSources.kind` gains `transcript_digest`, plus `digestId?`; `sourceTranscriptIds?` on `reports`, `reportSnapshots`, `reportProvenance`; `digestIds?` on `reportProvenance`. `f8c218d` touches `convex/schema.ts` only. tsc is step one of the gate under `set -e`, gate exit 0   [4]
- AC5 → `rg -n "Multiple transcripts per project" docs/product-domain.md` → `:1485`; amendment read: cardinality (zero or more, ordered, labelled, immutable, 20 rows, `MAX_TOTAL_TRANSCRIPT_CHARS`), digest key `(transcriptId, sourceContentHash, condenseVersion)`, provenance shape (single id = first, lists alongside), widen-only citing `:226`/`:220`/`:247`, Tests bullet, Approval bullet. The six code pointers in the "one definition" bullet each land on a `query("transcripts")` line (`rg -n` at HEAD: debugTools 46/201, pdReviews 257, reviewFromProject 88, projects 558/1056)   [4]
- AC6 → `getTranscript` "returns the first transcript of the ordered set (AC6)" ✓ asserts `_id` of the position-0 row despite later createdAt; "returns null with no transcripts and without access (AC3, AC6)" ✓. Baseline `getTranscript` (`git show 470557d:convex/transcripts.ts`) was a bare `.first()`; HEAD delegates to `listProjectTranscripts(...)[0] ?? null`   [4]
- Edge cases: position tie → "breaks a position tie by createdAt" ✓; >20 rows → "returns at most MAX_TRANSCRIPTS_PER_PROJECT rows" ✓ (23 seeded); whitespace-only → in the AC2 test ✓; cross-project id → the "never a throw" test ✓. Not tested: the `_id` tie-break when both `position` and `createdAt` are equal (ticket names it, no AC depends on it).

### Evidence audit
- `commit: 3d60b9f` + "this file lands in the commit on top of it" → HEAD `0436111` changes only `.audit/.../evidence.md` ✓
- `git show --stat f8c218d` = `convex/schema.ts` only ✓; `32218f3` = lib + test + query ✓; `0c7998d` = docs only ✓
- Gate tails (5867 files / 116 files / 1132 tests) match my run ✓; `done_when` exits match ✓
- `wc -l` of the baseline ticket = 43 ✓; baseline `:31-36` prints the implementation notes ✓
- Deferred-regression pointers: `CurrentProjectPage.svelte:1723` / `:1731`, `PreviewProjectPage.svelte:2224` / `:2232` / `:2241` / `:2249` all show `{#if transcript}` / `Loading transcript...` ✓; `ingestionPort.ts` inserts `content: ""` at `:210` (insert opens at `:208`) ✓
- Drift: the fix section says the ticket "forbids UI edits (`:40`)" and the decisions rows say "`:35-40` at HEAD" / "`:40` at HEAD". At HEAD the no-writer rule is `:41` and the notes are `:36-41`, because `3d60b9f` itself added one `deferred:` line above them. Baseline pointers (`:31-36`, `:36`) are exact. Recorded, not failed: the referenced text exists one line down and the file is engine-owned. Principle 19: this is a ladder-2 pointer, and I say so instead of treating it as level 1 or level 4.

### Live drive
- none. Principle 16 (prove it works) is met at the highest surface that exists: `convex-test` drives the real function surface with the real schema, index and auth helpers. No UI reaches the new queries until `transcripts-5`.

### Skipped / needs operator
- smoke — no commands supplied — nothing to run.
- file-specific `npx vitest run convex/transcripts.test.ts` — outside this QA session's allowlist — a human reruns: `npx vitest run convex/transcripts.test.ts` (expect `Tests 20 passed (20)`).
- live drive — no `.factory/verify` skill and no user surface — nothing a human can drive yet; after `transcripts-5`, follow the implementer's "Not proven" bullet on the placeholder-only project.

Decisions and principles: verdict held at test-verified rather than live-verified (principle 19, never round up: no level-5 surface exists). Ticket verification passed on the gate's run rather than failed on the blocked direct command (principle 16: the same artifact ran and fails loud; the allowlist, not the code, blocked the narrower invocation). Evidence audit passed with the off-by-one noted (principle 25 and 19: state the drift plainly; it changes no claim's ladder).

## Findings-2 fix · 2026-09-03T21:54Z
commit: 5cc83e6 (this section lands in the commit on top of it; the fix touches no code, test or doc)
re-run at 5cc83e6: gate exit 0 (116 files / 1132 tests, `/tmp/gate-final.log`), 9/9 done_when exit 0 (`ALL_DONE_WHEN_OK`)

`.audit/transcripts-1-model-and-list/findings-2.md`: `rg -q 'transcriptDigests: defineTable' convex/schema.ts` exited 127, `sh: rg: command not found`.

**Root cause: a host tooling gap, not a code or content defect.** No file in this worktree changed. The predicate's assertion held the whole time and still does:

```
$ grep -n 'transcriptDigests: defineTable' convex/schema.ts
503:  transcriptDigests: defineTable({
```

The engine runs predicates as `spawnSync("sh", ["-c", cmd], { cwd: worktree, env: { ...process.env, CI: "1" } })` (`src/v2/engine.mjs:281`, called from `:256`). At 21:50:30Z, `rg` was not a binary on that `sh` PATH. Reproduced verbatim by stripping the PATH back to the state the engine saw:

```
$ env PATH=/usr/bin:/bin:/usr/sbin:/sbin sh -c "rg -q 'transcriptDigests: defineTable' convex/schema.ts"
sh: rg: command not found
exit=127

$ env PATH=/usr/bin:/bin:/usr/sbin:/sbin sh -c "grep -q 'transcriptDigests: defineTable' convex/schema.ts"
exit=0
```

Same file, same string, same stripped PATH: POSIX `grep` exits 0, `rg` exits 127. The predicate was measuring ripgrep's presence, not the schema.

**Why QA-1 and the engine disagreed.** QA-1 recorded "8 shell done_when exit 0" at the same commit. QA ran them from zsh, where Claude Code installs `rg` as a *shell function* that re-execs its own binary with `ARGV0=rg`:

```
$ which rg
rg () { local _cc_bin="${CLAUDE_CODE_EXECPATH:-}" ... ARGV0=rg "$_cc_bin" ${1+"$@"} }
$ env PATH=/usr/bin:/bin:/usr/sbin:/sbin sh -c 'command -v rg'   # exit 1, no output
```

The function exists only in an interactive zsh. `sh -c` never sees it, so an agent verifying by hand cannot observe this failure class. That is what `.audit/transcripts-1-model-and-list/done-when.mjs` (added here) exists to prevent: it replays all nine predicates through the engine's own `spawnSync sh -c` path.

**Who repaired it.** The host gained the binary 43 seconds after findings-2 was written, from outside this worktree and outside this session:

```
$ stat -f '%N  birth=%SB' -t '%Y-%m-%dT%H:%M:%S' /opt/homebrew/bin/rg /opt/homebrew/Cellar/ripgrep/15.2.0
/opt/homebrew/bin/rg  birth=2026-09-03T14:51:13          # findings-2: 14:50:30 local
/opt/homebrew/Cellar/ripgrep/15.2.0  birth=2026-07-15T09:00:11
```

The 15.2.0 keg has been on the machine since July; only the `bin` symlink is new, so this was a `brew link` of an unlinked keg. No commit of mine fixed this predicate, and this section does not claim otherwise.

**`done_when` left unchanged.** Swapping `rg -q` for `grep -q` would make the nine predicates independent of an optional third-party binary at identical assertion strength (proven above). `mode=fix` forbids editing `done_when`, and the environment defect is now repaired, so the swap is not licensed here. Recorded in the ticket's `deferred:` list for the planner instead.

### Output tails

`node .audit/transcripts-1-model-and-list/done-when.mjs` (exit 0) — all nine predicates through the engine's path:
```
  0  test -f convex/lib/transcripts.ts
  0  test -f convex/transcripts.test.ts
  0  rg -q 'transcriptDigests: defineTable' convex/schema.ts
  0  rg -q 'by_transcriptId_and_sourceContentHash_and_condenseVersion' convex/schema.ts
  0  rg -q 'export const listTranscripts' convex/transcripts.ts
  0  rg -q 'export const getTranscriptContent' convex/transcripts.ts
  0  rg -q 'transcript_digest' convex/schema.ts
  0  rg -q 'Multiple transcripts per project' docs/product-domain.md
  0  npx vitest run convex/transcripts.test.ts
ALL_DONE_WHEN_OK
```

`bash scripts/loop-verify.sh` (exit 0, `/tmp/gate-fix2.log`):
```
1788472392260 START "/Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/transcripts-1-model-and-list"
1788472392290 COMPLETED 5867 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

> banhall-app@0.1.0 test
> vitest run

 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/transcripts-1-model-and-list

 Test Files  116 passed (116)
      Tests  1132 passed (1132)
   Start at  14:53:13
   Duration  8.12s (transform 14.28s, setup 0ms, import 18.87s, tests 15.52s, environment 6.42s)

GATE_EXIT=0
```

### Not proven by this fix

- That `rg` stays on the engine's PATH. It is present now (`/opt/homebrew/bin/rg` → `ripgrep 15.2.0`) but reached that state by a host-level `brew link` no commit records. Any `brew unlink ripgrep` reopens this exact failure on all seven `rg` predicates. Command a human should run before the next engine pass: `env -i PATH=/usr/bin:/bin sh -c 'command -v rg'` — if it exits 1, the predicates need `grep -q`.
- Coverage of AC1–AC6 is unchanged by this fix; nothing in the diff touches `convex/`, `docs/` or tests. The AC evidence remains the `## Coverage` table above, re-confirmed only by the gate re-run (116 files / 1132 tests, exit 0).
