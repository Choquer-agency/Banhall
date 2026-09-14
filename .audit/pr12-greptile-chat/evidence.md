# PR #12 Greptile findings: DW-137 and DW-138

Branch `fix/pd2-greptile-chat`, baseline `55011ea` (PD generation stories 3-6).
Findings: `/private/tmp/.../scratchpad/greptile/pr12-findings.md` comment ids
4008694029 (deviationInventory.ts:197), 4008694047 (chatV2.ts:1317),
4008694055 (chatV2.ts:1235). Ledger entries DW-137 and DW-138 at `HEAD`.

Method: every new test was written first and run against the unmodified
source (`before.raw.log`), then the source was changed and the same suites
rerun (`after.raw.log`). One assertion in the DW-137 "nothing is similar" test
was narrowed after the first after-run (its 244/246 fixture sections are
identical on both sides and legitimately pair); the test fails on the baseline
under either wording because `unpairedReference` did not exist and Line 242
was pinned positionally.

## Finding → test → before/after

| Finding | Test | Before (baseline source) | After |
| --- | --- | --- | --- |
| DW-137 inserted paragraph shifts every later pair | `deviationInventory.test.ts` "does not shift later pairs when the draft inserts a paragraph at the top" | FAIL | pass |
| DW-137 deleted paragraph | "keeps the true counterparts when the draft dropped a middle paragraph" | FAIL | pass |
| DW-137 reordered pair | "follows a reordered pair to its real counterpart" | FAIL | pass |
| DW-137 ambiguous → no counterpart | "offers no counterpart when two reference paragraphs match equally well" | FAIL | pass |
| DW-137 low similarity → no counterpart, not positional | "offers no counterpart, rather than the positional one, when nothing is similar" | FAIL | pass |
| DW-137 identical sections unchanged | "leaves identical sections paired position for position" | FAIL (shape) | pass |
| DW-137 section-local only | "aligns within a section only, never across Locked sections" | FAIL | pass |
| DW-137 unpaired reference rendered as DATA, neutralized | "neutralizes markers in an unpaired reference paragraph's excerpt" | FAIL | pass |
| DW-138 >20 open questions silently cut | `chatContext.test.ts` "reports how many open questions the 20 cap left out" | FAIL | pass |
| DW-138 Brief entries taken before filtering | "still finds open questions behind more than 500 entries of other groups" | FAIL (returned `[]`) | pass |
| DW-138 omitted count reaches the model | `chatEvidence.test.ts` "opens the block with the omitted count…" and "carries the omitted count from the context row into the message" | FAIL | pass |
| DW-138 Reference PD past row 200 | `chatDeviationInventory.test.ts` "finds a previous_pd attached after more than 200 other documents" | FAIL (`referenceFileNames` was `[]`) | pass |
| DW-138 bounded scan reported, not "absent" | "says so when the document scan hit its bound…" and `chatToolBodies.test.ts` "tells the model the document scan was cut instead of claiming none is attached" | FAIL | pass |

`before.raw.log` tail:

```
 Test Files  5 failed (5)
      Tests  17 failed | 98 passed (115)
```

`after.raw.log` tail:

```
 Test Files  5 passed (5)
      Tests  115 passed (115)
```

## Gates

| Command | Log | Result |
| --- | --- | --- |
| `npx tsc -p convex/tsconfig.json --noEmit` | `tsc.log` | exit 0, no output |
| `npx vitest run` (full unit suite) | `vitest-full.log` | 187 files, 2655 tests passed |
| `npm run check` | `check.log` | 5958 files, 0 errors, 0 warnings |

All run with `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud
PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site`.

## Design

### DW-137: content alignment in `convex/lib/deviationInventory.ts`

`alignReferenceParagraphs(draft, reference)` returns, per draft paragraph, the
index of its Reference counterpart or `undefined`. Per section only.

- Similarity: Sørensen–Dice over lowercased word multisets with a small
  function-word stop list (so two unrelated SR&ED paragraphs do not look a
  third alike on "the/of/and", while a rewritten paragraph keeps its nouns).
