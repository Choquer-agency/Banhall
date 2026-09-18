Verdict: NOT READY for UX or architecture handoff. The happy path is described; the decision, approval and recovery contracts still permit incompatible implementations and silently wrong plans.

Review scope: `prd.md`, `addendum.md`, `extract-codebase.md`, `extract-prior-prd-spec.md`, `extract-spine-ux.md` and `input-design-handoff.md`, read in full. Existing-system statements below are grounded in those extracts, not a fresh code audit. Reviewer: `gpt-6-astra`, reasoning effort `medium`; BMad adversarial lens. The addendum explicitly declares itself non-binding (line 3), so a mechanism sketched there does not repair an absent requirement.

## 1. The dependency graph disagrees with the context actually sent to the model

**Severity:** high  
**Location:** FR-4, FR-8, FR-17; `prd.md:164-167,206-211,300-305`; handoff, Dependency Logic and Recommendation and Regeneration Context.

**The attack:** Every Batch consumes *all* current Selections, but only changes at a lower fixed outline index invalidate an approved Subsection. Non-linear navigation makes that wrong immediately. Context dependency is not the same as display order.

**Concrete scenario:** (1) Larry jumps to Experimentation and selects experiment A. (2) He opens Company / Context; its Batch consumes A under FR-8, and he approves a framing based on A. (3) He returns to Experimentation and replaces A with B. (4) Company / Context stays approved because it is upstream in FR-2 order. (5) He completes the remaining approvals and signs off two incompatible descriptions. Every stated staleness rule was obeyed.

**Suggested fix:** Choose one normative model: condition only on fixed-order predecessors and record that restriction against the handoff, or record the actual decision/context revision consumed by every Batch and invalidate all affected approvals irrespective of outline order. Define invalidation for selections, skips, feedback and Brief/settings changes consistently.

## 2. Prefetched and in-progress Seeds can become obsolete without ever becoming Stale

**Severity:** high  
**Location:** FR-4, FR-5, FR-17, FR-19; `prd.md:167,178-184,300-305,320`; addendum B, lines 29 and 37.

**The attack:** FR-17 deliberately excludes in-progress work. FR-4 deliberately reuses that work. Nothing requires Approve to check whether its Batch was produced from the current context. Client mutation versioning does not establish which context an asynchronous model response used.

**Concrete scenario:** (1) Larry approves Company / Context with product name Alpha, starting the Goal prefetch. (2) He changes Alpha to Beta while the call is running. (3) The Alpha-based response lands, or was already shown before the edit. (4) Goal is not approved yet, so it gets no Stale flag. (5) Larry approves its old Seeds. No new Batch is required, despite FR-17's promise that the “next Batch” will use current choices. If an architect instead rejects the stale callback using the global fence, no requirement tells UX how the generating row recovers.

**Suggested fix:** Persist the request's context revision and attempt identity. On completion and approval, compare that revision with current dependencies. Specify whether obsolete results are discarded, retained with an explicit outdated warning, or require confirmation. Include failed/obsolete prefetch recovery and deduplication between first-open, prefetch and Regenerate in the binding FRs.

## 3. Feedback can replace approved human choices with unapproved AI choices

**Severity:** high  
**Location:** FR-10..FR-12, FR-15, FR-17, FR-23; `prd.md:235,244,248-253,279,300,357-362`.

**The attack:** Feedback automatically deselects the original and selects the Revised Seed. The edited Subsection has no explicit approval invalidation rule for this operation. FR-10 revokes approval for deselection, but FR-12 can be read as a separate replacement operation; FR-17 only lists tick, untick, edit and un-skip. The document never resolves that ambiguity. A human's approval must bind a specific selection revision, not survive an AI substitution by accident.

**Concrete scenario:** (1) Larry approves an experiment and all downstream Subsections. (2) He submits Feedback on the selected experiment. (3) He enters Summary Review while the response is pending. (4) The Revised Seed inherits selection. An implementation treating FR-12 as its own mutation can leave approvals and readiness intact. (5) Larry signs off changed claims without another experiment approval. An implementation routing it through FR-10 instead invalidates the page. Both are plausible readings.

