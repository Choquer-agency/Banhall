Verdict: BROKEN for story handoff. Revise the feature spine and resolve inherited-contract conflicts before implementation.

# Rubric review

Reviewed 2026-09-16 at FEATURE altitude. Sources read in full: the feature `ARCHITECTURE-SPINE.md` (AD-31 through AD-43), the binding, read-only parent `architecture-Banhall-2026-09-03/ARCHITECTURE-SPINE.md`, the driving `prd-Banhall-2026-09-16/prd.md`, and its `extract-codebase.md`. Parent identifiers below refer to that parent; child identifiers refer to this feature. Review concerns the written architecture, not an assertion that proposed code already exists. An independent reviewer explicitly configured as GPT-6 Astra with medium reasoning checked inheritance. No source spine or parent was changed.

Severity counts: critical 0; high 12; medium 8; low 1. Findings are counted once even when they affect several checklist items.

## Checklist judgments

| Checklist item | Judgment | Evidence and consequence |
| --- | --- | --- |
| Fixes the real divergence points for stories, missing none | broken | AD-31/33/36/37/40 choose the right durable records, version fences and handoff, but batch identity, immutable input materialization, advancement references, restoration, and asynchronous state transitions still admit incompatible implementations (F05-F10). |
| Every AD Rule is enforceable and prevents its stated divergence | broken | AD-32 and AD-40 are concrete. AD-33's closed writer list excludes writers required elsewhere; AD-34/42 fingerprints cannot deduplicate open against prefetch; AD-38 cannot return links required by AD-36; AD-36's update algorithm omits its own feedback revision (F05-F10). Test names do not reconcile incompatible rules. |
| Nothing Deferred can let two units diverge | broken | Ghost retention and a second gate change baseline, events, state transitions and scheduling; the ghost Deferred row directly contradicts AD-37. Budget/latency numbers affect contracts already specified by AD-34. These must be pinned defaults with a change procedure, not parallel choices (F17). |
| Ratifies brownfield instead of contradicting it | thin | AD-37 correctly identifies and explicitly extends the existing ordered-chain guards; AD-40 retains old stepper routing. AD-32 acknowledges natural-language roles rather than inventing existing identifiers. But AD-33 places default-runtime mutations in the Node AI module, and its registry rollout cannot pass its own whole-schema guard. Initialization/retry seams are incomplete (F10, F11). |
| Covers every PRD FR/NFR | thin | Most requirements have a plausible owner, but FR-22, the report entry point of FR-28, and pagination in NFR-6 have no governing AD. FR-6, FR-8, FR-14, FR-27, FR-34, FR-41 and NFR-1/3/5 have materially incomplete or contradictory rules. Full map below. |
| No child AD weakens or contradicts a parent AD | broken | AD-34 conflicts with parent AD-27 and AD-7/Q10; AD-37 conflicts with parent AD-2 and AD-24; The baseline exception is explained by the removal of pre-assembly prose editing; the gate change still requires approval. PRD §10 explicitly says its domain amendment is proposed, not approved, so parent AD-15 remains a gate (F01-F04). |
| Every feature-owned dimension is decided, deferred or an open question | thin | Each broad dimension is mentioned, but several execution contracts within those dimensions are neither decided nor explicitly open. Mentioning a module or an enforcing test is not a decision (dimension inventory below). |

## Findings

### F01. Request refusal contradicts the inherited budget policy

- **Severity:** high
- **Location:** AD-34; parent AD-27, AD-9/Q12; PRD NFR-3 and §10 row 4.
- **Note:** AD-34 hard-refuses requests at a count threshold. Parent AD-27 expressly says no call is refused on budget. This is a request cap rather than a monetary spend cap, so AD-9's monetary policy alone would not settle it; AD-27's broader prohibition does. The PRD wants this change, but cannot silently amend a parent declared binding here.
- **Fix:** Record the conflict and require an approved parent/domain amendment permitting a separate seed request cap while preserving alert-only monetary spend. Keep the parent read-only in this review; identify the exact upstream decision needed before dependent stories execute.

