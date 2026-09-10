# Rubric review: ARCHITECTURE-SPINE.md, 2026-09-09 update (Banhall)

Reviewer role: rubric walker. Scope: the 2026-09-09 update only — header note, dated pointer bullets under AD-4/5/9/11/16, AD-23–AD-30, the new "Generation UI" convention row, the new Capability-map row, the five new Deferred rows tied to `spec-pd-generation`, and Q15–Q17 — judged for internal consistency against the whole spine (AD-1–AD-22 taken as prior and final) and against `_bmad-output/specs/spec-pd-generation/SPEC.md` + `touchpoints.md`. Repo checked at `c55014f` on `sprint2-boundary`. Citations spot-checked against `convex/ai/providers.ts`, `convex/reports.ts`, `convex/ai/chatAgentV2.ts`, `convex/writerProfiles.ts`, `convex/_generated/ai/guidelines.md`.

**Overall verdict: Adequate, not yet closed.** The update is well-targeted — every CAP-1..17 is bound by a new AD, the Deferred rows are internally consistent, and the two most load-bearing numeric claims (AD-24's `SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE = 5` / 600 s, AD-23's citation-validation shape) hold against the code. But it has one real structural gap — three new child tables (`generationBriefEntries`, `complianceNotes`, `chatProposalItems`) carry client-confidential content and no direct `projectId`, so they will silently escape AD-19's own stated cascade-delete enforcement once AD-19 ships — plus a cluster of medium-severity thinness: legacy generations without a Brief are undecided, AD-24's "writer may stop" names no mechanism, the new UI convention row conflates two different status enums across two different stories, AD-28 misdescribes an existing schema cap, and none of AD-23–AD-30 name an enforcing test the way every inherited ADOPTED AD does. None of this contradicts an ADOPTED invariant outright, which is why the verdict is "adequate" and not "broken" — but AD-19's undermining is high-impact enough that it should be fixed before the schema lands, not folded in later.

## Checklist scorecard

| # | Criterion | Verdict |
| --- | --- | --- |
| 1 | Fixes the real divergence points for the six stories, misses none | Adequate |
| 2 | Every new AD's Rule is enforceable and actually prevents its stated divergence | Adequate |
| 3 | Nothing under the new Deferred rows lets two stories diverge | Strong |
| 4 | Ratifies rather than contradicts the codebase | Adequate |
| 5 | Covers every CAP-1..17 | Strong |
| 6 | No new AD weakens an inherited one (AD-2, AD-3, AD-4, AD-5, AD-9, AD-10, AD-19) | Thin |
| 7 | Every altitude-owned dimension for this addition is decided, deferred, or questioned | Thin |

## Findings

### High

#### H1. Three new child tables carry client-confidential content but no `projectId`, so they escape AD-19's own enforcement mechanism

