Verdict: NOT READY for UX or architecture handoff. The revision fixes several original defects, but its new freshness and approval machinery still permits incompatible implementations and approval of a plan whose retained ideas were never reconciled with the current context.

Review scope: `prd.md`, `addendum.md`, `review-adversarial-pass1.md`, `extract-codebase.md`, `extract-prior-prd-spec.md`, `extract-spine-ux.md` and `input-design-handoff.md`, all read in full. Existing-system claims are grounded in the supplied extracts, not a fresh code audit. Reviewer and review lead: `gpt-6-astra`, reasoning effort `medium`. This is a single-reviewer adversarial pass, not multi-model consensus. The addendum is explicitly non-binding; its sketches cannot supply missing requirements, and contradictory sketches are called out where they invite implementation drift. Locations below use current file line numbers.

## Pass-1 disposition

“Resolved” closes the original attack, not every adjacent risk. “Partially” means a material part of that finding still lacks a consistent contract.

| Pass-1 | Finding | Status | One-line reason |
|---|---|---|---|
| 1 | Dependency graph disagrees with actual context | resolved | FR-8 restricts Batch context to fixed-order Predecessors and §10 records the narrowed handoff promise. |
| 2 | Prefetched and in-progress Seeds become obsolete silently | partially | FR-40 covers late and unapproved Batches, but approval checks only the current Batch, leaving carried selections and Feedback results outside the freshness guarantee. |
| 3 | Feedback silently replaces approved choices | resolved | FR-12 now inserts revisions unselected, selection changes revoke approval, and FR-23 rejects mutations after sign-off. |
| 4 | Editing launders claims through old provenance | resolved | FR-11 marks every edit writer-asserted, retains citations as history, and carries support status downstream; the glossary explicitly limits byte validity. |
| 5 | Hard budget strands valid projects | partially | First-Batch exemptions and an extension unblock the original example, but the exemption is unbounded under repeated failure and concurrent capacity is unspecified. |
| 6 | Regenerate-from-summary lacks a lifecycle | resolved | FR-23 removes plan editing after sign-off from MVP, while FR-27 binds prose recovery to the existing frozen Summary. |
| 7 | Skip has competing selection meanings | resolved | FR-14 explicitly retains but deactivates selections, invalidates Successors, and forbids restoring approval on Unskip; prose omission remains a new adjacent gap. |
| 8 | Record absence misclassifies initialization as legacy | partially | Reservation now stamps workflow and FR-32 branches on it, but existing rows without that field still have no required interpretation. |
| 9 | Experimental units contradict advancement roles | partially | FR-16 restores the resolved-uncertainty unit, but FR-8 conditions its linkage guarantee on an approval event that does not change the Decision Set. |
| 10 | Feedback cannot perform the promised split | resolved | FR-12 supports one-to-three revisions, explicit selection and per-Seed validation separately from Batch validation. |
| 11 | Brief, Summary and settings lack precedence | partially | FR-41 freezes versions and orders content precedence, but the visible editable Brief and conflicting inherited terminology rules remain unreconciled. |
| 12 | Budget amendment and behavioral retirements incomplete | partially | §10 records both retirements and the drafting-time ceiling, but does not explicitly dispose of the inherited total cost ceiling. |
| 13 | Retiring section approval silently cuts learning feeds | resolved | FR-34 visibly excludes seed decisions from the digest and §10 specifies the replacement edit-distance baseline. |
| 14 | Feedback stops being project context | partially | FR-12 propagates Feedback to Successors, but contradictory, withdrawn and superseded Feedback has no active-state or precedence rule. |
| 15 | Reversibility and approval bar weakened | resolved | FR-39 names restoration actions, originals remain selectable, and §4.3 plus FR-37 keep the action bar visible while scrolling. |
| 16 | Shared navigation and conflict behavior ambiguous | resolved | FR-4/FR-30 make navigation private and FR-19 preserves unsaved text after rejecting stale writes. |
| 17 | Testable consequences are weak proxies | partially | Semantic fixtures and deterministic parsing are now required, but evaluation acceptance and comparable latency measurement remain unspecified. |
| 18 | Dashboard cannot be reconstructed | partially | FR-33 adds revisions, times, snapshots and stale episodes, but presentation/response identity and several cohort/clock rules remain incomplete. |
| 19 | Feedback metric rewards automatic selection | partially | Automatic selection is gone, but alternatives, later approvals and responses never followed by approval still lack a coherent denominator. |