### F02. New iterative workflow changes the binding approval-gate contract

- **Severity:** high
- **Location:** AD-31, AD-37, AD-39, AD-40; parent AD-24, AD-12, AD-15; PRD §10 rows 8-10.
- **Note:** Parent AD-24 says iterative mode and its approval gate remain unchanged. The feature replaces section approval with Summary sign-off. Legacy preservation does not make that inherited statement true for new iterative rows. AD-37/39 also replace section-edit distance with generated-snapshot distance and no sectionEditEvents. That baseline is appropriate under parent AD-12 once there are no pre-assembly prose edits; it is not an independent weakening of measurement. The PRD discloses that the domain amendment is not approved. These are legitimate proposed product changes, not ratified inheritance.
- **Fix:** Name the AD-24 amendment and parent AD-15 approval dependency explicitly; explain the AD-12 baseline applicability for the new workflow. Make the new workflow's gate and baseline conditional on that approval, with one pinned implementation contract afterward.

### F03. Budget-extension permission invents a capability mapping

- **Severity:** high
- **Location:** AD-34 `extendBudget`; parent AD-7/Q10 and Q3; PRD NFR-3.
- **Note:** The feature permits a Manager to extend provider request capacity through `project.setStage`. Parent AD-7/Q10 excludes Managers from spend until suitable capability cells ship. Q3 permits report-edit access for generation-adjacent writers; it does not authorize mapping budget authority to stage changes. The PRD requests Manager access but does not supply an approved domain amendment.
- **Fix:** Escalate this explicit parent conflict and define an approved capability mapping for extending seed capacity. State separately the start/retry, ordinary seed-edit, and extension guards; do not use a workflow-stage capability as an undocumented proxy.

### F04. Sign-off introduces a forbidden generation-status writer

- **Severity:** high
- **Location:** AD-37 `convex/seeds.ts: signOff`; parent AD-2.
- **Note:** Parent AD-2 closes `generations.status` writes to mutations in `convex/generations.ts`. AD-37 requires the public seeds mutation itself to change status to running while freezing the Summary. Preserving the status vocabulary alone does not preserve writer ownership.
- **Fix:** Put the transactional sign-off mutation that owns the status transition in `generations.ts`, and expose shared seed validation helpers as needed. Keep readiness recheck, Summary snapshot, state transition and enqueue atomic. Otherwise require a specific parent writer-boundary amendment.

### F05. Advancement links cannot pass through the declared model schema

- **Severity:** high
- **Location:** AD-38 forced tool schema; AD-33 seeds; AD-36 approval; AD-37 plan; PRD FR-8/16.
- **Note:** The prompt asks for uncertainty and experiment ids, but the forced schema has only bullets, tags and provenance. The downstream approval rule requires `uncertaintySeedId` and `experimentSeedIds`, and editing cannot add them. Strict implementations cannot produce an approvable role-11 item. The spine also omits the PRD rule that two selected facets for the same uncertainty become one advancement with a named merge in Compliance Notes.
- **Fix:** Define role-aware generation and feedback output schemas, validate ids against active role-5/9 selections of the same generation, persist the links, and define the merge/coverage contract for shared uncertainty ids. Include missing, cross-generation, inactive and changed-link fixtures.

### F06. A context hash does not freeze the input that an action consumes

- **Severity:** high
- **Location:** AD-33/34 batch records; AD-36 dispatch revision; AD-38 context assembly; PRD FR-5/8/12/41.
- **Note:** Dispatch stores a hash, Brief id and attempt, but no immutable Decision Set payload or versioned source of the selections and feedback. An action running later can read edited decisions while retaining the earlier consumed hash. `seedFeedbackRequests` stores only the target wording hash, not its wording at request time; mutable editedBullets cannot reconstruct that wording. Batch settings are also required by the PRD but absent from the batch shape. This breaks provenance and Outdated truth without any concurrent writer violating OCC.
- **Fix:** Atomically persist or reference an immutable context snapshot at dispatch, including final selected wording, active feedback, target wording, frozen settings and references. Derive the hash from exactly that payload and make the action consume only it. Specify child rows/bounds if necessary.

