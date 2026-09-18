---
id: SPEC-step-by-step-seeds
companions:
  - glossary.md
  - state-machine.md
  - build-sequence.md
  - ../../planning-artifacts/architecture/architecture-Banhall-2026-09-16-step-by-step-seeds/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/architecture/architecture-Banhall-2026-09-03/ARCHITECTURE-SPINE.md
  - ../spec-pd-generation/glossary.md
  - ../../planning-artifacts/prds/prd-Banhall-2026-09-16/input-design-handoff.md
  - ../../../docs/product-domain.md
  - ../../../docs/design-system.md
  - ../../../convex/_generated/ai/guidelines.md
sources:
  - ../../planning-artifacts/prds/prd-Banhall-2026-09-16/prd.md
  - ../../planning-artifacts/prds/prd-Banhall-2026-09-16/addendum.md
  - ../../planning-artifacts/prds/prd-Banhall-2026-09-16/extract-codebase.md
  - ../../planning-artifacts/prds/prd-Banhall-2026-09-16/extract-prior-prd-spec.md
  - ../../planning-artifacts/prds/prd-Banhall-2026-09-16/extract-spine-ux.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Step-by-step PD generation: idea seeds before prose

## Why

A pain to solve and a vision to realize. Step-by-step mode today drafts a whole Section 242, 244 or 246 and asks the writer to approve it; the section is the wrong unit of review, because the writer and the AI have already diverged on what the project *is* before any prose exists, and the writer's real decision is positioning. The owner and the product lead want the mode to seed ideas per Subsection of the PD template — three to five short bullets, tagged and cited — that the writer selects, edits, corrects and approves, with a Running Summary the writer signs off before Banhall writes the PD. Backdrop: the September adoption goal, the lead writer's ten-revision experience, and the 2026-09-09 spec that deferred exactly this ("Michael's stepwise idea") to v2. Single and compare modes are untouched. Vocabulary is in `glossary.md` (new terms) and `../spec-pd-generation/glossary.md` (inherited); every capitalised term below is defined in one of them.

## Capabilities

- **CAP-1**
  - **intent:** A writer can start Step-by-step mode wherever a generation mode is chosen today, and generations started before the feature keep their old surfaces.
  - **success:** The three mode selectors read one shared definition and store the existing gated key; the generation records its workflow (section-approval or seeds) at reservation and one resolver interprets it everywhere (a pre-feature gated row resolves to section-approval); a seeds generation shows an initializing state until its thirteen Subsection rows exist and a failed-with-retry state if initialization fails; legacy approve/regenerate refuse seeds generations and seed mutations refuse section-approval generations; one active generation per project is enforced as today.

- **CAP-2**
  - **intent:** The writer works through a fixed list of thirteen Subsections, in any order, with a persistent Outline that is also the Running Summary.
  - **success:** One shared module defines the thirteen roles (order, Section, kind Standard/Optional/Multiple, canonical role id, display title) and a test proves the bijection with the content roles the section prompts and QA use; the Outline shows every Subsection's state as a word (untouched, generating, in progress, approved with count, skipped, stale with reason, failed, plus an outdated marker) and approved rows show truncated previews; the Outline scrolls independently; opening any Subsection never discards work; the open Subsection is per user; Subsections never become report headings.

- **CAP-3**
  - **intent:** For a Subsection the AI returns a Batch of short, positioned, cited Idea Seeds that the server validates before anyone sees them.
  - **success:** A Batch has three to five Seeds, each one or two bullets, each bullet at most 25 words and one sentence under a fixture-backed deterministic check, one or two Tags from the closed six-value set, at least two distinct Tags per Batch and both one- and two-bullet Seeds when the Batch has four or more; each Seed cites at least one excerpt validated against the frozen sources (offsets and exact text) or is marked writer-asserted; the Batch prompt forbids narrative sentences and connective prose, the deterministic check is the floor and the evaluation harness carries full-sentence Seeds as negative fixtures; invalid Seeds are dropped, a Batch below three fails the attempt, and the structured-output two-request repair is the only automatic retry shared by shape, Tag and form checks; every attempt has a durable identity, records Seeds dropped and its consumed revision, at most one attempt is pending per Subsection, and a result for an attempt that was superseded, timed out (10-minute lease), cancelled or signed off is stored as late and never shown as current; excerpts are revealed on the card by disclosure, closed by default.

