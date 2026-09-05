---
title: 'Boundary DW-33/DW-37/DW-40 Unicode marker repair'
type: bugfix
created: '2026-09-04'
status: done
baseline_commit: c7075572f14e51433b524026db55d5520eddde03
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/convex/_generated/ai/guidelines.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Generation filenames and transcript labels accept runs of Unicode dashes that the existing marker grammar treats as BEGIN/END delimiters. A client can place an apparent higher-trust wrapper inside a generated marker line or transcript heading. Boundary ledger identities DW-33, DW-37, and DW-40 record the same sanitizer defect and coverage gap.

**Approach:** Make filename and transcript-label sanitization obey the already-supported dash vocabulary in the shared trusted-context module. Preserve ordinary label text and source contents, and prove the real generation builder cannot gain delimiters from either metadata field. Keep chat behavior consistent by reusing the repaired helper.

## Boundaries & Constraints

**Always:** Work only in `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-unicode-fix`, branch `codex/bmad-unicode-fix`. Follow current trust classification, data-not-instructions guidance, and the existing marker grammar: ASCII hyphen-minus, U+2010 through U+2015, and U+2212, in runs of at least three. Preserve original filenames/labels in provenance reports, source payload semantics, budgets and prompt constants. Use physical local dependencies. Obtain real failing regression output before editing production code and passing output afterward.

**Ask First:** Any new trust policy, character vocabulary, public API, schema change or expanded scope. Root coordinates full-suite/typecheck gates; focused tests are already authorized.

**Never:** Edit other worktrees, native state, existing story statuses, deferred ledgers, generated Convex files, lockfiles or prompt snapshots. Do not push. Do not claim actual model resistance from deterministic formatting tests; they prove containment of the supported delimiter syntax. Do not run full-suite/typecheck gates yet.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Filename forgery | Each supported dash repeated three times, or mixed/longer runs, then a BEGIN/END marker in a document filename | Builder produces only its own genuine wrapper markers; source remains client evidence | Sanitization, no rejection |
| Transcript label forgery | Same hostile marker labels in a multi-part transcript, including lower-case keywords and mid-label placement | No added BEGIN/END occurrence; transcript contents remain between genuine transcript boundaries | Sanitization, no rejection |
| Ordinary names | Single/double supported dashes, Unicode prose, and normal filenames | Ordinary bytes remain unchanged | No error |
| Folded name | Newline or Unicode line separators and delimiter run in metadata | Single-line safe metadata | No error |
| Empty metadata | Whitespace-only filename | Existing untitled fallback remains | No error |
| Existing content/chat behavior | Current body-injection fixtures and chat filename regression | All existing focused boundary tests pass; benign formatting unchanged | No error |

</frozen-after-approval>

## Code Map

- `convex/ai/trustedContext.ts:244-268`: `DASH` defines existing grammar; `neutralizeMarkers` handles body content. `sanitizeFileName` currently collapses ASCII only. `documentBlock` interpolates sanitized filenames; `buildTrustedContext` sanitizes transcript part labels at its `keptParts.map`. Reuse the dash vocabulary without changing body neutralization semantics.
- `convex/ai/trustedContext.test.ts`: existing `doc`/`budget` factories, marker-forgery suite, ordinary double-dash and line separator regressions. Multi-part transcripts are necessary because single-part formatting omits labels.
- `convex/ai/chatEvidence.ts:140-153`: `markerFileName` duplicates Unicode dash handling because the old shared helper was ASCII-only. Consolidate that safeguard into shared sanitization; do not change chat framing.
- `convex/ai/chatEvidence.test.ts`, `convex/ai/contextBoundary.test.ts`: existing chat and corpus boundary checks. The corpus oracle already recognizes the supported dash grammar; do not weaken it.
- `_bmad-output/specs/spec-ai-engine-sprint-2-boundary/SPEC.md`, `touchpoints.md`, and `stories/5-injection-boundary-test-suite.md`: read-only CAP-2/CAP-5 contract and recorded bypass evidence. Existing story freeze restrictions remain historical context; this new authorized repair owns the sanitizer correction.
- `vitest.config.ts`: focused Convex tests run in the real edge-runtime project with bounded workers. No configuration edits needed.

