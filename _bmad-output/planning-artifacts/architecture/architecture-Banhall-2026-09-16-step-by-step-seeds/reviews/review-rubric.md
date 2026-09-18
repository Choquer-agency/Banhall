Verdict: REVISE BEFORE BUILD. The revision closes most pass-1 contract gaps, but one asynchronous-state defect and four narrower contract gaps remain.

# Rubric review, pass 2

Reviewer: `gpt-6-astra`, reasoning effort `medium`. Date: 2026-09-16. Altitude: feature, inheriting a binding, read-only parent.

Severity counts: **critical 0; high 1; medium 4; low 0**. Five findings, counted once each. Pass-1 disposition: **33 resolved; 5 partially; 0 open** across both reviews. A resolved architecture finding does not mean its proposed implementation or tests have shipped.

The revised feature spine, parent spine, PRD, SPEC, codebase extract, rubric pass 1 and adversary pass 1 were read in the requested order. The SPEC's `build-sequence.md` companion was also read to inspect the worked event trace expressly bound by AD-39. This review applies the requested good-spine checklist, rather than introducing a different lens or asking the architecture to be an implementation specification. Locations below use stable AD identifiers and current feature-spine line numbers. Only this review artifact was written.

## Pass-1 status table

“Resolved” means the revision supplies the missing architectural decision or explicitly governs the parent conflict. “Partially” means a material part remains, identified by a current finding. “Open” would mean no substantive resolution. Pending owner approval of an explicitly named parent amendment is a build gate, not an undisclosed architecture conflict.