## 1. A fresh current Batch launders old selections past the freshness gate

**Severity:** high  
**Location:** Glossary, `prd.md:43-59`; FR-10, FR-13, FR-15 and FR-40, `prd.md:242-249`, `271-276`, `291-295`, `343-348`.

**Attack:** Freshness belongs to the current Batch; approval belongs to all active selections, potentially drawn from several older Batches. Those are different sets. Regenerate expressly keeps earlier selections, but Approve checks only whether the new current Batch is Outdated. Generating some fresh alternatives is not confirmation that the retained old claims remain correct. The current rules allow the architect to clear the blocker simply by replacing a Batch pointer while UX tells the writer their selected plan has been refreshed.

**Concrete scenario A, fresh-wrapper approval:** Larry approves uncertainty U and selects experiment E from Batch B1. He then removes U upstream. Experimentation becomes Stale. He presses Regenerate, which produces B2 under the new context without E. FR-13 keeps E selected at the top. Larry selects nothing in B2 and presses Approve. B2 is fresh and the selection count is nonzero, so the required server checks pass. E is now approved under a context it never consumed and the writer never explicitly confirmed it against. The same exploit works with selections carried through Previous Batch restoration.

**Fix:** Make approval bind the complete selected plan to the current Decision Set. Either require explicit reconfirmation of retained selections whose consumed context differs, or define Approve as that explicit reconciliation and require the UI to identify the carried items and their changed dependencies before accepting it. Persist the reconciliation per selected revision. A fresh unselected Batch must not silently vouch for older selected content.

## 2. Confirm both rewrites history and leaves Stale with two incompatible meanings

**Severity:** high  
**Location:** Glossary, `prd.md:44-59`; FR-15, FR-18, FR-40, `prd.md:295`, `325-331`, `343-348`; `addendum.md:35`.

**Attack:** A Batch is an immutable AI result recording the Context Revision it consumed. Confirm then overwrites that revision with one the AI did not consume. The same field is being used for historical provenance and a human acceptance. Append-only events record the current revision, but no binding requirement preserves the original request revision or the before/after pair, so the purported context audit can lie after confirmation.

There is a second contradiction. Stale is defined as an approved Subsection whose Batch is Outdated or whose Selection Revision differs from approval. After Confirm changes the Batch revision, neither predicate need remain true. FR-18 nevertheless requires Confirm **and re-approve**, and says the episode closes through that path. One implementation recomputes Stale to false and enables Summary Review immediately; another preserves a sticky flag until Approve. Both can cite this PRD. The addendum reproduces the conflicting formula and close-on-approve rule.

**Concrete scenario B, confirmation shortcut:** All Subsections are approved. An upstream change makes a downstream Batch Outdated without changing its selections. Larry confirms it. A predicate-based backend now reports no Stale flag and ready Summary, although the downstream approval still records the old Context Revision. A transition-based backend keeps Sign-off blocked. UX cannot design one truthful state transition until this is settled.

**Fix:** Preserve immutable `consumedContextRevision` separately from the human-confirmed revision. Define approval validity against both selected content and the context explicitly accepted by the writer. State exactly whether Confirm alone restores validity or whether a separate Approve remains mandatory; derive readiness, row state and episode closure from that same rule. Retain both revisions and the actor in the confirmation record.

## 3. Feedback is permanent context without complete request lineage or retraction

**Severity:** high  
**Location:** Glossary, `prd.md:43-54`; FR-8, FR-12, FR-17 and FR-40, `prd.md:219-225`, `262-267`, `318-323`, `343-348`; `addendum.md:29`, `31`, `41`.

