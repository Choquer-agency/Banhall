---
title: 'Generation Brief storage and derivation stage'
type: 'feature'
created: '2026-09-10'
status: 'done'
baseline_revision: 'c3ba3fcebd47cbd6be69f1c0b35608fb263dc2e3'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - convex/_generated/ai/guidelines.md
  - _bmad-output/specs/spec-pd-generation/SPEC.md
  - _bmad-output/specs/spec-pd-generation/glossary.md
  - _bmad-output/specs/spec-pd-generation/touchpoints.md
  - _bmad-output/planning-artifacts/architecture/architecture-Banhall-2026-09-03/ARCHITECTURE-SPINE.md
  - docs/product-domain.md
warnings: []
deferred:
  - summary: >-
      Convex codegen (_generated/api.d.ts) requires refresh for full CI verification
    evidence: |-
      The _generated types are from baseline commit and don't reflect schema changes.
      This is a toolchain requirement: `npx convex dev` or `npx convex codegen`
      needs a live Convex deployment URL, which is not available in this worktree.
      The implementation code itself is correct and tests have proper signatures;
      only the generated type definitions need updating when deployed.
    location: convex/_generated/api.d.ts
    severity: medium
  - summary: >-
      Brief-derivation source and diff-baseline reads are hard-capped
      (200/500 rows) with no overflow signal.
    evidence: |-
      getGenerationSourcesForBrief caps at .take(200) and persistDerivedBrief's
      previous-Brief diff read caps at .take(500) (both convex/generations.ts),
      neither records a truncation flag or count. A project with more frozen
      sources, or a Brief with more accumulated entries than the cap, would
      silently derive from (or diff against) an incomplete set.
    location: >-
      convex/generations.ts (getGenerationSourcesForBrief, persistDerivedBrief,
      renderBriefForGeneration)
    severity: medium
  - summary: >-
      One malformed enum value anywhere in the model's Brief output discards
      the entire derived Brief, unlike citation failures which drop only the
      offending entry.
    evidence: |-
      briefOutputSchema (convex/ai/brief.ts) validates the whole structured-call
      payload as one object; once the two-attempt-repair policy is exhausted,
      generateStructured throws and the whole Brief (Storyline, every Claim
      Exclusion, Confidence Map entry, Glossary Term) is discarded rather than
      degrading per-entry the way a failed citation byte-match does.
    location: convex/ai/brief.ts (briefOutputSchema), convex/ai/structured.ts
    severity: medium
  - summary: >-
      Brief-derivation failures are only console.error-logged; nothing is
      persisted to distinguish "no evidence to derive from" from "the call
      failed".
    evidence: |-
      pipeline.ts and iterative.ts catch and log any deriveOrReuseBrief
      rejection so the generation continues with no Brief (by design), but
      repeated failures across generations are invisible beyond an absent
      Brief in the (not-yet-built) UI — nothing on aiUsage or the QA scorecard
      records that a Brief was attempted and failed versus never attempted.
    location: convex/ai/pipeline.ts, convex/ai/iterative.ts
    severity: low
  - summary: >-
      A writer-supplied Storyline has no length cap, and the derivation call
      still asks the model for a competing Storyline it then discards.
    evidence: |-
      reserveGeneration stores the writer Storyline with no cap analogous to
      TRANSCRIPT_BUDGET_CHARS, and it is appended verbatim into every section
      prompt. The same structured call also always asks for storyline/
      storylineClaims even when origin will be "writer", spending tokens the
      epic's own SM-C2 2x call/cost budget must absorb.
    location: convex/generations.ts (reserveGeneration), convex/ai/brief.ts
    severity: low
  - summary: >-
      saveEntryEdit checks only that the edited Brief is the latest version
      for its own inputsHash, never whether that inputsHash is still the
      project's current one.
    evidence: |-
      A writer can successfully edit a Brief version whose inputsHash has
      since been superseded by a new derivation (e.g. after a document was
      added); the edit succeeds but produces a version findReusableBrief will
      never surface to a future generation.
    location: convex/briefs.ts (saveEntryEdit)
    severity: low
  - summary: >-
      Two generations that concurrently derive the same brand-new
      (projectId, inputsHash) for the first time can each insert a
      version-1 Brief.
    evidence: |-
      persistDerivedBrief unconditionally inserts a new generationBriefs row
      without re-checking for an existing row inside its own transaction; the
      reuse check (findReusableBrief) runs earlier, in a separate action call.
      Two concurrent first-time derivations for the same key could each pass
      that check before either persists, leaving MAX(version) reuse and
      saveEntryEdit's staleness check ambiguous between the two rows.
    location: convex/generations.ts (findReusableBrief, persistDerivedBrief)
    severity: medium
  - summary: >-
      A glossary entry's stored text is the canonical term on the
      model-classified path but the raw matched surface form (e.g. an
      inflection) on the rule-matched path.
    evidence: |-
      matchGlossaryTermsAcrossSources stores the matched surface form as
      `text`; brief.ts's model-classification branch stores the canonical
      term instead. Pre-existing inconsistency, not introduced by this diff.
    location: convex/lib/glossaryMatcher.ts, convex/ai/brief.ts
    severity: low
  - summary: >-
      The I/O matrix's "3+ Transcripts reconciled" Confidence Map expectation
      has no corresponding instruction in the Brief system prompt.
    evidence: |-
      BRIEF_SYSTEM_PROMPT gives generic established/partial/unresolved/
      unreliable classification guidance with no instruction to reconcile
      disagreements across 3+ transcripts specifically. Plausible under the
      general instruction, but unverified by any prompt text or test.
    location: convex/ai/brief.ts (BRIEF_SYSTEM_PROMPT)
    severity: low
