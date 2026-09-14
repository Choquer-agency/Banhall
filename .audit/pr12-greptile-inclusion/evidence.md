# PR #12 Greptile findings: DW-133 and DW-128

Base 55011ea2da502c0191af7c4e936478141f9b935c on `fix/pd2-greptile-inclusion`. All commands ran with
`PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site`.
Raw logs and exit sidecars sit beside this file; `decisions.tsv` is the decision trail.

## DW-133 — Document totals silently undercount (commit e63b4d0)

Finding: `convex/generations.ts` `getContextInclusion` read `projectDocuments` with `.take(100)`, so a project with more than 100 lifetime documents dropped attached documents from `documentsTotal` and from the not-captured rows.

Fix:
- `convex/lib/boundedRead.ts` (new): `collectBounded(source, { maxRows, maxBytes })` walks an index range one row at a time, reserving a maximum-size document (1 MiB + 4096) before each read via `getConvexSize`, and returns `{ rows, complete }`. `complete` is truthful: the row cap reports incomplete only when a further row actually arrived. Same idiom as `convex/lib/learningHealthReads.ts`, made generic.
- `convex/generations.ts`: the walk replaces `take(100)` under `INCLUSION_DOCUMENT_ROWS = 1000` and `INCLUSION_DOCUMENT_BYTES = 6 MiB`; the query passes `documentsTruncated: !complete` into the assembler.
- `convex/lib/contextInclusion.ts`: additive `documentsTruncated: boolean` on the return shape (default `false`). No existing field changed.
- `src/lib/brief.ts` `inclusionHeader`: a truncated total renders as `N+` (the app's bounded-count qualifier); `INCLUSION_TRUNCATED_NOTE` ("Not every document could be listed. The counts are a lower bound.").
- `src/lib/components/brief/BriefRail.svelte`: optional `documentsTruncated` on the inclusion view; the note renders under the Inputs rows only when set (`text-body text-ink-muted`, no new weights or hex).

Reproduction before the fix (`dw133-before.log`, exit 1):
```
× 101 documents: every attached document is counted, past the old 100-row fetch bound (DW-133)
  AssertionError: expected 100 to be 101
× says so when the document read budget stops the listing short (DW-133)
  AssertionError: expected undefined to be true
Tests  2 failed | 4 passed (6)
```
After (`dw133-after.log`, exit 0): the same two cases pass, plus 4 `collectBounded` unit cases, the assembler passthrough case and the `inclusionHeader` case — `Tests 29 passed (29)`. Browser: `dw133-component-after.log` `BriefRail.component.test.ts` 11 passed, including the new header/note case.

Acceptance mapping:
- Totals correct past 100 documents → `convex/contextInclusion.test.ts` "101 documents…" (101 inserted, 50 frozen, 51 not captured, `documentsTotal` 101, `documentsTruncated` false).
- Bounded read with an explicit flag → `convex/contextInclusion.test.ts` "says so when the document read budget…" (10 archived 700 KiB documents; `documentsTruncated` true, `documentsTotal` < 10, listed rows keep their real reason).
- Flag rendered honestly → `src/lib/brief.test.ts` (`12 of 1000+ documents…`) and `BriefRail.component.test.ts` (header `40+` plus the note; absent for a complete listing).
- Backward compatibility → additive field only; every existing inclusion test and the BriefRail/BriefRailPanel/BriefWorkspace suites pass unchanged.

## DW-133 review fixes (gpt-6-astra medium, `astra-review/result.md`; logs in `review-fix/`)

Astra rejected e63b4d0: the 6 MiB document budget did not protect the whole transaction (High), and `boundedRead.ts` duplicated `learningHealthReads.list` (Low). Both are addressed in the review-fix commit.

**Design.** `convex/lib/readBudget.ts` is now the one budget primitive: `createReadBudget({ maxBytes, reservedBytes })` with `account(value)` for rows already read, `one(read)`, `list(source, cap)` returning `{ rows, complete, stoppedBy: "rows" | "bytes" | null }`, and `snapshot()`. `learningHealthReads.ts` is a thin wrapper that keeps only the health population labels ("read byte budget" on a bytes stop, the population alone on a row-cap stop); its exported constants and result shapes are unchanged. `boundedRead.ts` and its test are deleted.

`getContextInclusion` runs every read under ONE budget: `INCLUSION_READ_BYTES = 14 MiB`, `reservedBytes = DOCUMENT_HEADROOM` (covers the four small appSettings reads at the end), then `account(generation)`, `account(user)`, `account(project)` for the rows authorization already read, then `list(generationSources, 200)` and, only if that finished, `list(projectDocuments, 1000)`. Every list reserves a maximum-size document (1 MiB + 4096) before each read. Whatever could not be read is reported: additive `sourcesTruncated` (frozen set cut short) and `documentsTruncated` (document walk cut short, or skipped because a partial source set cannot tell an unread frozen row from an unfrozen document — the assembler forces `documentsTruncated` whenever `sourcesTruncated`).

**Budget math.** Limit 16 MiB. Budget 14 MiB includes the 1 MiB up-front reservation, so bytes actually read ≤ 13 MiB + settings (< 1 KiB each) + the authorization rows the budget charged explicitly — about 3 MiB under the limit in the worst case. Reviewer fixture (four 500,000-char transcripts + fifty 200,000-char documents ≈ 12.0 MB ≈ 11.44 MiB of frozen sources): sources read in full (used ≈ 12.5 MiB with reservation + overhead), then the document walk reads until `used + 1 MiB > 14 MiB`, i.e. ~3 more 200k rows, and stops with `documentsTruncated: true`; total read ≈ 12.6 MB. Sources-only fixture (twenty 900,000-char rows = 18 MB): ~14 rows read (~12 MiB), `sourcesTruncated: true`, no throw.

**Regression tests, transaction limits enabled** (`convex/contextInclusion.test.ts` now uses `convexTest({ schema, modules, transactionLimits: true })` for every case):
- "12 MB of frozen sources: the whole transaction stays under the read limit and the document walk says it stopped" — the reviewer's exact fixture through the real `requestGeneration` reservation; inclusion is recorded per row in small transactions because `recordContextBudget`'s own get+patch loop over 12 MB is a separate pipeline limit (`dw133-before-first-attempt.log` shows that helper throwing at `generations.ts:967`, which is why the fixture was reshaped).
- "bounds the frozen sources themselves when they alone would exceed the budget, and says so" — twenty 900,000-char source rows.
- "says so when the document read budget stops the listing short" reshaped to seventeen 900,000-char archived documents (15.3 MB: the reservation's own `take(50)` read stays under 16 MiB while the query's 14 MiB budget cannot list them all).

`review-fix/dw133-before.log` (exit 1) runs the final test file against the e63b4d0 blobs of `convex/generations.ts`, `convex/lib/contextInclusion.ts`, `convex/lib/learningHealthReads.ts` and `convex/lib/boundedRead.ts` (the log's header prints `git hash-object` of each swapped file against `git rev-parse e63b4d0:<path>`; the swap was an in-place scratch copy, restored and checksum-verified, never a stash):
```
× 12 MB of frozen sources …   Error: Read too much data in a single function execution (limit: 16777216 bytes)   ❯ handler convex/generations.ts:1020:43  (the document walk)
× bounds the frozen sources … Error: Read too much data in a single function execution (limit: 16777216 bytes)   ❯ handler convex/generations.ts:1009:21  (the take(200) source read)
× says so when the document read budget … AssertionError: expected undefined to be false  (no sourcesTruncated field yet)
Tests  3 failed | 5 passed (8)
```
`review-fix/dw133-after.log` (exit 0): `Tests 63 passed (63)` across `contextInclusion.test.ts`, `lib/contextInclusion.test.ts`, `lib/readBudget.test.ts` (5 primitive cases incl. shared reservations and iterator cleanup), `learningHealth.test.ts` and `learningHealthBytes.test.ts` (31 health cases, unchanged, still passing on the wrapper) and `src/lib/brief.test.ts`.

**Gates after the review fix** (`review-fix/`): `npx tsc -p convex/tsconfig.json --noEmit` exit 0; `npm run check` exit 0 (5959 files, 0 errors, 0 warnings); `npx vitest run` exit 0 (188 files, 2650 tests); `npm run test:component` exit 0 (82 files, 641 tests).

## DW-128 — Query failures look like absence (efd7b18)

Finding: `src/lib/components/brief/BriefRailPanel.svelte` derived `available` from `.data` of the three `useQuery` calls only; an errored read left `data` undefined forever, so the panel and (via `CurrentProjectPage`'s own `briefAvailable`) the launcher vanished exactly like a legacy generation.

Fix:
- `BriefRailPanel.svelte`: `loadFailed` = any of `briefQ.error`, `inclusionQ.error`, `writerQ.error`; it makes the panel available and swaps the rail body for one line — `<p role="alert" class="px-4 py-3 text-body text-ink-muted">Couldn't load the Generation Brief. Try reloading the page.</p>` — the idiom `FilingReadinessPanel.svelte` already uses for a failed read. Rail mode keeps the card chrome (title + Close Brief); inline mode renders the card with the Brief title and the line. Loading (no data, no error) still renders nothing.
- `CurrentProjectPage.svelte`: `briefLoadFailed` joins `briefAvailable` so the launcher and the rail view stay reachable when a read fails.

Reproduction before the fix (`dw128-before.log`, exit 1):
```
× BriefRailPanel > read failures (DW-128) > shows a plain error line in the rail instead of disappearing when a Brief read fails
  expected undefined to be 'Couldn't load the Generation Brief. …'
× BriefRailPanel > read failures (DW-128) > shows the error line for the inline placement, whichever read failed
× BriefWorkspace > keeps the launcher when a Brief read fails, and the rail says so (DW-128)   (launcher never appeared)
✓ stays hidden while the reads are still loading, and renders once data lands   (pre-existing behaviour, kept)
Tests  3 failed | 17 passed (20)
```
After (`dw128-after.log`, exit 0): `Tests 20 passed (20)`.

Screenshots (captured by the panel test via `page.screenshot`, before its assertion, at 480×360):
- `before.png` — the rail renders nothing (empty canvas).
- `after.png` — the rail card with the Brief title, the close control and the error line.

Acceptance mapping:
- error → error line visible → `BriefRailPanel.component.test.ts` "shows a plain error line in the rail…" (rail mode; also asserts every element ≤ 500 weight) and "…inline placement, whichever read failed" (inclusion read errors).
- no data, no error → hidden as before → "stays hidden while the reads are still loading, and renders once data lands".
- data → rendered as before → same test after seeding, plus every pre-existing BriefRailPanel case.
- launcher survives → `BriefWorkspace.component.test.ts` "keeps the launcher when a Brief read fails, and the rail says so".

## Gates (after both fixes)

| Command | Log | Result |
|---|---|---|
| `npx tsc -p convex/tsconfig.json --noEmit` | `convex-tsc.log` | exit 0 |
| `npm run check` | `check.log` | exit 0 — 5959 files, 0 errors, 0 warnings |
| `npx vitest run` | `unit.log` | exit 0 — 188 files, 2647 tests passed |
| `npm run test:component` | `component.log` | exit 0 — 82 files, 641 tests passed |

Vitest's own failure captures under `src/**/__screenshots__/` from the pre-fix runs were removed; they are ignored and never staged. `.vitest-attachments/DW-128/` holds the live capture the committed test writes.