### F07. Revision and confirmation algorithm leaves decision changes unreconciled

- **Severity:** high
- **Location:** AD-36 mutation algorithm and `approve`; AD-43 feedback; PRD FR-10/12/15/17.
- **Note:** The algorithm recomputes the changed row's selection revision and only Successors' context revisions. Own feedback must also change the current row's context revision. A selected edit/toggle must return its own approved row to in_progress, but the written algorithm instead leaves it approved and derives Stale; the test label says otherwise. `approve` sets a confirmation flag when needed without specifying a caller acknowledgment bound to the current exclusions/carried items; recording a flag is not proof of an explicit human confirmation. AD-37 says exclusion confirmation already happened, but AD-36 never requires it.
- **Fix:** Define a transition table for each decision mutation, recompute own feedback context plus successors, specify self-approval invalidation, and require confirmation input fenced to the displayed decision/version. Enforce exclusion warning acknowledgment server-side before recording it.

### F08. Open/prefetch identity and initial-attempt budgeting are incompatible

- **Severity:** high
- **Location:** AD-34 fingerprint, kind, allowance and budget; AD-42 reuse; PRD FR-5/27, NFR-3.
- **Note:** The fingerprint contains `kind`, so an open cannot find a prefetch by the same fingerprint as promised. `retry` is used in AD-34 but absent from the AD-33 kind union. Initial allowance increments only on failure for open/retry, omitting prefetch attempts and successful attempts despite the attempt-identity contract. After three initial failures, the PRD permits ordinary counted retries; AD-34 never defines that transition and applies its cap refusal only to regenerate/feedback/prefetch. Separate stories can produce an unlimited retry path or permanently strand a failed role.
- **Fix:** Separate operation kind, idempotency key and attempt identity. Specify canonical open/prefetch reuse and user-request retry deduplication. Consume the initial allowance once per eligible dispatched attempt, then route further retries through ordinary reservations and cap checks. Define reservation-aware admission so a two-request attempt cannot overshoot the stated hard bound.

### F09. Reaper and asynchronous completion can corrupt newer or skipped state

- **Severity:** high
- **Location:** AD-33/34 run rows and reaper; AD-36 skip/sign-off; PRD FR-5/14/27.
- **Note:** Recovery scans only running rows by startedAt, while the PRD lease starts at dispatch and covers pending attempts. A queued action that never claims has no recovery path. The promised prior state is not stored anywhere. Skip during a pending batch leaves ownership semantics undefined: unconditional completion to in_progress or reaper restoration can undo skipped state. Late callbacks may overwrite a failed row with late, contrary to the parent's terminal-run convention, and budget settlement is not defined for duplicate, late or missing callbacks.
- **Fix:** Specify dispatch/lease timestamps, queued and running recovery, saved prior state and guarded restoration. Define skip/cancel/sign-off invalidation of pending ownership. Keep terminal attempt outcome immutable and store late delivery separately, with idempotent usage/reservation settlement. Test queued loss, skip versus completion, reaper versus completion, and duplicate delivery.

### F10. Closed writer and runtime contracts cannot implement initialization and claims

- **Severity:** high
- **Location:** AD-31 initialization; AD-33 closed writers; AD-34 claim; Structural Seed; extract-codebase §4/8.
- **Note:** AD-33 permits subsection inserts only through listed public seed mutations, excluding `initializeSeedStage` in generations.ts. It excludes `claimSeedBatch` and the reaper's batch changes. It simultaneously says no other module inserts and requires signOff to write summaryItems without listing that child table among its writes. The Structural Seed puts claim/complete/fail internal mutations in `ai/seeds.ts`, while the extract establishes `convex/ai/*` as Node modules; those mutations need the default runtime. Initialization failure also has no named durable failure field/transition that guarantees awaiting_input if the initialization transaction aborts.
- **Fix:** Publish one complete writer matrix, including initialization, dispatch, claim, complete, fail, reaper, sign-off and cancellation. Put Node actions and default-runtime mutations in distinct modules. Name the initialization error record, separate failure transition, and idempotent retry mutation.