- A pair (d, r) is accepted only when: score ≥ 0.5; r beats d's runner-up by
  ≥ 0.1; d is r's best by the same margin (mutual). Ties fail the margin, so
  duplicated boilerplate pairs with nothing. Each Reference paragraph is used
  at most once. Order-free, so a reordered pair still meets.
- No positional fallback: absent `referenceText` means "no confident
  counterpart", never "the one at the same index".
- Structural `x-` items stay count-based (the paragraph-count difference), so
  a differently worded PD does not flag every paragraph as a Coordinated
  Revision candidate; alignment only chooses WHICH unaligned draft paragraphs
  carry them (the last `excess` unaligned ones, which degrades to the old
  positional rule when nothing aligns). Existing ids (`x-242-3-1`) and the
  "N of its paragraph(s) have no counterpart" item are unchanged.
- New additive field `DeviationInventory.unpairedReference` lists Reference
  paragraphs no draft paragraph was aligned to; `renderInventory` prints them
  under "Reference PD paragraphs with no aligned draft paragraph", each
  marker-neutralized and marked DATA, so the model still sees the text without
  a claimed pairing. The header sentence now says counterparts are aligned by
  content and that an unlisted one means "not paired with confidence".
- Fixture change: the existing "neutralizes markers in both the draft and the
  counterpart excerpt" test now uses a reference paragraph that is a near copy
  of the draft's (each with its own forged marker) so the pairing exists; a
  second test covers the unpaired path.

### DW-138: bounded scans that filter as they walk, with explicit signals

`convex/chatV2.ts`

- `openQuestionsFor` walks `generationBriefEntries` by `by_briefId` with
  `for await`, filtering `confidenceMap` + `unresolved|unreliable` as it goes;
  keeps the first `MAX_OPEN_QUESTIONS` (20) and counts the rest as `omitted`.
  Scan bound `MAX_BRIEF_ENTRY_SCAN = 2000` rows (was `take(500)` BEFORE the
  filter); hitting it sets `exact: false`. `getChatContextV2` returns
  `openQuestionsOmitted: { count, exact }` alongside `openQuestions`.
- `getDeviationInventoryContext` walks `projectDocuments` by `by_projectId`
  with `for await`, keeping non-archived `previous_pd` rows (was `take(200)`
  then filter). Bound `MAX_PROJECT_DOCUMENT_SCAN = 1000` rows (exported for
  the tool copy and tests); hitting it returns `documentScanTruncated: true`.
  No schema index added: the project's documents are already read in full by
  `getChatContextV2` on every chat turn, so the walk introduces no new read
  profile, and a `by_projectId_and_category` index remains the right next step
  if projects grow past the bound.

`convex/ai/chatEvidence.ts`

- `ChatOpenQuestionsOmitted` type; `openQuestionsTextFrom(questions, omitted)`
  prepends one line when `count > 0`: "Listing 20 of 26 open questions; 6 more
  are not shown." or, inexact, "Listing 20 open questions; at least 6 more are
  not shown." It is the FIRST line so the budget's tail cut cannot remove it.
  `buildChatTurnRequest` passes `context.openQuestionsOmitted` through. With
  `count: 0` the block bytes are unchanged (AD-11a byte-stability test still
  passes).

`convex/ai/chatAgentV2.ts`

- `InventoryContext.documentScanTruncated`; `runCompareReferencePd` appends
  "Note: only the first 1000 documents of this project were scanned, so a
  previous-year report attached after them was not seen; tell the writer this
  limit applies." to the `unknown_name` copy, and replaces "This project has
  no Reference PD attached" with "No Reference PD was found among the documents
  scanned." plus the note when the walk was cut.

## Astra review fixes (gpt-6-astra, medium, ACCEPT_WITH_FIXES on 1784826 + fb15c59)

Review copied to `astra-review/`. Logs under `review-fix/`. The
`review-fix/before.raw.log` run was taken with every source file at
`fb15c59` and only the test files edited. CORRECTION (Astra review 2, item
3): in that log only the two DOCUMENT byte-budget cases fail with the
platform read error (`Read too much data in a single function execution
(limit: 16777216 bytes)`); the Brief byte-budget case failed at fixture
insertion with `Wrote too much data` (its first version seeded all rows in
one transaction), so the Brief query never ran there. That log is kept as
the invalid first attempt. The corrected, separately seeded Brief test was
rerun against `fb15c59` source: `review-fix-2/before-fb15c59-brief.raw.log`
(source sha in `before-fb15c59-brief.source.sha`) fails inside the query
with `Read too much data`.