**Suggested fix:** Specify one transition table for every selection-changing operation, including asynchronous feedback completion. Bind approval to a selected-content revision, invalidate the current approval and affected dependencies when that revision changes, and define whether pending mutations block sign-off or are fenced out after it.

## 4. Editing a cited Seed launders a new claim through old provenance

**Severity:** high  
**Location:** FR-7, FR-11, FR-22, SM-C4; `prd.md:197-202,239-244,349-352,559`.

**The attack:** Byte validation proves that an excerpt exists, not that it supports the edited claim. Only Seeds that lose all citations become Unsupported. Editing preserves the Seed without any required support reassessment.

**Concrete scenario:** (1) A supported Seed says “Prototype tested with 10 users,” citing exactly that transcript excerpt. (2) Larry edits it to “Production deployment validated with 10,000 users.” (3) The edit satisfies the bullet caps. (4) The card still carries its original citation; the Summary need not label it writer-asserted. (5) Prose Generation receives the false evidentiary impression as an approved plan. Even an unedited Seed can cite an exact but irrelevant passage.

**Suggested fix:** Separate source-byte validity from claim support. On substantive edits, preserve original citations as historical provenance and explicitly label the changed assertion as writer-authored/unverified until confirmed against evidence. Carry claim origin and verification status into the frozen Summary, drafting and QA. Do not let an exact quote alone establish support.

## 5. The hard budget can strand a valid project before sign-off

**Severity:** high  
**Location:** FR-5, FR-6, FR-12, FR-20; NFR-3; `prd.md:181-192,251,331,500`; addendum B/C, lines 29 and 43-52.

**The attack:** “Cancel or sign-off still available” is false when a required Subsection has no valid Batch. Calls spent on regeneration, feedback, validation retries and speculative prefetch can exhaust the budget before all required work is reachable. The cap refuses “further Batches,” while Feedback is a one-Seed call, leaving an alternative reading that Feedback bypasses the hard cap.

**Concrete scenario:** (1) Larry spends 59 calls resolving early Subsections and has not opened Overall improvements. (2) The sixtieth call produces only two valid Seeds and fails FR-5. (3) Retry is offered, but NFR-3 forbids another Batch. (4) Approve is unavailable because nothing can be selected; Summary Review and sign-off are unavailable because the required Subsection is undecided. (5) His only defined exit discards the generation as a usable workflow.

**Suggested fix:** Define exactly what consumes the cap, reserve call capacity atomically across concurrent work, and prevent optional calls from consuming capacity needed for completion. Specify a supported exhausted-budget recovery path, such as an authorized extension or resumption carrying the plan forward. Include automatic retries and Feedback in the same policy. Do not advertise an unavailable sign-off escape.

## 6. “Regenerate from summary” has no lifecycle contract

**Severity:** high  
**Location:** FR-1, FR-23, FR-26..FR-28, FR-31; `prd.md:123,357-362,395-410,433-436`.

**The attack:** Post-sign-off edits are explicitly permitted and offer regeneration, but sign-off requires the generation's human-gated state, and the post-generation Summary is read-only. There is no defined way to enter the editable successor, approve it, start a second run, or identify which report it produces. “New Summary version” is not a generation transition.

**Concrete scenario:** (1) Larry signs off version 8; 242 is drafting. (2) In a second still-open workspace, he changes an uncertainty, creating version 9 under FR-23. (3) He chooses “Regenerate from summary.” Version 8 is still the project's active generation, so FR-1 disallows another start; FR-23 also lacks a second sign-off transition from running. (4) Version 8 completes. Version 9 now has no specified edit/review entry point, generation ownership, frozen-input policy or report replacement behavior. A late retry can further compete with a newly started project generation.

**Suggested fix:** Specify the full successor lifecycle: whether editing is allowed during drafting, where a successor plan is edited, how approvals transfer, how it becomes ready, and how its new generation is reserved. Bind each report and retry immutably to a Summary version; enforce active-generation and terminal-state fences. State whether regeneration creates a new report/version through the existing creation path and preserve intervening human prose edits.

## 7. Skip has two competing meanings and no complete invalidation rules

**Severity:** high  
**Location:** FR-8, FR-14, FR-17, FR-21; `prd.md:206,268-271,300-305,339`; addendum B, line 35.