- Where: AD-19 Rule ("`convex/lib/projectScopedTables.ts` lists every table with `projectId`... a schema test fails when `schema.ts` gains a `projectId` field not in the list"); AD-23's `generationBriefEntries` shape (`{briefId, group, text, reason?, confidence?, sourceId, sourceContentHash, startOffset, endOffset, exactExcerpt}`); AD-25's `complianceNotes` shape (`{generationId, candidateRunId?, section, source, instruction, outcome, tier, reason, repaired}`); AD-28's `chatProposalItems` shape (`{proposalId, itemId, status, reason, missingFact?, missingFactSource?, lockedRule?, alternative?}`).
- What is wrong: AD-19's guardrail is a schema-diff test keyed on the literal presence of a `projectId` field. None of these three new tables has one — each is reachable only by walking a parent id (`briefId → generationBriefs.projectId`, `generationId → generations.projectId`, `proposalId → chatProposals → reportId → projects`). `generationBriefs` and `comparisons` (both AD-23 and AD-29) do carry `projectId` directly and are fine. The three that don't hold real client-confidential/derived content under AD-21's classes: `exactExcerpt` is a verbatim client-document slice (C1), `instruction`/`reason` in `complianceNotes` can quote profile instructions and client facts (C2), and `chatProposalItems.missingFact`/`alternative` can name client-specific gaps (C2). If `deleteProject`'s cascade is ever driven mechanically off the AD-19 list (as the AD's own enforcing test implies it should be), these three tables are invisible to it and become permanent orphans on every project delete — exactly the erasure gap AD-19 exists to close, reintroduced by the feature that cites AD-19 as its safety net.
- Why it matters: this is a retention/privacy regression under the Pre-Claim Approval backdrop the SPEC itself calls out, and it directly touches Q17 (retention of stored Claim Exclusions) — Q17 cannot be answered correctly if the row holding Claim Exclusion text isn't even reachable from the erasure sweep.
- *Fix:* widen AD-19's Rule to cover transitively project-scoped rows, not just direct-field ones — either (a) require every new project-scoped table to carry `projectId` directly regardless of its parent (cheapest, matches the existing convention for `generationSources`, `reportSnapshots`, etc.), or (b) state that `projectScopedTables.ts` and its enforcing test resolve through one declared parent-key hop and add that mapping. Then add one clause to each of AD-23, AD-25, AD-28 naming how its child table cascades ("`generationBriefEntries` deletes with its `generationBriefs` row; `complianceNotes` deletes with its `generations` row; `chatProposalItems` deletes with its `chatProposals` row").

### Medium

#### M1. Migration of existing generations without a Brief is undecided

- Where: AD-23 (Brief is declared "between analyzer and the first section" for future generations only); AD-25 (Compliance Notes produced going forward); the new "Generation UI" convention row (Brief is a third `railView`, Compliance line under each section-end marker); Deferred table; Open Questions Q15–Q17.
- What is wrong: nothing in the update says what the report editor shows for a report whose `generations` row predates this feature and therefore has no `generationBriefs`/`complianceNotes` rows. This is exactly the kind of altitude-owned dimension the spine is supposed to settle for a brownfield addition — "schema rollout... for the new tables under AD-10" implicitly covers *new writes*, but says nothing about *old rows read by new UI*.
- Why it matters: without a stated behaviour, two teams (UI/story 4 and pipeline/story 2) will independently guess — one might render an empty/loading Brief panel forever, another might treat "no Brief row" as an error state. This is a real two-story divergence risk the same way the Deferred rows were checked for (item 3) and found clean; this gap is the one place that check turns up something.
- *Fix:* add one sentence to AD-23 or AD-25 ("a report/generation with no stored Brief or Compliance Notes renders the Brief panel and Compliance line as absent, not as an error or empty-but-loading state") and either add a Deferred row ("backfilling Briefs/Compliance Notes for pre-feature generations — no owner, no retroactive Brief planned") or fold it into Q17's scope.

#### M2. AD-24's "the writer may stop at any point" names no mechanism

- Where: AD-24 Rule: "The writer may stop after any section; the remaining sections stay ungenerated and the generation completes with what exists."
- What is wrong: `iterative` mode's equivalent behaviour has a named mutation (`cancelIterativeGeneration`, shown in the AD-5 flowchart as `X[cancelIterativeGeneration] --> F`). AD-24 gives `single`/`compare` the same user-facing claim with no analogous mutation, and the AD-5 flowchart (unmodified by this update) still shows no cancel path for the `GR` (single/compare) branch — only `catch then failGeneration`. It's ambiguous whether "stop" means (a) the writer navigates away while the chain keeps running server-side to completion regardless, or (b) an actual stop call halts scheduling of the next section. Those are materially different builds.
- Why it matters: this is exactly the "is every new AD's Rule enforceable" test (item 2) — a team can't build "at most one repair per section, chain of per-section actions" and independently arrive at the same stop semantics without this being specified.
- *Fix:* pick one and say so in the Rule. If it's (a), say so explicitly ("stopping is a UI-only concept: the chain runs to completion regardless, the writer simply isn't required to wait"). If it's (b), name the mutation and add it to the AD-5 diagram alongside `cancelIterativeGeneration`.

#### M3. The new "Generation UI" convention row conflates two different status enums from two different stories

- Where: Consistency Conventions, "Generation UI" row: "status pills by tier (`applied`, `resolved`, `blocked`, `conflicting`)"; AD-25's `complianceNotes` shape (`outcome: applied | not_applied`, separately `tier: locked | org_enforced | conflict | missing_fact | none`); AD-28's `chatProposalItems` shape (`status: resolved | blocked | conflicting`).
- What is wrong: no single field in the schema has the value set `{applied, resolved, blocked, conflicting}`. `applied` comes from `complianceNotes.outcome` (story 2); `resolved | blocked | conflicting` comes from `chatProposalItems.status` (story 5). The convention row implies one shared "tier" concept renders both, but they are different fields on different tables owned by different stories, and neither one's real `tier` field (`locked | org_enforced | conflict | missing_fact | none`) appears in the row at all.
- Why it matters: a UI implementer building the shared pill component from this row alone will build the wrong prop shape, and the two stories (2 and 5) will each patch it differently once the mismatch surfaces — the concrete instance of "could this let two stories diverge" for this addition.
- *Fix:* split the row into two clauses: "Compliance line pills read `complianceNotes.outcome` (`applied`/`not_applied`), qualified by `tier` when `not_applied`" and "Inventory/Completion pills read `chatProposalItems.status` (`resolved`/`blocked`/`conflicting`)."

#### M4. AD-28 attributes an "N ≤ 30" cap to the existing code that isn't there

- Where: AD-28 Rule: "`makeProposeBulkEdits` findings become the union `resolved | blocked | conflicting` with the existing coverage `superRefine` (unique ids, full coverage of N ≤ 30)."
- What is wrong: verified against `convex/ai/chatAgentV2.ts:114-155` — the current `superRefine` enforces unique finding ids and full edit-number coverage, but the schema caps are `.min(1).max(40)` on `edits` and `.min(1).max(80)` on `findings`; there is no `N ≤ 30` constraint anywhere in the current tool. `N ≤ 30` is CAP-13's tested fixture size ("For N ≤ 30 the reply holds exactly one Proposal and N report lines"), not a schema-enforced cap. As written, the parenthetical reads as if today's `superRefine` already enforces 30, which would mislead an implementer into thinking no cap decision is needed.
- *Fix:* reword to "(unique ids, full coverage; CAP-13's harness is tested to N ≤ 30, the schema cap is unchanged at 40 edits / 80 findings)" — or, if the intent is to actually tighten the cap to 30, say so as a decision, not as an "existing" fact.

#### M5. None of AD-23–AD-30 name an "Enforcing tests" line

- Where: AD-23 through AD-30 (AD-28 references a live fixture in `scripts/chat-behavior-eval.mjs` but no unit test file); compare with AD-6 ("Enforcing tests: `convex/learning.test.ts`..."), AD-7, AD-8, AD-16, which all close with one; Consistency Conventions "Tests" row: "Every AD that names an enforcing test is extended in the same PR that extends its guarded list."
- What is wrong: `touchpoints.md` (a companion, not the spine itself) lists a test file per capability (`brief.test.ts`, `glossaryMatcher.test.ts`, `promptProgram.test.ts`, `writerProfiles.test.ts`, `selfCheck.test.ts`, `passageEdits.test.ts`, `comparisons.test.ts`, `trustedContext.test.ts`). Because the spine's own AD prose never names them, the "Tests" convention's obligation — extend the named test whenever the guarded list is extended — doesn't bind any of these six new stories, breaking the one mechanism the spine relies on elsewhere to keep an invariant enforced over time.
- *Fix:* fold each capability's test file from `touchpoints.md` into its AD's Rule as an "Enforcing tests:" line, matching the inherited ADs' convention.

#### M6. AD-29's "(Q10 stance)" citation doesn't apply

- Where: AD-29 Rule: "admin-only writes (Q10 stance)"; Q10: "Decided 2026-09-04: project Owner or Admin for delete, egress, spend, and identity writes; Managers excluded until the capability cells ship (AD-7)."
- What is wrong: Q10 covers exactly four write classes — delete, egress, spend, identity — none of which is "record a Paired Comparison." Citing it as though it settled comparisons-recording authority is a false pointer; Q10 also says "Owner or Admin," not "admin-only," so even read loosely it doesn't match AD-29's stricter "admin-only."
- *Fix:* drop the "(Q10 stance)" citation and either add a fresh sentence to AD-7's capability list or open a dedicated Open Question for who may write `comparisons` (CAP-16's own text only names "Michael or Johnny," which may be the actual intended scope, but that's a naming of individuals, not a capability rule).

### Low

#### L1. Citation drift in three new/changed pointers

- AD-23 cites `convex/reports.ts:77-138` for `createProvenance`; the function is `:77-139` (closing brace at 139). Fix: `:77-139`.
- AD-26 cites `convex/writerProfiles.ts:200-236` for `getEffectiveWriterStyle`; the function is `:215-237` (200-214 is the tail of `updateWriterProfile` plus its JSDoc). Fix: `:215-237`.
- `touchpoints.md`'s companion citation for the same function, `writerProfiles.ts:206-224`, stops mid-function (before the `return` statement) and starts inside the JSDoc, not the signature. Not part of the spine proper, but worth fixing alongside AD-26 since both cite the same symbol differently.

#### L2. CAP-2's glossary matcher isn't named in AD-23

- Where: AD-23 Rule lists `generationBriefEntries` group `glossaryTerm` but never names `convex/lib/glossaryMatcher.ts` as what derives those entries; AD-25 does name the matcher for its self-check reuse ("Glossary Terms (rule-based matcher first, model judgment only on flagged candidates)"). CAP-2's 95%-synonym-match requirement therefore only appears in `touchpoints.md`, not in the spine's own AD text for the Brief stage.
- *Fix:* add one clause to AD-23: "Glossary Term entries are derived by `convex/lib/glossaryMatcher.ts` (rule-based exact/inflected matching, model classification only on flagged candidates), the same matcher AD-25's self-check reuses."

#### L3. AD-24 doesn't reconfirm reaper coverage for the new per-section chain

- Where: AD-24 Rule says "generations.status keeps its vocabulary (AD-2)" but doesn't say the existing 30-minute stale-generation reaper (AD-5) still recovers a chain stuck between section actions. Likely true by construction (same `generations.status` state machine), but worth one clause given AD-24 is explicitly reshaping how that status is driven.
- *Fix:* add "a chain stalled between sections is recovered by the existing `failStaleGenerations` reaper (AD-5); no new reaper is added."

## Verified citations (accurate)

- **AD-24**: `SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE = 5` and the 600 s action limit both match `convex/ai/providers.ts` exactly (`CONVEX_ACTION_LIMIT_MS = 600_000`, `SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE = 5`, with the file's own comment deriving `(1 + 1) × 240 s + 60 s = 540 s < 600 s`). The "twelve slots" figure that the Rule contrasts against 5 isn't independently re-derivable from the spine text alone (it depends on which of the old pipeline's compression/QA slots still run alongside the new self-check slots, which the AD doesn't spell out), but the core inequality it's making — an ordered, self-checked three-section chain needs far more than 5 sequential slots to fit in one action — holds under any reasonable count (≥ 9 for section+selfCheck+repair alone), so the AD's "prevents" claim is sound even though the exact number isn't traceable.
- **AD-23**: the citation-validation claim against `convex/reports.ts:77-138` (`createProvenance`) is accurate in substance — the function does validate `sourceContentHash === citation.sourceContentHash` and `source.content.slice(startOffset, endOffset) === exactExcerpt`, the same shape AD-23 proposes for `generationBriefEntries`. Only the line range is off by one (see L1).
- **AD-28**: the citation against `convex/ai/chatAgentV2.ts:114-155` is accurate — that is exactly `makeProposeBulkEdits`'s boundaries, and its `superRefine` does enforce unique finding ids and full edit-number coverage as described. The one inaccuracy is the "N ≤ 30" attribution (M4).

## Mechanical notes

- All three named code citations for this update (AD-23, AD-24, AD-28) point to real, correctly-identified functions; drift is at the line-range level only (see L1), consistent with the tolerance the 2026-09-03 rubric review already accepted for the rest of the spine.
- New index names (`by_projectId_and_inputsHash`, `by_generationId`, `by_generationId_and_section`, `by_projectId`, `by_recordedAt`) all follow the `by_<field>[_and_<field>]` convention from `convex/_generated/ai/guidelines.md:157`.
- All five new tables described (`generationBriefs`, `generationBriefEntries`, `complianceNotes`, `chatProposalItems`, `comparisons`) are declared as separate tables with a foreign key back to their parent rather than an array field on an existing document, matching the guideline at `convex/_generated/ai/guidelines.md:159` ("do not store unbounded lists as an array field"). AD-23 even says so explicitly ("child rows, not an array — Convex guideline").
- None of AD-23–AD-30, the new convention row, or the new Deferred rows touch `convex/http.ts`, `convex/lib/ingestionClassify.ts`, the uploader kit, Brain ingestion, or role capabilities — matches `touchpoints.md`'s "Not touched" list exactly.
- Operational envelope: no new crons, env vars, deployment targets, or alert channels are implied by AD-23–AD-30 or the new Deferred rows — correctly nothing new here, though see L3 for one clarity gap (reaper coverage of the new per-section chain isn't restated).
- No new AD narrows an existing field or removes a legacy one; all schema additions are new tables or (implied) optional fields on existing tables (`generations.briefId`, `generationSources.inclusion`/`includedLength`), consistent with AD-10's widen-first convention, which the update correctly does not restate per-AD since AD-10 already binds "all schema changes."