| Review item | Test | Before (fb15c59) | After |
| --- | --- | --- | --- |
| 1 High: row bound does not prevent the 16 MiB read limit (documents) | `chatDeviationInventory.test.ts` "stops at its byte budget instead of exceeding the transaction read limit" (`transactionLimits: true`, 20 × ~900 KB attachments; the unbudgeted walk is shown throwing in the same test) | FAIL: query threw `Read too much data` | pass: `documentScanTruncated: true` |
| 1 High: same for the Brief scan | `chatContext.test.ts` "stops at its byte budget instead of exceeding the transaction read limit" | FAIL: fixture write limit in `review-fix/` (invalid); query threw `Read too much data` in `review-fix-2/before-fb15c59-brief.raw.log` | pass: `{ count: 0, exact: false }`, prefix question kept |
| 2 Medium: incomplete scan hidden by empty list / zero omissions | `chatEvidence.test.ts` "says the scan was incomplete even with nothing listed or no known omission"; `chatContext.test.ts` "reports an inexact scan when the row bound stops before the Confidence Map" | FAIL (block absent) / pass (guard) | pass |
| 3 Medium: truncation ignored on auto-resolve and most tool replies | `chatDeviationInventory.test.ts` "does not auto-resolve the only PD seen when the walk was incomplete"; `chatToolBodies.test.ts` × 4 (explicit choice, named PD carries note, unknown-name phrasing, unreadable/unparsed carry note) | FAIL | pass |
| 4 Medium: quadratic score matrix | `deviationInventory.test.ts` "skips alignment with a notice when a section is too large to compare" (3000 × 3000), "aligns a large shuffled section without a full score matrix" (300 × 300 guard), "pairs duplicated paragraphs positionally when the sections are identical" | FAIL / pass (guard) / FAIL | pass |

`review-fix/before.raw.log`: `Tests  11 failed | 116 passed (127)`.
`review-fix/after.raw.log`: `Tests  127 passed (127)`.

| Gate | Log | Result |
| --- | --- | --- |
| `npx tsc -p convex/tsconfig.json --noEmit` | `review-fix/tsc.log` | exit 0 |
| `npx vitest run` | `review-fix/vitest-full.log` | 187 files, 2667 tests passed |
| `npm run check` | `review-fix/check.log` | 5958 files, 0 errors, 0 warnings |

### Design of the fixes

1. **Byte-budgeted reads** (`convex/chatV2.ts`, `chatReadBudget`). A local
   twin of `convex/lib/learningHealthReads.ts`: `CHAT_READ_BYTES = 8 MiB`
   (half the platform limit), `CHAT_DOCUMENT_HEADROOM = 1 MiB + 4096`
   reserved BEFORE each read, `getConvexSize(row) + 256` charged after.
   `charge()` accounts point reads and `.take`s; `list(source, cap, keep)`
   walks an index range with explicit `iterator.next()`/`return()`, keeping
   the rows `keep` accepts and returning `{ rows, complete }`. Both queries
   create one budget and charge everything they read in order (thread,
   report, generation, compliance notes, the chat context's document
   `.collect()`, proposals) so the walk at the end stops with headroom.
   `documentScanTruncated` and `omitted.exact` now mean "row cap OR byte
   budget stopped the walk". A shared `convex/lib/boundedRead.ts` is being
   extracted from the learning-health module on another branch; the helper
   here keeps that module's reserve-then-account shape and the same numbers
   so the switch is an import swap plus deleting `chatReadBudget`. No index
   exists on `projectDocuments` that avoids reading `content` for
   category metadata (`by_projectId`, `by_storageId`, a search index), so
   none was used; adding `by_projectId_and_category` stays the right follow-up
   and is not done here per instructions.
