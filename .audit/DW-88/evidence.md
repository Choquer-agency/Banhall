# DW-88 verification evidence

Canonical baseline revision: `b984822a8aeb70b7eb48a5d617ed18846392b1d2`.
Implementation was made in the existing orchestrator worktree. HEAD was exactly this revision before changes; `git diff b984822a8aeb70b7eb48a5d617ed18846392b1d2 -- convex/ai/research/core.ts` returned no output after adding tests and before the fix. Implementation commit: `22fda2fa15ea4c294ecd8dea9362bbc69319e5d4`.

The spec frontmatter has `context: []`; no frontmatter context files were omitted. Convex guidelines and the code-map redactor, brief builder, firm-wide precedent, and Vitest configuration were read before implementation. The firm-wide policy and generated files were not edited.

## Acceptance mapping

All test names below resolve in `convex/ai/research/core.test.ts`.

| Acceptance | Exact test name or parameterized title |
| --- | --- |
| Entire parenthesized phone consumed alone, after whitespace and punctuation | `consumes the complete phone in %s` (parenthesized input rows) |
| Outbound selected passage contains complete placeholder without leaked phone parenthesis or digits; technical numbers and parentheses retained | `redacts the complete parenthesized phone in the outbound selected passage` |
| Existing phone forms and adjacency positions retained | `consumes the complete phone in %s` (bare, dotted, dashed, country-prefixed, repeated, and Call-adjacent rows) |
| Embedded word protections retained | `retains word-boundary protection for %s` |
| URL and email behavior retained | `preserves existing URL and email redaction behavior` |
| Literal overlapping names retained | `replaces overlapping names longest-first and regex-special names literally` |
| Whitespace normalization retained | `preserves trim, space and tab collapse, and paragraph normalization` |

## Baseline reproduction

Command: `npm test -- convex/ai/research/core.test.ts` (exit 1).
Full output: [baseline-test.log](baseline-test.log).

```text
Expected: "[redacted phone]"
Received: "([redacted phone]"

Test Files  1 failed (1)
     Tests  7 failed | 28 passed (35)
```

Failures covered three parenthesized positions, two plus-prefixed forms, repeated phones, and the outbound brief. The brief contained `Call ([redacted phone] about the cultivar trial.`

## Initial passing regression

The first proposed production edit changed the leading `\b` to `(?<!\w)`. Review found an adjacency regression in that proposal; the final correction and its proof follow below.

Command: `npm test -- convex/ai/research/core.test.ts` (exit 0).
Full output: [focused-test.log](focused-test.log).

```text
Test Files  1 passed (1)
     Tests  35 passed (35)
```

Command: `git diff --check` (exit 0, no diagnostic output); see [diff-check.log](diff-check.log).

## Review correction

Added exact regression cases `Call(613) 555-0134 today.` and `Call+16135550134 today.` before changing the first proposed fix. Command: `npm test -- convex/ai/research/core.test.ts` (exit 1). Full output: [adjacency-before.log](adjacency-before.log).

```text
Expected: "Call[redacted phone] today."
Received: "Call([redacted phone] today."

Expected: "Call[redacted phone] today."
Received: "Call+[redacted phone] today."

Test Files  1 failed (1)
     Tests  2 failed | 35 passed (37)
```

The final production edit replaces the original leading `\b` with `(?:\b|(?<!\w))`. Keeping the original boundary alternative preserves its existing matching positions; the additional alternative consumes punctuation-led phones after whitespace, punctuation, or at the start. The phone body and trailing boundary remain unchanged.

The outbound brief fixture now contains legitimate technical text `(24 samples at 5 C)` and asserts exact retained passage text plus phone-specific absence. The URL/email test name now describes existing behavior, which includes consuming the final period in a URL. Acceptance anchors above use test names instead of drifting source line numbers; historical TSV rows remain append-only.

Command: `npm test -- convex/ai/research/core.test.ts` (exit 0). Full output: [adjacency-after.log](adjacency-after.log).

```text
Test Files  1 passed (1)
     Tests  37 passed (37)
```

Post-review command: `git diff --check` (exit 0, no diagnostics), recorded in [review-diff-check.log](review-diff-check.log).

## Original implementation verification (before native closure)

Implementation commit: `22fda2fa15ea4c294ecd8dea9362bbc69319e5d4`.

- `npm test -- convex/ai/research/core.test.ts`: exit 0, 37 tests passed; [parent-focused.log](parent-focused.log).
- `bash scripts/loop-verify.sh`: exit 0; Convex TypeScript pass, Svelte 0 errors / 0 warnings, 148 test files / 1799 tests passed, PowerShell uploader 50 passed, shell uploader 18 passed. Full output: [loop-verify-final.log](loop-verify-final.log).
- `git diff --check`: exit 0.
- `git diff --exit-code b984822a8aeb70b7eb48a5d617ed18846392b1d2 -- _bmad-output/implementation-artifacts/deferred-work.md`: exit 0; ledger unchanged.

All five matrix rows run in the focused suite. Four independent review layers covered the diff and audit trail. Four patch findings were addressed (one medium boundary regression and three low test/evidence improvements); seven suggestions were rejected; no findings were deferred. The edge reviewer rechecked the final boundary with seven probes and reported no concrete regression. The workflow follow-up score is 6 (3 × 1 medium + 3 low), so the spec retains its computed follow-up recommendation.

The regex remains a best-effort recognizer using the existing research phone grammar. No external provider request was needed for this pure transformation fix.

Recorded command logs have terminal blank lines trimmed for repository whitespace checks; diagnostic content is unchanged.

## Fresh follow-up review

Reviewed implementation at `71cd71cd1d24daf0f9444a686cc824ad1e5f1118`, against baseline `b984822a8aeb70b7eb48a5d617ed18846392b1d2`.
The ledger-unchanged command above describes the original implementation verification. The native orchestrator subsequently closed DW-88 before this review invocation. `followup/native-journal.json` retains the close and subsequent review-start events; `followup/invocation-snapshot.json` identifies the exact ledger hash and starting revision. `followup/ledger-invocation.snapshot` retains the unchanged bytes for staged comparison. This provenance establishes authorship only, not acceptance.

Fresh focused command `npm test -- convex/ai/research/core.test.ts` passed all 37 tests. Four independent review layers found no new production defect or verification gap. Triage details are in `followup/review.md`. The earlier seven edge probes remain a historical reviewer report; this fresh review does not use that report as execution evidence.

Fresh full gate `bash scripts/loop-verify.sh` exited 0: Convex TypeScript passed; Svelte 0 errors / 0 warnings; 148 test files and 1799 tests passed; uploader harnesses 50 and 18 passed. Output: `followup/verification.log`.