### F11. Project-erasure bootstrap cannot satisfy its inherited whole-schema guard

- **Severity:** high
- **Location:** AD-33 registry creation; parent AD-19; PRD FR-35.
- **Note:** Creating the registry with just the new tables as its first entries while adding a test rejecting every unlisted projectId table will fail against the many existing project-scoped tables. The rule also replaces cascade behavior without specifying parent AD-19's paginated purge, delete/detach/keep dispositions or preservation of existing cleanup behavior. This turns a feature story into an unspecified system migration.
- **Fix:** Make the complete registry/purge foundation an explicit dependency, or include its full scope and classifications in an owned prerequisite story. Register all schema projectId tables before enabling the whole-schema guard and preserve blob/component/Brain cleanup contracts. Do not weaken the parent guard to new tables only.

### F12. Restoration and skip semantics remain story-local choices

- **Severity:** high
- **Location:** AD-33/36/43; query conventions; PRD FR-11/13/14/39/40.
- **Note:** restoreWording and restoreBatch are named without rules. Editing overwrites seeds.support, so restoring original wording has no explicit rule restoring source-supported status from preserved citations. Unskip always returns in_progress even when no batch ever existed, contrary to FR-14, and reactivates all feedback, potentially resurrecting explicitly withdrawn instructions that must never be sent again. Skip lacks the required optional-kind server guard. shownBatch alone cannot describe Outdated feedback batches and the Shown Set's carried selections/revisions; restoreBatch's pointer, revision and selection effects are unspecified.
- **Fix:** Define each restoration transaction and Shown Set membership explicitly. Preserve original support, distinguish withdrawn feedback from skip-inactive feedback, require optional-kind skip, and make batchless unskip untouched. Compute Outdated per constituent batch and target wording rather than only the primary shown batch.

### F13. Summary editing and the report-to-Summary entry point have no rule

- **Severity:** medium
- **Location:** AD-37/41 and Capability map FR-20..24; PRD FR-21/22/28.
- **Note:** Summary editing is neither bound nor described by an AD. The view rule does not require per-item edits, frozen settings display or behavior when an edit withdraws readiness. FR-28 is listed in AD-37's Binds but no rule creates the report-side link or chooses the historical Summary version for a recovery generation.
- **Fix:** Extend AD-41 with direct Summary item edits through the existing edit mutation, read-only frozen settings, loss-of-readiness behavior, and a report-side entry that resolves the generation's signed-off summaryVersionId in read-only mode.

### F14. Shape validator omits required form variety and semantic seed fixtures

- **Severity:** medium
- **Location:** AD-35/38; PRD FR-6/9.
- **Note:** validateBatch enforces tag diversity but omits the four-or-more-seeds requirement for both one-bullet and two-bullet seeds. A one-sentence prose bullet passes the deterministic checks; FR-9 requires a no-narrative prompt instruction and full-sentence negative evaluation fixtures, neither specified here.
- **Fix:** Add form diversity to the shared validator within the existing two-request repair envelope. Bind seed-form negative fixtures and the no-narrative prompt rule to a named evaluation owner.

### F15. Bounded reads have no pagination or complete Shown Set contract

- **Severity:** medium
- **Location:** Consistency Conventions Queries; AD-33; PRD NFR-6.
- **Note:** createReadBudget is named, but a bounded failure is not pagination. getSubsection is described as shown batch at most five plus selections/provenance, omitting potentially many feedback revisions and prior batches. No cursor/order is decided for history, carried selections, provenance or Summary items. Different stories can truncate, throw or silently omit retained choices.
- **Fix:** Put bounded query shapes, stable order/cursors and overflow behavior under an AD, including complete Summary snapshots and full Shown Set access. Bound mutation and prompt input sizes as well; do not silently truncate signed-off decisions.