**Attack:** Every Feedback text permanently enters this Subsection's regenerations and every Successor's Decision Set. No rule withdraws an instruction when the writer rejects its revisions, corrects the instruction, skips the Subsection or gives contradictory Feedback later. “Use no cloud services” and “Correction: the deployment was on AWS” can therefore remain equally authoritative forever. This is a bag of historical instructions masquerading as a current decision.

The lineage guarantee identifies the original Seed, not the exact target wording, Feedback request, frozen request context or attempt. Two requests against the same Seed, or an edit while Feedback is running, can produce indistinguishable revisions with different premises. Revised Seeds are not Batches under the glossary, so FR-40 does not clearly mark their late results Outdated. Moreover, same-Subsection Feedback affects its regenerated prompt under FR-12 but is absent from that Subsection's defined Decision Set: two materially different prompts can carry the same supposedly identifying Context Revision. The addendum also retains an obsolete one-Seed response sketch beside its new one-to-three rule.

**Concrete scenario C, obsolete split:** Larry asks to split a selected “cloud batching experiment” into two runs. While that call runs, he edits the original to say the experiments ran on-premise and adds correcting Feedback. The first call returns two cloud-based revisions. They have lineage to the same original, but no required outdated marker or target-version explanation. Larry selects one thinking it incorporates his latest correction. The current Batch can still be fresh, and both Feedback instructions continue downstream.

**Fix:** Require Feedback request identity, target Seed revision, immutable consumed context, attempt and outcome, with result-to-request linkage. Apply an explicit freshness rule to targeted results. Define active versus historical Feedback and a correction/withdrawal action, including its invalidation effects and Skip behavior. Include every context-affecting input in the applicable request revision, while distinguishing human-authored constraints from archival Feedback. Reconcile the addendum to the binding response cardinality.

## 4. Skip disappears exactly where the report is drafted

**Severity:** high  
**Location:** FR-14, FR-21, FR-25 and FR-41, `prd.md:280-287`, `366`, `401-406`, `419-424`; `addendum.md:33`; inherited content roles in `extract-prior-prd-spec.md:75`.

**Attack:** Skip now has sound selection semantics, but no binding prose semantics. The Summary displays it; the required drafting payload contains active Seed Selections, support status and order. It does not require explicit skipped-role decisions, and content precedence names only Seed Selections above Brief entries. The inherited role prompt can therefore draft a skipped Work plan from the Brief or transcript. Its Compliance Note need only account for selected Seeds, so it need not report that it ignored a Skip. “Not applicable” becomes “nothing selected, fill this from the sources.”

**Concrete scenario D, resurrected role:** Larry selects a Work plan, then deliberately skips it after deciding that it does not apply. He resolves downstream staleness and signs off a Summary visibly saying “Skipped.” The frozen Brief still contains the original plan. Section 244 receives no active Work plan selections, follows the existing role prompt, and includes that plan. Every required selection is covered; every stated drafting consequence can pass.

**Fix:** Put explicit Skip decisions into the frozen plan and every applicable drafting/self-check request. Define whether Skip forbids that role's coverage or has some narrower meaning, and define its precedence over Brief/source suggestions. Require the Compliance Note and semantic fixtures to verify the chosen behavior, including a skipped role strongly supported by the frozen Brief.

## 5. The completion exemption makes the hard cap potentially unlimited

**Severity:** high  
**Location:** FR-5, FR-6, FR-13 and NFR-3, `prd.md:192-195`, `204`, `275-276`, `538`; `addendum.md:29`, `41`, `54`.

**Attack:** “The first Batch of a Subsection with no shown Batch” is not a finite allowance. A failed attempt leaves no shown Batch. Its manual retry can be classified as another first Batch, with another exempt automatic retry, indefinitely. If “first” instead means the first historical attempt, two invalid outputs exhaust the exemption and the original stranded-project problem returns unless an eligible person grants the one extension. The text promises that every Subsection can always be decided without selecting either interpretation.