**The attack:** Skipping a previously selected Optional Subsection does not specify whether its Selections are cleared, retained but excluded, or still sent downstream. FR-8 requires *all* Selections and *all* Skips, so “Work plan selected” and “Work plan skipped” can coexist in the same request. FR-17 includes un-skip but omits Skip; the non-binding addendum includes Skip instead.

**Concrete scenario:** (1) Larry selects and approves a Work plan. (2) He approves Hypothesis and Experimentation derived from it. (3) He skips Work plan. (4) The later approvals need not become Stale under FR-17, and the hidden Work plan Selections may still condition further Batches. (5) He un-skips; FR-14 can restore the prior approved state even if its inputs changed while it was skipped.

**Suggested fix:** Define an explicit skipped-state invariant and the effect on active versus retained selections. Exclude inactive selections from context and sign-off. Make Skip invalidate actual dependents, and require restored approval to match a still-valid context/content revision. Reconcile FR-17 and the addendum.

## 8. A record-absence test cannot distinguish legacy from a new generation still initializing

**Severity:** high  
**Location:** FR-1, FR-32; `prd.md:122,440-443`; addendum B, lines 17 and 39; codebase extract §§1 and 3.

**The attack:** Both workflows reuse `iterative`. New generation reservation, analysis/Brief work and seed-row creation are separate stages, but “no seed records” definitively selects the legacy stepper. A newly reserved seed generation has no seed records yet. Partial initialization or initialization failure can make that false classification persistent. The old APIs remain available for real legacy runs.

**Concrete scenario:** (1) A writer starts Step by step just after deployment. (2) Another writer opens the project before seed initialization completes. (3) FR-32 instructs the UI to render the old section stepper. (4) Initialization fails or is retried. Neither surface selection nor the admissibility of old approve/regenerate operations is unambiguously determined by generation identity.

**Suggested fix:** Persist an immutable workflow revision/discriminator at reservation and use it in both read surfaces and mutation guards. Legacy rows get a defined default. Seed generations render an initializing or failed seed state until rows exist; record absence must not authorize the legacy workflow.

## 9. The experimental-unit contract contradicts itself and the existing advancement role

**Severity:** high  
**Location:** FR-8, FR-10, FR-16, §10; `prd.md:210,230,285-290,565-571`; prior-spec extract §4, line 75.

**The attack:** FR-10 permits arbitrarily many selections across Batches. FR-8 then requires at least one advancement Seed per experiment and no more than five Seeds, allowing grouping above five. FR-16 declares each such Selection one distinct advancement. Grouping changes the unit. Separately, the supplied existing content-role contract defines specific advancements as one per *resolved uncertainty*, not one per experiment. Several experiments can resolve one uncertainty; an experiment can fail to establish any advancement. §10 says the content-role amendment is honored but never records this semantic replacement.

**Suggested fix:** Define explicit experiment-to-uncertainty-to-advancement relationships and permit zero advancement for an unsuccessful experiment. Decide whether grouped Seeds contain separately selectable items or represent one genuinely shared advancement. Rewrite the cardinalities consistently and record any departure from the existing resolved-uncertainty role in §10 and the required domain amendment.

## 10. Feedback cannot perform the split promised by the flagship journey

**Severity:** medium  
**Location:** UJ-2, FR-12; `prd.md:86-87,248-252`.

**The attack:** Larry asks to split two experiments into distinct items. The journey says the result yields four chosen iterations. FR-12 permits exactly one Revised Seed, and FR-16 equates one Selection with one item. A two-bullet replacement still produces one Selection, not two independently editable/selectable experiments. Literal compliance with “obeying FR-5..FR-7” is also impossible for the revision if FR-5's three-to-five Batch cardinality is applied.

**Suggested fix:** Either support one-to-many targeted revisions with explicit selection inheritance and lineage, or remove the split promise and provide a defined workflow for creating distinct experiments. State which per-Seed rules apply to Feedback separately from Batch-level cardinality and tag diversity.

## 11. The Summary, editable Brief and frozen settings have no precedence or refresh contract