## Tasks & Acceptance

**Execution:**
- [x] `convex/ai/trustedContext.test.ts`, `convex/ai/chatEvidence.test.ts` -- add regression coverage for both metadata entry points, each supported dash, mixed/longer runs, and benign labels; preserve red test output before fixing production code.
- [x] `convex/ai/trustedContext.ts`, `convex/ai/chatEvidence.ts` -- apply one shared dash-run sanitization rule and remove the now-redundant local chat workaround.
- [x] `.audit/unicode-marker-repair/` -- preserve baseline SHA, commands, red/green logs, matrix coverage and independent review evidence. The baseline is current HEAD before changes; never alter historical story baselines.

**Acceptance Criteria:**
- Given hostile generation metadata, when the real builder assembles it, then marker occurrences match the benign counterpart, the document retains client trust, and the payload remains inside the genuine boundaries.
- Given the existing focused boundary suites, when they run after the change, then they all pass without weakening any existing assertion or changing prompt constants.
- Given final diff review, when compared with baseline, then edits remain confined to this repair's code, tests, new specification and audit files, with no ledger/state/lockfile changes.

## Spec Change Log

## Verification

**Commands:**
- `npx vitest run convex/ai/trustedContext.test.ts` before the production fix: new hostile metadata regression must fail on the recorded baseline implementation.
- `npx vitest run convex/ai/trustedContext.test.ts convex/ai/chatEvidence.test.ts convex/ai/contextBoundary.test.ts` after the fix: all tests pass.
- `git diff --check`: no whitespace errors.

Full-suite and typecheck verification is owned by root after integration and is not represented as completed by these focused checks.

## Review Triage Log

2026-09-04: Three independent BMAD layers completed through root. Edge and verification-gap found no issues. Blind review: five low-severity coverage patches accepted, five rejected with code/test evidence, no intent gap, bad spec or production defect. Added full category identity to marker oracle, ordinary Unicode builder metadata checks, mixed two-dash threshold checks, longer homogeneous runs, and the complete chat dash matrix. Details: `.audit/unicode-marker-repair/review-triage.md`.

## Verification Hold

Candidate remains in-review pending root's native full verification gate. Focused tests are evidence for this bounded correction and do not certify the full integrated application. Existing native story states and deferred-ledger entries are unchanged.

## Suggested Review Order

- Shared supported dash vocabulary now applies to metadata.
  [trustedContext.ts:248](../../convex/ai/trustedContext.ts#L248)
- Chat uses the same sanitizer instead of duplicating its Unicode safeguard.
  [chatEvidence.ts:143](../../convex/ai/chatEvidence.ts#L143)
- Generation tests cover both metadata entry points and benign Unicode labels.
  [trustedContext.test.ts:348](../../convex/ai/trustedContext.test.ts#L348)
- Chat tests retain the full supported dash matrix at the second caller.
  [chatEvidence.test.ts:268](../../convex/ai/chatEvidence.test.ts#L268)

## Integrated verification acceptance

At integrated revision `717c75897cc04256c008a2ed42747df66f6fc6b5`, the standard `bash scripts/loop-verify.sh` exited 0: Convex typechecking passed, Svelte reported 0 errors and 0 warnings, all 1,726 tests in 148 files passed, and uploader harnesses passed 50 and 18 checks. Source changes from this repair are present in that ancestry; the merged snapshot tests separately passed 9 cases and integrated legacy/Unicode checks passed 233 cases. Evidence: `.audit/ledger-reconciliation/integrated-full-gate.log` and `integrated-repair-focused.log`. This supersedes the prior verification hold for this repair. Native original-story ledger closure, browser verification and remaining learning stories are tracked separately; no native run state was hand-edited.