The cap also counts calls but does not require atomic reservation of in-flight capacity. Different Subsections can start at once. A ledger-based implementation, as sketched in the addendum, can admit several paid calls at 59 before any completion is metered. Finally, FR-5 and FR-6 each describe their own retry, while structured-output repair is a separate existing mechanism. No rule tells the implementer whether those limits compose or share one retry allowance.

**Concrete scenario E, no shown Batch forever:** At 60 calls, the last untouched required role repeatedly returns invalid tags. Each two-attempt failure leaves it without a shown Batch. The Retry button either purchases unlimited exempt calls or eventually refuses and makes the unconditional completion promise false. The PRD currently requires the team to choose which guarantee to break.

**Fix:** Define a finite per-role initial-attempt allowance by durable attempt identity, one shared retry policy across validation/repair layers, and the exact order of exemption and prefetch rules. Reserve counted capacity atomically before dispatch, including in-flight work. State the maximum possible total after exemptions/extension and a truthful recovery outcome when all allowed initial attempts fail. Do not claim guaranteed completion in the presence of persistent model failure.

## 6. Legacy preservation still has no rule for the legacy rows that actually exist

**Severity:** high  
**Location:** FR-1 and FR-32, `prd.md:133`, `475-479`; `addendum.md:39`; `extract-codebase.md:17`; migration invariant, `extract-spine-ux.md:26-28`.

**Attack:** The new discriminator correctly fixes the initialization race for new reservations. It does not classify pre-release generations. The supplied schema extract does not contain this new workflow field, and the inherited migration rule requires widening with optional fields. FR-32 specifies behavior only for a generation already “recorded as” section-approval or seeds. A legacy `iterative` row with no discriminator satisfies neither branch. An implementer can reject it, default it to seeds, or infer from record absence, the exact heuristic pass 1 rejected.

**Concrete scenario F, deployment with an open old run:** Jane leaves an old Section 244 draft awaiting approval overnight. Deployment adds the optional workflow field. Her generation has no value. On reload, one frontend defaults undefined to the new workspace while the legacy mutation interprets it as sections; another refuses all actions. The promised preservation of old surfaces does not determine the answer.

**Fix:** Define the immutable effective workflow for missing-field legacy rows, scoped to relevant modes, and use the same resolver for queries, mutations, recovery and telemetry. Specify backfill/default compatibility during deployment and test an old awaiting-input row, an old completed row and a newly reserved seed row without initialized Subsections. Never infer workflow from seed-row existence.

## 7. The frozen Brief can disagree with the Brief the writer is looking at

**Severity:** medium  
**Location:** UJ-4 and FR-41, `prd.md:111`, `399-407`; inherited terminology, `extract-prior-prd-spec.md:19-23`; existing Brief rail behavior, `extract-spine-ux.md:38`.

**Attack:** Freezing the Brief is now clear to the backend, but the visible Brief remains editable and “works as today.” No requirement labels the active generation's frozen version or distinguishes it from a newer displayed edit. A writer can correct a Claim Exclusion in the rail, see that correction while approving Seeds, and still be warned and drafted against the old version. “Regenerate with this Brief” starts a new generation, while this project already has an active one; the required UX response to that action is unspecified.

There is also a remaining boundary inside precedence. Seed content beats Brief entries, while style precedence is unchanged and inherited Glossary Terms are exclusive. If a Seed uses a term excluded by the frozen glossary or a terminology preference in the Writer Profile, the PRD does not say whether this is a content override or a style normalization. Two drafters can obey different chains. §10 does not enumerate the new Claim Exclusion override or frozen-Brief behavior as explicit old/new amendments.

**Fix:** Require the rail and Summary Review to identify the exact frozen Brief used by the run and label any newer edits as applying only to a new generation. Define the active-run behavior of “Regenerate with this Brief.” Classify glossary/terminology conflicts explicitly within content versus style precedence and record the new Brief behavior in §10. Bind exclusion confirmation to the selected revision and exclusion version it acknowledges.

