---
title: 'Ordered, ungated generation with Self-check and Compliance Notes'
type: 'feature'
created: '2026-09-10'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - convex/_generated/ai/guidelines.md
  - _bmad-output/specs/spec-pd-generation/SPEC.md
  - _bmad-output/specs/spec-pd-generation/touchpoints.md
  - _bmad-output/specs/spec-pd-generation/glossary.md
  - _bmad-output/specs/spec-pd-generation/user-journeys.md
  - _bmad-output/planning-artifacts/architecture/architecture-Banhall-2026-09-03/ARCHITECTURE-SPINE.md
  - docs/product-domain.md
warnings: []
deferred:
  - summary: >-
      UI surfaces for this story's backend: rendering drafted sections as they complete, a Stop button calling
      generations.stopOrderedGeneration, and the Compliance line/QA rail reading complianceNotes.listForGeneration.
    evidence: |-
      AD-25 names stories 4 and 5 as the readers of complianceNotes; story 4 (ui lane) owns the Brief panel and the
      "no Writer Profile applied" line. This story ships the stored rows, the one read query, the stop mutation and the
      drafted-section query those surfaces consume.
    severity: medium
  - summary: >-
      "Generate the rest" after a stop: a new generation carrying resumesGenerationId with the drafted sections as prior
      context (AD-24).
    evidence: |-
      Needs a request surface and a generation-writer path through createGeneratedReportArtifacts; no caller exists
      until the stop UI ships. This story records stoppedAfterSection and renders [NOT GENERATED] placeholders so the
      resume path has a well-formed report to extend.
    severity: medium
  - summary: >-
      Writer Profile settings UI for buildOrder and selfCheckRules.
    evidence: |-
      Both fields are accepted by saveMyProfile/saveProfileForUser and read by generation here; story 3 (profile lane)
      owns profile fidelity and the settings-document path that populates them.
    severity: low
  - summary: >-
      A Brief re-derivation re-inserts the previous version's "removed" and storylineQuestion rows as fresh
      change: "removed" markers, and renderBriefForGeneration (iterative sections and the one-shot ghost) still
      renders "removed" rows into the prompt as live Claim Exclusions, Confidence Map items and Glossary Terms.
    evidence: |-
      persistDerivedBrief diffs against every previous-version row without filtering change === "removed" or
      group === "storylineQuestion", so markers accumulate across versions; renderBriefForGeneration filters by
      group only. Story 1 code (c3ba3fc). This story's ordered chain reads the Brief through loadBriefCheck, which
      now skips "removed" rows; the story 1 readers do not.
    location: >-
      convex/generations.ts persistDerivedBrief, renderBriefForGeneration
    severity: medium
  - summary: >-
      failStaleGenerations fails any non-iterative running generation 30 minutes after startedAt without checking
      whether its ordered chain is still progressing, so a slow but live chain can be reaped mid-flight.
    evidence: |-
      The reaper (convex/crons.ts, every 10 minutes, olderThanMinutes 30) has per-section handling for iterative
      only. A single generation now runs generateReport, generateCandidate, three sequential section actions (up
      to five provider calls each, 240 s per attempt) and finalize. AD-24 binds recovery to the existing reaper and
      forbids a new one, so a progress-aware threshold is an architecture-level change.
    location: >-
      convex/generations.ts failStaleGenerations
    severity: medium
  - summary: >-
      A Brief-derivation failure inside generateReport is only logged with console.error, not the writer-facing
      progress log, so a silently Brief-less generation gives no visible signal of why.
    evidence: |-
      convex/ai/pipeline.ts generateReport's deriveOrReuseBrief catch block predates this story (introduced in
      c3ba3fc, story 1) and is unchanged here; every other fallback in the same function (Build Order, Writer
      Profile) does call the progress-log helper. Pre-existing, not caused by this story's diff.
    location: >-
      convex/ai/pipeline.ts generateReport (Brief-derivation catch block)
    severity: low
  - summary: >-
      getOrderedSectionDrafts takes(30) on generationSectionRuns before filtering by candidateRunId, so a
      generation that has accumulated more than 30 section-run rows across many regenerations could have a
      newer candidate's rows silently excluded.
    evidence: |-
      convex/generations.ts getOrderedSectionDrafts queries by_generationId with .take(30) first, then filters by
      candidateRunId in memory. Not reachable under this story's own acceptance criteria or tests (a generation
      normally accumulates a handful of rows per candidate), and a correct fix needs a candidateRunId-first index
      strategy rather than a one-line change.
    location: >-
      convex/generations.ts getOrderedSectionDrafts
    severity: low
  - summary: >-
      complianceNotes.listForGeneration takes(10) on generationCandidateRuns before matching the selected
      candidateId, so a generation that has accumulated more than 10 candidate runs across many regenerations
      could fail to resolve the selected run and silently fall back to returning every candidate's unscoped notes.
    evidence: |-
      convex/complianceNotes.ts queries by_generationId with .take(10) then Array.find()s by candidateId in
      memory — the same shape as the already-deferred getOrderedSectionDrafts .take(30) truncation above. Not
      reachable under this story's own acceptance criteria or tests; a correct fix needs a candidateRunId-first
      index rather than a one-line change.
    location: >-
      convex/complianceNotes.ts listForGeneration
    severity: medium
  - summary: >-
      In compare mode, two candidates can each independently insert a storylineQuestion row for the same
      Confidence Map entry into the generation's shared Brief; the row carries no candidateRunId to attribute or
      dedupe against, so duplicate or conflicting questions can accumulate on one generation's Brief.
    evidence: |-
      convex/generations.ts completeOrderedSectionRun inserts a generationBriefEntries "storylineQuestion" row
      per section whenever the model's Self-check verdict cites Confidence Map evidence, with no check for an
      existing row citing the same evidenceEntryId and no candidateRunId field on the insert. AD-23 names the
      mechanism but not compare-mode attribution. Not reachable under this story's own acceptance criteria or
      tests (the readers of this data are deferred to stories 4/5); a correct fix needs either a candidateRunId
      column or a dedup pass, not a one-line change.
    location: >-
      convex/generations.ts completeOrderedSectionRun
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Currently all three sections (242, 244, 246) are drafted in parallel via a candidate pipeline. The section generation lacks ordered sequencing with prior-section context, per-section self-checks before output, and traceable compliance reporting. Writers have no visibility into which profile instructions were applied or rejected per section, making it impossible to audit the generation.