### F16. Telemetry reader changes the PRD's feedback outcome definitions

- **Severity:** medium
- **Location:** AD-33 events versus AD-39 reader; PRD FR-33/34, SM-5.
- **Note:** AD-39 groups feedback outcomes as selected-at-next-approve/unresolved/withdrawn. FR-34 requires frozen first-Approve states including not selected and response-not-yet-available, with withdrawal orthogonal; SM-5 scores at the first eligible approval after response. Those are distinct measurements. The event schema also conflicts internally: AD-33 requires userId while AD-39 requires actor user/system. Hash-only snapshots without versioned wording need a clear basis for later unchanged-original metrics.
- **Fix:** Adopt one event schema and separate immutable first-Approve outcome, withdrawal state, and SM-5 eligible scoring. Bind the worked trace and delayed-response/withdraw-after-score cases to explicit expected outputs; specify how historical wording comparisons remain computable.

### F17. Deferred choices contradict already written execution rules

- **Severity:** medium
- **Location:** Deferred ghost, second gate, latency/budget rows; Q-A/Q-B; AD-31/34/37/39.
- **Note:** Deferred says retiring the ghost removes the edit-distance baseline and that the metric has no reader. AD-37 explicitly retains a generated-snapshot baseline and names learningHealth as its reader. A deferred second gate would revive approveSectionDraft, which AD-40 forbids for seeds and which currently emits sectionEditEvents and owns assembly. Threshold measurement is reasonable, but the present text permits stories to change normative numbers independently.
- **Fix:** Remove the stale ghost claim. Pin one release behavior for gate/ghost/thresholds and label alternatives as future amendments requiring coordinated changes. Give calibration an owner, artifact and decision deadline before dependent stories; retain explicit defaults until changed.

### F18. Latency and action time budgets are attributed but not decided

- **Severity:** medium
- **Location:** AD-34/38 and Deferred; parent AD-9/11; PRD NFR-1/2/3.
- **Note:** AD-34 claims NFR-1 without naming the dispatch-to-completion cohort, foreground metric, sign-off-to-report comparison or reader. It permits two structured requests but supplies no timeout/SDK-retry arithmetic ensuring both fit one 600-second action, and does not say whether transport retries count toward requestsMade and reserved capacity. Parent routing/metering inheritance does not choose these feature-specific parameters.
- **Fix:** Specify request-count semantics at the HTTP attempt boundary, per-call input/output/time allowances, and total action arithmetic including repair. Name the latency reader and measurements with PRD thresholds, including failures/prefetch and post-sign-off time. Calibration may remain open with an owner, but cannot stand in for the contract.

### F19. Retry-from-Summary does not define frozen-input identity across generations

- **Severity:** medium
- **Location:** AD-37 retryFromSummary; AD-33 projectId/generationId rows; parent AD-5; PRD FR-27/41.
- **Note:** A new generation copies summaryVersionId while Summary items and their provenance still belong to the old generation. 'Frozen sources reused' does not decide copying versus references, source-id validation, Brief/style/digest/prompt snapshots, or authorization and active-generation fencing for the new public retry. Following the ordinary reservation path can re-read current project inputs/settings, defeating retry equivalence.
- **Fix:** Choose a concrete immutable reuse model, with original source ownership and ids preserved or remapped explicitly, all frozen settings carried, and one authorized active-generation reservation. Define which prompt version describes the retry's actual code and keep lineage to the original plan. Test project edits and profile changes between failure and retry.

### F20. Prompt and compliance semantics omit content/style boundary details

