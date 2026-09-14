---
title: 'DW-114 Brief transcript disagreement reconciliation'
type: 'bugfix'
created: '2026-09-14'
status: 'done'
baseline_revision: '750842f5897deacd04ba15519a6aa640a8660fce'
baseline_commit: '750842f5897deacd04ba15519a6aa640a8660fce'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - 'convex/_generated/ai/guidelines.md'
  - '_bmad-output/specs/spec-pd-generation/SPEC.md'
warnings: []
deferred:
  - summary: >-
      Frozen-source truncation metadata does not reach the Brief request; reconcile this completeness signal with pending allocation work before assigning a separate residual.
    evidence: |-
      At the implementation baseline and current source, generationSources carries truncated/originalLength, but convex/ai/brief.ts buildBriefUserMessage accepts and emits label, content, and kind only. Capture truncation is set in convex/generations.ts:472-532. Acceptance queue commit 09b2403c93dcc36967f71e534a12b6db841f98cd finding 1/story 8 owns bounded allocation, truthful inclusion, and frozen-offset preservation. That action is related but not identical to emitting capture-truncation metadata, so exact ownership of this narrower signal is unproven. Reconcile the same claim and required action before treating it as separate work. The queue is integrated only after this sweep; no queue or ledger entry was changed here. Evidence: .audit/DW-114/followup-convergence-20260914/residual-ownership.json.
    location: >-
      convex/ai/brief.ts:264
    severity: medium
  - summary: >-
      Brief evidence can forge raw request delimiters; repair remains owned by existing acceptance story 8/finding 2.
    evidence: |-
      Acceptance queue commit 09b2403c93dcc36967f71e534a12b6db841f98cd triage finding 2 and stories.yaml story 8 specify the same claim and required action: reuse established label sanitization and evidence-marker neutralization while retaining quote offsets against frozen originals. Root revalidation .audit/complete-local-20260914/queue-revalidation-bb4908f.md confirms this remains pending. DW-114 retains the existing raw evidence assembly and does not discharge that acceptance work. This is an existing-owner reference, not a new ledger entry or ownership assignment. Evidence: .audit/DW-114/followup-convergence-20260914/residual-ownership.json.
    location: >-
      convex/ai/brief.ts:271
    severity: high
---

<intent-contract>

## Intent

**Problem:** The Generation Brief prompt classifies evidence confidence generically, but it does not tell the model how to reconcile three or more Transcripts. CAP-1 therefore lacks proof that agreements become one defensible Storyline while unresolved contradictions remain separately cited rather than averaged or silently resolved.

**Approach:** Add explicit multi-Transcript reconciliation rules to the Brief system prompt, then prove them through the real Anthropic SDK request and response boundary with only HTTP transport stubbed. Persist representative agreement and disagreement entries through the existing derivation and citation-validation path.

## Boundaries & Constraints

**Always:** Produce one Storyline from supported agreements; keep materially conflicting claims as separate `unresolved` Confidence Map entries with one exact source quote each; preserve source-by-source traceability; discard and count fabricated quotes; keep the current Brief schema, single-call budget, source bounds, and 12-document context cap unchanged; retain raw command stdout and stderr plus actual exit receipts under `.audit/DW-114/`, bound to revisions and source hashes.

**Block If:** Correct reconciliation requires a schema migration, more provider calls, a context-cap change, or a product-policy decision not present in CAP-1.

**Never:** Invent a resolution or citation, average incompatible claims, call a live provider in tests, mutate report prose, edit the deferred-work ledger, alter `convex/_generated/`, push, or deploy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Three-Transcript reconciliation | Three frozen Transcripts agree on the project objective but report incompatible measurements | One coherent Storyline; agreement is retained; each competing measurement is a separate `unresolved` Confidence Map entry citing its own Transcript verbatim | No conflict is averaged, selected without justification, or omitted |
| Fabricated citation | Provider response includes one quote absent from all frozen sources | Valid cited entries persist; the invented entry does not; the Brief drop count increases | Derivation continues through the existing fail-open citation filter |
| Request contract | Real SDK serializes the Brief request through a stubbed HTTP transport | System prompt includes the reconciliation rules; all three delimited source blocks, forced tool schema, and 8192-token budget reach the request | Any unexpected network access fails the test |