| Review | Finding | Status | One-line disposition |
| --- | --- | --- | --- |
| Rubric | F01 | resolved | C1 names the AD-27 request-cap exception and gates slice 2 on owner approval; monetary spend remains alert-only. |
| Rubric | F02 | resolved | C2 names the AD-24 gate replacement, while C6 explains the generated-snapshot baseline and visible digest exclusion. |
| Rubric | F03 | resolved | AD-34 now requires project Owner or Admin for extension and explicitly rejects `project.setStage` as its authority. |
| Rubric | F04 | resolved | AD-37 places atomic sign-off and its generation-status transition in `generations.ts`. |
| Rubric | F05 | resolved | AD-35 publishes role-aware reference fields and validation; AD-37 specifies same-uncertainty merging and plan-reference coverage. |
| Rubric | F06 | resolved | AD-33/34 persist immutable context rows, target wording and frozen-setting identity; AD-38 forbids live decision reads. |
| Rubric | F07 | resolved | AD-36 recomputes own context, invalidates own approval and requires a version-bound challenge with explicit carried/exclusion acknowledgments. |
| Rubric | F08 | partially | Normalized initial keys, command ids, dispatch-counted allowance and ordinary retries are decided, but prefetch still bypasses its required cap refusal (R02). |
| Rubric | F09 | partially | Queued leases, prior state, additive late receipt and idempotent settlement are fixed; Skip still leaves pending ownership able to overwrite it (R01). |
| Rubric | F10 | resolved | AD-31/33 separate initialization, durable error/retry, Node actions and default-runtime writers, and publish the ownership matrix. |
| Rubric | F11 | resolved | AD-45 makes the complete registry and paginated purge an explicit slice-0 prerequisite with the whole-schema guard intact. |
| Rubric | F12 | resolved | AD-36/43 decide original support, restoreBatch, optional-only Skip, batchless Unskip, suspended versus withdrawn feedback and constituent Outdated state. |
| Rubric | F13 | resolved | AD-41 governs Summary item editing, readiness withdrawal, frozen settings and report-side access through the signed-off version id. |
| Rubric | F14 | resolved | AD-35 adds mixed bullet form, exact tags and no-narrative policy; AD-37 binds negative semantic fixtures to a manager-judged release suite. |
| Rubric | F15 | resolved | AD-44 chooses server DTOs, ordering, explicit truncation, paginated history and complete Summary/plan behavior; its new selection limit is a separate R04 regression. |
| Rubric | F16 | partially | Actor shape, event kinds, deduplication and orthogonal withdrawal are fixed, but first-Approve exposure and eligible-response scoring remain conflated (R03). |
| Rubric | F17 | resolved | Ghost, second gate and numerical defaults are pinned; later changes require amendment and calibration has an owner, artifact and deadline. |
| Rubric | F18 | partially | Two transport requests with retries disabled and 90-second timeouts settle the seed-action envelope; the complete latency measurement contract remains unowned (R05). |
| Rubric | F19 | resolved | AD-37 decides Summary origin, item foreign key, copied frozen sources with id map, artifacts/settings, authorization, active-run fencing and current retry prompt version. |
| Rubric | F20 | resolved | AD-37/38 preserve frozen effective style and glossary wording-only behavior, and label coverage as model verdicts joined by plan identity. |
| Rubric | F21 | resolved | The structural inventory consistently says eleven tables and host routing uses the declared workflow/phase projection. |
| Adversary | F01 | resolved | Dispatch snapshots and request-byte interleaving tests now bind what the action consumes to the stored consumed revision. |
| Adversary | F02 | resolved | The shared batch/feedback tool schema carries advancement references through validation, persistence and approval. |
| Adversary | F03 | resolved | AD-34 separates operation, initial dedupe class, command id and attempt id; open and prefetch share their key. |
| Adversary | F04 | resolved | AD-33 names writer ownership and default-runtime run mutations, and AD-37 moves sign-off to the inherited status owner. |
| Adversary | F05 | resolved | Seed calls explicitly disable SDK retries, cap transport requests at two and timeout at 90 seconds; the old ordered-chain timing concern is inherited, not a new seed contract defect. |
| Adversary | F06 | resolved | AD-34 covers queued/running leases, conservative reaper settlement, terminal-outcome preservation, dispatch-counted allowance and ordinary retries. |
| Adversary | F07 | resolved | AD-36 requires the displayed challenge and acknowledgment lists, and AD-33 requires internal seed writers to bump the stage version. |
| Adversary | F08 | resolved | Summary items join by summaryVersionId, origin ownership is explicit and recovery copies sources with an id map and frozen artifacts/settings. |
| Adversary | F09 | resolved | AD-44 supplies one server-built Shown Set contract, original/revision groups, carried items, generated DTO types and explicit history overflow. |
| Adversary | F10 | resolved | AD-31/40 decide initialization error/retry and phase routing, while signed-off seeds use ordered-chain terminal failure and Summary recovery. |
| Adversary | F11 | partially | The discriminated event stream, view index and trace binding are present, but eligible scoring still cannot produce the promised first-Approve unavailable result (R03). |
| Adversary | F12 | resolved | AD-36 defines a versioned canonical DTO, byte treatment, per-role hashes and one restored-contribution explanation helper. |
| Adversary | F13 | resolved | AD-37 chooses a shared deterministic presentation order for Shown Set, approval snapshot, Summary and plan rather than separate story-owned orderings. |
| Adversary | F14 | resolved | AD-36 adds activeStaleEpisodeId and forbids opening another episode while one remains undisposed, including R0/R1/R0/R2. |
| Adversary | F15 | resolved | AD-35 explicitly specifies form diversity, serialized tags, word counting and feedback's exemption from batch-level rules. |
| Adversary | F16 | resolved | AD-37 adds stable planRef identities, model provenance, skipped-role outcomes and merged-item metadata within the existing Self-check. |
| Adversary | F17 | resolved | AD-34 matches the final PRD's Owner-or-Admin extension rule and preserves the exclusion of non-owner Managers. |

## Good-spine checklist

