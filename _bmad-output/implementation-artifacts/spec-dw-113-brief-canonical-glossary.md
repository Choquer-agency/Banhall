---
title: 'DW-113 Canonical glossary identity with exact citation excerpts'
type: 'bugfix'
created: '2026-09-14'
status: 'done'
baseline_revision: 'f5f27ae1dcbaf0cf3712530ffbf4bd1212561112'
baseline_commit: 'f5f27ae1dcbaf0cf3712530ffbf4bd1212561112'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - 'convex/_generated/ai/guidelines.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Rule-matched Generation Brief glossary entries store the matched source surface in `text`, while model-classified entries store the canonical term. Inflections therefore produce inconsistent stored identities even though both paths retain source citations.

**Approach:** Carry the matcher-provided canonical identity into rule-path Brief entries and keep the exact matched surface solely in the citation fields. Prove the distinction through the persisted Brief boundary for an inflected rule match, while retaining the existing synonym-classification citation proof.

## Boundaries & Constraints

**Always:** Treat `MatchedTerm.canonicalTerm` as the rule match's canonical identity and `MatchedTerm.text` as its exact source excerpt. Preserve source id, content hash, offsets, byte-for-byte citation validation, first-match deduplication, and the existing model-classified synonym behavior. Record the regression failing before the production fix and passing afterward.

**Block If:** The persisted Brief contract requires rule-path `text` to preserve the surface form, or canonical identity cannot be carried without changing schemas or citation validation.

**Never:** Change the deferred-work ledger, generated Convex files, glossary casing policy, matching or deduplication rules, model classification eligibility, existing Brief rows, or add a backfill. Do not address empty glossary-term hangs or Unicode case-folding concerns in this bundle. Do not push or deploy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Rule exact match | Canonical term appears verbatim in a frozen source | Persist one glossary entry whose `text` is the canonical term and whose citation excerpt is the exact source slice | Existing citation validation remains authoritative |
| Rule inflection | Canonical term `algorithm` is supplied with inflection `algorithms`, and only `algorithms` appears in the source | Persist `text: "algorithm"`; retain `exactExcerpt: "algorithms"` with offsets that slice to `algorithms` | Drop behavior remains unchanged if citation validation fails |
| Model synonym | A flagged canonical term is classified from a different quoted phrase | Persist the canonical model term while retaining the quoted synonym as the exact excerpt | Fabricated or absent quotes continue to be omitted or counted by existing behavior |

</intent-contract>

## Code Map

- `convex/lib/glossaryMatcher.ts:16-24,40-123` provides both identities already: `canonicalTerm` is the normalized glossary identity and `text` is the source surface with offsets. Reuse it unchanged.
- `convex/lib/glossaryMatcher.ts:139-180` deduplicates and flags by canonical identity. This is read-only evidence that no matcher or classification change is needed.
- `convex/ai/brief.ts:537-550` maps rule matches into persisted candidate entries. Its `text` assignment is the defect; its citation fields must continue to describe `match.text`.
- `convex/ai/brief.ts:560-587` is the model-classified synonym path and the consistency reference. Preserve it.
- `convex/ai/brief.test.ts:79-108,213-327` owns the real pipeline-to-persisted-Brief integration coverage. Extend it with a rule-matched inflection and exact source-slice assertions; retain the existing model synonym proof.
- `convex/lib/citations.ts:48-85` and `convex/generations.ts:1965-1989,2056-2088` enforce and persist citation bytes. Read-only evidence; no schema or persistence changes are needed.
- `_bmad-output/specs/spec-pd-generation/stories/1-generation-brief-storage-and-derivation-stage.md:101-109` is the original deferred finding. Read-only; the native orchestrator owns its ledger state.

## Tasks & Acceptance

**Execution:**
- [x] `convex/ai/brief.test.ts` -- make the rule-path integration fixture use an inflected source form, assert canonical stored `text`, exact surface `exactExcerpt`, and matching source slice; run the focused test before the production change to capture the baseline failure -- prove the observable storage and citation contract at the outermost affected boundary. Evidence qualification: the original failure and initial focused results are attributable historical reports; no raw failing `CommandExecution` or exact original pre-fix fixture was inspected, and the directly inspected parent focused pass predates the later assertion patch.
- [x] `convex/ai/brief.ts` -- map rule-matched glossary entry `text` from the existing canonical identity while leaving citation data derived from the matched surface -- make rule and model paths consistent without weakening citations.
- [x] `.audit/brief-canonical-glossary/decisions.tsv` and `.audit/brief-canonical-glossary/evidence.md` -- record decisions, historical failure and focused-pass reports with their raw-capture limits, source-matching native gate receipts, acceptance mapping, implementation revision `c037b41fc001cbb2c4131e764b3e26812d086b6c`, and accepted worker revision `281455fae90c5e95a23807f91087766e76ebde11`.

**Acceptance Criteria:**
- Given a generated Brief whose canonical glossary term has only an inflected form in a frozen source, when the rule matcher derives and persists the glossary entry, then the stored entry names the canonical term and its exact excerpt and offsets reproduce the inflected source bytes.
- Given a generated Brief whose canonical term is classified from a cited synonym, when the classified entry is persisted, then the stored entry continues to name the canonical term and its exact excerpt and offsets reproduce the synonym bytes.
- Given the DW-113 change, when the focused regression and canonical repository verification gate run, then both pass without schema changes, generated-file edits, ledger edits, network deployment, or unrelated matcher behavior changes.

## Spec Change Log