</intent-contract>

## Code Map

- `convex/ai/brief.ts:141` (`BRIEF_SYSTEM_PROMPT`): add the missing three-or-more-Transcript reconciliation instructions. Reuse `runBriefAgent`, `buildBriefUserMessage`, and `deriveOrReuseBrief`; their existing schema validation and citation filtering remain authoritative.
- `convex/ai/brief.ts:485` (`deriveOrReuseBrief`): read-only implementation anchor for model call, exact `citeQuote` resolution, fabricated-entry counting, and persistence. No new reconciliation mechanics belong here.
- `convex/ai/structured.sdk.test.ts:42`: reusable real Anthropic SDK boundary pattern. Keep SDK serialization and application decoding real; stub only `globalThis.fetch`.
- `convex/ai/brief.test.ts:154`: reusable project, generation, source, persistence, and byte-match fixture patterns. Do not reuse its globally mocked Anthropic client for the boundary proof.
- `convex/ai/brief.sdk.test.ts`: new focused regression covering one real Brief HTTP request/response, three frozen Transcript blocks, persisted reconciliation entries, exact source binding, and a dropped fabricated quote.
- `convex/generations.ts:1555`: read-only Brief source and entry bounds. Assert or inspect that the change does not alter them.
- `convex/ai/promptScaffolds.test.ts:178`: read-only context-budget contract, including `maxDocuments: 12`.
- `.audit/DW-114/`: ignored owning audit directory for decisions, raw baseline/focused/full-gate logs, exit receipts, revision and source hashes, review prompts, actual CLI headers, and results. Any derived scoreboard must be labeled `summary`.
- `_bmad-output/implementation-artifacts/deferred-work.md`: orchestrator-owned and read-only.

## Tasks & Acceptance

**Execution:**
- [x] `.audit/DW-114/decisions.tsv` and evidence receipts: capture the clean baseline revision and hashes, every consequential decision, raw stdout/stderr, and actual command exit codes before and after implementation.
- [x] `convex/ai/brief.sdk.test.ts`: add the failing three-Transcript real-SDK regression first and capture its baseline failure before changing production code.
- [x] `convex/ai/brief.ts`: add explicit reconciliation rules using the existing one-quote-per-entry Confidence Map representation.
- [x] `convex/ai/brief.sdk.test.ts`: run and capture focused post-fix proof that the same regression passes through HTTP serialization, SDK decoding, derivation, persistence, and byte-level citation validation.
- [x] `scripts/loop-verify.sh`: run the canonical full gate and retain its raw output and exit receipt at the post-fix source hash.

**Acceptance Criteria:**
- Given three frozen Transcripts with shared facts and incompatible measurements plus a representative reconciled provider response, when the Brief is derived through the real SDK request/response boundary with HTTP transport stubbed, then exactly one generation Brief stores the supplied Storyline, agreements, and every competing claim without altering or averaging them.
- Given conflicting claims from different Transcripts, when Confidence Map entries are persisted, then each unresolved claim cites the exact originating frozen source bytes and no citation is invented or reassigned.
- Given a provider response containing a fabricated quote, when derivation validates citations, then that entry is discarded, the drop is counted, and valid reconciliation entries remain.
- Given the completed change, when the focused test and `bash scripts/loop-verify.sh` run, then both exit successfully and their raw streams, actual statuses, revision, and source hashes are retrievable under `.audit/DW-114/`.
- Given the final diff and invocation/native ownership snapshots, when inspected, then Brief schemas, provider-call count, source limits, context budgets, report-prose mutation policy, and generated files are unchanged from the implementation baseline, and orchestrator ledger bytes are unchanged from the invocation/native snapshots.

## Spec Change Log

## Review Triage Log