| Checklist item | Judgment | Reason |
| --- | --- | --- |
| Fixes real divergence points for independent stories | mostly passes; revise | The durable snapshot, ownership matrix, resolver, approval challenge, origin Summary and shared DTOs close the major producer/consumer seams. Pending work versus Skip remains a real cross-story state race (R01). |
| Every AD Rule is enforceable and prevents its divergence | partial | Most Rules now have concrete owners, inputs, outcomes and behavioral test witnesses. AD-34's admission algorithm contradicts C1/prefetch policy (R02); AD-39's declared metric enum cannot be populated by its stated scoring rule (R03). |
| Deferred cannot let two units diverge | passes | Gate, ghost and thresholds have pinned defaults; learning, future plan revision, second tag axis and comparison presentation do not create alternate MVP contracts. Retention inherits project erasure until a dated window decision. |
| Ratifies the brownfield code | passes at feature altitude | The existing iterative entry, ordered-chain extension, generation lifecycle owner, report creation writer, post-QA, reactive hosts and default-runtime/Node separation are explicitly respected. The unbuilt erasure registry is correctly a prerequisite, not claimed to exist. |
| Covers every PRD FR/NFR and SPEC CAP | partial | Every numbered requirement/capability has a plausible governing AD, but R01-R05 leave five bounded areas incomplete or contradictory. NFR-1 has thresholds and a calibration task without complete measurement ownership. Full crosswalk follows. |
| No new AD weakens inherited rules except named parent conflicts | passes with explicit gates | C1, C2 and C4 expressly propose the cap, gate and exclusion exceptions and require owner approval. C3 corrects authority; C5 realizes AD-19; C6 explains AD-12 applicability. The parent remains binding and unchanged. |
| Every dimension is decided, deferred or open | mostly passes | All broad feature dimensions have a disposition. Pending Skip, prefetch admission, metric definitions and latency ownership need the narrow decisions below; the new 20-item product limit needs reconciliation. |

### Rule-by-rule enforceability

| AD | Judgment at this altitude |
| --- | --- |
| 31 | Enforceable: durable initialization/error retry, thirteen rows, workflow discriminator and lifecycle owner are named; implement failure recording in a committed transaction rather than assuming rollback persists an error. |
| 32 | Enforceable: one ordered role vocabulary is consumed by prompts and QA; the test must exercise consumers, not duplicate a constant. |
| 33 | Enforceable: project ownership, child tables, immutability and runtime/writer homes are chosen; generation-field writes must physically use the named generations owner. |
| 34 | Partial: dispatch identity, frozen inputs, bounded seed action and lease settlement are strong; pending human-state preservation and prefetch admission need R01/R02. |
| 35 | Enforceable: exact tag set, shape, form diversity, role-aware links, provenance fallback and one repair envelope. |
| 36 | Partial: one revision/transition/challenge/readiness owner; the pending-operation interaction needs R01 and the added cardinality restriction needs R04. |
| 37 | Enforceable: atomic freeze/start, identity-based coverage, existing prose writer and recovery lineage are decided, subject to C2/C4 approval. |
| 38 | Enforceable: snapshot-only context and versioned scaffolds behind the inherited trust boundary. |
| 39 | Partial: event production is concrete; the promised metric meanings still conflict with the scoring algorithm (R03). |
| 40 | Enforceable: one absent-field fallback and server phase projection govern both hosts, mutations and recovery. |
| 41 | Enforceable: route placement, split behavior, server DTO rendering, conflict text preservation and Summary edit/read entry points are specified. |
| 42 | Partial: shared initial identity and one-ahead policy are decided, but cap refusal is inconsistent with AD-34 (R02). |
| 43 | Enforceable: immutable target wording, 1-3 unselected revisions, explicit withdrawal and skip suspension are chosen; pending Skip follows R01. |
| 44 | Enforceable read contract, conditional on R04: full versus partial results and history pagination are distinguished; a product limit cannot be justified solely by query convenience. |
| 45 | Enforceable: whole-schema registry, dispositions, paginated purge and existing cleanup preservation precede seed tables. |

These are judgments about specified future enforcement. Named tests are obligations, not evidence of already passing tests. Missing test implementations in this unbuilt feature are not counted as architecture defects.

## Findings

### R01. A pending result or reaper can undo the writer's Skip