**Severity:** high  
**Location:** FR-1, FR-8, FR-21, FR-25, §10.6; `prd.md:122,206,345,382-387,570`; prior-spec extract §§1, 2 and 4; handoff, Generation settings.

**The attack:** The Brief remains editable and contains Storyline, Claim Exclusions and exclusive Glossary Terms. Seeds consume the Brief; signed-off Selections become the content plan. The PRD says nothing about which Brief version wins, whether a Brief edit invalidates Seeds, or what happens when a selected plan contradicts an exclusion. A writer can approve a Seed about excluded prior-year work while the Brief says not to claim it. One architect will prioritize the signed-off plan; another will drop it under Brief rules. Both can point to a requirement. The UI shows settings at final generation, but frozen-start settings versus editable-final settings are similarly unresolved.

**Suggested fix:** Bind each Batch and Summary to explicit Brief, Writer Profile and generation-settings versions. Define precedence for content decisions separately from existing style precedence, including conflicts with exclusions and unsupported claims. Define invalidation and required confirmation when those inputs change. Specify whether final settings are read-only or editable and which changes require new sign-off.

## 12. The prior budget amendment is incomplete, and two behavioral retirements escape §10

**Severity:** high  
**Location:** §4.6, §8.2, §10; `prd.md:376,537-540,565-571`; prior-spec extract §4, line 67; codebase extract §§3 and 8; spine extract, AD-24.

**The attack:** §10.4 grants a seed-stage call budget but never explicitly resolves the prior total cost/time ceiling of at most 2x single-mode or the required consistency pass and overrun scorecard. A seed run could satisfy its 60-call budget and still violate the inherited contract. Retiring per-section prose approval is documented as a default assumption, and retiring the ghost draft is documented as an MVP exclusion, but neither is enumerated as an amendment. The extracted code and architecture still describe the old gated path and ghost behavior. Downstream teams must guess which obligations survived.

**Suggested fix:** Expand §10 into an explicit old-contract/new-contract table for gated prose approval, ghost generation, total cost/time ceilings, consistency checks and scorecard reporting. Distinguish pending product defaults from approved domain amendments. Record the required dated architecture/domain changes before treating the new behavior as an inherited invariant.

## 13. Removing the old approval writer silently cuts an existing learning and evaluation feed

**Severity:** high  
**Location:** FR-26, FR-33..FR-34, §8.2; `prd.md:394,453-464,537-540`; codebase extract §§2, 3 and 8, especially lines 79-80.

**The attack:** The extract says `approveSectionDraft` is the only producer of `sectionEditEvents`, and ghost/snapshot baselines feed `reportEditDistance`. New generations retire that approval path and default to no ghost. Counts on seed events satisfy the new “has a reader” requirement but do not preserve those existing consumers. The product may stop learning from this mode or compare different baselines while claiming only the review unit changed.

**Suggested fix:** Enumerate affected readers and give each a replacement event/baseline, an intentional exclusion with visible coverage labeling, or an explicitly approved retirement. Never manufacture a section approval event to disguise a seed decision. Record these contract changes in §10 and test reader behavior for both legacy and seed workflows.

## 14. Feedback outside the current Subsection quietly stops being project context

**Severity:** medium  
**Location:** FR-8, FR-12; `prd.md:172,206-211,253`; handoff, Workflow Requirements and Recommendation and Regeneration Context.

**The attack:** The handoff requires all approvals, edits and feedback as context for subsequent suggestions. The PRD narrows Feedback to the same Subsection without naming that as a scope change. Larry's correction “the client never used cloud services” on Company / Context will not reach later Experimentation requests unless the one returned Seed happens to encode the whole correction and remains selected. A feedback instruction may be a cross-project constraint, not just replacement text.

**Suggested fix:** Preserve project-wide feedback constraints in later requests, or explicitly approve and record a narrower model with a way to promote feedback into project context. Define the handling of contradictory or superseded feedback. Do not present same-Subsection replay as fulfillment of the handoff's broader promise.

## 15. Reversibility and approval-bar availability are reduced from the handoff

**Severity:** medium  
**Location:** FR-10..FR-14, FR-19, FR-29, FR-37; `prd.md:230-271,320-321,418-422,489`; handoff, Screen 2 and Recommendation and Regeneration Context.

