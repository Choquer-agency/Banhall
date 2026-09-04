---
title: 'De-identification before firm-wide knowledge (CAP-1)'
type: 'feature'
created: '2026-09-04'
status: 'done'
baseline_revision: '8aa8be3d84bed5a936647c717c8f6a45c4b32d39'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
warnings: ['oversized']
deferred:
  - summary: >-
      sectionEditEvents and brainSources rows written before this change still
      hold raw client prose and reach firm-wide digests and the Brain unchanged.
    evidence: |-
      Scrubbing for those two tables happens at the write site
      (convex/generations.ts:1985, convex/brain.ts:234), so
      convex/learning.ts getSectionEditsForDigest returns whatever is stored and
      every pre-deploy row in the 500-row digest window is raw. CAP-1's success
      clause is write-scoped ("writes pass through it") and the epic SPEC's open
      question defaults re-processing existing Brain sources to "no", so a
      backfill or a read-side filter is deliberately out of this story.
    location: >-
      convex/learning.ts:100
    severity: medium
  - summary: >-
      Three other free-text streams cross the same firm-wide boundary without
      de-identification.
    evidence: |-
      qaItemFeedback.itemText (convex/learning.ts getFeedbackForDigest),
      candidateScores.comment (getCandidateFeedbackForDigest) and
      brainFeedbackQueue body/suggestedRule (getApprovedBrainFeedbackForDigest,
      plus the writer_feedback importSource at convex/brain.ts:675) all feed the
      same two digest prompts or the Brain, and all carry a projectId. CAP-1
      enumerates only nominateFromReport, sectionEditEvents and
      proposalWordingEditEvents, so these are outside this story's intent.
    location: >-
      convex/learning.ts:29
    severity: medium
  - summary: >-
      convex/ingestion.ts builds a Brain source title from clientName, so
      curated imports carry the client name into drafting prompts.
    evidence: |-
      The exemplar label reaches generation prompts via
      BRAIN_EXEMPLAR_SCAFFOLDS.labelOrder (convex/ai/brain/retrieve.ts:115) —
      the same argument that made nominateFromReport scrub its title. The
      ingestion path is a separate, admin-curated crossing not named by CAP-1.
    location: >-
      convex/ingestion.ts
    severity: low
  - summary: >-
      redactExternalText still leaves the opening parenthesis of a "(613) 555-0134"
      phone number.
    evidence: |-
      convex/ai/research/core.ts:57 anchors the phone pattern with a leading \b,
      which cannot match before "(", so the match starts at the digits. The new
      convex/lib/deidentify.ts fixes this with a lookbehind; the research
      redactor, which predates this story, was left untouched.
    location: >-
      convex/ai/research/core.ts:57
    severity: low
  - summary: >-
      The read-side scrub matches the project's current identifiers, so a
      renamed project leaves its old name in previously stored edit text.
    evidence: |-
      convex/learning.ts getProposalWordingEditsForDigest loads the live project
      document and scrubs against it. A project renamed after an edit event was
      written no longer supplies the string that appears in the stored prose.
      Inherent to the read-side approach the story mandated (chatV2.ts is
      off-limits), not to any choice made inside it.
    location: >-
      convex/learning.ts:79
    severity: low
  - summary: >-
      A section edit whose only change was a client name now stores an identical
      draft/approved pair while keeping its pre-scrub editRatio.
    evidence: |-
      editRatio is computed on raw text (deliberate, so the metric does not
      move), but getSectionEditsForDigest filters on editRatio >= 0.05 and then
      shows the model two identical strings as evidence of a meaningful edit.
      Low signal cost, no privacy cost.
    location: >-
      convex/generations.ts:1985
    severity: low
  - summary: >-
      The de-identification invariant and the new publish precondition are not
      recorded in the product-domain contract or the Brain doc.
    evidence: |-
      AGENTS.md requires contract-level transitions and permissions to be
      recorded in docs/product-domain.md; that file still only states
      "Personal digests cannot be published globally" and says nothing about
      de-identification at the firm-wide boundary or about publication now
      requiring an administrator privacy attestation. docs/the-brain.md still
      describes Brain ingestion without the scrub step. Out of this story
      because its acceptance criteria restrict the diff to files in the
      Execution task list, which names no documentation file.
    location: >-
      docs/product-domain.md
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Client prose crosses into firm-wide knowledge verbatim: `nominateFromReport` imports a report's plain text (and a title built from the project title) into `brainSources`, `sectionEditEvents` stores draft/approved/ghost section text, and `proposalWordingEditEvents` rows written in chat are fed to the draft-style distiller. Nothing strips company names, project titles, people names, emails, or phone numbers, and an administrator can publish a distilled digest without ever confirming it is free of client identifiers.

