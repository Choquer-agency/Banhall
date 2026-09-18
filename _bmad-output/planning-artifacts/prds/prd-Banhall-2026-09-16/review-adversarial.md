Verdict: CONDITIONALLY READY for UX and architecture handoff. The core approval and lifecycle contract is repaired. Resolve three medium contract clarifications before freezing implementation acceptance criteria; the other two findings concern measurement interpretation and do not block the workflow design.

Reviewer and review lead: `gpt-6-astra`, reasoning effort `medium`. Pass 3, 2026-09-16. Review scope: `prd.md`, `addendum.md`, `review-adversarial-pass2.md`, `extract-codebase.md`, `extract-prior-prd-spec.md`, `extract-spine-ux.md`, and `input-design-handoff.md`, read in that order. Existing-system statements rely on the supplied extracts, not a fresh code audit. The addendum is non-binding and cannot override the PRD. This is an adversarial document review, not implementation verification or multi-model consensus. Locations refer to this revision.

## Pass-2 finding status

Resolved means the original attack is closed; it does not promise that every adjacent implementation detail is specified.

| Pass-2 | Finding | Status | One-line reason |
|---|---|---|---|
| 1 | Fresh current Batch launders old selections | resolved | FR-13/FR-15 require explicit reconciliation of every carried selection against current context, regardless of the fresh Batch. |
| 2 | Confirm rewrites history and contradicts Stale | resolved | Consumed revisions remain immutable; the single Confirm and approve action records separate approval revisions and disposes the episode. |
| 3 | Feedback lacks lineage and retraction | resolved | FR-12 records request, target wording, attempt and consumed revision, makes revisions unselected, and defines withdrawal and active context. |
| 4 | Skip disappears during drafting | resolved | FR-14/FR-23/FR-25 freeze Skip decisions, prohibit filling skipped roles from sources, and require compliance reporting and a release fixture. |
| 5 | Completion exemption permits unlimited calls | partially | Durable finite allowances and in-flight reservations close the unlimited-call attack, but the repair and exhausted-allowance recovery rules still conflict. |
| 6 | Legacy rows lack a workflow interpretation | resolved | FR-32 explicitly defaults pre-field gated generations to section-approval through one resolver used by all readers and writers. |
| 7 | Visible Brief differs from frozen Brief | resolved | FR-41 labels the run's version and future-only edits, disables active-run restart, and separates content precedence from terminology normalization. |
| 8 | Advancement linkage depends on experiment approval | partially | Active selections now trigger linkage regardless of approval, but missing links on earlier results are not covered by the explicit approval validator. |
| 9 | Measurement cannot support consistent conclusions | partially | Exposure identity, actors, request cohorts, restoration and episode dispositions are fixed; response timing and outcome reporting retain narrower weaknesses. |
| 10 | Global mutation fence rejects valid late completions | resolved | FR-19 separates writer versions from attempt ownership; FR-5/FR-27 define leases, winning attempts and historical-only late results. |
| 11 | Cost ceiling and semantic acceptance escape hatches | resolved | Section 10 expressly retires the inherited cost ceiling, NFR-1 defines the prose comparison, and FR-25 requires every named manager-judged fixture to pass. |

Status totals: **8 resolved, 3 partially, 0 open**. None of the former high-severity findings remains unchanged.

## 1. Advancement approval rejects inactive references but not absent references

**Severity:** medium  
**Location:** `prd.md` FR-8, line 223; FR-15, line 296; FR-16, line 308; FR-20 and FR-23.  
**Classification:** narrow contract-level validation gap.

**Attack:** The generation-time requirement for structured links applies when Subsection 9 already has active selections. Non-linear navigation permits a Batch generated before that condition holds. The explicit approval and sign-off rule rejects an item if any reference is inactive. An empty reference list has no inactive member. Confirm and approve correctly reconciles old wording with current context, but it does not create missing structured relationships. FR-16 states the intended relationship; the testable validator still falls short of that intention.

**New scenario A:** Larry opens Specific technological advancements first, while there are no experiment selections. Its Batch includes a plausible advancement without structured experiment links. Later he selects uncertainty U1 and experiments E1/E2. The old advancement is now Outdated, so he explicitly confirms and approves it. He judges its wording correct. Its empty references pass a validator checking only whether each supplied reference is active. Sign-off can therefore contain an advancement that meets the freshness requirements but lacks the required auditable relationship.

The prescribed recovery also says the writer can edit an unlinked item, while FR-11 defines edits only to bullets. Changing a sentence that mentions E2 does not necessarily update a structured E1 reference. This is the same missing relationship contract, not a separate severity claim.

**Fix:** At approval and sign-off require exactly one active uncertainty reference and at least one active experiment reference for every selected advancement, regardless of when it was generated. Define the supported way to repair links: an explicit relationship editor, or regeneration/Feedback followed by replacement. If relationship editing is supported, include it in selection revisions and downstream invalidation. Add the empty-reference scenario alongside the existing changed-link fixture. Also make the one-advancement-per-resolved-uncertainty check explicit for multiple selected alternatives, so drafting does not have to decide whether to merge them.