- **Severity:** high.
- **Location:** AD-34 completion/failure (line 142), AD-36 Skip/Unskip (line 154), AD-43 suspension (line 196); PRD FR-5/14/27, SPEC CAP-8/14.
- **Note:** Dispatch stores pendingBatchId and priorState. Skip changes the row to skipped and suspends its decisions, but does not clear/invalidate the pending attempt or define a skipped completion disposition. Successful completion checks only pendingBatchId and awaiting_input, then sets in_progress. Failure unconditionally restores the saved priorState. Thus opening an Optional role, skipping it while the call runs, and receiving either success or timeout silently reverses Skip. The version fence on writer mutations does not prevent an internal completion. The revision repairs lease and late-result handling but leaves this concrete human-decision race.
- **Fix:** Decide one pending-work policy for Skip: atomically invalidate ownership and treat eventual output as late, or retain work for history while preserving skipped state and inactive decisions. Define failure restoration against current human state, not just the dispatch snapshot. Apply the same invariant after Skip/Unskip and a pending attempt. Test skip-before-success, skip-before-failure/reaper and skip/unskip-before-delivery through the real transition helper; assert readiness, feedback activity and downstream Decision Sets remain consistent.

### R02. Prefetch is exempt from the very cap that C1 says refuses it

- **Severity:** medium.
- **Location:** Conflicts C1 (line 85), AD-34 dispatch (line 142), AD-42 (line 190); PRD NFR-3, SPEC CAP-14.
- **Note:** C1 and the product contract say the cap refuses prefetch. AD-34 classifies prefetch as initial and exempts that class while initialAttemptsUsed < 3. AD-42 only prefetches roles with no batch, so those prefetches necessarily retain their initial exemption. At reserved=60, approving a role can therefore dispatch the next untouched role's prefetch despite the required refusal. The overall 158-request ceiling is still conservative; this is an optional-work admission error, not unlimited spending. It also leaves unclear whether refused best-effort prefetch would abort the writer's approval transaction.
- **Fix:** Separate reuse identity from admission eligibility. Open/retry can share prefetch's dedupe key while only writer-demanded initial attempts receive the cap exemption. At the cap, omit prefetch and commit approval normally. Keep the allowance accounting and hard maximum. Test approval at cap, no optional request scheduled, followed by a writer open that uses the role's protected initial allowance.

### R03. The reader still merges first-Approve exposure with first-eligible feedback scoring

- **Severity:** medium.
- **Location:** AD-39 (line 172); PRD FR-34, SM-5, SM-C2; SPEC CAP-15 and Success signal; referenced build-sequence worked trace.
- **Note:** The enum includes response_not_available, but the Rule freezes the outcome at the first approve after batchCompleted. At that approval the response is already available, so the promised unavailable-at-the-earlier-Approve observation cannot be produced. Example: request, Approve A before response, response, Approve B with a revision selected. FR-34 needs the first-Approve unavailable observation; SM-5 needs the eligible selected score at B. One immutable outcome cannot describe both. The revision correctly separates later withdrawal, actor identity and view deduplication. Its universal cancelled-generation exclusion also conflicts with the explicit SM-C2 exception including cancelled requests. The referenced short trace has neither a delayed response nor a cancellation and cannot resolve those cases.
- **Fix:** Name separate immutable first-Approve exposure and first-eligible-Approve selection results, each with its approval/event identity; keep withdrawal orthogonal. State cohort exceptions for SM-C2 and carry them into the reader. Extend the versioned trace with the A/B sequence, withdrawal after B and cancelled request consumption; specify the cross-period join basis so the same request does not receive incompatible outcomes in adjacent reporting windows.

### R04. The new 20-selection limit narrows an explicit product capability

- **Severity:** medium.
- **Location:** AD-36 (line 154), AD-44 (line 202); PRD FR-10, SPEC CAP-5, NFR-6.
- **Note:** The PRD allows any number of Seeds to be ticked. AD-36 newly refuses the twenty-first active selection, and AD-44 uses that restriction to establish a 260-item Summary bound. Neither the PRD nor SPEC adopts this maximum, and the spine does not name it as a proposed product amendment or open tradeoff. Bounded reads are required, but pagination and a user-visible content limit are different decisions. This is a finite edge-case capability reduction, not a reason to reject the otherwise useful DTO design.
- **Fix:** Either retain the product selection contract with paginated reads and a complete Summary materialization/sign-off strategy, or explicitly propose and obtain approval for the per-role limit with consistent UI copy and product/spec amendments. Keep the separate no-silent-plan-truncation rule. Verify the chosen behavior at 20 and 21 selections, including a Multiple role accumulated across batches.