- **Severity:** medium
- **Location:** AD-37/38; inherited AD-25/26; PRD FR-25/41.
- **Note:** AD-37 calls semantic coverage rows deterministic without identifying a deterministic coverage algorithm; parent AD-25 distinguishes model verdicts from deterministic checks. The new content precedence does not explicitly preserve Org Mode/Writer Profile/House Rules for style, nor the glossary-only wording normalization rule. The seed action does not explicitly bind effective style to the frozen generation projection. This leaves implementations free to use current style or let an exclusion/terminology repair drop an approved plan item.
- **Fix:** Define model versus deterministic coverage provenance, reason and paragraph mapping, including skipped roles and merged advancements. State separate content/style precedence and frozen effective-style consumption, with glossary normalization unable to change content.

### F21. Structural inventory contains misleading stale labels

- **Severity:** low
- **Location:** Structural Seed `schema.ts # six tables`; AD-33 ten tables; AD-41 `seedStage is true` versus AD-40 union.
- **Note:** The tree says six tables while the authoritative inventory has ten; the UI rule uses a boolean not present in the declared seedStage union. These are small but direct sources of inconsistent story scaffolds.
- **Fix:** Update the tree count and use `gatedWorkflow === seeds` plus the declared initializing/ready/failed states consistently.

## Parent conflict ledger

The parent remains read-only. A PRD proposal does not resolve a binding parent rule.

| Child location | Parent id | Conflict / required resolution |
| --- | --- | --- |
| AD-34 request cap | AD-27; related AD-9/Q12 | Hard request refusal versus no call refused on budget (F01). |
| AD-31/37/40 new iterative path | AD-24 | Existing iterative approval gate declared unchanged versus its replacement (F02). |
| AD-34 extension authority | AD-7/Q10; Q3 | Manager spend and stage-cell proxy are not authorized by the interim generation writer mapping (F03). |
| AD-37 status write in seeds.ts | AD-2 | Closed status writer boundary violated (F04). |
| Proposed workflow, authority and precedence changes | AD-15 | PRD §10 calls the domain amendment unapproved; feature cannot declare ratification on its own (F01-F03, F20). |
| AD-33 erasure bootstrap | AD-19 | New-only registry cannot satisfy all-project-table guard and purge obligations (F11). |

AD-25 is an amendment dependency for Claim Exclusion handling, not proof that every exclusion must win over Locked Rules: the parent specifies exclusion checks and repair, while the PRD requests a confirmed content override. AD-37 must state this exception explicitly and satisfy AD-15 rather than imply that inherited checking alone implements it. Parent AD-3/4 prose boundaries, AD-8 report format, AD-14 creator identity, AD-18 frontend conventions, and AD-30 document cap are preserved in intent. Their preservation does not cancel the concrete conflicts above. Parent terminal-run conventions also need reconciliation with the late-outcome design (F09).

## Full FR/NFR coverage map

“Partial” means an AD names or partly implements the requirement but its Rule does not close the architectural contract. “Gap” means the necessary behavior has no governing AD Rule, even if it appears in a Binds range or conventions.