**Approach:** Add a pure `deidentify(text, project)` helper that removes project-record identifiers plus email/phone patterns; run every write into `brainSources` (via `nominateFromReport`) and `sectionEditEvents` through it, and scrub `proposalWordingEditEvents` on the learning read side since the write site is off-limits. Carry a privacy instruction in the digest system prompts, and require an explicit `privacyReviewed: true` on the mutation that publishes a digest, surfaced as an administrator checkbox.

## Boundaries & Constraints

**Always:**
- `deidentify` lives in a new pure module `convex/lib/deidentify.ts` with no Convex imports, so it is unit-testable without a deployment (mirror `convex/ai/research/core.ts`'s `redactExternalText`).
- Identifiers come from the project record only — `clientName`, `title`, `sredTitle`, `writer`, `interviewer`, `interviewees` — plus regex email and phone patterns. Regex + project-record driven, never model-driven; false negatives are acceptable this sprint.
- Placeholder tokens match the existing precedent exactly: `[redacted]`, `[redacted email]`, `[redacted phone]`.
- Scrubbing preserves the shape of the prose it replaces: paragraph breaks and line structure survive, because the scrubbed text is Brain exemplar content and digest input, not a single-line brief.
- The `privacyReviewed` gate applies only when `selectDigest` is publishing a digest (`digestId` non-null). Disabling guidance (`digestId: null`) and rollback-to-null stay reachable without it.
- The administrator checkbox is per digest kind, resets after a successful publish, and gates only the "Publish this version" buttons — never "Disable guidance". Use the existing `src/lib/components/ui/Checkbox.svelte` (bits-ui), design-system tokens, no font weight above 500.
- Existing callers of `api.learning.selectDigest` in `convex/learning.test.ts` must be updated to pass `privacyReviewed: true` on their publish calls; that is expected churn, not a new test.

**Block If:**
- Scrubbing `sectionEditEvents` would require editing a module the epic forbids (`convex/chatV2.ts`, `convex/reports.ts`, `convex/ai/pipeline.ts`, `convex/ai/chatAgentV2.ts`, `convex/ai/analyzerAgent.ts`, `convex/lib/auth.ts`, `convex/projectWorkflow.ts`, `convex/ai/qaChecks.ts`).

**Never:**
- Do not touch `convex/chatV2.ts`. `proposalWordingEditEvents` rows keep their raw text on disk; only the learning read path returns scrubbed text.
- Do not re-process previously nominated `brainSources` rows (SPEC open question, default: no).
- Do not add a model call, an LLM-based PII detector, or a new schema field. `learningDigestSelections` gains nothing.
- No changes to scoring math, CRA rules, digest freshness/dedup logic, or the publication ledger's semantics.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Name scrub | text containing `Acme Farms` and `Johnny Test`; project with those as `clientName`/`writer` | both replaced by `[redacted]`, case-insensitively | No error expected |
| Project title scrub | text containing the project's `title` and `sredTitle` | both replaced by `[redacted]` | No error expected |
| Contact scrub | text with `jo@acme.ca` and `(613) 555-0134` | `[redacted email]`, `[redacted phone]` | No error expected |
| Short/blank identifiers | project fields that are empty, whitespace, or under 3 characters | ignored; text unchanged by the name pass | No error expected |
| Overlapping names | `Acme` and `Acme Farms` both identifiers | longest match wins; result contains no bare `Acme` remnant | No error expected |
| Regex-special name | `clientName` = `C++ (Nordic) Ltd.` | literal match replaced; no regex crash | No error expected |
| Structure preserved | multi-paragraph text with no identifiers | returned unchanged including blank lines between paragraphs | No error expected |
| Nomination | `nominateFromReport` on a report whose prose names the client | the `brainSources` row's `content` **and** `title` are scrubbed | No error expected |
| Section approval | `approveSectionDraft` with client names in draft and approved text | the `sectionEditEvents` row's `draftText`/`approvedText` are scrubbed; `editRatio` is computed on the raw text, unchanged | No error expected |
| Ghost patch | final approval patching `ghostText` onto edit events | patched `ghostText` is scrubbed | No error expected |
| Proposal read | `getProposalWordingEditsForDigest` over rows whose project names the client | returned `originalText`/`editedText` scrubbed; stored rows untouched | No error expected |
| Proposal orphan | edit-event row whose project doc no longer exists | row still returned with email/phone scrubbing applied and no name pass | No error expected |
| Publish without flag | `selectDigest` with a non-null `digestId` and `privacyReviewed` absent or `false` | mutation throws; no `learningDigestSelections` row inserted | Error naming the privacy review requirement |
| Publish with flag | same call with `privacyReviewed: true` | publishes exactly as before | No error expected |
| Disable | `selectDigest` with `digestId: null`, no `privacyReviewed` | disables guidance as before | No error expected |
| Admin UI | reviews page, publish candidate visible | "Publish this version" is disabled until the per-kind privacy checkbox is checked; "Disable guidance" is never gated | Existing `digestError` surface reports a thrown error |

</intent-contract>

## Code Map

- `convex/ai/research/core.ts:39-60` -- `escapeRegExp` + `redactExternalText`: the precedent to mirror (longest-first name replacement, the three placeholder tokens, the email/phone regexes). It also strips URLs and collapses whitespace; the new helper must NOT collapse whitespace. Do not import it — it pulls `../openrouterCore`.
- `convex/research.ts:118-123` -- how `knownNames` is assembled from a project (`clientName`, `writer`, `interviewer`, `interviewees`). Extend with `title`/`sredTitle` for `deidentify`.
- `convex/schema.ts:67-127` -- `projects` fields available to the helper: `title`, `sredTitle`, `clientName`, `writer`, `interviewer`, `interviewees`.
- `convex/brain.ts:212-252` -- `nominateFromReport`; `project` and `content` are both in scope. Scrub `content` and the `title` template's project-title segment.
- `convex/brain.ts:116-166` -- `importSource`; `contentHash(args.content)` dedups on the passed content, so scrubbing changes the hash. Acceptable: pre-existing raw rows are never re-processed.
- `convex/ai/brain/retrieve.ts:103-116, 265` -- `BRAIN_EXEMPLAR_SCAFFOLDS.labelOrder` puts the source `title` into the generation prompt. Evidence that the nomination title, not just its content, reaches firm-wide prompts.
- `convex/generations.ts:1926-1929` -- `requireIterativeGeneration` returns `{ generation, project }`; `project` is in scope for the whole `approveSectionDraft` handler.
- `convex/generations.ts:1966-1986` -- the `sectionEditEvents` insert (`cap` at 6000, word-level `editRatio`). Scrub after computing `editRatio`, before `cap`.
- `convex/generations.ts:2085-2112` -- the ghost `ghostText` patch loop; scrub each `ghostText` the same way.
- `convex/learning.ts:65-78` -- `getProposalWordingEditsForDigest`: the read side to scrub. Rows carry `projectId`, so load the project per distinct id (memoize; up to 500 rows).
- `convex/learning.ts:287-340` -- `selectDigest`: add `privacyReviewed`, enforce only on the `args.digestId` non-null path, before the ledger insert.
- `convex/ai/learning.ts:88-105, 165-176` -- `QA_DIGEST_SYSTEM_PROMPT` and `STYLE_DIGEST_SYSTEM_PROMPT`; both already end with a "Be plain text…" bullet. Append one shared privacy instruction constant to both.
- `src/routes/admin/reviews/+page.svelte:29-75` -- `selectDigest` binding and `changePublishedDigest`; `:196`, `:230`, `:279`, `:313` are the four call sites (two disable, two publish).
- `src/lib/components/ui/Checkbox.svelte` -- bits-ui checkbox with `bind:checked` and `labelText`; the primitive to use.
- `convex/learning.test.ts:1-45` -- `convexTest(schema, modules)` fixture with admin/writer/manager identities; extend it. Publish calls at `:63,:156,:198,:226-233,:259` need `privacyReviewed: true`.
- `convex/ai/research/core.test.ts` -- the pure-helper test shape for `convex/lib/deidentify.test.ts`.

## Tasks & Acceptance

**Execution:**
- `convex/lib/deidentify.ts` -- new pure module exporting `deidentify(text, project)` and the `DeidentifiableProject` shape it accepts (all fields optional) -- one implementation both backend call sites and the read-side scrub share.
- `convex/lib/deidentify.test.ts` -- new unit suite covering every helper row of the I/O matrix (names, title, contacts, short/blank fields, overlap, regex-special characters, structure preservation) -- the helper is where the privacy guarantee actually lives.
- `convex/brain.ts` -- run `nominateFromReport`'s `content` and the project-title portion of its `title` through `deidentify` -- report prose and the exemplar label both reach firm-wide prompts.
- `convex/generations.ts` -- scrub `draftText`/`approvedText` at the `sectionEditEvents` insert and `ghostText` at the ghost patch loop, leaving `editRatio` computed on raw text -- writer-approved client prose is digest input.
- `convex/learning.ts` -- scrub `originalText`/`editedText` in `getProposalWordingEditsForDigest` using each row's project; add `privacyReviewed` to `selectDigest` and enforce it on the publish path -- the chat write site is off-limits, so the read side is the boundary.
- `convex/ai/learning.ts` -- add a shared privacy instruction constant and append it to both digest system prompts -- de-identification is best-effort, so the distiller must be told never to carry an identifier into a rule.
- `src/routes/admin/reviews/+page.svelte` -- add a per-kind privacy-review `Checkbox`, gate the two "Publish this version" buttons on it, pass `privacyReviewed`, and reset it after a successful publish -- the argument must reflect a real human confirmation.
- `convex/learning.test.ts` -- add cases for the scrubbed proposal-edit read (including the orphan-project row) and the `privacyReviewed` publish gate; update existing publish calls -- these are the two behaviors the mutation contract gained.
- `convex/brainFeedback.test.ts` -- append a `nominateFromReport` case asserting the `brainSources` row's scrubbed `content` and `title` -- the nomination matrix row; this file already seeds projects and reports.
- `convex/generationLifecycle.test.ts` -- append `approveSectionDraft` cases for the scrubbed `draftText`/`approvedText` (with `editRatio` unmoved) and the scrubbed `ghostText` patch -- the section-approval and ghost-patch matrix rows; this file already owns the iterative fixtures.
- `src/routes/admin/reviews/reviewsPublishGate.component.test.ts` -- new browser suite mounting the page: publish disabled until the checkbox is checked, `privacyReviewed: true` reaching the mutation, and "Disable guidance" ungated -- the admin-UI matrix row.

**Acceptance Criteria:**
- Given a nominated report whose prose and project title name the client, when the `brainSources` row is read back, then neither the client name nor the project title appears in `content` or `title`.
- Given the full suite, when `npm test` runs, then it passes with no test deleted and no previously passing assertion weakened.
- Given `npm run check` with `PUBLIC_CONVEX_URL` set, when it runs, then there are no new type errors.
- Given `git diff --name-only`, when inspected, then `convex/chatV2.ts` is absent and every listed file appears in the Execution task list or is this spec.
- Given the reviews page with an unpublished candidate, when the privacy checkbox is unchecked, then "Publish this version" is disabled and "Disable guidance" is still enabled.

## Spec Change Log

## Review Triage Log

### 2026-09-04 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 3, low 2)
- defer: 6: (high 0, medium 2, low 4)
- reject: 14: (high 0, medium 4, low 10)
- addressed_findings:
  - `[medium]` `[patch]` The name pass ran before the contact passes, so a client name inside an address ("jo@acmefarms.ca") was rewritten first, broke the email pattern, and left the local part exposed. Contact scrubbing now runs first; pinned by a new test.
  - `[medium]` `[patch]` Identifier matching had no boundaries, so a short or common identifier ate the inside of unrelated words ("Ion" within "Ionization") — a real hazard now that project titles, which are technical phrases, are in the identifier set. Matching is anchored to non-alphanumeric boundaries (lookbehind/lookahead, not `\b`, so "C++ (Nordic) Ltd." still matches); two tests pin both directions.
  - `[medium]` `[patch]` The phone pattern matched any bare ten-digit run, redacting serials, sample ids and measurements out of the exemplar prose the Brain exists to preserve. It now requires a separator or parentheses, and consumes an extension suffix; the intent explicitly accepts false negatives, which this trades for.
  - `[low]` `[patch]` The component test polled captured arrays (`toggles.length`, `publish.length`), so the waits could never observe a change and would fail rather than wait. Every poll now re-runs its query.
  - `[low]` `[patch]` The component test exercised only the QA-calibration panel. It now runs the gate for both digest kinds, asserts the opened panel owns exactly one checkbox, and asserts the `kind` reaching the mutation.

### 2026-09-04 — Review pass (resumed run)

- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 1: (high 0, medium 1, low 0)
- reject: 18: (high 0, medium 7, low 11)
- addressed_findings:
  - `[medium]` `[patch]` The per-publish reset of the privacy confirmation had no test: deleting `if (digestId) privacyReviewed[kind] = false;` from `+page.svelte` left the component suite green, so the human attestation could silently degrade to a one-time click while every later publish still sent `privacyReviewed: true`. `reviewsPublishGate.component.test.ts` now asserts, after a successful publish, that the checkbox is back to `aria-checked="false"` and the publish button is disabled again; the same mutation now fails 2/3 cases.

### 2026-09-04 — Review pass (follow-up on done spec)

- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 0
- reject: 23: (high 0, medium 6, low 17)
- addressed_findings:
  - `[medium]` `[patch]` The phone pattern accepted mixed separators, so a 3-3-4 digit run built from a range plus a count ("500-600 1000 times", "100-200 3000 cycles", "v2.100 200 3000") was rewritten to `[redacted phone]`, corrupting the technical numbers Brain exemplars exist to preserve. The bare form now requires the same separator twice (backreference) and the lookbehind also refuses a leading "."; the parenthesised area-code form is unchanged. Pinned by a new test that also keeps "613 555 0134" and "613-555-0134" redacted. Accepted false negative: a phone written with two different separators.
  - `[low]` `[patch]` `nominateFromReport` re-checked `content.trim()` after `deidentify`, which can never blank non-blank input (identifiers become `[redacted]`). Dead branch removed; the raw-content guard above it stays.

## Design Notes

`deidentify` mirrors `redactExternalText` but deliberately diverges twice: it adds `title`/`sredTitle` to the identifier set, and it skips the URL strip and the `[ \t]+`/`\n{3,}` collapse, because Brain exemplars and section drafts are structured prose whose paragraphing is part of the signal.

```ts
export function deidentify(text: string, project: DeidentifiableProject): string {
  const names = Array.from(new Set(
    [project.clientName, project.title, project.sredTitle, project.writer,
     project.interviewer, ...(project.interviewees ?? [])]
      .map((n) => n?.trim()).filter((n): n is string => !!n && n.length >= 3)
  )).sort((a, b) => b.length - a.length); // longest first: "Acme Farms" before "Acme"
  let out = text;
  for (const name of names) out = out.replace(new RegExp(escapeRegExp(name), "gi"), "[redacted]");
  return out
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]")
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, "[redacted phone]");
}
```

Nomination title: `${deidentify(project.title, project)} (writer-rated ${score}/100)` degrades to `[redacted] (writer-rated 85/100)`. That is the intended trade — the title is injected into drafting prompts as an exemplar label, so it cannot carry the client's project name.

The privacy instruction appended to both digest prompts, one bullet in the existing voice: `- Never carry a company name, person name, project title, email address, or phone number from the events into a rule. The events are already de-identified on a best-effort basis; if an identifier survives, write the rule generically instead.`

## Verification

**Commands:**
- `npx vitest run convex/lib/deidentify.test.ts convex/learning.test.ts convex/brainFeedback.test.ts convex/generationLifecycle.test.ts` -- expected: all pass.
- `npx vitest run --config vitest.component.config.ts src/routes/admin/reviews/reviewsPublishGate.component.test.ts` -- expected: both cases pass (needs `npx playwright install chromium` once).
- `npm test` -- expected: full backend suite green.
- `PUBLIC_CONVEX_URL=placeholder npm run check` -- expected: 0 errors.
- `git diff --name-only` -- expected: no `convex/chatV2.ts`.

**Manual checks (if no CLI):**
- `/admin/reviews`: the publish button for each digest kind is disabled until its privacy checkbox is checked, and the checkbox clears after a successful publish.


## Auto Run Result

Status: done
Blocking condition: none

### What this pass was

A follow-up review pass on an already-`done` spec (fresh four-layer review over
the full diff since `8aa8be3d84bed5a936647c717c8f6a45c4b32d39`). No
re-implementation; two patches applied on top of the shipped change.

### Implemented change

De-identification of client prose before it enters firm-wide knowledge (CAP-1):
a pure `deidentify(text, project)` helper, applied at the `brainSources` and
`sectionEditEvents` write sites and on the proposal-edit digest read path, a
privacy instruction in both digest system prompts, and a `privacyReviewed`
precondition on the mutation that publishes a digest, surfaced as a per-kind
administrator checkbox.

### Files changed (this pass)

- `convex/lib/deidentify.ts` — phone pattern: bare form requires one consistent separator (backreference); lookbehind also refuses a leading ".". Mixed-separator numeric ranges survive.
- `convex/lib/deidentify.test.ts` — new case: mixed-separator ranges/measurements untouched, consistent-separator phones still redacted.
- `convex/brain.ts` — removed the dead post-scrub `content.trim()` guard in `nominateFromReport`.

Files changed by the story overall are unchanged from the previous result:
`convex/lib/deidentify.ts` + test, `convex/brain.ts`, `convex/generations.ts`,
`convex/learning.ts` + test, `convex/ai/learning.ts`,
`convex/brainFeedback.test.ts`, `convex/generationLifecycle.test.ts`,
`src/routes/admin/reviews/+page.svelte`, `src/routes/admin/reviews/reviewsPublishGate.component.test.ts`.

### Review findings breakdown

- Patches applied: 2 (medium 1, low 1) — see the triage log entry above.
- Items deferred: 0 new. Every pre-existing gap the reviewers re-raised (historic raw rows, the other three digest streams, the `writer_feedback` and `ingestion.ts` Brain paths, the docs contract) is already in `deferred` / the ledger (DW-42).
- Items rejected: 23. Recurring themes, each adjudicated by the intent: partial-token and whitespace-split name matching, international phones and URL hosts (`Always`: false negatives acceptable); per-version rather than per-kind checkbox and keeping it checked after a failed publish (`Always`: per digest kind, resets after a *successful* publish); recording the attestation on the ledger row (`Never`: no schema field); the collapsed `[redacted] (writer-rated N/100)` label (Design Notes: intended); `writerName` stored raw on the `brainSources` row (firm staff, drives writer-tier weighting, not a client identifier, pre-existing); `projectNumber` not in the identifier set (intent enumerates six fields); a stopword list for common-word titles (model-free, project-record-driven by design); component suite outside CI (pre-existing repo convention); `PRIVACY_RULE` unpinned by a test (static prompt text, accepted residual); shared `knownNames` helper with `research.ts` and per-row regex memoisation (refactors outside the change); `cap` vs `.slice` on the ghost patch (pre-existing shape); tooltip on the disabled button (cosmetic); a changelog entry (the in-app changelog is pipeline-generated from commits per `docs/changelog-guidelines.md`); idempotent same-digest re-selection now needing the flag (intent: gate applies whenever `digestId` is non-null).

### Follow-up review recommendation

`false`. Patched findings this pass: high 0, medium 1, low 1. Score = 3 × 1 + 1 × 1 = 4, below the threshold of 5, and no patched finding was high severity.

### Verification performed

- `bash scripts/loop-verify.sh` — rc=0: convex `tsc --noEmit`, `npm run check` (0 errors), `npm test` (124 files, 1255 tests passed), both client-uploader harnesses (50/0 and 18/0).
- `npx vitest run convex/lib/deidentify.test.ts convex/learning.test.ts convex/brainFeedback.test.ts convex/generationLifecycle.test.ts` — 4 files, 78 tests, all pass (one new).
- `npx vitest run --config vitest.component.config.ts --no-file-parallelism src/routes/admin/reviews/reviewsPublishGate.component.test.ts` — 3 tests pass.
- Regex probe before/after the patch: "500-600 1000 times", "100-200 3000 cycles", "v2.100 200 3000" were redacted before and survive now; "(613) 555-0134", "613-555-0134", "613 555 0134", "613.555.0134", "+1 613 555 0134", "613-555-0134x22" redact in both.
- `git diff --name-only` against the baseline — `convex/chatV2.ts` absent; every changed file appears in the Execution task list or is this spec / the ledger.

### Residual risks

- A phone written with two different separators ("613-555 0134") is no longer redacted; a run such as "100-200-3000" or "100.200.3000" still is. Both are accepted trades under the intent's false-negative clause and the exemplar-preservation goal.
- De-identification remains regex- and project-record-driven and best-effort: identifiers not on the project record survive. `PRIVACY_RULE` in both digest prompts is the compensating control and is not pinned by a test.
- Forward-only for `brainSources` and `sectionEditEvents`; three other free-text digest streams and two other Brain import paths remain unscrubbed. All recorded in `deferred` / the ledger.
- The component suite that pins the admin-side gate does not run in CI; the server-side refusal is covered by `convex/learning.test.ts`, which does.