**Severity rationale:** The semantic intent already exists in FR-16, so this is not a missing product concept or the former approval-order failure. It is a bounded discrepancy between the invariant and its enumerated enforcement rules.

## 2. The finite budget still has two incompatible repair and recovery instructions

**Severity:** medium  
**Location:** `prd.md` FR-5, line 191; FR-6, line 203; FR-27, line 440; NFR-3, line 539; `addendum.md` section B, Calls and Budget.  
**Classification:** contract-level recovery clarification.

**Attack:** FR-5 says the only automatic retry is structured-output repair, with two requests maximum per attempt. FR-6 independently says an all-one-tag Batch is regenerated once before an error. The PRD does not explicitly say that this regeneration consumes the same remaining repair opportunity, including when structural repair already used it.

**New scenario B:** Request 1 returns malformed structured output. Request 2 repairs the shape but all three Seeds carry only Technical. FR-5 now requires failure because the two-request allowance is spent; FR-6 still requires one regeneration before surfacing the diversity error. An implementation can either violate the latter instruction or start an unintended third request/new automatic attempt. The finite cap is now real, so this is no longer the former unlimited-exemption defect.

The exhausted initial allowance has a related recovery ambiguity. After three failed initial attempts, FR-27 offers extension or cancel. Extension increases the global cap by 20; no rule states whether it permits a paid fourth attempt on a role whose initial allowance remains exhausted. At six total requests the global cap was not the blocker in the first place. A consultant can appear to need a manager's extension despite substantial unused ordinary capacity, or the extension can appear to do nothing.

**Fix:** State that shape, tag and form validation all share the same two-request attempt budget, with no new automatic attempt after it is spent. Define whether an exhausted initial allowance merely ends the cap exemption, allowing further paid retries when ordinary capacity remains, or permanently blocks the role until a specified extension action. State exactly what extension unlocks and how that request is charged. A successful last allowed attempt must remain usable. Update the non-binding addendum's obsolete first-Batch/automatic-retry exemption so architecture does not copy it.

**Severity rationale:** The hard maximum, reservation and persistent-failure admission are substantial fixes. The remaining issue is the permitted recovery transition and retry composition, not uncontrolled spend or a promise of guaranteed model success.

## 3. Batch latency now includes the writer's delay before opening a prefetched role

**Severity:** medium  
**Location:** `prd.md` FR-5, lines 188-195; FR-33, line 495; NFR-1, line 537.  
**Classification:** contract-level acceptance-measurement mismatch.

**Attack:** NFR-1 ends its Batch latency clock when the Batch is shown. FR-33 now precisely defines shown as a user's first render. Prefetch and navigation away are allowed. A fast response can consequently breach the 30-second percentile solely because the writer has not opened its Subsection. This is separate from the repaired prose-generation latency comparison in pass-2 finding 11.

**New scenario C:** Approval starts the next-role prefetch at 09:00. The validated Batch is ready at 09:00:08. Larry works in a different role, then opens the prefetched role at 09:20. The required event stream correctly reports its first view at 09:20. NFR-1 therefore records 20 minutes for an eight-second Batch, despite correct product behavior. Closing the browser makes the distortion larger; never viewing the Batch leaves the endpoint absent.

**Fix:** Measure request-to-validated-result-available for all attempts, and separately measure foreground request-to-first-render for requests whose role remains visible. Retain first-view events for exposure metrics. Define handling of failures, never-viewed results and prefetch samples. Do not change the truthful exposure definition merely to make the latency number pass.

**Severity rationale:** This can invalidate release acceptance on a correct implementation. It requires a metric boundary decision, not architectural redesign.

## 4. Feedback outcome reporting lacks a normal unsuccessful category and mixes response timing with usefulness

**Severity:** low  
**Location:** `prd.md` FR-12, lines 264-266; FR-15; FR-34, line 502; SM-5, line 596; `addendum.md` section B, Worked event trace.  
**Classification:** measurement semantics and reader implementation.

**Attack:** SM-5 now correctly scores a request once, rather than penalizing a choice among alternative revisions. Its denominator is also explicit. However, FR-34 lists only selected at next Approve, unresolved and withdrawn outcomes. A completed request rejected at its next Approve is none of those under SM-5's definition of unresolved as never followed by approval. The reader needs a failed/not-selected category.

**New scenario D:** Larry requests Feedback at 10:00:00, then confirms and approves the unchanged original at 10:00:05 while the response is pending. At 10:00:08 useful Revised Seeds arrive; he selects one and re-approves at 10:00:15. The literal metric records failure at the first Approve, although the writer later uses the response. This is a defined outcome, not an approval-integrity exploit: the response was unselected and approval of existing content was explicit. It simply cannot be interpreted as revision usefulness without separating pending-at-approval cases.