### R05. Latency has pinned targets but no complete owned measurement contract

- **Severity:** medium.
- **Location:** AD-34 Binds/Rule (lines 140-142), AD-39 (line 172), Deferred calibration row; PRD NFR-1, SPEC CAP-14.
- **Note:** The revised 2 × 90-second, zero-SDK-retry seed-call envelope addresses the prior action-time problem. It does not implement the product's latency measurements. The spine pins 12-second median/30-second p95 and a measurement note before slice 7, but no Rule assigns a reader the dispatch-to-validated-result cohort including failures/prefetch, the separately reported foreground dispatch-to-first-render figure, or the sign-off-to-report comparison with same-model/project single drafting time plus consistency. Existing event timestamps can support some figures, but first-view alone does not establish that the role stayed open. The prose-generation bound is not restated or explicitly delegated to an owned measurement surface.
- **Fix:** Bind those three measures to one named reader or release measurement artifact, cite NFR-1 as its exact cohort/comparison definition, and identify the extra foreground eligibility observation or controlled session protocol. Preserve the current defaults until the dated calibration amendment. This requires an ownership/measurement decision, not a new scheduler or proof that an unimplemented model already meets the targets.

## Requirement coverage and ungoverned behavior

“Covered” means an AD supplies the architectural owner and invariant, including inherited rules. “Partial” identifies a current finding. The table does not require the spine to repeat every UI acceptance criterion already binding in the SPEC.

