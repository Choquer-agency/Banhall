---
title: 'DW-121/DW-122 candidate-scoped bounded reads'
type: 'bugfix'
created: '2026-09-14'
status: 'done'
baseline_revision: '087c76b18a8ad462498653651a3fcb971e31baf4'
baseline_commit: '087c76b18a8ad462498653651a3fcb971e31baf4'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - convex/_generated/ai/guidelines.md
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Two candidate-aware reads apply fixed limits before resolving candidate identity. A requested section-run candidate beyond the first 30 generation rows can disappear, and a selected report candidate beyond the first 10 candidate runs can cause Compliance Notes to fall back to every candidate's rows.

**Approach:** Apply bounds only after candidate identity is established. Reuse the existing section-run candidate index and add the missing candidate-run lookup index, preserving all public return shapes, authorization, filtering, and fallback semantics.

## Boundaries & Constraints

**Always:** Keep reads bounded; scope an explicit section-draft candidate before its limit; resolve a selected report candidate by generation and candidate ID before reading notes; preserve unauthorized/missing generation, iterative generation, failed-run, consistency-withholding, sorting, and legacy unresolved-selection behavior.

**Block If:** Existing data permits an observably different required choice between duplicate candidate-run matches and the current first-match tolerance.

**Never:** Edit the deferred-work ledger or generated Convex files; make `candidateId` required; introduce a data migration; change no-candidate section-draft aggregation; change Compliance Notes' explicit-candidate path or unresolved-selection unscoped fallback.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Late explicit section candidate | More than 30 older section rows precede the requested run | Only that run's drafted sections are returned in production order | Missing or cross-generation run returns no rows |
| Late selected report candidate | More than 10 older candidate runs precede the selected run | Only the selected run's Compliance Notes are returned | Missing/legacy selection keeps the existing unscoped fallback |
| No section candidate supplied | Multiple candidate runs exist | Existing generation-scoped bounded aggregation is unchanged | Existing failed-run and consistency filters remain in force |

</intent-contract>

## Code Map

- `convex/schema.ts`: `generationCandidateRuns` has optional `candidateId` but lacks a generation-plus-candidate index; add an additive `by_generationId_and_candidateId` index. `generationSectionRuns.by_candidateRunId_and_section` already exists and is the required DW-121 reuse point. Do not edit `convex/_generated/`.
- `convex/generations.ts:getOrderedSectionDrafts`: currently takes 30 through `by_generationId`, then filters `args.candidateRunId`; branch explicit-candidate reads onto the existing candidate-first index while retaining generation ownership and the current no-candidate path.
- `convex/complianceNotes.ts:selectedCandidateRunId`: currently takes 10 generation runs, then finds `selection.candidateId`; use the new compound index with both equality predicates and a tolerant first match. Guard absent legacy `candidateId` before index lookup.
- `convex/ai/promptProgram.test.ts`: existing ordered single/compare fixtures prove output, failed-run exclusion, withholding, and explicit Compliance Note scoping; add the late explicit-section candidate regression here or in a focused Convex test.
- `convex/chatDeviationInventory.test.ts`: existing selected-candidate fixture exercises `selectedCandidateRunId` through the real DB lookup; extend it beyond 10 earlier runs or cover the same public query in a focused Convex test.
- `/Users/johnnynguyen/Documents/Repos/Banhall/.bmad-loop/runs/20260912-061909-feb3/bundles/candidate-scoped-bounded-reads/intent.md`: read-only source of DW-121/DW-122 intent and verbatim ledger entries.

## Tasks & Acceptance

**Execution:**
- [x] `convex/schema.ts`: add the candidate-run compound index without changing field optionality or generated files.
- [x] `convex/generations.ts`: candidate-scope explicit `getOrderedSectionDrafts` requests before `.take(30)` and preserve generation ownership plus existing post-read semantics.
- [x] `convex/complianceNotes.ts`: resolve selected candidate runs through the compound index before any bound, preserving first-match and unresolved fallback behavior.
- [x] `convex/ai/promptProgram.test.ts` and/or a focused Convex test: prove an explicit candidate beyond 30 older section rows still returns exactly its draft.
- [x] `convex/chatDeviationInventory.test.ts` and/or a focused Convex test: prove a selected candidate beyond 10 older runs returns only its notes.

**Acceptance Criteria:**
- Given more than 30 earlier section-run rows for one generation, when `getOrderedSectionDrafts` is called with a later candidate run ID, then it returns that candidate's eligible drafted rows in production order and no other candidate's rows.
- Given a candidate run belonging to another generation, when it is supplied to `getOrderedSectionDrafts`, then the query returns no rows for the requested generation.
- Given more than 10 earlier candidate runs and a model selection for a later run, when `listForGeneration` is called without an explicit run ID, then it returns only the later selected run's Compliance Notes.
- Given no explicit section candidate or no resolvable selected candidate, when the readers run, then their existing bounded aggregation and fallback semantics remain unchanged.

## Spec Change Log

## Review Triage Log