**The attack:** “Support undo for destructive changes” becomes retention of prior Batches, a viewable original wording and a reversible Skip. None requires restoration of an edit or of a superseded selected Seed after Feedback. An original marked superseded may be readable but unselectable. The handoff also requires the final approval bar to remain visible during card scrolling; the only explicit bar rule here is “reachable” on narrow screens. A designer can ship substantially weaker reversibility and a disappearing desktop approval action while satisfying the FRs.

**Suggested fix:** Specify the destructive operations with Undo, the restoration target and its staleness effects. Define whether superseded Seeds remain selectable. Make the approval action remain visible during card scrolling at supported breakpoints, or record the deliberate relaxation of the approved handoff.

## 16. Shared navigation state and version fences make collaboration ambiguous

**Severity:** medium  
**Location:** FR-19, FR-29, FR-30; `prd.md:320,418-429`; addendum B, line 37.

**The attack:** “Same seed state live” is useful; a shared active pane is not obviously intended. Navigation-relevant state must persist server-side, but it has no owner scope. The addendum bumps a global version on every mutation. If navigation is shared, Larry opening Company / Context can move Jane away from Experimentation or invalidate her unrelated edit. If navigation is per user, the second-device resume promise works differently from project-wide live state. “Last write wins under the version fence” also obscures that stale writes are rejected, not accepted.

**Concrete scenario:** (1) Larry and Jane open the same generation. (2) Jane types an experiment correction. (3) Larry navigates or saves an unrelated Company edit. (4) Jane saves. Her operation may conflict, refresh and lose unsaved text, or her active pane may have changed; the required UX outcome is unspecified.

**Suggested fix:** Separate shared domain state from per-user navigation state. State the conflict scope and require preservation of unsaved local text when a conflict refreshes server data. Define a reapply/review interaction. Use accurate optimistic-concurrency wording instead of last-write-wins.

## 17. Several “testable” requirements test proxies that do not establish the promise

**Severity:** medium  
**Location:** FR-8, FR-9, FR-25, NFR-1, SM-C1; `prd.md:209,215-219,385,498,556`.

**The attack:** Counting sentence terminators does not enforce “never sentences of prose.” A complete narrative sentence ending in one period passes, while `e.g.` or a decimal can cause false rejection depending on the undefined parser. A fixture in which an edited term appears proves lexical copying, not that the model obeyed the correction; a draft can repeat the term while contradicting it. Latency for Prose Generation is compared with the existing gated mode's “end-to-end” time, which includes unbounded human pauses and has no defined measurement protocol.

**Suggested fix:** Define deterministic shape checks separately from semantic quality evaluation, with fixtures for abbreviations, decimals and full-sentence Seeds. Test factual adherence and coverage using a labeled evaluation set, not token presence alone. Define latency clock boundaries, cohort/context size, model, pause exclusions and the baseline measurement procedure.

## 18. The success dashboard cannot be reconstructed from the required event contract

**Severity:** high  
**Location:** FR-15, FR-18, FR-23, FR-33..FR-34, §9; `prd.md:279,312,360,453-464,546-559`.

**The attack:** FR-33 promises append-only events with an acting user, but does not require event timestamps, generation/Subsection/Seed/version references, approval snapshots, presentation events or stale-start events. FR-34 wants Batches generated, Seeds shown and Regenerates even though those events are not in FR-33. Existing tables may supply some evidence, but the extract does not establish the complete measurement contract. An implementation can satisfy the storage FRs and still be unable to calculate the advertised success criteria consistently.

**Suggested fix:** Make a minimal measurement contract normative: event identity/type/time, project/generation/workflow revision, Subsection/Seed/Batch identifiers as applicable, actor, relevant content/context revision, attempt/outcome, stale-episode identity and approval/sign-off snapshots. Define each metric's cohort, denominator, clock and aggregation policy. Specify existing external evaluation records where product telemetry is insufficient.

### Metric-by-metric storage audit