### 2026-09-14 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 2, medium 7, low 1)
- defer: 0
- reject: 3: (high 0, medium 2, low 1)
- addressed_findings:
  - `[high]` `[patch]` Added authoritative source-kind tags to every evidence delimiter and tested custom labels that do not contain the word Transcript.
  - `[high]` `[patch]` Preserved defensible complementary single-source facts instead of restricting the Storyline to consensus-only facts.
  - `[medium]` `[patch]` Limited separate agreement rows to materially distinct passages and prohibited duplicate identical quotes from implying unique source attribution.
  - `[medium]` `[patch]` Distinguished ordinary unresolved disagreement from independently evidenced source unreliability.
  - `[medium]` `[patch]` Defined explicit correction and retraction handling without inferring resolution from recency or plausibility.
  - `[medium]` `[patch]` Made all conflicting measurements refer to the same run and configuration.
  - `[medium]` `[patch]` Removed an unsupported claim about the team retaining evidence from the fixture Storyline.
  - `[medium]` `[patch]` Strengthened agreement assertions to require the expected text, exact quote, source ID, and content hash for each source.
  - `[medium]` `[patch]` Strengthened contradiction assertions to require the intended claim, exact quote, source ID, and content hash together.
  - `[low]` `[patch]` Pinned the request budget independently to the literal value `8192`.

### 2026-09-14: Follow-up review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 0, medium 5, low 6)
- defer: 0
- reject: 4: (high 0, medium 2, low 2)
- addressed_findings:
  - `[medium]` `[patch]` F1: aligned the introductory unreliable definition with the ordinary-disagreement rule.
  - `[medium]` `[patch]` F2: compare measurement scope, run, configuration, time, and units before classifying contradictions.
  - `[medium]` `[patch]` F3: apply corrections only to their claims and retain remaining unresolved alternatives; retractions supply no replacement fact.
  - `[medium]` `[patch]` F4: prefer unique contextual quotes, acknowledge attribution ambiguity, and verify a repeated full measurement with reversed source order.
  - `[low]` `[patch]` F6: renamed and documented the SDK regression as prompt serialization and representative-response persistence.
  - `[low]` `[patch]` F7: asserted the operative correction and non-inference instructions in the serialized request.
  - `[low]` `[patch]` F8: removed a tautological Storyline assertion and documented the cited-entry filtering boundary.
  - `[medium]` `[patch]` F9: asserted one generation Brief and its generation association separately from atomic Storyline claims, including claim provenance.
  - `[low]` `[patch]` F10: documented newly derived Brief applicability and unchanged reuse behavior.
  - `[low]` `[patch]` F11: replaced the obsolete empty-ledger-diff check with authorized invocation/native snapshot equality.
  - `[low]` `[patch]` F13: source attribution wording now includes the originating evidence block, preserving document and digest eligibility.

Full current-pass dispositions and review artifact pointers: `.audit/DW-114/followup-local-20260914/triage.md`. Four Astra xhigh review CLI receipts have exit 0; the owning lead performed triage directly.

### 2026-09-14: Convergence review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 4, low 1)
- defer: 2: (high 1, medium 1, low 0)
- reject: 10: (high 0, medium 2, low 8)
- addressed_findings:
  - `[medium]` `[patch]` Reject withdrawn or discredited corrections as a basis for resolving a conflict.
  - `[medium]` `[patch]` Keep disputed corrections and unsupported cross-source accusations unresolved without inventing an authority hierarchy.
  - `[medium]` `[patch]` Retain Storyline uncertainty where a valid correction still has conflicting alternatives.
  - `[medium]` `[patch]` Persist and verify the objective and all three measurement claims with exact source IDs, hashes, excerpts, and offsets.
  - `[low]` `[patch]` Measure ledger preservation against invocation/native snapshots while preserving the existing bytes.

All four required reviews ran as Astra xhigh with exit 0. Sol high implemented the four source/test patches and ran their red/green proof. The owning lead performed triage and verified the resulting artifacts. Current-pass details: `.audit/DW-114/followup-convergence-20260914/triage.md`.

Residual ownership was checked against acceptance queue commit `09b2403c93dcc36967f71e534a12b6db841f98cd` and the root revalidation snapshot. Existing source-allocation and delimiter findings 1 and 2 remain with story 8; basis-link finding 18 remains with story 11. The narrower capture-truncation signal has related allocation work but no proven identical-action owner. Structured retries are the existing human-corrected story 1 two-attempt-repair policy, so no new retry defect or deferral was recorded. No existing ledger entry was edited and no acceptance claim was discharged.

## Design Notes

The current schema stores one quote per Brief entry. Multiple sources are therefore represented by separate Confidence Map rows, including competing claims and any agreement that needs independent source traceability. This preserves existing persistence and UI contracts without a migration.

