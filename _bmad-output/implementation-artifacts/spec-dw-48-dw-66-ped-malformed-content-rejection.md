---
title: 'DW-48 DW-66 reject malformed content from persisted PED'
type: 'bugfix'
created: '2026-09-04'
status: 'done'
baseline_revision: 'f34bd79ccff35019c5cf5460d8845a0240c19978'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '{project-root}/.factory/AGENTS.factory.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Malformed baseline or current JSON becomes empty text in the existing extractor, permanently recording bogus PED 1 or PED 0 readings (DW-48, DW-66).

**Approach:** Distinguish extraction failure from successful empty text at the persistence boundary. Keep read-time extraction behavior and PED formula compatible.

## Boundaries & Constraints

**Always:** Skip persistence when either content cannot be parsed/extracted; let milestone and publish operations complete. Accept legitimate empty Tiptap documents. Reproduce the invalid scalar on the baseline before production edits and retain real failing and passing output.

**Block If:** Fixing requires changing product permissions or workflow policy.

**Never:** Edit the deferred-work ledger, generated files, native orchestration state, or historical story. Change the read-time API or PED formula, backfill historical readings, push or deploy. This invocation authorizes the existing native worktree and bundle as scope despite generic factory intake instructions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Broken current | Valid baseline, syntactically invalid current JSON | No reading; milestone and publish complete | Skip |
| Broken baseline | Invalid baseline JSON, valid current | No reading; milestone and publish complete | Skip |
| Both broken | Both JSON strings malformed | No bogus PED 0 row | Skip |
| Empty documents | Valid empty doc on either or both sides | Record PED 1 for empty/nonempty and 0 for both empty | No error |
| Valid edited document | Valid Tiptap content | Existing formula and read-time parity retained | No error |
| Traversal failure | JSON parses but traversal throws (e.g. null or non-array content) | No reading, caller completes | Skip |

</intent-contract>

## Code Map

- `convex/lib/reportEdits.ts:168`: extractPlainText catches JSON/traversal errors and returns empty string. Reuse traversal to expose failure without changing legacy callers.
- `convex/lib/editDistance.ts:99`: recordReportEditDistance catches failures; extraction at 116 currently loses failure information. Preserve baseline selection, dedupe, attribution and formula.
- `convex/reportEditDistance.test.ts:56`: convex-test setup creates writer, project, generation, report and baseline; rows helper at 145 inspects storage. Public milestone and scheduled publish tests already exist.
- `convex/lib/editDistance.test.ts:1`, `tests/reportEdits.test.ts`: formula and extractor tests.
- `convex/reports.ts`: postEditDistance read query remains compatible.
- `convex/snapshots.ts`, `convex/projects.ts`: public milestone and publish entry points; exercise without policy changes.
- `scripts/loop-verify.sh`: ordinary full gate.
- `docs/product-domain.md`: read-only domain contract; no policy amendment required.

## Tasks & Acceptance

**Execution:**
- [x] `convex/reportEditDistance.test.ts`: reproduce the bogus persisted scalar before modifying production code, then add real public milestone/publish regressions for matrix cases with scheduled functions drained and persisted side effects checked.
- [x] `convex/lib/reportEdits.ts` and `convex/lib/editDistance.ts`: expose extraction failure separately and skip invalid persistence while preserving successful text and legacy fallback.
- [x] `tests/reportEdits.test.ts`: cover successful empty text, extraction failure, and legacy fallback as appropriate.
- [x] `.audit/DW-48-DW-66/`: retain baseline revision, red/green logs, append-only decisions.tsv and evidence.md mapping ACs to executed tests.

**Acceptance Criteria:**
- Given malformed baseline or current content, when a public milestone or publish operation completes, then its normal side effects exist and no invalid reportEditDistance row is inserted after scheduled work finishes.
- Given valid empty or edited documents, when readings are recorded, then persisted values follow the existing formula and the read-time query retains its response contract.
- Given the unchanged baseline implementation, when the regression runs before production edits, then evidence demonstrates bogus persisted PED 1 and PED 0 values.

## Spec Change Log

## Review Triage Log

### 2026-09-04 Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 0
- reject: 12: (high 0, medium 0, low 12)
- addressed_findings:
  - [low] [patch] Clarified the extractor comment to distinguish failure from legitimate empty text.
  - [low] [patch] Qualified baseline hash timing in baseline.txt.
  - [low] [patch] Inventoried parent verification commands and outcomes in evidence and decisions.

### 2026-09-04 Fresh review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 0
- reject: 12: (high 0, medium 0, low 12)
- addressed_findings:
  - [low] [patch] Added native journal provenance and exact-byte finalization evidence for the pre-existing orchestrator closure.

## Verification

**Commands:**
- `npx vitest run convex/reportEditDistance.test.ts convex/lib/editDistance.test.ts tests/reportEdits.test.ts`: all focused tests pass.
- `bash scripts/loop-verify.sh`: ordinary full gate passes.



## Auto Run Result

Status: done.

Implemented failure-aware extraction that skips persisted PED on JSON parse or traversal failure while preserving empty documents, legacy read fallback, formula, and caller completion. Fresh four-layer review required no production changes.

Files changed since baseline:
- `convex/lib/reportEdits.ts`: failure-aware extraction with legacy wrapper.
- `convex/lib/editDistance.ts`: skip invalid inputs before persistence.
- `convex/reportEditDistance.test.ts`: public milestone/publish regression matrix.
- `tests/reportEdits.test.ts`: extraction success/failure compatibility.
- `.audit/DW-48-DW-66/`: red/green evidence, fresh verification, review triage, native provenance.
- This spec: review and completion record.
- Deferred-work ledger: exact pre-existing native closure bytes staged without agent content changes, supported by native journal evidence.

Review this pass: one low audit documentation patch, zero deferred, twelve rejected. Patched severity counts high 0, medium 0, low 1; score 1; follow-up recommendation false.

Verification: fresh focused command exited 0 (76 tests); fresh full gate exited 0 (1835 tests, zero Svelte diagnostics, uploader harnesses 50 and 18 passes). Previous baseline red log retains 16 failures showing bogus PED 1 and 0. Production implementation commit: `6c6cb7023417b38d0b8aee09a34dc4fe26d6cec3`. Fresh reviewed source HEAD: `0a52e0ab50a259e86c70dc5c3472dbabfbf9882d`.

Residual limits: no full Tiptap schema validation or historical backfill; original red-before-edit chronology has the documented attestation limitation. Final native acceptance remains the orchestrator's responsibility.