| Metric | What is required or available in the extracts | Missing contract / exploitable ambiguity |
|---|---|---|
| SM-1: three completed projects by lead writer | Generation completion, approval/sign-off actors; generation and report linkage. | Define lead-writer identity, whether “end to end” means generated or accepted, attribution when several writers act, unique-project deduplication and how new seed runs are distinguished from legacy `iterative` runs. |
| SM-2: median sign-off time for 100–200 claimed hours | Sign-off time explicitly stored; generation start can plausibly come from existing generation records. | No required structured claimed-hours field or source is identified; define which start timestamp, wall time versus active time, abandoned/restarted runs and denominator. The fragmented-over-days journey conflicts with interpreting this as active effort. |
| SM-3: 60% of approved Subsections contain an unedited selected Seed | Original wording retained, edited marker, selection versions and approval actor/time. | Require the selected revision set at approval and a definition of “without a Seed Edit”: ever edited, final text unchanged, feedback-revised, first approval or latest approval? Otherwise repeated approvals and deselection change the result. |
| SM-4: corrections-to-acceptable at most one | Prior evaluation vocabulary is inherited; extract lists review/edit-distance tables. | Neither new FRs nor extracts establish a stored acceptance judgment and correction-round count for this cohort. Name the inherited manual evaluation protocol or add one, with report version and acceptance actor/time. Do not infer acceptability from generation completion or edit distance. |
| SM-5: 70% of Revised Seeds selected | FR-12 automatically selects a revision when its original was selected; feedback lineage is explicit only in the non-binding sketch. | Define voluntary selection/retention after review, not inherited selection at arrival. Persist revision lineage and the acceptance decision. As written, automatic inheritance can meet the target without anyone endorsing the revision. |
| SM-6: stale counts and resolution time | Resolution type recorded; resolution events listed. | No stale-start timestamp/event, episode identifier, coalescing rule for several upstream changes, or duration endpoint is required. A stored current flag/reason cannot reconstruct historical durations. |
| SM-C1: short bullets and zero multi-sentence bullets | Stored Seed bullets and shape checks. | Define generated versus displayed versus selected versus edited population, word/sentence rules and failed-output treatment. Terminator count does not establish sentence count. |
| SM-C2: calls median ≤20, p95 <40 | NFR-2 meters seed-stage calls by generation/Subsection. | Largely derivable if ledger linkage is enforced; explicitly count retries, repairs, prefetch, failures and Feedback, including canceled/incomplete generations in a stated cohort. Otherwise expensive failures disappear from the percentile. |
| SM-C3: unchanged single/compare latency and cost | Existing usage ledger and generation lifecycle; no new gate allowed. | Define paired baseline, model/context normalization, observation window, time-to-first-draft event and allowable tolerance. “Do not change” is not a statistical acceptance rule; a shared prompt-version change alone complicates attribution. |
| SM-C4: no higher GAP/unsupported findings | Post-generation QA scheduled and `qaFindings` exists. | Define taxonomy/counting unit, completed-QA inclusion, matched project/model cohorts and baseline. GAPs expose honest missing evidence; suppressing GAPs can make this metric look better. Require claim-support evaluation so a confident unsupported draft cannot win merely by emitting fewer markers. |

## 19. The feedback metric rewards the automatic selection behavior, not successful feedback

**Severity:** medium  
**Location:** FR-12 and SM-5; `prd.md:252,552`.

**The attack:** Give Feedback only on already selected Seeds and every returned revision is selected automatically. SM-5 can report 100% success at response time even if the writer never reads a single revision or later rejects every one. This is not merely missing telemetry; the measured behavior is built into the feature and cannot validate whether Feedback works.

**Suggested fix:** Measure explicit acceptance or retention of a Revised Seed at the next valid Subsection approval/sign-off, separately from automatic inheritance. Include deselections, superseded revisions and abandoned feedback in a stated denominator. Keep latency and revision failure rates visible so a nominal acceptance percentage does not conceal failed requests.

## Disposition

Counts: **0 critical, 13 high, 6 medium, 0 low**. The first five findings are the primary blockers. The remaining high findings are also contract corrections, not implementation polish. Resolve the transition and dependency rules in the PRD itself, then reconcile §10 against the supplied spec/spine and the design handoff. Leaving these choices to separate UX and architecture work will produce incompatible definitions of what the writer approved.