2. **Incomplete-scan notice** (`convex/ai/chatEvidence.ts`).
   `openQuestionsBlockNeeded(questions, omitted)` renders the block when there
   is anything to list OR `exact === false`; `buildChatTurnRequest` uses the
   same predicate so an empty inexact list is not dropped. Notice lines:
   exact + omissions "Listing 20 of 26 open questions; 6 more are not
   shown."; inexact + omissions "…at least 6 more…"; inexact, none known
   "Listing N open questions; the Brief was not fully read, so more may
   exist."; inexact, empty "No open question was read before the Brief scan
   stopped; this list is incomplete, not empty." Exact + empty still renders
   nothing (byte-stability).
3. **Truncation propagation** (`convex/chatV2.ts`, `convex/ai/chatAgentV2.ts`).
   A single readable PD is auto-resolved only when the walk was `complete`;
   otherwise the status is `ambiguous` and the copy asks for an explicit
   name ("The document scan was incomplete, so the comparison cannot
   establish which previous-year report to use…"). An explicitly named PD
   still resolves and the comparison is rendered with the scan note
   appended. `unknown_name` reads "was not found among the documents
   scanned" (or "this project's documents" when complete). `none`,
   `unreadable`, `unparsed`, `ambiguous` and the unresolved fallback all
   carry the note.
4. **Bounded alignment** (`convex/lib/deviationInventory.ts`). The score
   matrix is gone: one pass over draft × reference updates a `BestTwo`
   (best index, best score, runner-up score) per row and per column, which
   is all mutual-best + margin needs; memory is O(D + R). Work is bounded by
   `MAX_ALIGNMENT_COMPARISONS = 250_000` (500 × 500); past it
   `alignReferenceParagraphs` returns `null`, the section is listed in
   `alignmentSkippedSections`, its paragraphs carry no counterpart and no
   unpaired list, and `renderInventory` says "Line 242 was not aligned: the
   section is too large to compare paragraph by paragraph…". Exact-identical
   fast path: when both sides have the same paragraph count and every
   paragraph matches after whitespace/case normalization, the identity
   mapping is returned, so boilerplate duplicated on BOTH sides pairs
   (deterministic, 3 lines).

## Astra review 2 fixes (gpt-6-astra, medium, ACCEPT_WITH_FIXES on a5f9ca4)

Review copied to `astra-review-2/`. Logs under `review-fix-2/`.
`before.raw.log` was taken with every source file at `a5f9ca4` (verified
`git diff --stat` empty for the four source files) and only the test files
edited.

| Review item | Test | Before (a5f9ca4) | After |
| --- | --- | --- | --- |
| 1 High: source label lookups after the Brief walk not reserved | `chatContext.test.ts` "keeps every open question and drops labels when source lookups would exceed the budget" (`transactionLimits: true`; 20 questions on 20 distinct ~720 KB sources, then 7 × ~900 KB Brief rows) | FAIL: query threw `Read too much data` | pass: 20 questions, `{ count: 0, exact: true }`, first label present, later labels `null` |
| 1 High: `selectedCandidateRunId` / `chatEvidenceBudget` reads bypass accounting | `deviationInventory.test.ts` "words the unread rules state as a budget limit, never a clean bill" (the degrade path's wording); the reserve itself is by construction (see design) | FAIL | pass |
| 2 Medium: skipped alignment still blamed a specific paragraph | `deviationInventory.test.ts` "reports only a section-level count difference when a skipped section's lengths differ" (501 vs 500 with an inserted opener, and the reverse, and equal lengths) | FAIL: item `x-242-501-1` on paragraph 501 | pass: one `x-242-1-1 [reference, section-scoped]` item; paragraph 501 clean |
| 3 Medium: evidence claimed a Brief read-limit reproduction the log did not show | corrected statement above; `review-fix-2/before-fb15c59-brief.raw.log` | — | query fails with `Read too much data` on fb15c59 source |

`review-fix-2/before.raw.log`: `Tests  3 failed | 127 passed (130)`.
`review-fix-2/after.raw.log`: `Tests  130 passed (130)`.

| Gate | Log | Result |
| --- | --- | --- |
| `npx tsc -p convex/tsconfig.json --noEmit` | `review-fix-2/tsc.log` | exit 0 |
| `npx vitest run` | `review-fix-2/vitest-full.log` | 187 files, 2670 tests passed |
| `npm run check` | `review-fix-2/check.log` | 5958 files, 0 errors, 0 warnings |

### Design of the fixes

1. `chatReadBudget.read(fn, extraBytes)` reserves one document of headroom
   BEFORE running `fn`, then charges its return value (when it is a Value)
   plus `extraBytes` for rows a helper reads that its return does not carry.
   `{ ok: false }` means the read was never started. Call sites:
   - Brief source labels: `budget.read(() => ctx.db.get(sourceId))`; when it
     is refused the question is kept with `sourceLabel: null` (the
     `ChatOpenQuestion` doc comment now covers "unreadable within the
     budget" alongside "source row gone").
   - `selectedCandidateRunId` (one modelSelections row + up to ten small
     candidate-run rows, `extraBytes = 11 × 2048`): a refused reservation
     sets the new `RulesStatus` value `"unread"` and reads no notes at all,
     because falling through to the unfiltered notes index would present
     every candidate's notes as this report's. `renderInventory` words
     `unread` as UNAVAILABLE within the read budget, never as a clean bill.
     By construction the reservation cannot fail there (at most thread +
     report + generation, ≤ 3 MiB, precede it), so the branch is covered by
     its wording test rather than a byte fixture.
   - `chatEvidenceBudget` (three settings rows, `extraBytes = 3 × 1024`) now
     runs right after the report read, before the document collect; a
     refused reservation falls back to `DEFAULT_CHAT_EVIDENCE_BUDGET`.
2. When a section's alignment is skipped, the structural pass attaches at
   most ONE item: section-scoped on paragraph 1, stating the paragraph-count
   difference and that which paragraph(s) lack a counterpart is not
   established. No per-paragraph "no counterpart" claims and no unpaired
   list. `renderItem` labels it `[reference, section-scoped]`. Equal
   lengths produce nothing.
3. Evidence corrected as described at the top of the previous section; the
   old log is preserved and labelled invalid.

## Limitations

- PRE-EXISTING, out of scope, to be tracked separately (Astra review 2):
  the chat context's `projectDocuments.collect()` (`convex/chatV2.ts`,
  `getChatContextV2`) predates DW-138 and is charged to the budget but not
  bounded; the generation and proposal `.take`s before and after it are
  likewise charged, not reserved. Charging after the fact cannot protect
  those reads: a project whose documents alone approach 16 MiB still fails
  that query as before, and whole-query safety for `getChatContextV2` is
  NOT claimed here. Bounding it is evidence policy (which documents reach
  the chat), not read policy.
- Both notes walks (`complianceNotes` in the inventory query) can stop on
  the byte budget with `complete: false`; the partial list is used and the
  cut is not surfaced as a rules status. Not raised by either review; noted
  for completeness.
- The budget is an estimate (`getConvexSize` + 256 B per row) that mirrors
  the learning-health module; it is not the platform's own accounting.
- Alignment thresholds (0.5 similarity, 0.1 margin) are fixed constants
  calibrated on the existing fixtures ("Trial 1 described a pressure range." vs
  "Trial 1 examined the pressure operating envelope." scores 0.545 and pairs;
  "Trial 3 … flow range" scores 0.18 against both and does not). A paragraph
  rewritten so heavily that it shares under half its content words with its
  origin is left unpaired by design; the model then sees it only in the
  unpaired list and in the turn's document evidence.
- Duplicated paragraphs on ONE side pair with nothing (ties fail the
  margin). Sections identical position for position on both sides take the
  exact-identical fast path and pair positionally (review fix 4).
- Both scans remain bounded (2000 Brief rows, 1000 project documents). Past
  the bound the code reports the cut (`exact: false`, `documentScanTruncated`)
  rather than reading further. A `projectDocuments` `by_projectId_and_category`
  index would remove the document bound entirely; not added here per the
  no-new-index instruction.
- `MAX_INVENTORY_NOTES` (1000, compliance notes) is still a silent `take`;
  DW-138's ledger text names it but the Greptile findings and this fix scope
  did not. The notes are per generation and per candidate run, written by the
  Self-check, so the bound is far above any real count.
