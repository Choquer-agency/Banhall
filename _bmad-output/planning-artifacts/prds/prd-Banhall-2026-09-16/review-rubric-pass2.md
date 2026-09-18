# PRD Quality Review — Banhall step-by-step PD generation: idea seeds before prose

## Overall verdict
The revised PRD is a credible basis for UX and architecture: its positioning-before-prose thesis, brownfield boundaries and explicit approval lifecycle hold up, and the principal pass-1 defects have been addressed. It needs a small, targeted clarification pass before epics treat it as a complete implementation contract, particularly for what Skip means to the drafter, failed-call recovery timing and the revised Feedback success metric. No critical or high-severity findings remain in this rubric review; the remaining findings are three medium and one low.

Review scope: the full revised `prd.md` and `addendum.md`, checked against `review-rubric-pass1.md`, all four supplied context files and the specified quality rubric. Accuracy judgments use those supplied extracts, not a fresh implementation audit. Reviewer: `gpt-6-astra`, reasoning effort `medium`.

## Decision-readiness — adequate
The central trade-off is explicit and useful: §1 says “A section is the wrong unit of review,” §7 excludes another prose gate and §8.2 defers editing a signed-off plan. FR-23 now makes that deferral operational: “After sign-off no seed-stage mutation is accepted,” and FR-27 gives recovery its own generation bound to the frozen Summary. This closes the most consequential lifecycle ambiguity from pass 1 without expanding the MVP.

§10 records amendments, including predecessor-only conditioning and removal of the ghost baseline, while its introduction correctly says the product-domain amendment is “proposed, not yet approved.” Nine Open Questions are proportionate to an unattended internal-tool draft, with defaults on the consequential gate, learning and writer-assertion choices. Those defaults allow design to proceed; they should not be represented as owner-approved domain amendments. Latency and call thresholds remain explicitly provisional, rather than pretending to be measured facts.

## Substance over theater — strong
The vision is specific to the team's problem: §1 identifies disagreement about “which uncertainty, which experiments count, what was advanced,” rather than generic productivity. Larry's four scenarios exercise materially different interactions, including changing an upstream decision and retrying failed drafting. §3.3 now identifies them as “authored scenarios,” which usefully distinguishes illustrative journeys from observed evidence.

The NFRs address actual feature pressures: NFR-2 meters every seed call, NFR-3 protects first-pass completion while limiting discretionary calls, NFR-4 applies the existing injection boundary and NFR-6 bounds growing histories. The 25-word cap and diversity rule are visibly assumptions. Neither extra personas nor a market-differentiation section would improve this internal tool's PRD.

## Strategic coherence — adequate
The feature sequence serves one thesis: choose the project framing, review the complete plan, then draft it. FR-8 and FR-16 now preserve the inherited “one advancement per resolved uncertainty” meaning while allowing several experiments to support one advancement and an experiment to support none. This resolves the pass-1 semantic problem against `extract-prior-prd-spec.md` §4.

SM-4 measures corrections, SM-C4 checks unsupported claims without penalizing honest `[GAP]` markers, and SM-C2 includes cancelled generations when checking call volume. SM-2 now explicitly separates active time from elapsed time, matching §3.1's fragmented working pattern. The active-time calculation is an event-gap proxy, not direct observation of attention, but that level of instrumentation is reasonable for this team. One secondary metric was not updated to reflect the newly supported choice behavior.

### Findings
- **medium** Feedback success penalizes useful alternatives (§9 SM-5; §4.3 FR-12) — FR-12 deliberately returns “one to three Revised Seeds,” all unselected, but SM-5 requires “at least 70% of Revised Seeds” to be selected. A successful response offering three alternative phrasings, from which the writer chooses one, scores 33%; even choosing two scores 67%. The new split case is supported, but the metric confuses a useful choice set with a set whose every member should be adopted. *Fix:* Measure the proportion of Feedback requests yielding at least one accepted revision, or distinguish alternatives from requested splits and score each against its intended result.

## Done-ness clarity — adequate
All 41 FRs have testable consequences. The revision strengthens the cross-requirement behavior: FR-40 covers unapproved, prefetched and late-arriving Batches; FR-15 prevents approving Outdated content; FR-19 rejects conflicting writes; FR-11 marks edited content “Edited · writer-asserted”; and FR-23 closes the seed stage definitively. NFR-3 now counts Feedback, retries, repairs and prefetch, exempts first-pass access and offers a recorded extension, so reaching the cap does not itself require abandoning undecided Subsections.

The rules give engineers a workable contract for the principal flow. The remaining gaps concern two observable outcomes, rather than a need to specify architecture: whether a skipped role can reappear in the generated report, and how long a dead Batch may leave the writer waiting.

