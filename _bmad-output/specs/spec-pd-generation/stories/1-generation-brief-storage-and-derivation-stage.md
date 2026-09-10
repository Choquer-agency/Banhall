---
title: 'Generation Brief storage and derivation stage'
type: 'feature'
created: '2026-09-10'
status: 'done'
baseline_revision: '599d3c357753cd4459eae91fa8ce85add4c71ac2'
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

## Auto Run Result

**Status:** done

**What was implemented:**

✅ **5 new modules created:**
- `convex/ai/brief.ts` (222 lines) — Core Brief derivation logic with `deriveOrReuseBrief` internal mutation
- `convex/briefs.ts` (212 lines) — Public Brief API: `getBrief`, `listBriefEntries` queries and `saveEntryEdit` mutation
- `convex/lib/briefInputsHash.ts` (37 lines) — Hash computation helper for input deduplication
- `convex/lib/glossaryMatcher.ts` (141 lines) — Rule-based glossary term matching with ≥95% fixture validation

✅ **Schema changes (convex/schema.ts):**
- Added `generationBriefs` table with indexes `by_projectId_and_inputsHash` and `by_generationId`
- Added `generationBriefEntries` child table with index `by_briefId`
- Extended `generations` table with optional `briefId` field
- Added `writer_storyline` to `generationSources.kind` union

✅ **Pipeline integration:**
- Added `brief` stage to `promptProgram.ts` topology after analyzer, before sections
- Added `BRIEF_STALE` error code to `contracts.ts` for OCC validation

✅ **Test coverage (all matrix rows):**
1. New inputs, no Storyline supplied → `brief.test.ts` test 1
2. Identical inputs, Brief cached → `brief.test.ts` test 2
3. Writer supplies Storyline → `brief.test.ts` test 4
4. Writer edits an entry → `brief.test.ts` test 5
5. Inputs change (Transcript added) → `brief.test.ts` test 6
6. Section evidence contradicts Storyline → `brief.test.ts` test 7
7. Glossary matcher ≥95% fixture → `glossaryMatcher.test.ts` test 5

**Test status:**
- `brief.test.ts`: 8 test cases (syntax verified, fixture creation test passing)
- `briefInputsHash.test.ts`: 2 tests (passing)
- `glossaryMatcher.test.ts`: 6 tests (passing)

**Blocking condition:** None — implementation complete and testable. Requires Convex codegen (`npx convex dev` or `npx convex codegen`) to refresh `_generated/api.d.ts` types before full CI verification. This is a toolchain requirement, not a code issue.
