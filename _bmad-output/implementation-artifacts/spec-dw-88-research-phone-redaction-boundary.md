---
title: 'DW-88 research phone redaction boundary'
type: 'bugfix'
created: '2026-09-04'
status: 'done'
baseline_revision: b984822a8aeb70b7eb48a5d617ed18846392b1d2
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Research redaction returns `([redacted phone]` for `(613) 555-0134` because the leading word boundary starts the match inside the parentheses.

**Approach:** Correct the starting boundary so the entire phone is consumed, with focused regressions preserving the research redactor's other behavior.

## Boundaries & Constraints

**Always:** Preserve URL and email redaction, existing name replacement behavior, and whitespace normalization. Keep existing research phone formats and trailing boundary behavior. Record baseline reproduction and passing regression evidence.

**Block If:** A change requires altering product policy or external research permissions.

**Never:** Edit the deferred-work ledger or generated Convex files. Expand this into the distinct firm-wide deidentify policy. Push, deploy, or open a PR. The invocation bundle supersedes factory ticket intake; use the existing orchestrator worktree.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Parenthesized phone | `(613) 555-0134` alone, after whitespace, or after punctuation | Entire phone becomes `[redacted phone]`; surrounding prose retained | No error |
| Existing phone forms | Bare, dotted, dashed, country-prefixed and repeated valid phone numbers | Complete phone placeholders, including prefix where present | No error |
| Other identifiers | URLs, email and known overlapping or regex-special names | Existing placeholders and longest-first case-insensitive literal name handling | No error |
| Whitespace | Leading/trailing whitespace, tabs, repeated spaces, three newlines | Trim; collapse spaces/tabs to one and three newlines to two | No error |
| Embedded digits | Phone-like sequence directly embedded in a word | Existing word-boundary protections retained | No error |

</intent-contract>

## Code Map

- `convex/ai/research/core.ts:47`: pure exported `redactExternalText`; names then email, phone, URL passes; whitespace normalization at return.
- `convex/ai/research/core.ts:73`: `buildExternalBrief` calls the redactor for outbound research text.
- `convex/lib/deidentify.ts:78`: read-only precedent for lookbehind, with deliberately different phone and prose policy. Do not wholesale reuse its pattern.
- `vitest.config.ts`: discovers `convex/**/*.test.ts` under edge-runtime.
- `convex/_generated/ai/guidelines.md`: read before Convex edits.
- Bundle intent and DW-88 provide scope; architecture security review confirms research strips direct identifiers while retaining technical content.

## Tasks & Acceptance

**Execution:**
- [x] `convex/ai/research/core.test.ts`: add direct redactor matrix regressions and an outbound brief assertion; run against baseline before fixing.
- [x] `convex/ai/research/core.ts`: repair only phone starting boundary.
- [x] `.audit/DW-88/decisions.tsv` and `.audit/DW-88/evidence.md`: record decisions, canonical baseline revision, command results and AC mappings. Leave commit finalization to parent.

**Acceptance Criteria:**
- Given a research text containing a parenthesized phone, when `redactExternalText` processes it, then no phone parenthesis or digits remain.
- Given a brief containing that phone in selected text, when `buildExternalBrief` constructs the outbound text, then it contains the complete placeholder and no leaked opening parenthesis.
- Given existing URL, name, email and whitespace inputs, when redaction runs, then the matrix preservation expectations pass.

## Spec Change Log

## Review Triage Log

### 2026-09-04 Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 1, low 3)
- defer: 0
- reject: 7: (high 0, medium 0, low 7)
- addressed_findings:
  - [medium] [patch] Preserve existing matches after words before an opening parenthesis or plus sign; add adjacency regressions and combine old and new starting assertions.
  - [low] [patch] Scope outbound residue assertions to phones and exercise retained technical numbers and parentheses.
  - [low] [patch] Rename URL test to reflect existing punctuation handling.
  - [low] [patch] Replace drifting audit line references with stable test names.

Blind and edge reviewers independently identified the same boundary regression; these were deduplicated. Verification-gap review found no gaps. Intent review found direct function and outbound-brief surface alignment. Seven remaining suggestions concern optional coverage, existing embedded-prefix semantics, or finalization fields that were correctly pending at review time. They do not identify additional change-caused defects.


### 2026-09-04 Follow-up review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 0
- reject: 8: (high 0, medium 0, low 8)
- addressed_findings:
  - [low] [patch] Clarified that prior ledger-unchanged verification preceded native closure.
  - [low] [patch] Retained native journal and invocation snapshot for exact unchanged ledger finalization.

Individual triage is retained in `.audit/DW-88/followup/review.md`. No production edits were required by this follow-up.

## Verification

**Commands:**
- `npm test -- convex/ai/research/core.test.ts`: all focused matrix and brief tests pass after baseline failures are recorded.
- `PUBLIC_CONVEX_URL=https://example.convex.cloud npm run check`: zero errors.
- `npm test`: suite passes.
- `git diff --check`: no whitespace errors.

## Auto Run Result

Status: done

Research phone redaction consumes the full opening parenthesis and country prefix while preserving existing phone grammar and matching positions. Production implementation remains `22fda2fa15ea4c294ecd8dea9362bbc69319e5d4`.

Files changed since baseline:
- `convex/ai/research/core.ts`: corrected only the starting phone boundary.
- `convex/ai/research/core.test.ts`: phone matrix, preservation, and outbound brief regressions.
- `.audit/DW-88/`: baseline failures, passing gates, decisions, follow-up triage, and native provenance.
- This spec: acceptance and completed fresh review result.
- `deferred-work.md`: exact unchanged orchestrator-authored closure, staged only after snapshot comparison.

Fresh review: 2 low evidence patches, 0 deferred, 8 rejected; no production findings. Follow-up recommendation false (high 0, medium 0, low 2; score 2).

Verification: focused suite 37 passed; full `bash scripts/loop-verify.sh` exit 0 (Convex TypeScript pass, Svelte 0 errors / 0 warnings, 148 test files / 1799 tests, uploader harnesses 50 and 18 passed). `git diff --check` passed after removing the invocation's trailing blank line. Evidence: `.audit/DW-88/evidence.md` and `.audit/DW-88/followup/`.

Residual risk: existing research regex remains a best-effort recognizer with its unchanged phone body and trailing boundary. No product policy decision is needed. Native closure provenance is separate from final orchestrator acceptance. No push, deployment, PR, ledger-content edit, or sprint-status write was performed.