### Findings
- **medium** Skip does not have an explicit drafting consequence (§4.3 FR-14; §4.5 FR-41; §4.6 FR-25) — FR-14 defines Skip as “not applicable” and excludes its selections from downstream content, while FR-25 only requires the drafting prompt to receive “Seed Selections (final wording, support status, order).” FR-41 then allows Brief entries as fallback content. Nothing explicitly requires the drafter to receive or honor the Skip marker, so a skipped Work plan or Previous-year status role could be populated from the Brief or frozen sources. The Summary's visible “Skipped” state does not by itself settle that output behavior. *Fix:* State whether Skip suppresses that role in the generated report. If it does, pass explicit Skip decisions into the content plan and require drafting and its coverage check to honor them; if it only skips ideation, name that narrower effect in the UI and glossary.
- **medium** Dead Batch recovery still lacks a testable deadline (§4.6 FR-27) — A Batch call that dies must be “marked failed within a bounded time,” but no bound or named inherited timeout is supplied. NFR-1's normal p50/p95 latency does not define failure detection, particularly because the human-gated generation is deliberately never reaped for inactivity. Two implementations could leave a writer blocked for very different periods and both claim compliance. *Fix:* Specify the maximum time from the last Batch progress or lease expiry to visible failure and retry availability, or reference a concrete existing recovery deadline that applies to Batch runs.

## Scope honesty — adequate
§7 and §8 distinguish what this release does from tempting extensions: no custom template, no free-text Summary items, no chat integration, no second tag axis, no same-generation replanning after sign-off, and no immediate seed-to-digest learning. FR-39 answers the handoff's undo requirement with named restorations and their staleness effects. FR-8 and §10 row 12 explicitly disclose the narrowing from all decisions to Predecessors, rather than silently changing the handoff.

The assumptions are now easier to audit: twelve index entries cover thirteen distinct concrete assumptions, with latency and budget grouped and two assumptions repeated in §10. Nine questions and three PM notes fit the stated stakes and unattended drafting process. The writer-assertion default is specifically exposed in FR-7 and OQ-9; selecting unsupported AI content is not being presented as proof that it is factual. The proposed domain amendments and unmeasured thresholds remain visible decisions for the next stages.

## Downstream usability — adequate
The 41 unique FR IDs, canonical thirteen-role table, separate Context and Selection Revisions, and glossary make this substantially easier to extract into UX, architecture and epics. FR-12 now supports independently selectable split results, matching UJ-2. FR-41 also makes frozen settings and content precedence explicit instead of leaving the architect to infer which plan wins.

The addendum is expressly nonbinding, which limits the severity of its remaining inconsistencies. Nevertheless it is addressed “for the architect,” and old mechanism statements alongside revised ones create an avoidable extraction trap.

### Findings
- **low** Addendum retains superseded feedback and current-state statements (addendum §A option A; §B “Calls,” “Feedback,” and read-model paragraph; §C Feedback row) — Option A still says “add edit + feedback” despite PRD §0 correctly acknowledging both existing controls. §B first says Feedback “returns one Seed,” then later says “returns 1–3 Revised Seeds”; §C still says “one Seed each.” The active-Subsection read sketch is bounded as “≤ 5 + selections,” omitting the additional unselected Revised Seeds that FR-12 puts in the Shown Set. *Fix:* Reconcile those old paragraphs with FR-12 and §0, and make the read sketch account for Revised Seeds and pagination. Preserve the addendum's nonbinding status.

## Shape fit — adequate
A capability-oriented PRD with four interaction journeys is a good fit for a small writing team and a meaningful UX redesign. It has enough traceability to feed three downstream workflows without adding procurement, market or multi-persona machinery. The brownfield commitments match the supplied extracts: existing mode identity, three report headings, authorization through prose-edit capability, frozen inputs, no new generation statuses and the existing report-creation path are preserved.

PRD §0 now accurately distinguishes implemented edit/guidance controls from the reported experience of being unable to use them (`extract-codebase.md` §§3 and 5). Its definitive diagnosis of “a discoverability and unit-of-review problem” is still a product interpretation rather than an observed usability finding; OQ-7 appropriately keeps discovery open. The remaining old wording in the nonbinding addendum is counted once under Downstream usability. No additional formal sections are needed for these stakes.

## Pass-1 findings status

The nine severity-ranked pass-1 findings are accounted for below. “Resolved” means the revised document closes that finding, not that implementation has been tested.