**Approach:** Add ordered, ungated section generation to `single` and `compare` modes (default 242 → 244 → 246) with each section's prior-section context available to the prompt, each section run through a self-check before display, and stored Compliance Notes recording which profile instructions were applied and why others were not applied. The existing `iterative` mode's gated behavior remains unchanged. Story 1's Brief infrastructure (Storyline, Claim Exclusions, Confidence Map, Glossary Terms) provides the semantic foundation; this story wires the self-check rubric (CAP-9) and consistency pass (CAP-10) to validate output before the writer sees it.

## Boundaries & Constraints

**Always:**
- Ordered section generation in `single` and `compare`: default Build Order is 242 → 244 → 246; writers can customize via profile
- Prior-section context is passed to each section generation call (section 244 receives drafted 242; section 246 receives 242 + 244)
- Every section's self-check runs before output and produces a structured outcome (pass | repair attempted | repair failed)
- Repair attempts are recorded per-section and capped at one per section; if repair fails, the section is shown with a notice
- One assembled-draft consistency pass runs after all sections are drafted and before the last section is shown to the writer
- Compliance Note is stored with the generation and records per-section: which profile instructions were applied, which were not, and why (reason codes: cap breach, cap met, instruction applied, instruction waived via override, disabled profile, missing profile)
- Call budget: per section one generation + one self-check + at most one repair; consistency pass runs once; total end-to-end within 2x today's single-mode
- Writer Profile Build Order must support custom ordering and per-paragraph self-check rules; if a rule exceeds its cap it is applied up to the cap and reported
- The iterative mode's gated behavior (section-by-section human approval gates) is unchanged
- All compliance and self-check outcomes are stored alongside the generation record for audit and reporting

**Block If:**
- Build Order cannot be derived from the writer profile (profile missing, disabled, or malformed): report to writer as `no effective writer profile` and use House Rules default (242 → 244 → 246)
- A self-check repair fails (after one attempt): the section is shown with a `Self-check repair failed` flag and the repair outcome in the Compliance Note
- Consistency pass detects incompatible changes between sections (e.g., a claim excluded in Brief appears in the section): flag the section and record the issue in Compliance Note
- Writer Profile Build Order specifies a section not in {242, 244, 246}: HALT with `invalid section in Build Order`

**Never:**
- Let unrepaired failed checks block generation; show the section with the outcome recorded
- Mutate report prose directly from self-check; route repairs through the same generation mechanism as the initial draft
- Silently apply a House Rule when a writer override is present; record every decision in Compliance Note
- Gate generation in `single` or `compare` modes; ungated means all sections are shown to the writer as they complete
- Store repair attempts inline; every repair call is a separate model interaction with its own aiUsage entry
- Require the writer to author a new artifact; the Dump is the maximum required input
- Change Locked Rules (242/244/246 skeleton, line and word caps)

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal ordered flow, single mode | Project with Brief + Writer Profile | Sections generated in order (242 → 244 → 246); each section passes self-check; consistency pass runs; all three shown to writer | No error expected |
| Enabled Writer Profile with custom Build Order | Project + Profile with custom order (e.g., 246 → 242 → 244) | Sections generated in custom order; prior-section context passed correctly | Invalid order in profile → use default 242 → 244 → 246 |
| Disabled Writer Profile | Project + disabled profile | Sections generated in House Rules default (242 → 244 → 246); Compliance Note reports "no Writer Profile applied" | No error expected |
| Missing Writer Profile | Project + no profile for user | Sections generated in House Rules default; Compliance Note reports "no Writer Profile applied" | No error expected |
| Self-check detects excluded claim | Section 244 draft contains claim from Brief's Claim Exclusions | Self-check repair attempted; repair removes or hedges the claim; outcome recorded in Compliance Note | Repair fails → section shown with flag, outcome recorded |
| Self-check detects off-glossary synonym | Section 246 uses word not in Glossary Terms | Self-check repair attempted; repair replaces with matched Glossary Term; outcome recorded | Repair fails → section shown with flag, outcome recorded |
| Section cap breach detected | Section draft exceeds word cap (e.g., s242 > 350 words) | Self-check repair attempted; repair shortens draft; outcome recorded | Repair fails → section shown with flag and actual word count recorded |
| Profile instruction exceeds cap (e.g., line limit on s242) | Writer's instructions demand a line count that conflicts with Locked Rules | Instruction applied up to the cap; Compliance Note records "cap met" with actual values | No error expected |
| Consistency pass detects contradiction between sections | Section 242 establishes fact X; section 246 contradicts it | Consistency pass flags the sections involved; Compliance Note records "section contradiction detected" with location; section is shown to writer | No error expected; writer can then revise |
| `iterative` mode generation | Project + `iterative` candidateMode | Section-by-section generation with human approval gates; Build Order and compliance tracking unchanged; one-shot ghost candidate still runs | No error expected; iterative gating unaffected |
| All sections drafted, none pass self-check | Scenario triggers repair failure on every section | All three sections shown with flags; Compliance Note lists all failures; writer can revise via chat or re-request | No error expected; writer informed |

</intent-contract>

## Code Map

Line numbers drift; grep the symbol. Partial work from commits 1ce273b/76c8e2f is the starting point, corrected as below.