## 8. Advancement linkage can be bypassed by approving Experimentation after generating advancements

**Severity:** high  
**Location:** FR-8, FR-15 and FR-16, `prd.md:224`, `295`, `302-307`; Decision Set definition, `prd.md:43`; FR-17, `prd.md:318`.

**Attack:** The resolved-uncertainty meaning is repaired, but its testable guarantee is conditional: advancement Seeds must name uncertainties and supporting experiments **when Subsection 9 is approved**. Non-linear navigation allows generating and selecting those Seeds before approval. Approving Subsection 9 changes neither its selected wording nor the defined Decision Set, and approval is not an invalidation trigger. A previously generated advancement Batch can remain fresh even though it was not required to satisfy the now-applicable linkage rule. FR-16 states the desired semantic relation, but neither approval validation nor refresh establishes it for this path.

**Concrete scenario G, same selections, new obligation:** Larry selects five experiments without approving them, opens Specific technological advancements and gets generic suggestions. He returns and approves Experimentation without changing a selection. The advancement Batch's Context Revision is unchanged. He then approves its generic Seeds; FR-15's only content-related checks concern selection presence, freshness and Claim Exclusions. The advancement requirement can be violated without any defined state transition detecting it.

**Fix:** Make the linkage requirement independent of approval status whenever experiment decisions exist, or include the relevant approval state in context identity and invalidate affected results when it changes. Require structured links or another explicit validation/evaluation rule for selected advancement items at approval/sign-off, including references to removed experiments and multiple selected alternatives for the same resolved uncertainty. Do not rely on an incidental visit order to satisfy the role contract.

## 9. The measurement contract is richer, but it still cannot support its conclusions consistently

**Severity:** medium  
**Location:** FR-33/FR-34, `prd.md:491-502`; SM-2 through SM-6 and counter-metrics, `prd.md:586-602`.

**Attack:** The new event fields repair much of pass 1. They do not finish the measurement semantics:

- **“Shown” has no presentation identity.** Does a prefetch completing while nobody views its role count as shown? Does reopening or a second client count again? Revised Seeds have no required result-shown event. FR-33 requires a user actor even for system-created stale transitions or automated Batch events without defining attribution. Different readers can produce different exposure counts from the same behavior.
- **SM-2 measures event spacing, not active effort.** A writer reading and thinking for 11 minutes creates no interval shorter than 10 minutes; that entire active period vanishes. Generation-start and first-event boundaries are also not specified as seed events. Two simultaneous users' activity is merged by generation unless a per-user aggregation rule is added. The metric can reward long difficult pauses while claiming they were breaks.
- **SM-5 punishes the new alternative-generation feature.** Feedback may return three alternative revisions, of which exactly one is correct. A successful writer choice scores 33%, not 70%. For an item rejected at the first Approve and selected at a later Approve, “all Revised Seeds returned before that Approve” also allows repeated denominators unless response cohorts are partitioned. Responses with no later Approve have no stated treatment.
- **SM-6 silently loses unresolved pain.** Episodes close only on approval, but Skip can make an Optional Subsection decided and cancel can terminate a generation. Neither operation has a required episode disposition. Median duration can exclude precisely the abandoned or bypassed episodes with the highest friction.
- **SM-3 uses both final equality and “no Seed Edit.”** Restore original wording can satisfy equality but fail an ever-edited interpretation. The outcome is not defined.
- **SM-C1's rejection rate has no required numerator record.** Dropped Seeds never become shown Seeds and FR-33 does not require validation-attempt counts. SM-C3/SM-C4 normalize by model/window but not input complexity or selection into modes; they are observational indicators, not proof that this feature caused or avoided regression.

**Fix:** Specify one measurement mapping from durable events/results to each metric. Define unique exposures, system versus user attribution, Feedback request/result cohorts, unresolved-episode censoring and cancellation/Skip outcomes. Measure Feedback success per request or task with explicit split-versus-alternative semantics. Either instrument actual sessions or call SM-2 an event-gap proxy and validate it before imposing an effort target. Record validation totals and define matched evaluation cohorts for causal regression claims. Include a small worked event trace with expected numbers so two implementations must agree.