| PRD requirement | Governing ADs | Judgment |
| --- | --- | --- |
| FR-1 | 31, 40, 41; parent 5/7 Q3 | Covered: shared mode entry, frozen start, resolver and inherited generation authorization. |
| FR-2 | 32; parent 8 | Covered: thirteen roles and unchanged headings. |
| FR-3 | 33, 36, 41, 44 | Covered: server outline states and previews; R01 affects state transitions. |
| FR-4 | 34, 36, 41, 42 | Covered: local navigation, retained sets and shared initial identity. |
| FR-5 | 33-35, 38, 42 | Partial: pending completion versus Skip, R01; cap handling, R02. |
| FR-6 | 35, 41, 43 | Covered: tags and batch form diversity. |
| FR-7 | 33, 35, 37, 41 | Covered: validated provenance, fallback support and carried marker. |
| FR-8 | 34-38 | Covered: frozen predecessor context and role-aware active references. |
| FR-9 | 33, 35, 37, 38 | Covered: separate records, deterministic floor and semantic negatives. |
| FR-10 | 33, 36, 41 | Partial: unauthorized maximum changes selectable cardinality, R04. |
| FR-11 | 33, 35, 36, 41 | Covered: shared edit validator, preserved original and support restoration. |
| FR-12 | 33, 34, 36, 43 | Covered: recorded instruction/target and unselected revisions. |
| FR-13 | 34, 36, 44 | Covered: retained selections, restoration and one pending attempt. |
| FR-14 | 36, 43 | Partial: correct steady-state Skip/Unskip, unsafe pending completion, R01. |
| FR-15 | 36, 41, 44 | Covered: readiness checks, current revision approval and acknowledgment challenge. |
| FR-16 | 32, 37 | Covered: distinct plan identities and same-uncertainty facets. |
| FR-17 | 36 | Covered: server recomputation and single open episode. |
| FR-18 | 36 | Covered: approval resolves, Skip/cancel bypass. |
| FR-19 | 33, 34, 36, 41 | Covered: writer OCC, internal ownership fence and retained text on conflict. |
| FR-20 | 36, 37, 44 | Covered: one readiness function with transactional sign-off recheck. |
| FR-21 | 32, 37, 41, 44 | Covered: complete ordered Summary and frozen settings. |
| FR-22 | 36, 41 | Covered: same Seed Edit and readiness withdrawal. |
| FR-23 | 37 | Covered: atomic immutable snapshot and closed stage. |
| FR-24 | 33, 37 | Covered: Summary separate from report/snapshots. |
| FR-25 | 37, 38; parent 8/16/24/25/26 | Covered: plan/skip blocks, stable coverage identities and semantic release gate. |
| FR-26 | 37; parent 3/5 | Covered: existing report writer and post-QA. |
| FR-27 | 31, 34, 37, 40 | Partial: retry lineage and lease recovery chosen; pending Skip restoration, R01. |
| FR-28 | 37, 41 | Covered: read-only signed-off Summary from original or recovery report. |
| FR-29 | 33, 36 | Covered: transactional server domain state. |
| FR-30 | 36, 41; parent 18 | Covered: shared reactive state and private navigation/text. |
| FR-31 | 31, 36, 37 | Covered: existing cancel semantics, retained audit and stale-episode disposition. |
| FR-32 | 31, 40 | Covered: reservation discriminator and mutually refusing workflows. |
| FR-33 | 33, 39 | Covered: one append-only text-free event contract. |
| FR-34 | 39 | Partial: feedback outcomes and cohort semantics, R03. |
| FR-35 | 33, 38, 39, 45; parent 13/19/21 | Covered: privacy policy and explicit erasure prerequisite. |
| FR-36 | 41; parent 18 | Covered: semantic controls, keyboard and polite announcements. |
| FR-37 | 41 | Covered: explicit narrow-screen pane switch and pinned actions. |
| FR-38 | 41; parent 18 UI conventions | Covered: inherited contrast and coarse-pointer targets. |
| FR-39 | 33, 36, 43, 44 | Covered: named restorations and retained history. |
| FR-40 | 34, 36, 43, 44 | Covered: immutable consumed revision and constituent/target Outdated rules. |
| FR-41 | 31, 34, 37, 38, 41 | Covered: frozen settings/Brief, content precedence and unchanged style precedence. |
| NFR-1 | 34 Binds; Deferred calibration | Partial: complete owned measurement rule missing, R05. |
| NFR-2 | 34, 39; parent 9/27 | Covered: transport request count and named role slots. |
| NFR-3 | 34, 42; C1/C3 | Partial: allowance and extension decided, prefetch cap exemption contradicts policy, R02. |
| NFR-4 | 38; parent 11/30 | Covered: snapshot data blocks and injection suite enrollment. |
| NFR-5 | 35, 36, 44 | Covered: server validator, revisions and readiness owner. |
| NFR-6 | 44 | Covered read contract; the new domain restriction used to bound it needs R04. |
| NFR-7 | 31, 37, 38; parent 5 | Covered: scaffold hashing and actual retry prompt version. |
| NFR-8 | 41; parent 18 | Covered: inherited tokens/type/weight/primitives and in-page surfaces. |

| SPEC capability | Governing ADs | Judgment |
| --- | --- | --- |
| CAP-1 | 31, 40, 41 | Covered: entry, discriminator and legacy phases. |
| CAP-2 | 32, 36, 41, 44 | Covered: role vocabulary, outline and private navigation. |
| CAP-3 | 33-35, 38 | Partial: pending result preservation across Skip, R01. |
| CAP-4 | 34-38, 41 | Covered: consumed decisions, links and frozen Brief/settings. |
| CAP-5 | 33, 35, 36, 41 | Partial: new selection maximum, R04. |
| CAP-6 | 34, 36, 43 | Covered: targeted feedback and lineage. |
| CAP-7 | 34, 36, 44 | Covered: regeneration retains decisions and history. |
| CAP-8 | 36, 37, 43 | Partial: asynchronous Skip reversal, R01. |
| CAP-9 | 35, 36, 41, 44 | Covered: challenged approval, active links and derived revisions. |
| CAP-10 | 33, 34, 36, 41 | Covered: persisted shared domain and OCC. |
| CAP-11 | 36, 41, 44 | Covered: readiness and complete editable Summary. |
| CAP-12 | 31, 33, 36, 37, 41 | Covered: freeze, cancel and read-only historical plan. |
| CAP-13 | 37, 38; parent 24/25/26 | Covered: existing chain, plan coverage, recovery and semantic evaluation. |
| CAP-14 | 34, 39, 42 | Partial: prefetch admission and latency measurement, R02/R05. |
| CAP-15 | 33, 38, 39, 45 | Partial: feedback outcome/cohort reader, R03. |
| CAP-16 | 41, 44; parent 18 | Covered: accessible responsive UI and bounded reads, subject to R04's product reconciliation. |