- **CAP-4**
  - **intent:** Each Subsection's Seeds are conditioned on the writer's decisions in its Predecessors, on the Brief version and on the settings frozen at start, and never on later Subsections.
  - **success:** The Batch request carries the Decision Set (Predecessors' active Seed Selections with final wording, Skips and active Feedback instructions, in order), the Subsection's own active Feedback, the frozen Brief version and settings, as delimited data blocks and never as system instructions, and nothing from a Successor; a fixture proves an edited term from Subsection 1 appears in Subsection 2's Seeds and an evaluation-harness fixture judges a Feedback instruction on Subsection 1 respected in Subsection 9; whenever Subsection 9 has active Seed Selections, every Specific-advancement Seed carries structured references to exactly one active uncertainty and at least one active experiment; the Brief rail labels the version the run uses, a mid-run Brief edit is labelled as applying to the next generation, and "Regenerate with this Brief" is unavailable while a generation is active.

- **CAP-5**
  - **intent:** The writer can select any Seeds, edit their wording in place, and restore what they changed.
  - **success:** Ticking uses checkbox semantics (control, border and the word "Selected" change together) and persists before the control settles; any tick or untick changes the Selection Revision, returns an approved Subsection to in progress and makes approved Successors Stale in one transaction; an edit keeps the bullet contract, marks the Seed "Edited · writer-asserted", keeps the AI wording and original citations as viewable history, and offers Restore original wording; every destructive action (edit, replace by a Revised Seed, regenerate, skip, untick) has a named restoration that is itself a selection change.

- **CAP-6**
  - **intent:** The writer can ask for a targeted revision of one Seed and decide what to do with the result.
  - **success:** Feedback is a recorded request (target Seed, its wording at request time, instruction of at most 300 characters, consumed revision, attempt) that yields one to three Revised Seeds under the per-Seed rules only; they arrive unselected beside the original, linked to the request, and the original keeps its selection and shows "has revisions"; a Feedback result is Outdated if the Subsection's Context Revision or the target's wording changed while it ran; an instruction is active until withdrawn (visible action) or its Subsection is skipped, active instructions enter the Subsection's own Context Revision and every Successor's Decision Set, and withdrawn instructions are never sent again.

- **CAP-7**
  - **intent:** The writer can ask for a fresh Batch without losing anything.
  - **success:** Regenerate keeps active Seed Selections at the top of the Shown Set, each marked with whether it was produced under the current Context Revision; the Previous Batch is reachable and restorable; a second Regenerate while one is pending shows "already generating" and starts nothing; a fresh Batch never vouches for carried selections.

- **CAP-8**
  - **intent:** The writer can declare an Optional Subsection not applicable, and reverse that.
  - **success:** Skip is refused on non-Optional Subsections; it sets the state skipped, makes the Subsection's Seed Selections and Feedback inactive (retained; excluded from Decision Sets, the Summary and readiness), makes approved Successors Stale, disposes an open stale episode as bypassed, and counts as decided; Unskip returns to in progress (or untouched) with selections active again and never directly to approved; the signed-off plan and every drafting request carry each Skip explicitly and the drafter must not cover a skipped role even when the Brief or sources support it.

- **CAP-9**
  - **intent:** Approval is the writer's reconciliation of a Subsection's selections with the current context, and the system tells the writer what became outdated or stale, never regenerating on its own.
  - **success:** Approve needs at least one active Seed Selection and, for Subsection 11, exactly one active uncertainty reference and at least one active experiment reference on every selected item (missing counts as unlinked and only regeneration or Feedback repairs links); when the shown Batch or any selected Seed's Batch consumed a different revision, the action is presented as "Confirm and approve" listing the carried items and the changed Subsections, and the confirmation is recorded; Approve stores the approved Context Revision (always the current one) and the approved Selection Revision; a Batch's consumed revision is never rewritten; Outdated is derived as consumed revision ≠ current; Stale is one derived predicate (approved and either approved revision ≠ current) recomputed server-side in the same transaction as any change, with a stale episode opened on the first true transition and disposed as resolved (recording whether a fresh-context attempt completed, whether its Seeds are in the snapshot, whether older selections were confirmed) or bypassed (skip, cancel); a Claim Exclusion match on a selected Seed warns at Approve and proceeds only on recorded confirmation.

- **CAP-10**
  - **intent:** Everything the writer decides is saved immediately and safely shared, and nothing they typed is lost to a conflict.
  - **success:** Closing and reopening on another device shows the same selections, states and Summary; only the open Subsection and unsaved box text are local per user; writer-initiated mutations carry the expected seed-stage version and a stale one is refused with the existing stale-revision error, after which the client refreshes and keeps the unsaved text; Batch completions are fenced by attempt ownership, not by the writer's version; prior Batches, superseded Seeds and original wordings are retained for the generation's life; two clients see each other's domain changes live.

- **CAP-11**
  - **intent:** When every Subsection is decided the writer reads the whole plan as one page and can fix it there.
  - **success:** Readiness is one server-side rule (all Standard and Multiple approved and not Stale, all Optional approved-not-Stale or skipped, no unlinked advancement) exposed with the blocking Subsections named; the Summary Review is a full-width in-page state with browser-history entry, never a modal, single column, sticky Section and Subsection navigation, every Seed Selection of a Multiple Subsection shown in full with its own Edit, Skipped and writer-asserted items marked, and the frozen length target, model and Writer Profile shown read-only beside the Sign-off action; an edit there is a Seed Edit with the same limits and staleness effects and withdraws readiness while anything is Stale; no free-text item can be added.

- **CAP-12**
  - **intent:** Sign-off freezes the plan, closes the seed stage and starts Prose Generation; the plan stays readable and separate from the prose; the writer can cancel before sign-off.
  - **success:** Sign-off requires the prose-edit capability and the human-gated state, re-evaluates readiness, and records who, when, the Summary version (active Seed Selections with support status and references, every Skip), the Brief version and settings; after sign-off every seed-stage mutation is refused with a typed invalid-state error; the Summary lives in its own records linked to the generation, is never written into the report, is unaffected by snapshot restore, and is readable read-only from the report afterwards; cancel before sign-off ends the generation with the existing semantics, retains seed records and creates no report; plan revision after sign-off is not offered.

- **CAP-13**
  - **intent:** Banhall drafts the three Sections from the signed-off plan under the unchanged Locked Rules and creates the report exactly as today.
  - **success:** Sections are drafted in the Writer Profile's Build Order (the Subsection order is the planning order only); each Section's drafting request receives its Subsections' Seed Selections (final wording, support status, order, references) and Skip decisions as delimited data blocks; a fixture proves an edited term appears in the drafted Section; Standard Subsections merge their Seed Selections into one role's content and Multiple items are distinct items to cover, with no prescribed paragraph count and QA scoring roles, never counts; two selected advancements sharing an uncertainty are drafted as one advancement with facets and the Compliance Note names the merge; writer-asserted items are treated as Writer's Notes; content precedence is Locked Rules, then signed-off Seed Selections, then Brief entries, with a Claim Exclusion conflict drafted and recorded rather than repaired, and Glossary Terms normalizing wording only, while style precedence (Locked, Org Mode, Writer Profile, House Rules) is unchanged; the Compliance Note lists every Seed Selection as covered or not and every Skip as honoured or not; the report is created by the existing creation path and post-QA is scheduled as today; the generation links its Summary version; a failed drafting run keeps the Summary and Retry starts a recovery generation bound to the same version, reusing frozen inputs and skipping the seed stage; a release-blocking semantic suite (carried old selections, skipped role supported by the Brief, corrected-then-withdrawn Feedback, exclusion-matching selection, changed advancement links) is judged by the reviewing manager with every fixture passing before release.

- **CAP-14**
  - **intent:** Seed-stage usage is visible and attributable, never capped, and fast enough that the writer stays in flow.
  - **success:** Every seed-stage request is metered under its own named slot (`generation:seeds:<role>`, `generation:seedFeedback:<role>`), including retries, repairs, prefetch and failures; the workspace shows the running request count with an informational notice at 40; no seed-stage request is ever refused on usage (owner decision 2026-09-17) and sign-off and cancel are never usage-gated; after three consecutive failed attempts a Subsection shows failed with Retry still available; dispatch-to-validated-result latency is at most 12 s median and 30 s p95 (placeholders until a production-model measurement), foreground dispatch-to-first-render is reported unthresholded, and Prose Generation from sign-off to report created is within single-mode drafting time plus the consistency pass; a pending attempt past its lease is marked failed within 20 minutes and the Subsection returns to its prior state with a retry action; prefetch runs at most one Subsection ahead, only for an untouched Subsection with no Batch, and a writer's open reuses the in-flight attempt.

- **CAP-15**
  - **intent:** Every seed decision is recorded for learning and measurement without leaking client text, and the record has a reader in the same release.
  - **success:** Append-only events cover Batch completion, failure, late arrival and first view (one per Batch per user), selection changes, edits (with edit ratio), Feedback requests and withdrawals, regenerate, skip, unskip, approve (with confirmation flag and snapshot), stale-episode open and disposition, budget extension, sign-off and cancel, each carrying ids, kind, time, project, generation, role, Batch/attempt/request/Seed ids where applicable, actor (user reference or system), the Context and Selection Revisions in force, outcome and stale-episode id, and never Seed or Feedback text; the learning-health admin surface shows, per period and per mode: Batches viewed, Seeds viewed, selected and edited, Feedback requests by frozen first-Approve outcome (selected / not selected / response not yet available / unresolved) with withdrawal reported separately, Regenerates, stale episodes by disposition (resolved split into fresh-attempt-used and confirmed-only) with median resolved duration, budget extensions, sign-offs and active time to sign-off, computed to match the worked event trace in `build-sequence.md`'s companion note (copied from the PRD addendum); the draft-style digest labels seed generations as not included; seed text never reaches logs or error reports, and any future firm-wide use goes through de-identification; seed prompts are versioned like all prompts and the shared injection suite covers Batch and Feedback calls.

- **CAP-16**
  - **intent:** The workspace is usable by keyboard and assistive technology, on narrow screens, and looks like the rest of Banhall.
  - **success:** Every control is reachable by Tab with visible focus, checkboxes toggle with Space, Approve/Regenerate/Sign-off are buttons; Batch arrival, saves, selection counts, Outdated and Stale changes and validation errors are announced politely; Tags, support status and state always carry their word; the action bar with Approve stays visible while cards scroll at every breakpoint; below the large breakpoint the Outline stacks or becomes a drawer with an explicit one-pane switch; contrast meets the design system and targets are at least 44 px on coarse pointers; new UI uses existing tokens, type roles, max font weight 500 and bits-ui primitives, no ad-hoc colours, no modal; list queries are bounded by the read-budget mechanism and paginated where they can exceed it.

## Constraints

- Agents propose, humans apply: Seeds are never prose, never enter the report, a Proposal or the Brief; the only prose this feature writes is the report created through the existing creation path.
- Locked Rules unchanged: three Sections with the three H2 headings, CRA line and word limits, no-fabrication with `[GAP]`, human-prose scan; Subsections are roles, never headings, and never a paragraph count.
- No new `generations.status` value; the seed stage waits in the existing human-gated status, which is never reaped for inactivity; per-Subsection state lives on its own rows.
- Every seed mutation and sign-off requires the project's prose-edit capability (own project or open assigned work item; Managers and Admins all); `projects.createdBy` is never consulted.
- Every new table carries `projectId` and joins the project-scoped registry this feature creates; seed text and Feedback are client data (never logged; de-identified before any firm-wide use).
- Conditioning is on Predecessors only (a recorded narrowing of the design handoff); Batch consumed revisions are immutable; Stale, Outdated and readiness are server-computed, never client-derived.
- Feedback results are never auto-selected; nothing regenerates automatically.
- The seed stage closes at sign-off; no plan revision within the same generation.
- Inherited spine invariants bind: AD-1, AD-2, AD-3, AD-4, AD-5, AD-7, AD-8, AD-9, AD-11, AD-14, AD-16, AD-19, AD-21, AD-23, AD-24, AD-25, AD-26, AD-27, AD-30 of the 2026-09-03 spine, plus AD-31 to AD-43 of the feature spine.
- Convex code follows `convex/_generated/ai/guidelines.md`; tests live in the vitest `convex`, `shared` and `src` projects and component tests under `vitest.component.config.ts`; every new mutation ships an authorization-branch test.
- Prior contracts are amended only as the PRD §10 table states (multi-select reversal; SM-C4 (09-09) rescoped; OQ-5 (09-09) closed; seed-stage requests metered and reported, never capped; 2x time ceiling from sign-off; the writer-effort ceiling restated so that choosing, editing and giving feedback in-tool is not authoring an artifact and the Dump stays the maximum input; Build Order extended so the Subsection order is the planning order while Build Order still governs Section order; gated prose approval and ghost retired for seed generations; edit-events replaced with visible coverage; Brief frozen per run; exclusion conflicts recorded not repaired; Feedback returns 1–3 unselected results; predecessor-only conditioning as a recorded narrowing of the handoff); single and compare modes are unchanged.

## Non-goals

- Any change to single or compare mode, including a pre-draft gate.
- Per-paragraph or per-Subsection approval of prose after sign-off (withdrawn only if OQ-2 is answered "keep the gate").
- Revising a signed-off plan within the same generation, or "start from previous summary" pre-fill.
- Writer-defined Subsection lists, order or kinds; free-text Summary items that are not Seeds.
- Seeds in the chat assistant; Seeds for an existing report; client-facing exposure of Seeds or the Summary.
- Automatic regeneration of Stale or Outdated Subsections.
- A new agent framework or orchestrator.
- Distilling seed decisions into learning digests; a positioning default for drafting; a second tag axis; side-by-side Batch comparison; the ghost one-shot draft for seed generations; a seed-record retention policy beyond project-scoped erasure.

## Success signal

Cohort for every figure: generations recorded as the seeds workflow, excluding cancelled ones and projects flagged as development; section-approval generations are never in the cohort.

- **Primary.** The lead writer (a named user id in admin settings) signs off and reaches a created report on three distinct projects by 2026-10-31. Median active time from the seed stage's first event to Sign-off is at most 30 minutes, where active time is the sum of gaps between consecutive seed events shorter than 10 minutes; this event-gap proxy is validated against at least five observed writer sessions before the threshold binds, and elapsed wall time is reported alongside, unthresholded. In at least 60% of Subsections approved at sign-off, the snapshot holds at least one Seed Selection whose final wording equals the AI wording of a non-Revised Seed (a restored original counts). Corrections-to-acceptable, recorded by the reviewing manager per report as in the 2026-09-09 measurement protocol with report version and judge stored, is at most 1.
- **Secondary.** At least 70% of Feedback requests have at least one Revised Seed selected at their Subsection's next Approve (denominator: requests whose response was available before an Approve; later responses score at the following Approve; never-approved requests are reported as unresolved; withdrawal after scoring does not change the score). Median stale episodes per generation at most 3, median resolved-episode active duration under 2 minutes, bypassed episodes reported separately.
- **Counter-metrics (never optimized).** Over all Seeds shown, median bullet length at most 18 words and zero sentence-check failures, with Seeds dropped by validation reported as a rate. Median seed-stage requests per generation at most 20 and p95 under 40, counting every request and including cancelled generations. Single and compare time-to-first-draft and cost per generation do not worsen by more than 10% over matched 30-day windows and the same model (an observational guard). Unsupported-claim QA findings per PD (QA's evidence-tracing check, completed QA only) in seed generations are not higher than in single mode over the same window and model; `[GAP]` markers are reported separately and are not the metric.

## Assumptions

- The Brief still derives at start and does not gate; its version and the generation settings are frozen per generation.
- The 25-word bullet cap, the tag-diversity and form-variety rules, the 300-character Feedback limit and the three-consecutive-failure signal are inferred bounds.
- Latency thresholds and the 40-request notice are placeholders until a production-model measurement.
- Prefetch is a droppable mechanism choice.

## Open Questions

- Owner answers of 2026-09-17 closed PRD OQ-1..OQ-5, OQ-8, OQ-9 and the cap half of OQ-6 (see `../../planning-artifacts/prds/prd-Banhall-2026-09-16/DECISIONS-2026-09-17.md`). Still open: latency measurement (OQ-6, owner Johnny, before slice 7); discovery of the relabelled mode (OQ-7, owner Michael); retention window for seed tables (spine Q-C).
