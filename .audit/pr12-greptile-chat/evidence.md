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

## Limitations

- Alignment thresholds (0.5 similarity, 0.1 margin) are fixed constants
  calibrated on the existing fixtures ("Trial 1 described a pressure range." vs
  "Trial 1 examined the pressure operating envelope." scores 0.545 and pairs;
  "Trial 3 … flow range" scores 0.18 against both and does not). A paragraph
  rewritten so heavily that it shares under half its content words with its
  origin is left unpaired by design; the model then sees it only in the
  unpaired list and in the turn's document evidence.
- Duplicated paragraphs on either side pair with nothing (ties fail the
  margin), including in otherwise identical sections. Previously they paired
  positionally.
- Both scans remain bounded (2000 Brief rows, 1000 project documents). Past
  the bound the code reports the cut (`exact: false`, `documentScanTruncated`)
  rather than reading further. A `projectDocuments` `by_projectId_and_category`
  index would remove the document bound entirely; not added here per the
  no-new-index instruction.
- `MAX_INVENTORY_NOTES` (1000, compliance notes) is still a silent `take`;
  DW-138's ledger text names it but the Greptile findings and this fix scope
  did not. The notes are per generation and per candidate run, written by the
  Self-check, so the bound is far above any real count.