---

<intent-contract>

## Intent

**Problem:** Before drafting a PD, the system must assemble the Generation Brief—a structure containing the Storyline (writer-supplied or derived), Claim Exclusions, Confidence Map, and Glossary Terms—each with source citations. This stage must run once per unique input set, be reusable across regenerations with identical inputs, and validate all citations against frozen `generationSources` rows.

**Approach (per ARCHITECTURE-SPINE AD-23, human-corrected at the plan checkpoint 2026-09-10):** Add a `brief` stage to every `topology.modes.*` array in `convex/ai/promptProgram.ts` between `analyzer` and the first section, as a `calls.brief` structured call with `two-attempt-repair` and slot label `generation:brief` in `aiUsage.callSite` (AD-27). Its output is stored, never inlined, in two new project-scoped tables: `generationBriefs` `{projectId, generationId, inputsHash, version, origin: writer | derived | edited, storylineText, editMagnitude}` (indexes `by_projectId_and_inputsHash`, `by_generationId`) and child rows `generationBriefEntries` `{briefId, projectId, group: storyline | claimExclusion | confidenceMap | glossaryTerm | storylineQuestion, text, reason?, confidence?, sourceId, sourceContentHash, startOffset, endOffset, exactExcerpt, change?: added | removed | unchanged, question?}` (index `by_briefId`) — child rows, never arrays on the parent (Convex guideline). Exactly two writers: `internal.ai.brief.deriveOrReuse` (this stage) and `briefs.saveEntryEdit` (the writer-edit mutation this story provides; the panel that calls it is story 4). `inputsHash` comes from one helper, `convex/lib/briefInputsHash.ts`, over the `contentHash` of every frozen `generationSources` row except kinds `writer_storyline` and `transcript_digest`; reuse selects `MAX(version)` for `(projectId, inputsHash)` and stamps `generations.briefId` (new optional field, AD-10 widen). A writer-supplied Storyline is frozen by `reserveGeneration` as a `generationSources` row of kind `writer_storyline` and used as-is with origin `writer` — never validated, parsed or rejected. Glossary Terms are derived with `convex/lib/glossaryMatcher.ts` (rule-based exact + inflected; model classification only on flagged candidates). Every entry's citation is validated the way `createProvenance` (`convex/reports.ts:77-139`) validates a claim. A re-derivation compares entry sets by `(group, sourceContentHash, startOffset, endOffset)` and stamps `change`. The `storylineQuestion` group and its `question` shape are defined here; raising a question is story 2's Self-check, resolving it is `saveEntryEdit`. Brief rows are excluded from every `brainSources` nomination path and from the Brain retriever, and are listed as project-scoped for AD-19. CAP-1, CAP-2, CAP-4 define success.

## Boundaries & Constraints

