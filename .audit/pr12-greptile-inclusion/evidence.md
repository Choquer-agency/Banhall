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

## DW-128 — Query failures look like absence (this commit)

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