### 2026-09-14: Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 4, low 2)
- defer: 0
- reject: 10: (high 0, medium 1, low 9)
- addressed_findings:
  - `[low]` `[patch]` Reused the validated explicit candidate-run document instead of reading it again for status and consistency metadata.
  - `[medium]` `[patch]` Added explicit-candidate custom production-order coverage so the candidate-first index cannot silently dictate response order.
  - `[medium]` `[patch]` Added explicit-candidate before-and-after consistency coverage so the last production section remains withheld until the consistency pass.
  - `[medium]` `[patch]` Added explicit failed-candidate coverage so drafted rows from a failed run remain hidden on the changed branch.
  - `[medium]` `[patch]` Added a missing-`candidateId` legacy selection case so unresolved identity is proven to retain the unscoped fallback.
  - `[low]` `[patch]` Added protected-byte hashes and scoped diff checks for the ledger, generated files, and historical tracked evidence.

### 2026-09-14: Follow-up review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 0
- reject: 11: (high 0, medium 0, low 11)
- addressed_findings:
  - `[low]` `[patch]` Clarified that absent selected candidate IDs and missing explicit candidate-run parents follow the stated intent matrix, which can differ from accidental baseline behavior for legacy or orphaned records.
  - `[low]` `[patch]` Resolved missing checkout-local installation evidence with a fresh `npm ci`, then reran both verification commands and retained their outcomes and preservation checks.

## Design Notes

The section-run candidate index omits `generationId`, so the explicit path must retain the current cross-generation exclusion before results are exposed. The new candidate-run index includes both `generationId` and optional `candidateId`; `.first()` matches the current tolerant first-match behavior, whereas `.unique()` would introduce a new duplicate-data failure mode.

The intent matrix also specifies two identity edge cases that can differ from accidental baseline behavior: a selection without `candidateId` uses the unscoped Compliance Notes fallback, and a missing explicit candidate-run parent returns no section rows. Previously, two absent candidate IDs could compare equal, and orphaned non-final drafts inside the generation limit could surface. The current guards enforce the stated matrix outcomes; preservation claims do not include those accidental legacy matches.

## Verification

**Commands:**
- `npx vitest run convex/candidateScopedBoundedReads.test.ts convex/ai/promptProgram.test.ts convex/chatDeviationInventory.test.ts`: expected result is that both old beyond-limit reproductions fail before the fix and pass after it, with unchanged semantic guards still passing.
- `bash scripts/loop-verify.sh`: expected result is that every canonical verification step passes.

## Auto Run Result

Status: done

**Summary.** Reused the existing implementation committed at `9d899dc0372844db966a5029d96cbbe6610c6723`. Explicit section reads establish candidate identity before the 30-row bound; selected Compliance Notes use the additive generation-and-candidate index before taking the first match. This follow-up changed documentation and evidence only.

**Files changed since baseline.**

- `convex/schema.ts`: adds the optional-candidate compound lookup index.
- `convex/generations.ts`: validates and scopes explicit candidates before reading bounded section rows.
- `convex/complianceNotes.ts`: resolves the selected run through the compound index, retaining first-match tolerance for present candidate IDs.
- `convex/candidateScopedBoundedReads.test.ts`: covers both beyond-limit regressions and compatibility guards.
- This spec: records the fresh review and makes the two intended legacy identity outcomes explicit.
- `.audit/DW-121-DW-122/followup-20260914/`: retains frozen review inputs, four Astra/xhigh results, individual triage, installation and verification receipts, and native-byte provenance. Earlier evidence remains unchanged.
- `_bmad-output/implementation-artifacts/deferred-work.md`: the delta predates this invocation and belongs to the native orchestrator; only its exact unchanged snapshot bytes are carried into finalization.

**Review.** Four independent Astra/xhigh layers exited 0. This pass addressed 2 low documentation/evidence findings, deferred 0, and rejected 11. Patched severity counts are high 0, medium 0, low 2; score `3 * 0 + 2 = 2`, so `followup_review_recommended` is false. The bounded independent trail and ownership audit passed with no flags. No product-code repair or human decision remains.

**Verification.** The retained baseline control proves the two original regressions failed. Fresh `npm ci` exited 0 with unchanged lock bytes. The post-install focused command passed 3 files and 40 tests. Fresh `bash scripts/loop-verify.sh` exited 0 with all nine stages passing, including 189 files and 2,683 tests, discovery, production build, and uploader harness totals of 93/0 and 47/0. All source and historical tracked evidence bytes remain unchanged. The gate receipt discloses 3,784 tokens omitted from the middle of build output by the tool; stage outcomes and exit status are retained.

**Residual limits and ownership.** The explicit section read retains its 30-row bound, and duplicate present candidate IDs retain first-match tolerance. The absent-ID and missing-parent distinctions are documented in Design Notes. No production-data audit, migration, browser-component change, push, or deployment was performed. The orchestrator owns native acceptance and all ledger/status resolution; this local `done` result does not establish native acceptance.