| Requirement | Governing AD(s) | Assessment |
| --- | --- | --- |
| FR-1 mode/start | 31, 40, 41; parent 5, 7 | Partial: mode shared and inputs frozen; start/retry authorization must be explicit, not assumed from seed mutation guards. |
| FR-2 vocabulary | 32 | Covered: single 13-role map and report heading invariant. |
| FR-3 outline | 33, 36, 41 | Covered in intent; asynchronous states need F09. |
| FR-4 navigation/open | 34, 36, 41, 42 | Partial: no named open mutation and reuse conflict (F08/F10). |
| FR-5 batch | 33-35, 38, 42 | Partial: snapshot, identity and lease gaps (F06/F08/F09). |
| FR-6 tags/variety | 35, 41, 43 | Partial: form diversity omitted (F14). |
| FR-7 support/provenance | 33, 35, 37, 41 | Covered in intent; restoration support needs F12. |
| FR-8 predecessor conditioning/links | 36-38 | Partial: missing output links and consumed snapshot (F05/F06). |
| FR-9 seed form/separation | 33, 35, 38 | Partial: semantic negative fixtures and prompt rule missing (F14). |
| FR-10 selection | 33, 36, 41 | Partial: own-state invalidation missing (F07). |
| FR-11 edit | 33, 35, 36 | Partial: original-support restoration and state transitions (F07/F12). |
| FR-12 feedback | 34, 36, 38, 43 | Partial: own revision, target snapshot, reader semantics (F06/F07/F16). |
| FR-13 regenerate | 34, 36 | Partial: retained Shown Set and restoreBatch contract missing (F12). |
| FR-14 skip/unskip | 36, 43 | Partial: optional guard, batchless state, feedback reactivation (F12). |
| FR-15 approval | 36, 37, 41 | Partial: explicit confirmation and exclusion gate (F07). |
| FR-16 multiple coverage | 32, 37 | Partial: same-uncertainty merge contract missing (F05). |
| FR-17 stale | 36 | Partial: own versus successor transition ambiguity (F07). |
| FR-18 reconcile | 36 | Covered in intent; confirmation gap in F07. |
| FR-19 OCC/history | 33, 36, 41 | Covered in intent; immutable input history incomplete (F06). |
| FR-20 readiness | 36, 37 | Covered: one server predicate and transactional recheck. |
| FR-21 review display | 32, 37, 41 | Partial: complete items, individual edits and frozen settings display missing (F13). |
| FR-22 edit in Summary | None | Gap: see F13. |
| FR-23 sign-off | 36, 37 | Partial: correct atomic concept, incompatible writer ownership (F04). |
| FR-24 separate Summary | 33, 37 | Covered: separate tables and report creation path. |
| FR-25 draft plan | 37, 38; parent 24-26 | Partial: semantic suite present, coverage/precedence details incomplete (F05/F20). |
| FR-26 create/QA | 37; parent 3 | Covered in intent: existing writer and post-QA. |
| FR-27 recovery | 31, 34, 37 | Partial: queued lease, ordinary retries and immutable reuse (F08/F09/F19). |
| FR-28 read Summary from report | 37 Binds only | Gap in Rule: no report entry or historical-version routing (F13). |
| FR-29 persistence | 33, 36 | Covered: server state and mutation transactions. |
| FR-30 shared state/private navigation | 36, 41; parent 18 | Covered: reactive queries and local navigation. |
| FR-31 cancel | 31, 36 | Partial: retained rows/disposition chosen; pending work settlement missing (F09). |
| FR-32 legacy | 40 | Covered: one field/resolver and absent-field fallback. |
| FR-33 event stream | 33, 39 | Partial: contradictory event schemas (F16). |
| FR-34 reader | 39; parent 12 | Partial: wrong outcome taxonomy and scoring contract (F16). |
| FR-35 privacy | 33, 39; parent 13, 19, 21 | Covered policy; erasure implementation prerequisite unresolved (F11). |
| FR-36 keyboard/announcements | 41; parent 18 | Covered in intent: semantic controls and polite announcements; tests should exercise all actions. |
| FR-37 narrow screens | 41 | Covered: explicit pane switch and pinned actions. |
| FR-38 contrast/targets | 41; parent 18 UI conventions | Covered by inherited design-system and 44px target rules. |
| FR-39 restoration | 33, 36, 43 | Partial: names are not restoration contracts (F12). |
| FR-40 Outdated | 34, 36, 43 | Partial: constituent batches and own feedback revision (F07/F12). |
| FR-41 frozen inputs/precedence | 31, 36-38, 41; parent 16, 26 | Partial: per-attempt snapshot, normalization, confirmation and style freeze (F06/F07/F20). |
| NFR-1 latency | 34 Binds; Deferred calibration | Partial: measurement and prose-time contract missing (F18). |
| NFR-2 attribution | 34, 39; parent 9, 27 | Partial: slots chosen; transport/late accounting unspecified (F09/F18). |
| NFR-3 budget | 34 | Partial and parent conflict: F01/F03/F08. |
| NFR-4 trust | 38; parent 11 | Covered: user data blocks and injection fixtures. |
| NFR-5 deterministic state | 35, 36, 43 | Partial: validator omissions and revision algorithm conflict (F07/F14). |
| NFR-6 read bounds | None; query convention only | Gap: pagination and complete result semantics undecided (F15). |
| NFR-7 prompt version | 31, 38; parent 5 | Covered in intent; retry version lineage needs F19. |
| NFR-8 design system | 41; parent 18 | Covered by inherited tokens/type/weight/primitives and route placement. |