- `convex/schema.ts` -- REMOVE `generations.complianceNotes` (the partial's JSON string field). ADD table `complianceNotes` `{projectId, generationId, candidateRunId?: v.id("generationCandidateRuns"), section: "242"|"244"|"246", paragraphIndex?: number, source: "deterministic"|"model", instruction: string, outcome: "applied"|"not_applied", tier: "locked"|"org_enforced"|"conflict"|"missing_fact"|"none", reason: string, repaired: boolean}` with indexes `by_generationId_and_section` and `by_generationId_and_candidateRunId_and_section` (AD-25). ADD to `generations`: `stopRequestedAt?: number`, `stoppedAfterSection?: "242"|"244"|"246"`, `productionOrder?: array of "242"|"244"|"246"` (AD-24; the order actually run). ADD to `generationSectionRuns`: `candidateRunId?: v.id("generationCandidateRuns")`, `orderIndex?: number`, `selfCheck?: string` (JSON summary), `slotCounts?: string` (JSON), status literal `"drafted"`, index `by_candidateRunId_and_section`. ADD to `generationCandidateRuns`: `consistencyCheckedAt?: number`. ADD to `writerProfiles`: `selfCheckRules?: array of {section?: "242"|"244"|"246", paragraphIndex?: number, instruction: string, maxWords?: number, maxLines?: number}` (keep the partial's `buildOrder`).
- `convex/writerProfiles.ts` -- Build Order is stored as sent (trimmed) and validated on READ, not dropped on save: it must be a permutation of exactly 242/244/246, otherwise the default 242 -> 244 -> 246 is used and a `buildOrderFallbackReason` is returned. `selfCheckRules` validated on save (max 20 rules, instruction <= 500 chars, positive integer caps). `getEffectiveWriterStyle` returns, per AD-26, `profileState: "applied"|"disabled"|"missing"` and `categoryOutcomes: [{category, mode, effective, tier}]` for the six `STYLE_OVERRIDE_KEYS` (tier: `org_enforced` when the org mode is `enforced` or `off`, otherwise `none`), plus `buildOrder`, `buildOrderFallbackReason?`, `selfCheckRules`. Replace the partial's `tier: house_rules|writer_profile` field with this shape. `getProfileForGeneration` keeps its pre-story return shape and its null-when-nothing-to-apply contract (restored in 6e0beaa); revert the partial's `buildOrder`/`tier` additions there. New `internalQuery getGenerationProfileContext({userId?})` always returns the ordered-generation context above (never null).
- `convex/ai/instrument.ts` -- AD-27 slot enum: `GENERATION_CALL_SLOTS` const covering every label the codebase emits: fixed `analyzer`, `retrieval_brief`, `condense`, `brief`, `consistency`, `qa`, `chronology`, `post_qa`, `post_chronology`; per-section `section:<n>`, `selfCheck:<n>`, `repair:<n>`, `compression:<n>` with n in 242/244/246. `assertGenerationCallSite(callSite)` throws on any other `generation:*` label (non-`generation:` labels pass untouched); called from `instrumentedAnthropic` and `clientForModel` (`convex/ai/providers.ts`). Pure `summarizeSlotUsage(counts)` returns per-slot counts and `overrun: string[]` against the allowances: per candidate `brief` <= 1, `section:<n>` / `selfCheck:<n>` / `repair:<n>` <= 1 each, `compression:<n>` <= 2, `consistency` <= 1. Recorded, never enforced (Q12).
- `convex/lib/selfCheckRules.ts` (new, no `"use node"`) -- deterministic Self-check: Claim Exclusions (normalized substring, empty text skipped), Glossary via `convex/lib/glossaryMatcher.ts` (flagged candidates handed to the model call), Locked caps via `sectionMetrics`, profile `selfCheckRules` caps clipped to Locked caps (`tier: conflict`, reason like `cap met at 350/350 words`), six category rows copying `tier` verbatim from `categoryOutcomes`, the Writer Profile row (`no Writer Profile applied (disabled|missing)` when `profileState` is not `applied`), the Build Order row on the first section in production order. Paragraph indices come from the same paragraph split `src/lib/reportSections.ts` uses. Returns row drafts plus `needsRepair` and repair guidance.
- `convex/ai/selfCheck.ts` -- replace the placeholders: one structured model call per section (`generation:selfCheck:<n>`, `two-attempt-repair` structured policy) returning at most 30 paragraph-scoped verdicts against the Storyline, Confidence Map calibration (a fact marked unresolved/unreliable stated without hedging fails, `tier: missing_fact`), glossary flagged candidates, and each free-text profile instruction / `selfCheckRules.instruction` (quoted verbatim in `instruction`). A Storyline contradiction backed by stronger section evidence is returned as a `storylineQuestion`, never as a repair reason. Delete `attemptRepair`; repair is the section agent (next item).
- `convex/ai/orderedGeneration.ts` (new, `"use node"`, actions only) -- `generateOrderedSection` internal action: claim via `generations.claimOrderedSectionRun`; draft with the section agent (`runSection242Agent`/`244`/`246`, label `generation:section:<n>`) and a DRAFTED prior-sections block (new `draftedPriorSections` scaffold; not the iterative "approved" wording) plus the Brief block and frozen style guidance; banned-word scrub; `compressToFit` (<= 2 calls); deterministic + model Self-check; at most one repair through the same section agent with the repair guidance appended (label `generation:repair:<n>`), re-scrubbed, deterministic re-check only; then `completeOrderedSectionRun`. Worst case 1 + 2 + 1 + 1 = 5 sequential calls = `SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE`. `finalizeOrderedCandidate` internal action: one structured assembled-draft consistency call (`generation:consistency`, at most 20 findings, each naming sections and paragraphIndex) stored as model rows and stamped `consistencyCheckedAt`; then QA and chronology via `Promise.allSettled` as today; `buildTiptapDocument`; `provenanceDrafts` + `createProvenance`; `completeCandidateRun` with `agentOutputs` carrying `selfCheck` summary, `callBudget` (`summarizeSlotUsage` over the section rows' `slotCounts` plus finalize's own) and `productionOrder`. Slot counts come from a counting wrapper around the action's client factory (one increment per `messages.create`).
- `convex/ai/pipeline.ts` -- `generateReport` reads `getGenerationProfileContext` once beside `fetchWriterStyle` and passes the ordered context to every candidate, so compare candidates share one Build Order. `generateCandidate`: ghost runs (iterative's one-shot comparison) keep `runPipelineForModel` unchanged; non-ghost runs (single/compare) create the ordered section rows and schedule the first `generateOrderedSection` instead of calling `runPipelineForModel`. Chain args carry the same frozen payload `generateCandidate` receives (analysis, brain blocks, style fields, ordered context).
- `convex/generations.ts` -- new internal mutations `createOrderedSectionRuns`, `claimOrderedSectionRun` (CAS: row `queued`, candidate run `running`, generation `running`, `project.activeGenerationId` matches; returns this candidate's drafted prior sections in production order), `completeOrderedSectionRun` (CAS; stores draft/metrics/selfCheck/slotCounts, inserts that section's `complianceNotes` rows, inserts at most one `storylineQuestion` `generationBriefEntries` row on the generation's Brief, appends a progress line, then schedules the next section, or `finalizeOrderedCandidate` when the order is exhausted or `stopRequestedAt` is set), `failOrderedSectionRun` (marks the row failed and fails the candidate through `completeCandidateRun` with an error), `insertConsistencyNotes`. Public `stopOrderedGeneration({generationId})` (single/compare only; same auth and CAS on `activeGenerationId` as `cancelIterativeGeneration`; sets `stopRequestedAt`; idempotent). `completeCandidateRun` stamps `productionOrder` and, when stopped, `stoppedAfterSection`. Public query `getOrderedSectionDrafts({generationId, candidateRunId?})`: drafted sections in production order, withholding the last section in order until `consistencyCheckedAt` is set. `failStaleGenerations` is unchanged (AD-24: the existing reaper recovers a stalled chain). `getSectionRun` (iterative) must never see ordered rows: iterative generations create none, because their ghost stays one-shot.
- `convex/complianceNotes.ts` (new) -- the one read query `listForGeneration({generationId, candidateRunId?})` with the same project-access check as `getGeneration`; when `candidateRunId` is absent on a compare generation that has a selected report, it returns the selected candidate's rows (`selectReportCandidate` inheritance). Bounded `take(1000)`. No other module inserts `complianceNotes` except the section-chain mutations above.
- `convex/lib/complianceNote.ts` -- replace the JSON aggregate/serialize/deserialize with typed row builders shared by the chain mutations (`ComplianceNoteRow` matching the table validator). No JSON blob anywhere.
- `convex/lib/tiptapReport.ts` -- `buildTiptapDocument` accepts a missing section and renders a `[NOT GENERATED]` placeholder paragraph under its H2, so AD-8's three-heading contract holds for a stopped generation.
- `convex/ai/promptProgram.ts` -- `single`/`compare` topology: replace the partial's `orderedSections` object with a declared shape: `{ orderedSectionChain: { defaultBuildOrder: ["242","244","246"], perSection: ["section", "conditionalCompression", "selfCheck", "atMostOneRepair"], gate: "none" } }`, then `"assembled-draft-consistency-pass"`, then `{ allSettled: ["qa","chronology"] }`. Add `calls.selfCheck`, `calls.repair` (section-agent reuse), `calls.consistency`. `iterative` topology unchanged apart from story 1's `brief`.
- `convex/ai/prompts.ts` / `convex/ai/promptDefinitions.ts` -- Self-check and consistency system prompts, request schemas and the `draftedPriorSections` and repair-guidance scaffolds, in the existing scaffold style.

## Tasks & Acceptance

**Execution (every item is in scope for this run; nothing here is deferred):**
- [ ] `convex/schema.ts` -- apply the Code Map schema changes; remove `generations.complianceNotes`.
- [ ] `convex/writerProfiles.ts` -- Build Order read-validation with fallback reason; `selfCheckRules`; AD-26 `profileState` + `categoryOutcomes`; restore the `getProfileForGeneration` shape; add `getGenerationProfileContext`.
- [ ] `convex/ai/instrument.ts` + `convex/ai/providers.ts` -- slot enum, `assertGenerationCallSite`, `summarizeSlotUsage`; update any test fixture labels that are not real slots.
- [ ] `convex/lib/selfCheckRules.ts`, `convex/ai/selfCheck.ts`, `convex/lib/complianceNote.ts` -- deterministic rules, the model Self-check call, row builders.
- [ ] `convex/ai/orderedGeneration.ts`, `convex/ai/pipeline.ts`, `convex/generations.ts` -- the scheduled per-section chain, finalize action, stop mutation, drafted-section query.
- [ ] `convex/complianceNotes.ts` -- `listForGeneration`.
- [ ] `convex/lib/tiptapReport.ts` -- `[NOT GENERATED]` placeholder.
- [ ] `convex/ai/promptProgram.ts`, `convex/ai/prompts.ts`/`promptDefinitions.ts` -- topology and prompts; update the manifest key list in `tests/aiUsage.test.ts` for the new calls.
- [ ] Tests (convex-test with the provider stubbed at the client boundary, as the existing pipeline tests do; never `test.skip`, never vacuous):
  - `convex/ai/promptProgram.test.ts` (new): single and compare run the chain in Build Order (default and custom 246 -> 242 -> 244) with each section's prompt containing exactly the prior drafted sections; no generation passes through `awaiting_input` in single/compare; the consistency pass runs exactly once per candidate, before the last section is exposed by `getOrderedSectionDrafts`; `productionOrder` is recorded; compare rows carry `candidateRunId`; iterative still stops at `awaiting_input` after its first section and its ghost still calls `runPipelineForModel`; `stopOrderedGeneration` after the first section yields a completed generation with `stoppedAfterSection` and `[NOT GENERATED]` bodies.
  - `convex/ai/selfCheck.test.ts` (new): excluded claim -> one repair -> row `repaired: true`; off-glossary synonym -> repair to the Glossary Term; s242 cap breach -> repair, and when the repair still breaches -> `not_applied` with the actual word count and a repair-failed status; unreliable fact stated flat fails the check (`missing_fact`), and the hedged fixture passes; never more than one repair call; `paragraphIndex` set on paragraph-scoped rows; Storyline contradiction inserts one `storylineQuestion` entry and no repair; every section repair-failing still completes the generation with all three sections flagged.
  - `convex/ai/instrument.test.ts` (extend): slot enum accepts every emitted label, rejects an unknown `generation:*` label, per-slot counts and `overrun`.
  - `convex/ai/providers.test.ts` (extend): the ordered section action's worst case (1 + squeezes + 1 + 1) equals `SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE`, and the per-action arithmetic is unchanged.
  - `convex/writerProfiles.test.ts` (extend): custom Build Order returned; invalid, duplicate or partial orders fall back with a reason; disabled and missing profiles report `profileState` and still yield the default order; category `tier` is copied verbatim into complianceNotes rows (never recomputed); the `getProfileForGeneration` null contract holds.
  - `convex/lib/tiptapReport.test.ts` + `tests/reportSections.test.ts` / `tests/exportValidation.test.ts` (extend): editor/export parity: the chain's assembled content, including the placeholder case, parses back into the same three headings and paragraphs the export path consumes.

**Acceptance Criteria:**
- Given a `single` generation with an enabled Writer Profile whose Build Order is 246 -> 242 -> 244, when the chain runs, then the sections are drafted by separate scheduled actions in that order, each section's prompt carries the previously drafted sections, the generation never enters `awaiting_input`, and `productionOrder` equals the Build Order.
- Given a disabled or missing Writer Profile (or an invalid Build Order), when generation runs, then the order is 242 -> 244 -> 246 and every section's `complianceNotes` include a `not_applied` Writer Profile row reading "no Writer Profile applied" (or the Build Order fallback reason).
- Given a section draft containing a Claim Exclusion, an off-glossary synonym or a cap breach, when its Self-check runs, then exactly one repair call (`generation:repair:<n>`) runs and the `complianceNotes` rows record the instruction, outcome, tier, reason and `repaired`; a repair that fails leaves the section shown with a repair-failed Self-check status.
- Given a Confidence Map fact marked unreliable stated without hedging, when Self-check runs, then the check fails with `tier: missing_fact` and the repaired prose hedges it.
- Given a profile rule demanding more than a Locked cap, when the section is checked, then the rule is applied up to the cap and the row reads `tier: conflict` with the actual values.
- Given all sections drafted, when `finalizeOrderedCandidate` runs, then exactly one `generation:consistency` call runs, its findings are stored as rows naming sections and paragraphs, and `getOrderedSectionDrafts` withholds the last section in order until that pass is recorded.
- Given `compare` mode, when the chain runs, then it runs once per candidate, and every section row and complianceNotes row carries that candidate's `candidateRunId`; `listForGeneration` returns the selected candidate's rows after selection.
- Given the writer calls `stopOrderedGeneration` after the first section, when the current section action finishes, then no further section is scheduled and the generation completes with `stoppedAfterSection` set and `[NOT GENERATED]` under each remaining H2.
- Given `iterative` mode, when a generation runs, then its section-by-section approval gate and one-shot ghost behave exactly as before.
- Given any generation-owned call, when it is made, then its `aiUsage.callSite` is a member of `GENERATION_CALL_SLOTS`, and the candidate's scorecard reports per-slot counts and any `overrun`.

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. Do not modify or delete existing entries.
     Each entry records: what finding triggered the change, what was amended, what known-bad state
     the amendment avoids, and any KEEP instructions (what worked well and must survive re-derivation).
     Empty until the first bad_spec loopback. -->

### 2026-09-10 — High-severity bad_spec loopback

**Triggering findings:**
- getProfileForGeneration return type changed from nullable to always-object; callers expecting null bypass buildOrder injection
- Build Order validation throws error instead of graceful fallback per spec

**Amendment to Boundaries & Constraints section:**
- Build Order fallback behavior: "Build Order cannot be derived... use House Rules default (242 → 244 → 246)" — updated to mean: validation errors do not throw; invalid sections cause silent fallback to default; Compliance Note records the fallback reason.

**Amendment to Tasks & Acceptance:**
- Added test requirement: Build Order validation fallback tested; invalid sections cause default order with compliance note explanation.

**KEEP instructions:**
- Schema additions (complianceNotes, buildOrder fields) and data structures (selfCheckOutcome, complianceNote types) are correct and must survive re-derivation.
- writerProfiles.ts tier tracking and buildOrder storage are correct; fix only the validation error handling and return type contract.

### 2026-09-10 — Dispatch corrections folded in (bmad-build-auto, story 2 re-drive)

**Trigger:** the caller's dispatch for this re-drive requires two corrections to the partial work (1ce273b, 76c8e2f) and names AD-24, AD-25 and AD-27 as binding.

**Amended (outside the intent-contract):** Code Map, Tasks & Acceptance, Design Notes, Verification and frontmatter `deferred`.
- Compliance Notes are rows in a `complianceNotes` table (AD-25 fields and indexes), replacing `generations.complianceNotes: v.optional(v.string())` and the JSON serialize/deserialize helpers. This supersedes the old Code Map/Tasks lines that said "no new schema tables".
- Ordered generation is a chain of per-section scheduled actions plus one finalize action (AD-24), never a loop inside one action; each action stays within the five-slot AD-9 budget.
- Every generation call carries an AD-27 slot label validated against `GENERATION_CALL_SLOTS`.
- The stale "phases 3-6 deferred" item is superseded: all of it is in scope for this run. The remaining deferrals (UI surfaces read by stories 4/5, "Generate the rest", profile settings UI) are recorded in frontmatter with reasons.
- Decided by the caller: ungated by default in `single`/`compare`; `iterative` keeps its gate untouched.

**Known-bad states avoided:** a JSON blob that stories 4/5 cannot index by section or candidate; three sections plus checks in one 600 s action; unlabeled extra calls hiding a budget overrun.

**KEEP:** the partial's `buildOrder` storage field and `validateBuildOrder` duplicate/invalid detection (moved to the read path so the fallback reason reaches the Compliance Note); the empty-exclusion guard; the prior loop's rule that Build Order errors never throw and never block generation.

## Review Triage Log

### 2026-09-10 — Review pass
- intent_gap: 0
- bad_spec: 2: (high 2)
- patch: 7: (medium 5, low 2)
- defer: 16: (medium 16)
- reject: 0
- addressed_findings:
  - `[high]` `[bad_spec]` getProfileForGeneration contract change: return type now always object, not nullable; callers checking `if (!profile)` will skip buildOrder injection
  - `[high]` `[bad_spec]` Build Order validation throws INVALID_INPUT error on invalid sections; spec requires graceful fallback to default order with compliance note
  - `[medium]` `[defer]` Phases 3-6 incomplete: orchestration, prompts, test files, consistency pass, repair pipeline (documented as deferred to next cycle)
  - `[medium]` `[defer]` Missing selfCheckRules field mentioned in spec but not implemented (phases 3-6)
  - `[medium]` `[patch]` Duplicate sections in buildOrder not rejected (e.g., ["242", "242", "246"])
  - `[medium]` `[patch]` Empty exclusion.text in claimExclusions matches all drafts
  - `[medium]` `[patch]` sectionMetrics() call lacks error handling
  - `[medium]` `[patch]` JSON.parse() in deserializeComplianceNote lacks error handling
  - `[low]` `[patch]` invalidBuildOrderReason could be undefined in summary
  - `[low]` `[patch]` section.selfCheck not guarded with optional chaining

### 2026-09-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 0, medium 7, low 4)
- defer: 2: (high 0, medium 2, low 0)
- reject: 26: (high 0, medium 8, low 18)
- addressed_findings:
  - `[medium]` `[patch]` `loadBriefCheck` fed a re-derived Brief's `change: "removed"` rows into section prompts and the deterministic Self-check, so a dropped Claim Exclusion was still enforced and repaired against: those rows are now skipped.
  - `[medium]` `[patch]` The Storyline Compliance Note said "Storyline question raised in the Brief" even when no Confidence Map evidence resolved and no entry was inserted: `assembleSectionNotes` now takes `recorded` and words the row "not recorded in the Brief" in that case.
  - `[medium]` `[patch]` In compare, `generations.stoppedAfterSection` recorded whichever candidate stopped first although candidates stop independently: `settleCandidateRun` now stamps it only in single mode, and `selectReportCandidate` copies the selected candidate's own stop from its agentOutputs.
  - `[medium]` `[patch]` No test reached `failOrderedSectionRun`: added a chain test where 244's draft call fails (rows failed and undrafted, candidate failed, single generation ended, project pointer cleared).
  - `[medium]` `[patch]` No test covered a failed model Self-check call: added one proving the section still completes with a per-section "Model Self-check" `not_applied` row and `modelCheck: failed`.
  - `[medium]` `[patch]` No test covered a failed consistency call: added one proving the advisory row, completion, and release of the last section.
  - `[medium]` `[patch]` Moving the Brief wiring test to the ordered chain left the iterative one-shot ghost's Brief-in-prompt path untested: added a ghost test asserting all three section prompts carry the stored Brief block.
  - `[low]` `[patch]` An empty repair output could replace the draft: blank text already throws in `requireTextResponse`; a repair the banned-word scrub empties is now also treated as a failed repair (`EMPTY_OUTPUT`) and the draft is kept. Tested with an empty repair response.
  - `[low]` `[patch]` `listForGeneration` resolved the selected run with `.unique()` on `(generationId, model)`, which throws if two runs share a model: it now resolves the run by the selection's `candidateId`.
  - `[low]` `[patch]` The intent's Block-If flag wording "Self-check repair failed" appeared nowhere: the section progress line now reads "drafted (Self-check repair failed)" for that status (asserted in the removed-entries test).
  - `[low]` `[patch]` `readOrderedProfileContext`'s degrade-not-fail fallback was untested: added a unit test with a throwing profile read.

### 2026-09-11 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 2, low 3)
- defer: 2: (medium 0, low 2)
- reject: 14: (high 0, medium 0, low 14)
- addressed_findings:
  - `[medium]` `[patch]` `generateOrderedSection`'s initial section draft had no guard against the banned-word scrub reducing a non-empty model response to an empty string (the raw response is already guarded by `requireTextResponse`, but nothing re-checked after the scrub, unlike the repair path's existing `EMPTY_OUTPUT` handling): now throws and fails the section instead of persisting an empty body. Tested with a draft response consisting only of a banned connective the scrub deletes outright.
  - `[medium]` `[patch]` `getOrderedSectionDrafts` returned a failed candidate's earlier successfully-drafted section rows (their own row status stays `"drafted"` even after the candidate fails): the query now also excludes rows whose owning candidate run's status is `"failed"`. Tested by extending the existing section-draft-failure chain test.
  - `[low]` `[patch]` `writerProfiles.ts` validated `selfCheckRules` length on save but not `buildOrder` length, leaving it an unbounded array: added a `MAX_BUILD_ORDER_ENTRIES` write-time cap (input-size backstop only; validity is still decided on read, unchanged). Tested with an 11-entry Build Order.
  - `[low]` `[patch]` A story-2 test in `briefPipelineWiring.test.ts` claimed each section's Self-check triggers its one repair, but the shared network mock has no `submit_self_check` branch, so the model Self-check call always fails there and the repair is actually driven by the deterministic checker: corrected the comment to say so; the test's own assertions were already accurate.
  - `[low]` `[patch]` No test covered QA and chronology failing at the same time (both run via `Promise.allSettled` in `finalizeOrderedCandidate`, only single-agent failure was covered elsewhere): added one asserting the candidate still completes with `agentOutputs.qa` and `.chronology` both `null`.
  - `[low]` `[defer]` Brief-derivation failures inside `generateReport` are logged with `console.error` only, not the writer-facing progress log (unlike the Build Order/Writer Profile fallbacks a few lines below). Pre-existing from story 1 (c3ba3fc), not caused by this story's diff.
  - `[low]` `[defer]` `getOrderedSectionDrafts` takes(30) on `generationSectionRuns` before filtering by `candidateRunId`, so a generation with more than 30 accumulated section-run rows could have a newer candidate's rows silently excluded. Not reachable under this story's acceptance criteria or tests; a correct fix needs a candidateRunId-first index rather than a one-line change.

### 2026-09-11 — Review pass (second follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 4: (medium 2, low 2)
- defer: 2: (medium 2, low 0)
- reject: 23: (medium 10, low 13)
- addressed_findings:
  - `[medium]` `[patch]` `compressToFit`'s squeeze re-scrub had no guard against the banned-word scrub reducing an already-non-empty compressed draft to nothing (the initial pre-compression draft already had this guard; the post-compression path did not): now throws and fails the section instead of persisting an empty body. Tested with an over-cap draft whose compression response is a banned connective the scrub deletes outright.
  - `[medium]` `[patch]` `clampParagraph` mapped both an explicit whole-section verdict (`paragraph: 0`, documented in the Self-check schema) and paragraph 1 to the same `paragraphIndex: 0`, so a section-wide Self-check finding was indistinguishable from a first-paragraph finding in the stored Compliance Note and in repair guidance text ("Paragraph 1: ..."). `ModelVerdict.paragraphIndex` is now optional; a whole-section verdict stores no `paragraphIndex` and its repair-guidance line reads "Whole section: ...". The consistency pass (no whole-section concept) is unaffected. Tested with one whole-section and one paragraph-1 verdict in the same Self-check response.
  - `[low]` `[patch]` `GENERATION_SLOT_ALLOWANCES.compression` in `convex/ai/instrument.ts` was a hardcoded `2`, duplicating `COMPRESSION_REQUEST.squeezes.length` (already derived the same way in `convex/ai/providers.ts`); the two constants could silently drift. Now imports and derives from the same source.
  - `[low]` `[patch]` `failOrderedSectionRun`, unlike every sibling ordered-chain write, patched `generationSectionRuns` rows with no `orderedChainFence` liveness check first, so a stale call (candidate run, generation or project pointer already moved on) could write stale `failed` rows. Now fenced like its siblings; `settleCandidateRun`'s own guard already protected the terminal state, so this is a defensive-consistency fix, not a demonstrated data-loss bug.
  - `[medium]` `[defer]` `complianceNotes.listForGeneration` takes(10) on `generationCandidateRuns` before matching the selection's `candidateId`, the same truncation shape as the already-deferred `getOrderedSectionDrafts` .take(30): a generation with more than 10 accumulated candidate runs could silently fall back to unscoped notes. Needs a candidateRunId-first index, not a one-line change.
  - `[medium]` `[defer]` In compare mode, two candidates can each independently insert a `storylineQuestion` Brief row for the same Confidence Map entry, with no `candidateRunId` to attribute it and no dedup, so duplicate/conflicting questions can accumulate. Needs a schema or dedup change; the readers of this data are deferred to stories 4/5.
  - 23 findings rejected: 3 restated already-recorded frontmatter deferrals or already-resolved Spec Change Log tensions (no UI consumer, Build Order HALT-vs-fallback, reason codes as typed codes); several described already-correct, intentionally disclosed design (the one-repair-not-re-verified-by-model tradeoff explicit in the row text; `claimOrderedSectionRun`'s "stop only after the first section" behavior explicit in its own code comment; `selfCheckRules`' cross-section fan-out, already capped at 20 rules on save; the AD-27 overrun list, explicitly "recorded, never enforced" by design; additive `stopOrderedGeneration`/`storylineQuestion` scope, authorized by AD-23/AD-24); one (`generateCandidate`'s legacy `orderedContext` fallback for pre-deploy candidates) matches an already-accepted, identically-shaped `contextBudget` pattern in the same function; `finalizeOrderedCandidate`'s "frozen generation input unavailable" recovery attempt was traced through `settleCandidateRun` and found to always no-op in the one scenario it can fire (the project-pointer mismatch that triggers it is also what `settleCandidateRun`'s own guard treats as "not this candidate's business"), but AD-24 already binds recovery for exactly this class of stuck-running row to the existing stale-generation reaper, so the dead branch has no behavioral consequence beyond what the accepted design already produces; the rest were low-consequence robustness/perf/coverage-only observations (a UTF-16 surrogate-pair truncation edge case, a non-exact string-literal "duplication", an unlogged defensive filter, a verified-already-correct `selfCheckRules: []` clearing path, a redundant double profile read, an unbounded `"pending"` status after a stop with no demonstrated query impact) below the bar for action.

## Design Notes

**Ordered generation with prior-section context:** The default Build Order (242 → 244 → 246) matches the Locked Rules structure, but writers need flexibility to reorder sections based on narrative flow (e.g., 246 "Findings" first to establish facts, then 242 "Executive Summary" second). Prior-section context is injected as a delimited data block into the section prompt so the model can reference established facts and avoid repeating claims.

**Self-check rubric:** The self-check validates the section against the Brief (no excluded claims, no off-glossary synonyms) and the profile's own rules (paragraph density, line limits, cap compliance). If a check fails, one repair is attempted using the same model + `two-attempt-repair` policy. If repair fails, the section is shown with a flag and the outcome is logged; the writer can then revise via chat or re-request generation.

**Compliance Note design:** Stores per-section decisions: which instructions were applied (from which tier: Locked Rules, House Rules, Writer Profile, Org Mode), which were not (and why: overridden, disabled profile, cap hit), and which repairs were attempted (outcome: pass/fail/not-needed). This makes the entire generation auditable and supports the Pre-Claim Approval regime's need for defensible narratives.

**Consistency pass:** Runs once over the assembled draft (all three sections together) after they are all drafted. Detects contradictions (e.g., a claim established in 242 contradicted in 246) and flags them for the writer to resolve. The pass does NOT auto-repair; it flags and records.

**Chain mechanics (AD-24, corrected):** `generateCandidate` (non-ghost) -> `generateOrderedSection` x N (one scheduled action per section, each fenced by `claimOrderedSectionRun`'s CAS, like iterative's `claimSectionRun` minus `approveSectionDraft`) -> `finalizeOrderedCandidate`. The completion mutation schedules the next step atomically with the section's writes, so a crash between sections leaves a `queued` row that the existing `failStaleGenerations` reaper fails with the generation. Per-action worst case: section 1 + compression 2 + selfCheck 1 + repair 1 = 5; finalize: consistency 1 + (QA || chronology) 1 = 2. The ghost draft in `iterative` stays one-shot, so iterative's `(generationId, section)` section-run lookups never meet an ordered row.

**Compliance rows (AD-25, corrected):** one row per decision, written only by the chain's mutations. Deterministic rows: six style categories (tier copied from `getEffectiveWriterStyle.categoryOutcomes`), the Writer Profile state, the Build Order, Locked caps, profile `selfCheckRules` caps, Claim Exclusions, glossary rule hits. Model rows: free-text instructions quoted verbatim, Storyline and Confidence Map calibration verdicts, consistency findings. `paragraphIndex` is set on every paragraph-scoped row. Intent reason codes map into `reason` text (e.g. `cap met at 350/350 words`, `instruction waived via override`, `no Writer Profile applied (disabled)`).

## Verification

**Commands:**
- `bash scripts/loop-verify.sh` -- full gate: preflight, Convex typecheck, `npm run check`, `npm test` (including the new and extended suites below), the discovery guard (fails on skipped or vacuous tests), `npm run build`, uploader harnesses.
- `npx vitest run convex/ai/promptProgram.test.ts convex/ai/selfCheck.test.ts convex/ai/instrument.test.ts convex/ai/providers.test.ts convex/writerProfiles.test.ts convex/lib/tiptapReport.test.ts tests/reportSections.test.ts tests/exportValidation.test.ts tests/aiUsage.test.ts` -- focused run of every suite this story adds or extends.

**Manual checks:**
- `grep -rn "complianceNotes" convex --include=*.ts | grep -v _generated` shows inserts only in `convex/generations.ts`'s chain mutations, and a read only in `convex/complianceNotes.ts`.
- `grep -rn "complianceNotes: v.optional(v.string())" convex/schema.ts` returns nothing.
- `iterative` topology in `promptProgram.ts` and `approveSectionDraft`/`cancelIterativeGeneration` are unchanged apart from story 1's `brief`.

## Auto Run Result

Status: done

**Summary.** This run started from `done` (per the frontmatter `followup_review_recommended: true` left by the prior review pass) and executed a fresh, independent review pass over the whole story-2 diff, not an implementation change. No new feature work was in scope; the four parallel review layers (Blind Hunter, Edge Case Hunter, Verification Gap, Intent Alignment) reviewed the diff from the merge base to `HEAD` (`df5eb1e..HEAD`, restricted to non-generated, non-`_bmad-output` files — narrower and cleaner than the prior pass's best-effort range, since no `baseline_revision` is recorded and this range excludes story 1's already-reviewed commits). Every finding was independently verified against the actual code before triage, not taken on a reviewing subagent's word: several were traced deep enough to overturn the reviewer's own framing (a claimed dead branch in `finalizeOrderedCandidate` turned out to converge with the already-accepted AD-24 reaper design once followed through `settleCandidateRun`'s own guard; a claimed "unguarded fan-out" in `selfCheckRules` turned out to already be capped at save time), and 3 findings restated ground already settled by frontmatter deferrals or the 2026-09-10 Spec Change Log, so they were rejected as already-addressed rather than re-opened.

**Files changed in this pass:**
- `convex/ai/orderedGeneration.ts`: the post-compression draft is now guarded against the banned-word scrub emptying it, matching the guard the pre-compression draft already had.
- `convex/ai/selfCheck.ts`: `clampParagraph` now distinguishes an explicit whole-section verdict (`paragraph: 0`) from paragraph 1 instead of colliding them.
- `convex/lib/selfCheckRules.ts`: `ModelVerdict.paragraphIndex` is now optional (whole-section); `repairIssues` labels a whole-section repair guidance line accordingly.
- `convex/ai/instrument.ts`: `GENERATION_SLOT_ALLOWANCES.compression` now derives from `COMPRESSION_REQUEST.squeezes.length` instead of a hardcoded duplicate.
- `convex/generations.ts`: `failOrderedSectionRun` is now fenced like every sibling ordered-chain write.
- `convex/ai/selfCheck.test.ts`: added a whole-section-vs-paragraph-1 Self-check test.
- `convex/ai/promptProgram.test.ts`: added a compression-scrub-empties-the-draft test.
- This spec: triage log, 2 new deferrals, this result.

**Review findings.**
- Patches applied: 4 (medium 2, low 2).
- Deferred: 2 (medium): a `.take(10)` truncation risk in `complianceNotes.listForGeneration` symmetric to the already-deferred `getOrderedSectionDrafts` `.take(30)`; a compare-mode `storylineQuestion` attribution/dedup gap needing a schema or logic change bigger than a one-line patch.
- Rejected: 23 (medium 10, low 13). See the triage log entry above for the full breakdown; the most substantive were confirming several reviewer claims described already-correct, intentionally disclosed design (the one-repair-not-model-re-verified tradeoff; the stop-only-after-first-section behavior; the AD-27 "recorded, never enforced" overrun list) and tracing the `finalizeOrderedCandidate` frozen-input branch deep enough to find it converges with the accepted AD-24 reaper-based recovery design rather than constituting an unhandled failure.
- intent_gap: 0. bad_spec: 0.

**Follow-up review recommendation:** `true`. Patched findings in this pass were 0 high, 2 medium and 2 low; score = 3 × 2 + 1 × 2 = 8, which is 5 or more.

**Verification:**
- Focused run before the full gate: `npx vitest run convex/ai/promptProgram.test.ts convex/ai/selfCheck.test.ts convex/ai/instrument.test.ts convex/ai/providers.test.ts convex/writerProfiles.test.ts` — 5 files, 87 tests, all passing.
- `npx tsc -p convex/tsconfig.json --noEmit` — 0 errors (verifies the `paragraphIndex` optionality change across all consumers).
- `bash scripts/loop-verify.sh` — 9/9 steps: preflight, no skipped tests, Convex typecheck, svelte-check, unit tests (170 files, 2211 tests — 2 more than the prior pass's 2209, matching the 2 new test cases added here), discovery guard, production build, both uploader harnesses (93/0 and 47/0). Exit 0.
- Every claim in the Review findings section above — the design-intent matches, the `contextBudget`-pattern precedent, the `settleCandidateRun` trace — was checked directly against the source, not taken on a reviewing subagent's word.

**Residual risks:**
- Same as the prior passes: AD-25's QA-scorecard summary field (`generations.qa`) is not written; Self-check/repair outcomes live only in `agentOutputs.selfCheck`/`.callBudget`. The UI surfaces (drafted-section rendering, Stop button, Compliance line) remain deferred to stories 4 and 5, unchanged by this pass.
- The two new deferrals (`complianceNotes.listForGeneration`'s `.take(10)`; compare-mode `storylineQuestion` attribution) are both medium-severity but not reachable under this story's own acceptance criteria today; they become worth revisiting once a project accumulates enough regeneration history, or once stories 4/5 give compare-mode Brief questions a real UI consumer.
- `baseline_revision` remains unset on this spec; this pass used `df5eb1e..HEAD` (the merge point before story 2's own commits) as a cleaner best-effort range than the prior pass's, but a future pass will again need to reconstruct the diff. This pass did not touch the deferred-work ledger's own entries beyond what the orchestrator had already written there.

