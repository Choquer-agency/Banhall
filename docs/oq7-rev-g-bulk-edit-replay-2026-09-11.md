# Open Question 7: has PR #8's bulk edit already improved the "4 of 16" behaviour?

Recorded 2026-09-11 for `SPEC-pd-generation` Open Question 7, during story 5 (CAP-12 to CAP-15, AD-28). Baseline `ba845a8`.

**Answer in one line: partly, and only in ways a deterministic test can show. No live-model verdict is recorded here, because the harness could not be run in this worktree.**

## The incident

`.factory/intake/20260908-chat-behavior-and-privacy/answer.md` records Larry's 2026-09-01 Rev G session: 16 deviations from his customized PD settings, 4 addressed. The intake assessment is explicit that the historical cause is unproven without the original settings, findings, report versions and effective writer profile, and this record does not claim otherwise.

PR #8 (`6c4f50b`, merging `d13abe7`) added `proposeBulkEdits`, `convex/lib/passageEdits.ts` and the `sixteen-profile-deviations` fixture in `scripts/chat-behavior-eval.mjs`.

## 1. Already passing, deterministically shown

Each claim is either an assertion in `convex/lib/completionReport.test.ts` (story 5's port of the same contract, run by `bash scripts/loop-verify.sh`) or an inspection of PR #8's own source.

| Rev G item class | What is guaranteed | Evidence |
|---|---|---|
| Many passages, one card | One `chatProposals` row per bulk tool call, whatever the item count. The tool calls `saveProposal` once with `kind: "replacements"` and `requireUniqueTargets: true`. | `git show 6c4f50b:convex/ai/chatAgentV2.ts` (the single `runMutation(internal.chatV2.saveProposal, …)` inside `makeProposeBulkEdits`); `convex/chatProposalItems.test.ts` > "writes one row per item, in input order, with the tool's ids and anchors" asserts exactly one `chatProposals` row for 16 items |
| Targets are unique, non-overlapping and match once | `applyPassageEdits` refuses a passage set unless every target matches exactly one location, makes a change, and the forward and reverse application agree. | `git show 6c4f50b:convex/lib/passageEdits.ts`; `convex/lib/passageEdits.test.ts` |
| Every edit is accounted for by a finding | The tool's `superRefine` rejects a duplicate finding id, an edit number out of range, and any edit no finding maps to. | `convex/lib/completionReport.test.ts`, the `rejects` table's labels "a duplicate id", "an uncovered edit", "an out-of-range edit number" (each becomes one `it("rejects <label>")` case) |
| The reply echoes the model's own ids | The tool result is a checklist line per finding, id verbatim, which the prompt requires the reply to carry. | `convex/lib/completionReport.test.ts` > "prints every id exactly once, verbatim, with its status"; `convex/ai/prompts.test.ts` > "tells the model to reuse the inventory ids verbatim" |
| Human apply is unchanged | `applyProposal` behaves as it did, writes its `pre_chat_edit` snapshot, bumps the revision by one and leaves the new item rows untouched. | `convex/chatProposalItems.test.ts` > "applies exactly as before and leaves every item row untouched"; `convex/chatProposals.test.ts` (unchanged from baseline) |
| The tool actually persists what it echoes | The bulk tool's own body, run against a real database, writes the rows it reports. Deleting its `items` hand-off fails the gate. | `convex/chatToolBodies.test.ts` > "persists the Completion Report and echoes the checklist" |

## 2. Not addressed by PR #8 (and what story 5 does about it)

| Gap in PR #8 | Story 5 | Evidence |
|---|---|---|
| Findings had three statuses `proposed`, `gap`, `conflict`, and `gap`/`conflict` carried a free-text `reason` only. A blocked item named no missing fact and no source; a rule conflict named no rule and offered no alternative. | Statuses are `resolved`, `blocked`, `conflicting`. `blocked` requires `missingFact` and `missingFactSource`; `conflicting` requires `lockedRule` and `alternative`. | `git show 6c4f50b:convex/ai/chatAgentV2.ts` lines 121 to 132; `convex/lib/completionReport.test.ts`, the `rejects` table's labels "blocked without a missing fact", "blocked without a missing-fact source", "conflicting without a locked rule", "conflicting without an alternative" |
| Findings were never persisted. They existed only in the tool result string, so nothing could be audited after the turn. | One `chatProposalItems` row per item, written by `saveProposal` in the same transaction as its parent and never mutated (AD-28). | `git show 6c4f50b:convex/chatV2.ts` has no `chatProposalItems` and no `items` argument; `convex/chatProposalItems.test.ts` > "writes one row per item, in input order, with the tool's ids and anchors" |
| Findings carried no paragraph anchor. An id was an opaque string, so a renumbered or invented item could not be detected. | Every finding carries `section`, a 1-based `paragraph`, a `kind` and, for a rule item, the `rule`. `saveProposal` refuses an anchor the current report does not have, writing neither the proposal nor a row, and hands back the real paragraph counts. | `convex/lib/completionReport.test.ts` > "refuses a finding whose paragraph anchor the current report does not have"; `convex/chatProposalItems.test.ts` > "writes neither the proposal nor a row for an anchor the report does not have" |
| A 4-of-16 call was schema valid. | It still is. See the limit below. | `convex/lib/completionReport.test.ts` > "still accepts a 4-of-16 call, because listed-item coverage is not a server guarantee" |
| There was no inventory to number the items against, so the writer's list and the assistant's list were separately authored. | `deviationInventory` lists every paragraph of the current report exactly once, in build order, with rule Deviations read from stored `complianceNotes` and writer content Deviations joined at the paragraphs they name. Item ids are positional and stable. | `convex/lib/deviationInventory.test.ts` > "lists every paragraph exactly once in 242, 244, 246 order", "is stable across two identical calls and unique across 40 items" |
| The converge answer was unguarded: nothing stopped a reply that asked the writer to produce a settings document, a storyline, an exclusion list or a glossary. | The prompt carries the CAP-14 guard, and this report's unresolved and unreliable Confidence Map facts arrive in the turn as an `OPEN QUESTIONS FOR THE CLIENT` evidence block so the answer has somewhere honest to go. | `convex/ai/prompts.test.ts` > "carries the CAP-14 no-writer-artifact guard and points at the open questions"; `convex/ai/chatEvidence.test.ts` > "open questions block" |
| No Reference PD comparison existed at all, so nothing could fabricate one either. | A `previous_pd` whose text was never extracted, or whose text carries no `Line 242/244/246` skeleton, is reported as attached-but-uncomparable and produces no difference. Without that, three empty sections make EVERY draft paragraph look like a difference. | `convex/chatToolBodies.test.ts` > "says a blank previous_pd is attached but unreadable", "says a previous_pd with no Line 24x sections could not be read into sections"; `convex/lib/deviationInventory.test.ts` > "emits no difference at all when the Reference PD parsed to no sections" |
| Reference PD text had no containment rule, because there was no comparison. | The counterpart excerpt is marker-neutralized and labelled as data, so a forged BEGIN/END line or an imperative sentence inside an uploaded PD cannot read as an instruction. | `convex/chatToolBodies.test.ts` > "neutralizes a forged marker inside the Reference PD's text"; `convex/lib/deviationInventory.test.ts` > "neutralizes markers in both the draft and the counterpart excerpt" |

### The limit that stays

The server enforces: unique ids, every edit mapped to a finding, every finding anchored to a paragraph that exists, and each status carrying its required evidence. It cannot enforce that the findings cover the items the **writer** listed, because part of that list is writer-authored text the server never stored. Closing that would need a persisted inventory table and an AD-28 amendment, which story 5 records as out of scope in its **Block If**.

So the 16-of-16 bar lives where CAP-13 puts it: the live-model harness fixture. A deterministic test cannot answer Open Question 7 on its own, and this record does not pretend it can.

## 3. Outstanding: the live re-run

`ANTHROPIC_API_KEY` is not set in this worktree, and `scripts/chat-behavior-eval.mjs` is opt-in and billable (it throws on a missing key by design and is deliberately not part of `scripts/loop-verify.sh`). The commands below were **not** run. No live-model verdict for Rev G is recorded anywhere in this story.

```
ANTHROPIC_API_KEY=… node scripts/chat-behavior-eval.mjs --case sixteen-profile-deviations --out .audit/chat-behavior
ANTHROPIC_API_KEY=… node scripts/chat-behavior-eval.mjs --case sixteen-profile-deviations --baseline 6c4f50b --out .audit/chat-behavior-baseline
```

The second command reconstructs PR #8's own `convex/` and `shared/` sources through the harness's `baseline-source` Vite plugin, so the two runs are the before and after comparison. Note that at `--baseline 6c4f50b` the harness loads PR #8's fixture checks, which score the old `proposed` / `gap` / `conflict` vocabulary; compare the recorded `text` and `calls` of the two runs, not the check names.

Two further fixtures are now in the same harness and are also unrun here:

```
ANTHROPIC_API_KEY=… node scripts/chat-behavior-eval.mjs --case converge-request --out .audit/chat-behavior
ANTHROPIC_API_KEY=… node scripts/chat-behavior-eval.mjs --case reference-pd-diff --out .audit/chat-behavior
```

### What the harness's own grading can and cannot see

`scripts/chat-behavior-checks.mjs` holds the CAP-14 and CAP-15 grading
predicates, unit-tested by `tests/chatBehaviorChecks.test.ts` so the rules are
checkable in the gate even though the harness is not. Their limit is recorded
there and repeated here: `asksWriterForArtifact` matches a FIXED list of artifact
names, while the prompt's rule is open ended ("or any other new artifact"). A
reply that invents an artifact name passes the predicate and still breaks CAP-14
(`tests/chatBehaviorChecks.test.ts` > "an artifact name outside the list is not
caught" pins exactly that gap). A green `converge-request` run is therefore
evidence, not proof, and the recorded `text` still has to be read.

### What a run must show before Open Question 7 is closed

- `sixteen-profile-deviations`: `usedInventory`, `explicitCoverage` (all 16 ids, 10 rule plus 6 content), `mixedProvenance`, `everyFindingMapped`, `anchoredFindings`, `onlyNewStatuses`, `oneAcceptedProposal`, `allSixteenCorrected`, `honestProposalStatus`, on every run, not once.
- `converge-request`: no edit tool, no request for a writer-authored artifact, and a named open question from the evidence block.
- `reference-pd-diff`: `compareReferencePd` called, paragraphs named, no bare numeric score, and any Locked-Rule breach reported `conflicting` with a rule and an alternative.

Owner for the run: Johnny (the key holder). Until it exists, Open Question 7's honest status is "improved deterministically, unproven live".