### Requirements not governed by any AD Rule

| PRD requirement | Ungoverned behavior | Nearby mention that does not settle it |
| --- | --- | --- |
| FR-22 | Direct per-item Summary editing through Seed Edit, with readiness withdrawal and no free-text additions | Capability range FR-20..24; AD-41 only defines view placement/navigation. |
| FR-28 | Report-side entry to the frozen, signed-off Summary, including recovery-generation resolution | AD-37 Binds names FR-28 but its Rule has no reader/entry contract. |
| NFR-6 | Pagination and bounded complete reads for seed/batch history and Summary | createReadBudget in conventions; no AD chooses cursors, stable order or overflow behavior. |

This table is deliberately narrower than the partial-coverage map: an incomplete governing AD is a finding, not an assertion that no AD exists.

## Feature dimension inventory

| Dimension | Written disposition | Remaining architecture decision |
| --- | --- | --- |
| Data | AD-32/33, ten tables and shared role ids | Frozen dispatch payload, links, canonical event shape, support history and erasure foundation (F05/F06/F11/F12/F16). |
| State | AD-31/34/36/40, seed statuses and OCC | Self-change invalidation, skip versus completion, queued recovery and initialization failure (F07/F09/F10). |
| Mutations/authority | AD-33/36/37/43, named APIs | Actual closed writer matrix, open/init retry entry points, confirmation acknowledgments and parent authorization/status ownership (F03/F04/F07/F10). |
| Actions/budgets | AD-34/42/43, one batch action | Canonical identity, ordinary retries, request accounting, action timeout envelope and upstream cap approval (F01/F08/F18). |
| Prompts/context | AD-35/37/38 | Immutable consumed payload, role-aware schema, effective-style freeze, form/coverage semantics (F05/F06/F14/F20). |
| UI placement | AD-40/41, project route and split | Summary edit/read entry contracts and exact Shown Set behavior (F12/F13). |
| Tests | Enforcing tests per AD, semantic release suite in AD-37 | Add the counterexamples above; a named future test cannot override contradictory rules. Semantic seed-form and latency evidence ownership remain thin (F14/F18). |
| Migration/legacy | AD-40 no backfill; parent AD-10 widening | Optional widening is inherited. Registry bootstrap and retry cross-generation source identity need explicit migration scope (F11/F19). |
| Operations/reaper | AD-34 existing cron scan | Dispatch-based lease covering queued rows, terminal/idempotent settlements and safe subsection restoration (F09). |
| Metering/measurement | AD-34/39 named slots and reader | Feedback cohort definitions, transport accounting, latency reader and gate approval and baseline applicability (F02/F16/F18). |
| Deferred lifecycle/learning | Q-C retention; AD-39 no digest distillation | Safe to defer retention-window choice under parent Q9 and distillation under parent AD-13. Ghost/gate/threshold choices are not safe as independent story decisions (F17). |

## Handoff conclusion

The feature's broad decomposition is appropriate: a durable human-gated planning stage, separate seed records, shared vocabulary, a frozen Summary, reuse of the existing report creation chain, and generation-scoped legacy routing. It is not yet a safe story substrate. Resolve the inherited changes through the approved upstream contract, then close the asynchronous state/input and API/schema contradictions. Re-run this rubric against the reconciled spine before splitting implementation stories. No implementation tests were run for this document-only review; the review artifact was checked for its required sections, all 49 requirement rows, severity totals. Tool actions wrote only this review and a temporary helper script; no input document was edited.