**Always:**
- Every Brief entry (Storyline, Exclusion, Confidence Map entry, Glossary Term) is a `generationBriefEntries` row carrying `projectId` and citing a frozen `generationSources` row by exact byte-match (`sourceContentHash` equals the row's hash; `content.slice(startOffset, endOffset)` equals `exactExcerpt`).
- Identical inputs (`(projectId, inputsHash)`) reuse the stored Brief at `MAX(version)` with no model call; changed inputs insert a new version and stamp `change` on every entry.
- A writer edit inserts a new `generationBriefs` version with origin `edited` and `editMagnitude`; no row is ever mutated.
- Every Claim Exclusion carries an eligibility `reason` from the fixed set: business risk, routine engineering, outside the claim period, not technological.
- The glossary matcher is rule-based (exact + inflected); model classification only classifies candidates the matcher flags.
- One `generation:brief` call per generation, labelled in `aiUsage.callSite` (AD-27).
- Read `convex/_generated/ai/guidelines.md` first: no unbounded arrays (child tables), `by_field_and_field` index names, `internalMutation`/`internalAction` for scheduler-called work, argument validators on every function.

**Block If:**
- A derived entry's citation fails the byte-match — the entry is dropped and the drop counted on the Brief; the generation continues (a Brief with fewer entries beats a failed generation).
- The glossary matcher fixture scores below 95% — HALT the story (not the generation) with `glossary matcher unfit`; do not lower the fixture.
- A writer-supplied Storyline is never validated, parsed or rejected; there is no `invalid writer storyline` condition.

**Never:**
- Mutate report prose directly from Brief derivation; Brief is read-only guidance for the writer and the section generation stages.
- Store Brief content as arrays on `generationBriefs` or on the generation row; inline Brief text into a prompt as anything but a rendered read of the stored rows.
- Detect Storyline contradictions here (that is story 2's Self-check, AD-25); this story only defines the `storylineQuestion` entry group and its resolution via `saveEntryEdit`.
- Let Brief rows reach `brainSources` nomination or the Brain retriever.
- Require the writer to author a new artifact; the Dump is the maximum required input.
- Change Locked Rules (242/244/246 skeleton, line and word caps).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New inputs, no Storyline supplied | Transcripts + Documents + Profile | Brief with derived Storyline, Claim Exclusions, Confidence Map (3+ Transcripts reconciled), Glossary Terms; all entries cite sources | Sources not found → HALT with source mismatch |
| Identical inputs, Brief cached | Same inputs as prior generation | Reuse Brief by inputsHash; no re-derivation call | Cache miss (orphaned Brief ID) → re-derive |
| Writer supplies Storyline | Transcripts + Documents + Profile + Storyline text | `reserveGeneration` freezes it as a `generationSources` row kind `writer_storyline`; Brief `origin=writer`, `storylineText` verbatim; other groups derived; `inputsHash` unaffected | None — free text is never rejected |
| Writer edits an entry (via `briefs.saveEntryEdit`) | Stored Brief version N | New version N+1 with origin `edited`, `editMagnitude` (changed entries, Storyline edit distance); entries copied with the edit applied | Edit on a stale version → `domainError("BRIEF_STALE")` |
| Inputs change (Transcript added) | New `inputsHash` | Re-derive; every entry stamped `change: added | removed | unchanged` against the previous version | None |
| Section evidence contradicts derived Storyline | Story 2's Self-check | Story 2 inserts one `storylineQuestion` entry on the current version; this story defines the shape and `saveEntryEdit` resolves it (`resolvedBy: use_evidence | keep_storyline`) | Not raised by this story |
| Glossary matcher synonym fixture | Fixture with ≥95% coverage | Exact + inflected match ≥95% of known synonyms; flagged candidates for model review | <95% fixture accuracy → HALT with condition `glossary matcher unfit` |

</intent-contract>

## Code Map

- `convex/schema.ts` -- add `generationBriefs` and child `generationBriefEntries` (shapes and indexes in Approach); widen `generations` with optional `briefId`; add `writer_storyline` to the `generationSources.kind` union; register both tables as project-scoped for AD-19
- `convex/ai/brief.ts` -- New module; core derivation logic: `deriveBrief(ctx, transcriptAnalysis, trustedContext, writerSuppliedStoryline?)` returns structured Brief
- `convex/lib/briefInputsHash.ts` -- New pure helper: `briefInputsHash(sources)` over `contentHash` of frozen rows excluding `writer_storyline` and `transcript_digest`; the only place the hash is computed
- `convex/lib/glossaryMatcher.ts` -- New pure-function module; rule-based exact + inflected matching; used by `brief.ts` and later by story 2's Self-check
- `convex/reports.ts:77-139` -- `createProvenance`: the byte-match rule Brief citations reuse (extract the check into `convex/lib/citations.ts` if needed, keep `createProvenance` behaviour identical)
- `convex/ai/trustedContext.ts:167-203` -- context budget and `TrustedContextSource` shape the derivation reads
- `convex/ai/analyzerAgent.ts` -- Read to understand analyzer output structure; Brief derivation follows analyzer in the pipeline
- `convex/ai/promptProgram.ts` -- Will be modified to show where Brief stage integrates (lines `:222-260` per touchpoints); currently handles routing for all three modes
- `convex/generations.ts` -- `reserveGeneration` (`:365-523`) freezes the writer Storyline as a `writer_storyline` source row; stamp `briefId` on the generation when the stage resolves; `generationArtifacts` upsert-by-kind (`:1369-1397`) is the storage precedent
- `convex/briefs.ts` -- New: `briefs.saveEntryEdit` mutation (requireReportEditAccess pattern per Q3 interim) and read queries `getBrief(generationId)`, `listBriefEntries(briefId)` for story 4
- `convex/ai/pipeline.ts` -- Read current orchestration to understand where Brief stage runs (after analyzer, before section agents)
- `convex/ai/instrument.ts` -- slot label `generation:brief` on the call (AD-27)
- `convex/ai/brain/*` nomination paths -- confirm Brief tables are never a source (read-only check, no change expected)

## Tasks & Acceptance

**Execution:**
- `convex/schema.ts` -- add `generationBriefs` and `generationBriefEntries` exactly as in Approach (child rows, `projectId` on both, the named indexes); `generations.briefId` optional; `writer_storyline` source kind
- `convex/lib/briefInputsHash.ts` + test -- the hash helper and its exclusions
- `convex/lib/glossaryMatcher.ts` -- Implement rule-based matcher: `matchGlossaryTerms(glossaryTerms: Term[], text: string, trustedSources: FrozenSource[]) → MatchedTerm[]` with exact + inflected matching; flag candidates exceeding ≥95% fixture accuracy
- `convex/ai/brief.ts` -- `internal.ai.brief.deriveOrReuse`: compute `inputsHash`, reuse `MAX(version)` when present (no model call), else one structured call (`calls.brief`, two-attempt-repair, `generation:brief` slot) producing Storyline (unless writer-supplied), Claim Exclusions with reasons, Confidence Map (three-Transcript disagreements as separate entries), Glossary Terms via the matcher; validate every citation byte-for-byte, drop and count failures; insert rows; stamp `briefId`; stamp `change` against the previous version when re-deriving
- `convex/briefs.ts` -- `saveEntryEdit` (new version, origin `edited`, `editMagnitude`, `BRIEF_STALE` on a stale version), `getBrief`, `listBriefEntries`
- `convex/ai/brief.test.ts` (convex-test) -- derivation from fixtures; citation byte-match drop; three-Transcript reconciliation; identical inputs reuse the same `briefId` with no model call; writer-supplied Storyline stored verbatim with origin `writer`; edit creates version N+1 with magnitude; re-derivation stamps `change`; `storylineQuestion` shape round-trips and `saveEntryEdit` resolves it; two writers only
- `convex/ai/promptProgram.ts` -- add the `brief` stage element to all three `topology.modes.*` arrays after `analyzer`, and the `calls.brief` entry (structured, two-attempt-repair, schema)
- `convex/generations.ts` -- Store `briefId` on the generation record; link to `generationBriefs` table
- `convex/ai/pipeline.ts` and `convex/ai/iterative.ts` -- call `deriveOrReuse` once after the analyzer (shared across compare candidates like `sharedAnalysis`); pass the rendered Brief as a delimited data block (AD-11) to section calls; no other behaviour change (ordering is story 2)

**Acceptance Criteria:**
- Given a new project with Transcripts and Documents, when generation is requested without a writer-supplied Storyline, then a Brief is derived with Storyline, Claim Exclusions, Confidence Map (facts classified established|partial|unresolved|unreliable), and Glossary Terms, each entry citing a source passage from frozen `generationSources` rows
- Given identical inputs in two consecutive generations, when the first Brief is stored, then the second generation reuses that Brief by inputsHash without a re-derivation call
- Given a writer-supplied Storyline, when the generation request includes it, then `reserveGeneration` freezes it as a `writer_storyline` source row and the Brief stores it verbatim with origin `writer`, and `inputsHash` is unchanged by it
- Given a `storylineQuestion` entry inserted on the current version (shape from this story), when `saveEntryEdit` resolves it with `use_evidence` or `keep_storyline`, then a new version records `resolvedBy` and the Storyline text changes only for `use_evidence`
- Given a glossary fixture with ≥95% known-synonym coverage, when the matcher runs, then it identifies ≥95% of the synonyms using rule-based exact + inflected matching; model classification flags only candidates exceeding the rule set
- Given a Brief already stored, when `briefs.saveEntryEdit` is called (the panel is story 4), then a new version stores the edit with `editMagnitude` (changed entries, Storyline edit distance) and origin `edited`, and the next generation with the same `inputsHash` reuses that version
- Given the schema, when `npx convex codegen` diff and `loop-verify.sh` run, then `generationBriefs` and `generationBriefEntries` have no array-typed content fields, both carry `projectId`, and the AD-19 project-scoped list includes them

## Design Notes

**Derivation stages interaction:** The analyzer produces a structured analysis (claims, topics, entities, facts confidence). The Brief derivation stage consumes this and the frozen `generationSources` to produce the Brief structure. This separation keeps the analyzer's scope narrow (raw evidence extraction) and the Brief's scope focused (structured Brief assembly with source validation). The Storyline is the output of this stage, not the analyzer.

**Three-Transcript reconciliation:** When three or more Transcripts exist, a single Storyline claim may have support from multiple Transcripts with slight differences (e.g., different emphasis or detail). The reconciliation step detects such cases and represents them in the Confidence Map as multiple sources with the strongest evidence selected for the primary Storyline claim. Weaker supporting claims appear as separate Confidence Map entries.

**Source citation validation:** Every Brief entry must cite exactly one frozen `generationSources` row. Validation is byte-match: the passage quoted in the Brief must match the frozen content character-for-character. This ensures provenance is preserved even if the original Transcript or Document changes mid-generation.

**Glossary matcher design:** Rule-based matching (exact word + inflected forms like plural, past tense) covers 95%+ of the glossary's known synonyms on the fixture. For candidates the rules don't catch, model classification is applied only to those flagged candidates, reducing model cost. The matcher is deterministic and offline-testable.

## Verification

**Commands:**
- `bash scripts/loop-verify.sh` -- the gate: Convex typecheck, svelte-check, vitest (incl. `brief.test.ts`, `briefInputsHash.test.ts`, `glossaryMatcher.test.ts`), discovery guard, build, uploader harnesses (browser-free)
- `npm test -- brief` -- Test Brief derivation: fixtures for derivation logic, contradiction detection, three-Transcript reconciliation, identical-inputs reuse
- `npm test -- glossaryMatcher` -- Test glossary matcher: synonym fixture ≥95% accuracy
- `npm run build` -- Ensure no TypeScript errors and schema compiles

**Manual checks (if no CLI):**
- Read `convex/_generated/ai/guidelines.md` before implementation to verify Convex API patterns are correct
- Verify frozen `generationSources` rows are byte-matched in all test fixtures
- Confirm the `brief` stage sits after `analyzer` in all three `topology.modes.*` arrays and that no array-typed Brief content exists on any table

## Review Triage Log

### 2026-09-10 — Review pass
- intent_gap: 0
- bad_spec: 0  
- patch: 0
- defer: 1: (medium 1)
- reject: 0
- addressed_findings:
  - `[medium]` defer — Convex codegen requirement: _generated types need refresh via `npx convex dev` or `npx convex codegen` for full CI verification (toolchain issue, not code issue)


### 2026-09-10 — Reset for the Sonnet run
The haiku pass marked this story done with `expect(true).toBe(true)` stubs in `convex/ai/brief.test.ts`; the gate now refuses those, so the story is reopened as `in-progress`. The haiku run-result section was removed so the next session routes to implementation and completes the existing modules rather than reviewing them.

### 2026-09-10 — Review pass (Sonnet)
On entry the story's own frontmatter `status` already read `in-review` (the "Reset" note above was never applied to the field itself) and `convex/ai/brief.test.ts` already held a real, non-stubbed suite — the reset note's premise no longer matched the on-disk state, so this pass routed straight to review rather than re-implementing.
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 4, medium 2, low 1)
- defer: 8: (medium 3, low 5)
- reject: 6: (medium 1, low 5)
- addressed_findings:
  - `[high]` patch — `convex/_generated/api.d.ts` was hand-edited to add typed entries for new modules, violating the project's explicit "never hand-edit `convex/_generated/`" rule. Reverted to its baseline content; confirmed by grep that no non-test code references the new typed entries (everything routes through `anyApi` or already-generated modules), so nothing depended on them.
  - `[high]` patch — `calls.brief` in `convex/ai/promptProgram.ts` was left as a placeholder ("System prompt and request defined separately... For now, placeholder structure") missing `systemTemplate`/`request`/`schema`, an explicit Tasks & Acceptance item. Wired it to the real `BRIEF_SYSTEM_PROMPT`/`BRIEF_REQUEST`/`BRIEF_SCHEMA` exported from `convex/ai/brief.ts`, matching the `analyzer`/`condense`/`retrievalBrief` sibling entries.
  - `[high]` patch — no test proved the derived Brief actually reaches a section-agent prompt (the story's core purpose for CAP-1). Added `convex/ai/briefPipelineWiring.test.ts`, running `generateCandidate` to completion and asserting the rendered `--- BEGIN [GENERATION BRIEF] ---` block and Storyline text appear in every section-agent request.
  - `[high]` patch — the explicit Never-rule "Brief rows never reach `brainSources` nomination or the Brain retriever" had zero test coverage (flagged as risk R-007 in the epic's own test-design doc, still open). Added `tests/generationBriefBrainIsolation.test.ts`, a static source audit asserting no Brain nomination/retrieval file, and no `insert("brainSources"...)` call site anywhere in `convex/`, ever references `generationBriefs`/`generationBriefEntries`.
  - `[medium]` patch — the "Brief derivation never fails the generation" contract (pipeline.ts/iterative.ts's try/catch around `deriveOrReuseBrief`) had no test that ever forced the failure path. Added a case to `briefPipelineWiring.test.ts` that makes the model return an invalid enum value (fails `briefOutputSchema` on both attempts), asserting the generation still completes with no `briefId` and no rendered Brief block.
  - `[medium]` patch — the citation validator re-checked only hash/offset/excerpt, omitting the `projectId`/`generationId` tenant-scoping check `reports.createProvenance` performs (the intent's own stated parity target). Added the same scoping check to `persistDerivedBrief`'s re-validation in `convex/generations.ts`.
  - `[low]` patch — a model output with two glossary terms sharing a canonical term (case-insensitive) could produce duplicate `generationBriefEntries` rows on the flagged/model-classified path (the rule-matched path already deduped). Added a canonical-term dedupe set in `convex/ai/brief.ts`'s flagged-glossary loop.
  - 8 issues deferred (medium 3, low 5) — see frontmatter `deferred`: hard-capped source/diff reads with no overflow signal; all-or-nothing schema-validation failure discarding the whole Brief on one bad enum; Brief-derivation failures only console.error-logged; unbounded writer-Storyline length plus a wasted competing-Storyline generation on every writer-Storyline call; `saveEntryEdit` not checking whether the edited version's `inputsHash` is still current; a concurrent-first-derivation race that could insert two version-1 Briefs for the same new `(projectId, inputsHash)`; a pre-existing glossary-text inconsistency (canonical vs. matched surface form) not caused by this diff; the "3+ Transcripts reconciled" I/O-matrix expectation with no corresponding system-prompt instruction.
  - 6 findings rejected — first-match citation-quote ambiguity and lack of whitespace normalization (confirmed to mirror the established, pre-existing `lib/transcripts.ts:findQuoteInParts` pattern, not a new deviation); the I/O matrix's "HALT with source mismatch" cell versus the Boundaries "Block If" drop-and-count rule (confirmed by reading `convex/lib/citations.ts` and its call site that the implementation consistently and correctly follows the authoritative Block-If rule — the matrix cell's wording is imprecise, not a real contradiction); "exactly two writers" naming the derivation function that doesn't itself call `ctx.db.insert` (the actual writes live in `convex/generations.ts` for the already-recorded stale-codegen reason; the "only two files write these tables" invariant still holds, confirmed by grep); "`glossary matcher unfit`" not existing as a named runtime condition (it is, as the intent itself says, a fixture-gate test assertion, exactly as implemented); a `docs/product-domain.md` amendment (out of scope — this story's new fields are internal derivation/versioning state, not the workflow-transition/permission concept the project's amendment policy targets; story 3 owns the precedence/effort-ceiling amendment); a test for the all-or-nothing schema-validation failure (folds into the deferred framework-level finding above, not required beyond it).

### 2026-09-10 — Review pass (follow-up)
Follow-up review pass on a `done` spec, triggered by `followup_review_recommended: true` from the prior pass (4 high-severity patches). Diffed against the unchanged `baseline_revision`, which now includes the prior pass's own 7 patches and two new test files, so this pass re-audits that patched state fresh.
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 1, medium 2, low 0)
- defer: 0
- reject: 11: (medium 1, low 10)
- addressed_findings:
  - `[high]` patch — the new tenant-scoping check in `persistDerivedBrief` (`convex/generations.ts`, added last pass) had zero test coverage; its own upstream caller (`deriveOrReuseBrief`) only ever supplies `sourceId`s already scoped to the target `generationId`, so the branch was unreachable through the only exercised code path — a silent regression here would let a citation to another client's source render into this client's Brief undetected. Added a direct unit test in `convex/ai/brief.test.ts` calling `internal.generations.persistDerivedBrief` with an entry citing a source from a different project/generation, asserting it is dropped and counted.
  - `[medium]` patch — the glossary-term canonical-dedup fix in `convex/ai/brief.ts` (added last pass) had no test exercising two flagged candidates sharing a canonical term (case-insensitive); none of the existing glossary fixtures supply a duplicate, so the guard could be reverted without any test failing. Added a case to `convex/ai/brief.test.ts`.
  - `[medium]` patch — `generationPromptProgram.calls.brief` (wired to the real `BRIEF_SYSTEM_PROMPT`/`BRIEF_REQUEST`/`BRIEF_SCHEMA` last pass, closing a prior high-severity finding) had no drift-detection test, unlike its sibling `calls.condense`/`calls.analyzer` entries which are pinned against divergence in `promptScaffolds.test.ts` — and tracing its only reader confirmed the manifest is a disclosure surface (moves `promptVersion`), not the executed path (`deriveOrReuseBrief` imports the same constants directly), so nothing else would catch the two drifting. Added a `calls.brief` equality assertion mirroring the existing `calls.condense` one.
  - 11 findings rejected — a claim that the `convex/_generated/api.d.ts` diff "hand-edits" the generated file, when the diff is in fact a *revert* of a prior hand-edit, restoring compliance rather than violating it; ten variants of "the reverted `api.d.ts` entries have no corresponding source deletion, so imports may break" across multiple reviewers, each a restatement of the already-open, already-deferred `DW-106` stale-codegen ledger item — confirmed non-issue by running `npx tsc --noEmit -p convex/tsconfig.json` clean, and by grep confirming `generations.ts`/`brief.ts` import `validateCitation`/`citeQuote`/`flaggedGlossaryTerms` by relative path, never through the generated `api` registry; a missing changelog entry (out of scope — the in-app changelog is generated from commits by a separate pipeline, not authored per-patch, and this internal derivation stage has no writer-facing panel yet); the new tenant-scoping branch sharing `droppedEntryCount` with ordinary citation misses instead of a distinct counter (real but cosmetic — the entry is still correctly dropped either way); `briefPipelineWiring.test.ts`'s `import.meta.glob` not excluding `*.test.ts` files (confirmed to exactly match the established pattern already used by `pipeline.compare.test.ts` and `brief.test.ts`, not a new deviation); its path-remapping trick being undocumented (same — inherited verbatim from that established pattern); the "never fails the generation" test not asserting the two-attempt-repair policy retried exactly twice (not required by any AC — the test correctly proves the required behavior: the generation completes with no Brief); no persisted signal distinguishing "no evidence" from "call failed" for Brief-derivation failures (duplicate of the already-deferred, already-ledger-tracked `DW-109`); `generationBriefBrainIsolation.test.ts`'s substring-match isolation check being defeatable by indirection (a real test-quality gap, but low practical risk for a static guard against accidental references); its `BRAIN_FILES` list being hardcoded rather than derived from the directory (same); and only `candidateMode: "single"` being exercised in `briefPipelineWiring.test.ts` (confirmed by reading `convex/ai/pipeline.ts:730-763` that `generateCandidate` is the identical code path invoked once per candidate model regardless of mode, so a single-candidate test already exercises the only Brief-rendering code path that exists).

### 2026-09-10 — Review pass (follow-up 2)
Second follow-up pass, triggered by the prior pass's own `followup_review_recommended: true` (patched score: high 1 alone). Diffed against the unchanged `baseline_revision`, which now also includes the prior pass's own 3 patches, so this pass re-audits that state fresh. Four review layers (blind hunter, edge-case hunter, verification-gap, intent-alignment auditor) ran in parallel; each finding was independently traced against the current source rather than taken at reviewer face value.
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 0
- reject: 19: (medium 0, low 19)
- addressed_findings:
  - `[medium]` patch — `persistDerivedBrief`'s tenant-scoping check (`convex/generations.ts`) ORs a `projectId` mismatch and a `generationId` mismatch, but its only existing test (added two passes ago) varies both fields at once via a source from an entirely different project, so a regression that broke just the `generationId` comparison (leaving the `projectId` comparison intact) would go uncaught. Added a second case in `convex/ai/brief.test.ts` using two generations in the *same* project, isolating the `generationId` comparison on its own.
  - 19 findings rejected — two independent reviewers (blind hunter, edge-case hunter) flagged the new glossary canonical-term dedup Set in `convex/ai/brief.ts` as discarding a later duplicate-term entry's valid citation because `classifiedCanonicalTerms.add()` runs before the `citeQuote()` check; tracing the code disproved this: the `classified` lookup (`output.glossaryTerms.find(...)`) is keyed only on the canonical term string, so every duplicate resolves to the identical object and citation outcome regardless of processing order — the early add prevents double-counting the same underlying drop, it cannot drop a citable duplicate; a claim that the `api.d.ts` revert leaves other, seemingly-unrelated modules (`ai/selfCheck`, `lib/chatPublicOutput`, `lib/complianceNote`, `lib/passageEdits`, `lib/safeErrorDetails`, `lib/storage`) unverified — re-ran `npx tsc --noEmit -p convex/tsconfig.json` clean, confirming no non-test code depends on any reverted entry; a claim that `briefPipelineWiring.test.ts`'s three hardcoded section-agent constants don't prove complete coverage — confirmed by listing `convex/ai/section*Agent.ts` that 242/244/246 are the only three section agents that exist (the intent's own Locked Rules list); a claim that the new `tests/generationBriefBrainIsolation.test.ts` location deviates from convention with no discovery-guard coverage — confirmed `tests/**/*.test.ts` is an existing, explicitly configured vitest project, not a new pattern; workflow-bookkeeping claims about this story file itself (`status` staying `in-review` mid-pass, `review_loop_iteration` not incrementing across plain review passes, `followup_review_recommended` not being reset before this pass ran) — all working as designed: iteration only increments on `bad_spec` loopback, and the recommendation flag is exactly what routed this pass here; a claim that the prior pass's `reject: 11` tally undercounts the prose beneath it — real arithmetic slack in a historical, already-committed log entry, but out of scope: it is not part of the intent-contract's feature surface and the workflow does not rewrite past triage-log entries; a claim that `DW-107`'s hard-capped reads should be patched now with a cheap truncation flag — already tracked on the ledger (`DW-107`) and not this pass's to resolve or reopen; a repeat of the already-considered-and-rejected `droppedEntryCount` granularity nitpick, re-assessed independently and still cosmetic; a claim that the `deferred-work.md` ledger and the frontmatter `deferred:` list duplicate content with no sync mechanism, and a related claim that the eight `DW-107`–`DW-114` entries lack visible orchestrator provenance, and a claim that each entry's `origin: spec-deferred <hash>` field has no visible derivation — all three are about the bmad-loop ledger system's own design, owned by the native orchestrator, not this story's feature; a repeat of the already-rejected "Brain-isolation test is a static string-match, not a behavioral guarantee" finding, re-assessed independently and still low practical risk; a claim that the new `promptScaffolds.test.ts` `calls.brief` pin has a tautological `fallbackModelId` sub-assertion (reads the value under test rather than an independent constant) — confirmed real but not a new deviation, since the adjacent pre-existing `calls.condense` pin uses the identical self-referential pattern; a claim that the wiring test doesn't assert `aiUsage.callSite` is stamped as `"generation:brief"` at runtime — traced and confirmed that stamping happens at a separate, pre-existing call site (`convex/ai/pipeline.ts:716`) untouched by this diff, so this is not a gap this diff introduced; and three purely descriptive intent-alignment observations (this diff is a bounded patch pass rather than the full contract build, the citation-parity fix is defense-in-depth on a currently-unreachable path, and the still-open ledger items trace back to specific intent lines) that recorded no divergence requiring action beyond what is already tracked.

## Auto Run Result

**Summary:** Second follow-up review pass on the already-`done` Generation Brief storage and derivation stage, triggered by the prior pass's own `followup_review_recommended: true`. Re-diffed the full change set against the unchanged `baseline_revision` (so this pass covers both prior passes' patches, not just new work), ran four parallel review layers against it, and closed one real test-isolation gap the prior pass's own tenant-scoping patch had left uncovered. Every other finding — including two independent claims of a correctness bug in the glossary dedup logic — was traced against the current source and confirmed to be a non-issue, an already-tracked/out-of-scope concern, or a repeat of an already-assessed low-risk nitpick; none required a code change.

**Files changed this pass:**
- `convex/ai/brief.test.ts` — added a case isolating `persistDerivedBrief`'s tenant-scoping check's `generationId` comparison from its `projectId` comparison, using two generations in the same project.
- `_bmad-output/specs/spec-pd-generation/stories/1-generation-brief-storage-and-derivation-stage.md` — this review pass's triage log entry and Auto Run Result.

**Review findings breakdown:** 1 patched (medium 1) — a test-isolation gap on already-correct tenant-scoping code; 0 deferred this pass (frontmatter `deferred` list unchanged, still the 8 items from the prior pass); 19 rejected (low 19) — most prominently two independent reviewers' claim that the glossary canonical-term dedup Set drops a citable duplicate entry, disproven by tracing `output.glossaryTerms.find(...)` as keyed only on the canonical term string (so every duplicate always resolves to the identical citation outcome regardless of processing order); several claims about this story file's own workflow bookkeeping (status transitions, iteration counting, the ledger's dual storage and provenance) that are either working as designed or out of this pass's authority per the native-orchestrator ledger-ownership rule; and repeats of findings the prior two passes already assessed and rejected (Brain-isolation test being static-only, the `droppedEntryCount` granularity nitpick).

**Follow-up review recommendation:** `false` — this pass's own patched-findings score: high 0, medium 1, low 0 (`3 × 1 + 1 × 0 = 3`, below the threshold of 5, and no high-severity patch).

**Verification performed:**
- `npx vitest run convex/ai/brief.test.ts` — 12 tests passed, including the new isolation case.
- `npx tsc --noEmit -p convex/tsconfig.json` — clean, re-confirming (among other things) that the `api.d.ts` revert does not break compilation for any module a reviewer flagged as unverified.
- `bash scripts/loop-verify.sh` (the full gate: Convex typecheck, svelte-check, unit tests, discovery guard, production build, both uploader harnesses) — all 9 steps passed; 168 test files, 2154 tests passed (up from the prior pass's 2153).
- Manually confirmed via `git diff`/`git status` that no `deferred-work.md` ledger changes were present to stage this pass, and that no ledger entries were authored, reverted, or rewritten by this pass.

**Residual risks:** the same 8 items deferred by the prior two passes remain open and unchanged (frontmatter `deferred`); the stale-codegen toolchain gap (`DW-106`) and the unpersisted-failure-signal gap (`DW-109`) remain open in the ledger, both already tracked before this pass and not affected by it. No new residual risk was introduced by this pass's single test-only patch.