- 2026-09-14: Implemented and verified canonical rule-match identity with exact surface citations; final commit remains with the owning workflow.
- 2026-09-14: Completed fresh Astra review and documentation repairs, bound retained native and parent evidence to their exact scope, and finalized the spec. Native terminal acceptance remains pending.

- 2026-09-14: Completed the second fresh four-layer review with direct owning-lead triage, qualified historical regression evidence, corrected the acceptance-table scope pointer, and reran the focused suite and canonical gate. Native review-entry metadata remains separate from source/evidence mutation.

## Review Triage Log

### 2026-09-14 Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 0
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[low]` `[patch]` Strengthened the changed re-derivation test to require the removed canonical `algorithm` marker and its original `algorithms` citation surface, rather than accepting any removed glossary row.

### 2026-09-14 Fresh review and corrected lead triage
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 3, low 2)
- defer: 0
- reject: 7: (high 0, medium 0, low 7)
- score: 11
- followup_review_recommended: true
- addressed_findings:
  - `[medium]` `[patch]` F07 separated historical review hashes from retrievable fresh review artifacts and recorded prompt, result, receipt, and lead provenance.
  - `[medium]` `[patch]` F08 corrected the attribution boundary: source-matching native receipt reuse does not waive missing raw failing-control evidence.
  - `[low]` `[patch]` F09 added baseline-to-accepted, baseline-to-working-tree, and accepted-to-current protected-scope comparisons, including the original story and excluding the native ledger.
  - `[medium]` `[patch]` F10 labeled the nine-step scoreboard as summarized results and added the retained native stdout tail verbatim with stderr warning context.
  - `[low]` `[patch]` F11 removed the extra blank line at EOF and retained one terminating newline.
- rejected_findings: 7 low-severity suggestions; no application defect or required implementation loopback was established.

### 2026-09-14 Second fresh review with owning-lead triage
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 0
- reject: 8: (high 0, medium 0, low 8)
- score: 4
- followup_review_recommended: false
- addressed_findings:
  - `[medium]` `[patch]` F02 qualified the checked regression task: the original failing control and initial focused results are attributable historical reports, with no inspected raw original failing execution or exact fixture.
  - `[low]` `[patch]` F03 pointed the acceptance table directly to the expanded baseline comparisons, native receipt binding, and separate ledger provenance.

## Verification

**Commands:**
- `npm test -- convex/ai/brief.test.ts` -- expected: the focused Brief integration suite passes, including canonical rule identity and exact citation bytes.
- `bash scripts/loop-verify.sh` -- expected: every numbered canonical verification step passes.
- `git diff --check` -- expected: no whitespace errors.


## Auto Run Result

Summary: Newly derived rule-matched glossary entries persist `match.canonicalTerm` as their identity while their exact excerpt, offsets, source id, and source hash retain the matched surface. The existing implementation and persisted-boundary tests were inspected and reused. This follow-up corrected two documentation claims after four independent Astra xhigh reviews and direct owning-lead triage.

Files changed across the reviewed baseline diff:

- `convex/ai/brief.ts` stores the rule match's canonical identity while preserving the citation surface.
- `convex/ai/brief.test.ts` proves exact, inflected, and synonym persistence and the specific removed canonical marker.
- `.audit/brief-canonical-glossary/evidence.md` qualifies historical evidence, links the expanded scope proof, and binds fresh review and command captures.
- `.audit/brief-canonical-glossary/decisions.tsv` appends the current review, triage, lifecycle, and verification decisions.
- `_bmad-output/implementation-artifacts/spec-dw-113-brief-canonical-glossary.md` records the current review and local result.
- `_bmad-output/implementation-artifacts/deferred-work.md` contains the pre-existing engine-authored close already committed at `4850a170f746f090a28eddee95471b93c14c9bcf`; this follow-up preserved its bytes and index entry.

Review findings: 2 documentation patches (high 0, medium 1, low 1), 0 deferrals, 8 low rejections, 0 intent gaps, and 0 bad specifications. Score: 4. Follow-up review recommended: false. No application-code repair or human decision was required.

Verification: Sol high reran `npm test -- convex/ai/brief.test.ts` (39 passed), `bash scripts/loop-verify.sh` (all nine steps passed, including 2,677 tests), and `git diff --check` (empty output). All returned 0. Before/after hashes matched for all 7,373 tracked entries with no restoration. The retained native receipt also remains bound to the unchanged application source at accepted worker revision `281455fae90c5e95a23807f91087766e76ebde11`. Fresh raw captures and their manifest are under `.audit/brief-canonical-glossary/fresh-review-20260914-2/`.

Residual evidence limits and behavior: The original failing control, its exact original fixture, and the historical post-review-patch focused rerun lack inspected raw execution captures. Their attributable summaries remain reported evidence; the fresh successful commands do not reconstruct that history. Existing reusable Brief rows retain their earlier surface text until a future derivation creates a new Brief. Casing policy, schemas, matching, deduplication, citation validation, and model eligibility remain unchanged. No backfill is included. Local capture paths require retaining this worktree.

Decision-trail audit: A bounded independent Astra xhigh audit returned 0, found no required corrections, and supported the frozen finalization claims. Its result and receipt are retained under `.audit/brief-canonical-glossary/fresh-review-20260914-2/trail-audit.*`; the audit repeated no broad code review.

Native ownership: The native review-entry removal of the previous result section was verified against the committed spec. The earlier F11 whitespace correction remains valid. This run does not establish terminal native acceptance and makes no changes to ledger entries or sprint status. No push or deployment occurred.