A request withdrawn before its next Approve is still in SM-5's literal denominator. A request can also succeed at that Approve and be withdrawn later. FR-34's single outcome list does not distinguish historical result from current instruction activity.

**Fix:** Add a not-selected outcome, record whether the response was available/viewed at the qualifying Approve, and keep withdrawal state separate from the frozen first-Approve outcome. Either retain the current timing-sensitive metric with an honest label and breakdown or choose the first Approve after response availability. Explicitly document withdrawal treatment and add pending, rejected, withdrawn and later-selected traces. The present trace covers only immediate success.

**Severity rationale:** No writer decision is lost and the percentage has a literal computable definition. This is a low-severity interpretation and dashboard gap, not a reason to block the seed workflow.

## 5. A stale episode can be labelled regenerated when every retained item was only confirmed

**Severity:** low  
**Location:** `prd.md` FR-15, line 295; FR-18, line 331; FR-34, line 502.  
**Classification:** instrumentation semantics.

**Attack:** An episode is marked regenerated if the shown Batch was produced after the episode opened. That timestamp does not prove that its request consumed the changed context or that any selected Seed came from it. This does not reopen the old freshness exploit: Confirm and approve still performs the correct human reconciliation. It only gives the resolution a misleading label.

**New scenario E:** A regeneration starts under context C1. An upstream edit changes context to C2 and opens a stale episode before the response returns. The C1 Batch completes after that opening, is correctly shown Outdated, and contains no selections Larry wants. He retains his earlier selected Seeds and explicitly confirms and approves against C2. FR-15 nevertheless classifies the resolution as regenerated because the shown Batch was produced after the episode opened.

**Fix:** Record independent facts: whether a fresh-context attempt completed during the episode, whether its Seeds entered the approved selection snapshot, and whether confirmation of older selections occurred. If one label must be retained, define it using consumed context and selected lineage; alternatively name the current timestamp-based category accurately. Add this trace to the reader's expected outputs.

**Severity rationale:** Approval, Summary readiness and immutable provenance remain correct. Only attribution of how the episode was resolved is wrong.

## Re-attacks that no longer justify findings

- **Merged Confirm and approve / consumed versus approved revisions:** A fresh unselected Batch cannot certify old selections. Confirmation binds current context and selection revisions without rewriting consumed history. An unrelated writer edit must pass the expected-version fence. An Outdated badge may remain after valid approval because historical generation context and current human acceptance are intentionally different facts.
- **Feedback withdrawal and late response:** Withdrawal changes context; a still-owned response can arrive Outdated and unselected. Selecting it requires an explicit selection and, where applicable, confirmation. A superseded or closed-stage response is historical only. Withdrawing an instruction does not promise to erase previously selected text, so that is not a defect. Skip makes Feedback inactive; architecture should distinguish skip inactivity from permanent withdrawal when specifying Unskip, without resurrecting withdrawn instructions.
- **Skip in the plan:** Skip is explicitly frozen, sent to drafting and checked in the Compliance Note. The old resurrection-from-Brief scenario is closed. A pending Batch completing after Skip should be tested to ensure it cannot undo the skip decision; the PRD's explicit writer-controlled Skip and attempt rules already give the intended invariant. That is an implementation verification case, not evidence that the prose contract is absent.
- **Attempt ownership / late results:** A timed-out attempt returning after its replacement cannot become current. Sign-off and cancel prevent reopening the seed stage while preserving late audit and usage records. The architecture still needs the ordinary transaction and reaper tests, but no new high-severity contract defect was found here.
- **Legacy resolver:** A pre-field iterative row resolves to sections, a new seeds reservation without Subsection rows renders initialization, and each mutation rejects the other workflow. Backfill mechanics belong downstream; the missing-field product behavior is now specified.
- **Measurements already repaired:** Restoring AI wording counts for SM-3; SM-5 is per request; bypassed stale episodes are separately reported; SM-2 admits that its clock is an event-gap proxy and requires observed-session validation; exposure events distinguish completion from first user view; unsupported-claim findings replace a penalty on honest GAP markers. These fixes should not be relitigated as open pass-2 defects.

## Disposition

Severity totals: **0 critical, 0 high, 3 medium, 2 low**. Five concrete new scenarios are included. Findings 1-3 are bounded contract decisions for validation, recovery and acceptance measurement. Findings 4-5 belong to metric/read-model refinement. No remaining finding demonstrates the former silent approval bypass, unlimited initial-call exemption, missing legacy interpretation or lost Skip plan.

The document is suitable for UX and architecture work with the three medium clarifications tracked and settled before acceptance criteria are frozen. This review does not approve the proposed product-domain amendments or claim implementation tests have passed. Verification performed here is review of the supplied contracts and scenario traces; no application code was changed or executed.