### Ungoverned requirements table

No entire FR or CAP lacks an architecture owner. The remaining missing governing rule is a sub-contract of NFR-1/CAP-14; the other findings contradict or incompletely compose rules that already exist.

| Requirement | Ungoverned behavior | Existing mention that does not settle it | Needed owner |
| --- | --- | --- | --- |
| NFR-1; CAP-14 | Complete dispatch-result cohort, foreground eligibility/reporting, and sign-off-to-report comparison measurement | AD-34 Binds, generic event timestamps and a Deferred calibration note | A named latency reader or release-measurement artifact with NFR-1's exact definitions, R05. |

## Dimension disposition and severity calibration

| Dimension | Disposition |
| --- | --- |
| Paradigm/dependencies/runtime | Decided by parent AD-1 and feature 31/33/38; fixed pipeline and separate Node action/default-runtime mutations. |
| Data/schema/identity | Decided by 32/33/36/37/44/45; recovery Summary has explicit origin and source map. |
| Human state/concurrency | Decided by 31/36/40, with pending Skip interaction requiring R01. |
| Authorization/inheritance | Parent AD-7/Q3 applies to ordinary generation work; extension is Owner/Admin; C1/C2/C4 await explicit approval before dependent slices. |
| AI dispatch/recovery/budget | Decided by 34/42/43; prefetch admission needs R02. |
| Prompt trust/provenance/quality | Decided by 35/37/38 and inherited 11/16/23-27/30; semantic release evaluation is explicit. |
| UI/navigation/accessibility | Decided by 40/41/44 and inherited 18; no new route or modal gate. |
| Read bounds/product capacity | Query behavior decided by 44; twenty-selection product restriction needs R04. |
| Telemetry/performance | Event shape and reader decided by 39; R03 and R05 refine distinct measurement contracts. |
| Brownfield rollout/erasure | Decided by 40/45 and inherited widen-first convention; registry is the prerequisite. |
| Future learning/retention/gates | Deferred or open with defaults: no digest distillation, project erasure until retention decision, no ghost and no second gate. |
| Verification | Behavioral tests per AD plus manager-judged semantic release suite; execution remains implementation work. |

The reviewer did not turn routine implementation residue into extra contract findings. Examples include exact TypeScript validators, mechanical total-order tie-breakers inside the single shared helper, committing initialization failure metadata after a failed transaction, calling the generations-owned helpers for budget fields, cursor encoding, and asserting the stage-to-editor host fixtures. The revision identifies owners and intended invariants for those details. The inherited ordered-chain timing concern is not evidence that this feature must redesign single/compare or reopen the parent architecture; the new seed action now has its own bounded request envelope.

The five findings above differ: they can reverse an explicit human decision, contradict a written admission/capability rule, or make independently implemented metric readers disagree. They need short contract amendments before dependent implementation. C1/C2/C4 owner approval remains a separate, already documented prerequisite; this review does not claim that approval occurred.

## Verification scope

Document review only. No application code was changed and no application test suite was run. The written report was checked for all 38 unique pass-1 dispositions, all 41 FRs, 8 NFRs and 16 CAPs, all 15 feature AD judgments, five severity-labelled findings and the ungoverned-behavior table. The parent and source artifacts remain read-only inputs.