| Pass-1 finding | Status | Pass-2 evidence |
|---|---|---|
| Experiment coverage is treated as advancement cardinality (high) | resolved | FR-8 now says “several experiments may support one advancement” and “an experiment may support none”; FR-16 and §10 row 7 retain one advancement per resolved uncertainty. UJ-2 illustrates the corrected relationship. |
| Sign-off time counts interruptions the product promises to support (medium) | resolved | SM-2 is “Active time to sign-off,” excludes event gaps of ten minutes or more and reports elapsed time separately without a threshold. |
| Previously generated suggestions can bypass dependency review (high) | resolved | FR-40 applies Context Revision checking to shown, in-progress, prefetched and late-arriving Batches; FR-15 refuses approval while Outdated. FR-4 preserves the warning on reopening. |
| The hard cap can make sign-off unreachable (high) | resolved | NFR-3 names all counted calls, keeps first-Batch access and its automatic retry available after the cap, and defines a once-only authorized extension. Sign-off and cancel are not budget-gated. This resolves budget-caused lockout, not the possibility of repeated model failures. |
| Post-sign-off editing introduces an unspecified second lifecycle (high) | resolved | FR-23 refuses every later seed-stage mutation; §7 and §8.2 explicitly defer same-generation replanning. FR-27 binds recovery to the same frozen Summary. |
| Editing a supported Seed can leave its changed claim looking source-backed (high) | resolved | Glossary Support status and FR-11 classify edited wording as writer-asserted, retain citations as “original source” history, and provide restoration. FR-7, FR-21 and FR-25 carry the marker through Summary and drafting. |
| Reversibility stops short of the handoff's undo requirement (medium) | resolved | FR-39 names restoration for edit, replacement, regeneration, Skip and deselection; each restoration gets normal staleness and approval consequences. FR-12 keeps the original available. |
| The feedback example promises a split that its contract does not explain (medium) | resolved | FR-12 returns one to three independently selectable Revised Seeds, with the original selection unchanged. UJ-2 now selects two split revisions and reaches five selections. The related success-metric issue is a new finding above. |
| The current-stepper diagnosis treats reported experience as verified absence (medium) | partially | PRD §0 explicitly acknowledges the existing textarea and guidance control and reframes the benefit. Addendum §A option A still says “add edit + feedback”; the remaining residue is included in the low finding above. |

The pass-1 mechanical observations are also accounted for, rather than silently dropped:

| Pass-1 mechanical observation | Status | Pass-2 evidence |
|---|---|---|
| FR/UJ/SM uniqueness, continuity and reference resolution | resolved | These checks still hold; FR coverage is now 1–41. See Mechanical notes. |
| §0 incorrectly points to §9 for the Assumptions Index | resolved | §0 now says “indexed in §12.” |
| Assumption roundtrip and open-item counts | resolved | The revised assumption set round-trips through §12; updated counts are below. |
| Inherited definitions should travel with downstream bundles; Corrections-to-acceptable missing locally | partially | §2 now defines Corrections-to-acceptable. Other inherited meanings are still referenced to the prior PRD, so downstream bundles must include that glossary. |
| Individually extracted UJs depend on surrounding context | open | UJ-2 still begins “same project,” UJ-3 “next morning,” and Larry's role remains in the §3.3 introduction. Include that introduction and relevant project context in each extracted journey, or repeat them inline. |
| Shortened Subsection names can drift from canonical roles | resolved | §3.3 explicitly identifies shortened journey labels and designates FR-2 as canonical. Extraction should use the table, not create additional roles from narrative labels. |
| Required sections are present for the product's stakes | resolved | The revised document retains all necessary sections; no additional template structure is called for. |

## Mechanical notes

- FR-1 through FR-41 form a complete, unique set. FR-39, FR-40 and FR-41 occur in their relevant feature groups rather than numeric reading order; that is acceptable. UJ-1 through UJ-4, SM-1 through SM-6 and SM-C1 through SM-C4 are unique and contiguous. Explicit FR references resolve.
- Twelve Assumptions Index bullets cover thirteen distinct assumptions; NFR-1 and NFR-3 deliberately share an index bullet. There are fifteen concrete inline assumption tags, including the two repeated §10 amendment markers, plus §0's generic notation example. No concrete assumption is orphaned. There are nine Open Questions and three PM callouts.
- Glossary cleanup: a Batch is called “immutable” in §2 but Confirm “re-binds” its Context Revision in FR-40 and addendum §B. Distinguish the immutable consumed revision from a later human confirmation revision so the original conditioning record remains intelligible; FR-33's append-only audit events already provide a basis for preserving history.
- UJ-4's “He fixes a bullet directly in the Summary, then signs off” elides the reapproval required by FR-22/FR-20. UJ-3's parenthetical enumeration of approved Successors is incomplete for its stated “everything approved except” entry condition. Treat the FR readiness and dependency rules as authoritative and align these example sentences when preparing UX journeys.
- The inherited glossary must accompany extracted requirements, and UJ excerpts still need their introductory role/project context. These are light extraction obligations, not additional medium-severity findings.
- Severity totals count the four findings in this pass only: **critical 0; high 0; medium 3; low 1**. Pass-1 status: **8 resolved, 1 partially, 0 open** among its nine ranked findings. The mechanical status table separately records the remaining extraction cleanup.