The regression proves serialized prompt instructions and persistence of a representative provider response through the real SDK, citation filter, and Convex path. It does not evaluate live model reasoning or enforce semantic correctness of arbitrary provider prose. Fabricated-entry filtering applies to cited entries; this change does not sanitize free-form Storyline text. New prompt rules apply when a Brief is newly derived; existing unchanged-input Brief reuse remains intact.

The existing structured-output policy permits two attempts when tool output needs repair. The one-request SDK assertion exercises a successful first response; this change adds no provider attempts and preserves the accepted story 1 repair policy.

## Verification

**Commands:**
- `npm test -- --project convex convex/ai/brief.sdk.test.ts`: baseline expected to fail before the prompt edit, then focused expected to pass after it.
- `bash scripts/loop-verify.sh`: expected to pass all canonical browser-free steps.
- `git diff --check`: expected to report no whitespace errors.
- `git diff 750842f5897deacd04ba15519a6aa640a8660fce -- convex/_generated convex/schema.ts convex/generations.ts convex/ai/promptScaffolds.test.ts package.json package-lock.json`: expected to be empty.
- Compare `_bmad-output/implementation-artifacts/deferred-work.md` byte-for-byte with `.audit/DW-114/followup-local-20260914/invocation-deferred-work.md` and the native accepted snapshot. Expected SHA256: `8e6407484bd92465a414e26cb16db7266b7554b612a0d7874faadc2bb9f2a20c`. This existing engine-written closure may be staged unchanged at finalization; ledger status is not verification or final native acceptance.
- No `sprint-status.yaml` exists in this owning checkout; do not create or alter one.

## Auto Run Result

Status: done. Local implementation and required review/verification are complete. Native final acceptance and the separate acceptance queue remain pending.

- Implemented change: reused the existing multi-Transcript reconciliation implementation, then qualified corrections so disputed, withdrawn, or discredited claims cannot silently settle a conflict. The Storyline retains uncertainty where alternatives remain.
- Files changed in this pass: `convex/ai/brief.ts` refines the correction instructions; `convex/ai/brief.sdk.test.ts` verifies their real SDK serialization and four exactly cited Storyline claims; this spec records current review, proof, and residual ownership.
- Review: four Astra xhigh layers completed successfully. Five patches were applied (0 high, 4 medium, 1 low), two pre-existing observations were deferred through this spec, and ten findings were rejected. Patch-only follow-up score: `3 * 4 + 1 = 13`; `followup_review_recommended: true`. No high-severity defer contributes to that score.
- Verification: the strengthened focused regression failed before the prompt repair (exit 1), then passed both tests (exit 0). `bash scripts/loop-verify.sh` passed all nine steps: 188 files, 2,679 tests, successful check/build, and uploader harnesses 93/47. Raw stdout/stderr, actual exit receipts, source hashes, and invariant results are retained under `.audit/DW-114/followup-convergence-20260914/verification/`. Prior matching receipts were inspected before the repair; the final claims above use fresh post-repair executions.
- Revision binding: test receipts name precommit HEAD `23ef3958fa979db7002c6ac447ab0411568a14e0` and production/test SHA256 values `d56e6ed27f2747da9b8488b683276fcc5fddb6c1a1ee1775e42b345c04f7d548` and `6b733aee7dc37229c5eb365e2b8409fe17e58d6dbcaa49c895f17d42fbb55885`. The final local commit is recorded by `.audit/DW-114/followup-convergence-20260914/finalization.json` after commit.
- Ownership: ledger SHA256 remains `8e6407484bd92465a414e26cb16db7266b7554b612a0d7874faadc2bb9f2a20c`, matching invocation/native snapshots. No ledger entry or sprint status was authored, reopened, rewritten, or reverted. The reviewed acceptance queue was inspected read-only and was not integrated.
- Residual limits: the HTTP-stubbed test proves prompt delivery and representative-response persistence, not live model reasoning. Free-form derived narrative validation, source allocation, delimiter neutralization, and Storyline basis links remain separate acceptance work. Ambiguous identical passages cannot establish unique provenance without distinguishing context. Existing Brief reuse and structured-output retry behavior remain intact. No push or deployment was performed.