## 10. The global mutation fence conflicts with the promise to retain late Batch results

**Severity:** high  
**Location:** FR-5, FR-19, FR-23, FR-27 and FR-40, `prd.md:196`, `338`, `388`, `440`, `343-348`; `addendum.md:35-37`; existing attempt fences, `extract-codebase.md:32`, `73`.

**Attack:** “Every seed-stage mutation” must carry the expected global version, and stale versions are refused. A Batch completion is a mutation. FR-40 separately requires a completion whose context changed to be stored and shown, never discarded. If the completion uses its dispatch version, any intervening selection or unrelated save rejects the result. If it fetches the current version and retries, the PRD still needs an attempt fence to distinguish that legitimate late completion from a timed-out attempt that has already been replaced. A global version is not request ownership.

FR-27 requires a dead Batch to become failed within a “bounded time” without a bound, and gives no winning rule if its response arrives after the retry. FR-23 then bans every seed-stage mutation after sign-off, while FR-40 says late results are never discarded. The architect can choose a sensible priority, but the product contract has not chosen one.

**Concrete scenario H, timeout followed by resurrection:** A first-open Batch times out and the role returns to its prior state. Larry retries and receives B2, then approves it. B1 finally completes. Both results consumed the same Context Revision. One implementation replaces B2 with B1 because it is not Outdated; another drops B1 by an attempt fence; a third rejects it on the global version and leaves no required audit outcome. These are different experiences under the same FRs.

**Fix:** Separate client optimistic concurrency from asynchronous request/attempt fencing. Define which attempt may become current, which late results are historical only, and how superseded, cancelled and signed-off generations dispose of completions. Preserve usage/outcome audit without reopening frozen domain state. Specify a maximum timeout and make the late-result guarantee explicitly subordinate to lifecycle and attempt ownership.

## 11. The old cost ceiling and the new acceptance tests still leave escape hatches

**Severity:** medium  
**Location:** FR-8/FR-9/FR-25, `prd.md:223`, `233`, `422`; NFR-1, `prd.md:536`; §10 row 4, `prd.md:613`; `extract-prior-prd-spec.md:46`, `67`.

**Attack:** The inherited requirement caps both time and cost relative to single mode. §10 now explicitly scopes the 2x ceiling from sign-off to report creation, which is a time interval, but does not say whether total cost is retired, applies only to prose, or includes seed calls. A separate call-count budget is not a cost ceiling: different models, contexts and repairs cost different amounts. Costly seed runs can be declared compliant or noncompliant depending on which artifact the architect treats as controlling.

NFR-1 also requires prose time within single-mode drafting plus consistency, while §10 preserves a 2x ceiling. The tighter bound may be intentional, but the comparison cohort, baseline statistic and treatment of retries are undefined. “A labelled fixture set judges that Sections follow the plan” supplies neither a judge protocol nor a pass threshold. A team can show one passing fixture, fail the important conflicts, and still claim to have installed the required harness.

**Fix:** State the surviving cost obligation in money/tokens or explicitly retire/rescope it as a proposed amendment. Define which latency bound is normative, its model/context cohort, statistic, retry policy and baseline procedure. Specify a small release-blocking semantic suite with expected outcomes and pass criteria covering retained old selections, Skip, corrected Feedback, Claim Exclusions and stale advancement links. The test contract must constrain the bad behaviors above, not merely require that some evaluation exists.

## Disposition

Counts for this pass: **0 critical, 8 high, 3 medium, 0 low**. The pass-1 table contains **9 resolved, 10 partially, 0 open** findings. This is meaningful progress, but not a handoff-ready state machine.

The first five findings are the primary blockers. Resolve the distinction between generated context, human-confirmed context and approved selected content; carry Skip and active Feedback into the final plan explicitly; then close the finite-budget and lifecycle rules. UX and architecture should consume the same transition and measurement examples, or they will again implement different definitions of what the writer approved.
