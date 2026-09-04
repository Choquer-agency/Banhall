---
title: 'Preserve line structure during phone de-identification'
type: 'bugfix'
created: '2026-09-04'
status: 'done'
baseline_commit: '9da55bece5948da12129720dd2330a3032c985bf'
review_loop_iteration: 0
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
---

<frozen-after-approval reason="human-owned intent; repair and verification authorized by user">

## Intent

**Problem:** The phone pattern in `convex/lib/deidentify.ts` consumes line separators. The real helper converts five-line `First line\n613\n555\n0134\nLast line` into three lines, violating the existing structured-prose contract for Brain exemplars and learning input.

**Approach:** Restrict phone matching to a single line while preserving established identifier coverage and phone format tradeoffs. Add regression evidence at the helper and its real Convex consumer boundaries.

## Boundaries & Constraints

**Always:** Preserve line and paragraph separators exactly during the phone pass, including LF, CR, CRLF, Unicode line separator and Unicode paragraph separator. Keep ordinary same-line phone redaction, horizontal whitespace support, consistent-separator protection for bare numbers, placeholders, name/email behavior, and nullable-project contact scrubbing. Use lockfile-local dependencies. Capture red-before-green evidence against the real helper, and verify relevant consumers plus repository gates. Work only in this isolated checkout and commit a local candidate after review.

**Ask First:** Changes to identifier scope, product policy, public interfaces, or accepted international-phone false negatives require renewed direction.

**Never:** Backfill existing data, mutate report prose, change research/core.ts, hand-edit generated files, modify historical story specifications, native state, deferred ledgers, or integration checkout. No push or remote changes. Human authorization already covers this narrow repair, verification, review, and local commit; do not pause for redundant plan or commit approval.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bare groups across lines | 613, 555, 0134 separated by each supported line delimiter | Numeric lines and delimiters unchanged | No error |
| Parenthesized groups across lines | Line delimiter after area code or exchange | No match spanning delimiter | No error |
| Prefix on previous line | +1 then delimiter then 613-555-0134 | Prefix and delimiter survive; complete same-line phone redacted | No error |
| Ordinary phone | Parenthesized, hyphen, dot, space, tab or nonbreaking-space forms on one line | Existing complete phone placeholder | No error |
| Technical numbers | Bare digit runs and mixed-separator 3-3-4 ranges | Unchanged | No error |
| Other identifiers | Names, titles, emails and missing project record | Existing helper behavior retained | No error |

</frozen-after-approval>

## Code Map

- `convex/lib/deidentify.ts:77` contains the phone pattern; each `\s` separator can consume a line break. Pure helper permits direct tests without deployment. A narrow separator restriction must also cover optional country-prefix and parenthesized branches, not only the backreference branch.
- `convex/lib/deidentify.test.ts` already covers names, literal boundaries, placeholders, ordinary phones, numeric-range preservation and unrelated whitespace. Extend this suite with exact output assertions. Preserve horizontal whitespace previously matched by `\s`.
- `convex/brainFeedback.test.ts:555` exercises `internal.brain.nominateFromReport` through convex-test; its existing de-identification case verifies paragraph structure in stored Brain sources.
- `convex/generationLifecycle.test.ts:1503` exercises `approveSectionDraft` and stored section edit events, including raw edit-ratio behavior and ghost text elsewhere in the suite.
- `convex/learning.test.ts:327` exercises `getProposalWordingEditsForDigest`, existing-project and deleted-project cases, and raw-row retention.
- `docs/product-domain.md:1622` is read-only contract evidence: layout preservation, best effort identification, write and read boundaries.
- `_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/stories/2-de-identification-before-firm-wide-knowledge.md:117` is historical read-only intent explicitly requiring line structure to survive.
- `vitest.config.ts` provides real Convex runtime testing and bounded workers; `package.json` defines check and full unit gates. No frontend changes imply no component-browser requirement.

## Tasks & Acceptance

**Execution:**
- [x] `convex/lib/deidentify.test.ts` -- add matrix regression coverage and reproduce failure before changing production code.
- [x] `convex/lib/deidentify.ts` -- prevent phone matches spanning line delimiters while retaining all other matching behavior.
- [x] `convex/brainFeedback.test.ts`, `convex/generationLifecycle.test.ts`, `convex/learning.test.ts` -- extend existing real consumer regressions to prove numeric lines survive their boundary and ordinary phones still redact.
- [x] `.audit/deidentify-linebreak-fix/` -- save red and green command logs, acceptance mapping and append-only decisions; run relevant and full tests plus typecheck.

**Acceptance Criteria:**
- Given structured input containing numeric line fragments, when the real helper and firm-wide boundary consumers process it, then line separators and numeric fragments survive without being joined.
- Given same-line contacts and project identifiers, when existing consumers scrub them, then established placeholders and raw report/event ownership remain unchanged.
- Given the baseline implementation, when the added regression tests run, then they fail for the reported line consumption; given the fix, the same tests and established regression suites pass.

## Spec Change Log

## Design Notes

The contract favors false negatives over corruption of technical vocabulary. A line break is a structural boundary, not a phone separator. Do not solve this by adding line breaks around a replacement: that would still consume numbers from separate lines. Do not reject a whole match in a callback, because a prefix on a previous line could shield a valid phone on the next line.

## Verification

**Commands:**
- `npm ci --ignore-scripts` -- install exact lockfile dependencies only.
- `./node_modules/.bin/vitest run convex/lib/deidentify.test.ts convex/learning.test.ts convex/brainFeedback.test.ts convex/generationLifecycle.test.ts` -- regression fails before repair and all pass after.
- `npm test` -- all unit and Convex tests pass.
- `PUBLIC_CONVEX_URL=https://example.convex.cloud npm run check` -- no typecheck errors.
- `git diff --check` -- no whitespace errors.

## Suggested Review Order

- Exclude structural separators at every phone position while preserving established phone formats.
  [deidentify.ts:76](../../convex/lib/deidentify.ts#L76)

- Verify every structural delimiter and same-line whitespace format against the real helper.
  [deidentify.test.ts:61](../../convex/lib/deidentify.test.ts#L61)

- Prove stored Brain exemplar layout and raw report ownership.
  [brainFeedback.test.ts:608](../../convex/brainFeedback.test.ts#L608)

- Prove draft and approved learning events preserve numeric lines.
  [generationLifecycle.test.ts:1503](../../convex/generationLifecycle.test.ts#L1503)

- Prove digest inputs preserve lines while stored source rows remain raw.
  [learning.test.ts:380](../../convex/learning.test.ts#L380)

- Read baseline failures, green results, full gate, and independent review dispositions.
  [evidence.md:1](../../.audit/deidentify-linebreak-fix/evidence.md#L1)

