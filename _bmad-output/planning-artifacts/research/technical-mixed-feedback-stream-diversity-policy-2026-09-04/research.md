---
title: 'technical research: Mixed feedback stream diversity policy'
type: 'technical'
topic: 'Mixed feedback stream diversity policy'
decision: 'Omit underdiverse sources or stop the entire learning digest?'
source: 'Exa, primary web sources, separately identified local code analysis'
status: complete
policy_status: proposed, awaiting user decision
verified_claims: 1
unverified_claims: 4
preset: 'standard, focused scope'
validation: 'normal'
created: '2026-09-04'
updated: '2026-09-04'
---

# technical research: Mixed feedback stream diversity policy

**Decision this research serves:** Omit underdiverse sources or stop the entire learning digest?

**Recommendation: generate an unpublished candidate from qualifying streams, omit underdiverse streams, and show the omissions to the reviewing admin.** Skip generation when the retained inputs fail the existing five-row minimum. Keep the current published guidance until an admin chooses another version.

This is a proposed product decision, not an approved amendment or a resumed loop. Confidence is **medium**: it fits the inspected architecture and avoids an identifiable stall condition, but no production data or comparative quality experiment establishes its outcome advantage. External sources support the available mechanisms, not this application's exact policy.

**The strongest objection is loss of legitimate general feedback.** Banhall [allows feedback without a project](/Users/johnnynguyen/Documents/Repos/Banhall-bmad-completion/convex/brain.ts:617), and the [current prompt](/Users/johnnynguyen/Documents/Repos/Banhall-bmad-completion/convex/ai/learning.ts:211) gives an admin-approved suggested rule special priority, even when it appears once. The [existing test](/Users/johnnynguyen/Documents/Repos/Banhall-bmad-completion/convex/learning.test.ts:548) demonstrates projectless approvals entering a digest. Strict project attribution will remove that path from automatic firm-wide distillation. This is a material behavior change required by the proposed interpretation, not something admin approval can silently bypass.

For example, six eligible comments from two writers across two projects can support a candidate even if one section edit is excluded for insufficient diversity. That lone edit must not influence the prompt, source count, provenance or freshness cutoff.

## What the code and BMAD contract establish

The inspected integration checkout is `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-completion` at `e581d51ca47b0652e0df5221a07ece6f5806333d`. These are local findings, separate from external evidence:

- [CAP-4](/Users/johnnynguyen/Documents/Repos/Banhall-bmad-completion/_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/SPEC.md:38) requires two distinct writers and two projects **per source stream**, exact signal IDs and per-producer counts. It does not say that all streams must contribute.
- [Draft-style generation](/Users/johnnynguyen/Documents/Repos/Banhall-bmad-completion/convex/ai/learning.ts:213) independently loads candidate comments, section edits, proposal wording edits and approved writer feedback. Optional prompt blocks already permit absent streams. The current implementation pools their rows, applies the five-row minimum and checks their newest timestamp. The requested diversity gate is not implemented yet.
- [Input queries](/Users/johnnynguyen/Documents/Repos/Banhall-bmad-completion/convex/learning.ts:31) currently strip source IDs and producer/project attribution from the returned prompt data. Story 4 must carry that metadata separately, gate before model use, and persist exact admitted provenance.
- [Governed storage](/Users/johnnynguyen/Documents/Repos/Banhall-bmad-completion/convex/learning.ts:211) saves immutable candidates and preserves the existing selection. [Publication](/Users/johnnynguyen/Documents/Repos/Banhall-bmad-completion/convex/learning.ts:307) requires admin authority and privacy confirmation. A new candidate is not an automatic change to firm-wide behavior.
- The [paused story](/Users/johnnynguyen/Documents/Repos/Banhall-bmad-learn-chat/.bmad-loop/runs/20260904-133944-0158/worktrees/4/_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/stories/4-digest-diversity-gate-and-signal-provenance.md:73) explicitly records both defensible interpretations. Research confirms that the ambiguity is real.

The architectural distinction matters: this digest proposes learned guidance for review. It is not a reconciliation report promising complete coverage of every source. The inspected code supports that interpretation; it remains an inference about the intended mixed-stream behavior.

## What primary online sources establish

Databricks supports retaining invalid records, dropping them with metrics, or failing an update. Its documented quarantine pattern separates accepted and rejected records. A validation table alone does not gate other downstream tables; that cross-pipeline check needs explicit task dependencies. These are supported choices, not a universal instruction to prefer omission. [1] [2]

AWS Glue independently distinguishes row-level evaluation from dataset-level outcomes and lets an operator configure continuation or job failure. A passing record does not necessarily mean the dataset passed. Applied here, every included stream must still pass its aggregate diversity test, and the final candidate must pass its aggregate row minimum. [3]

NIST treats trustworthiness tradeoffs and thresholds as contextual decisions. It supports representative evaluation and provenance, but does not choose Banhall's policy. Two writers and two projects prove only those counts; they do not prove representative feedback, independent support for every rule, or anonymity. Privacy review remains separate. [4] [5]

The two engineering publishers corroborate the distinction between input validation and failure scope. Transferring those mechanisms to Banhall is an architectural analogy. None of the sources reviewed validates exactly two writers, two projects or five rows as a statistically sufficient sample.

## Comparison and strongest objection

| Criterion | Omit failing streams | Stop if any nonempty stream fails |
| --- | --- | --- |
| Per-included-stream diversity | Preserved if gating happens before prompt construction | Preserved by refusing the whole candidate |
| Six diverse comments plus one isolated edit | Candidate may use the six comments | No candidate |
| Sparse or newly introduced feedback channel | Can accumulate evidence without blocking other channels | Can veto other channels until it qualifies or leaves the window |
| Coverage | Partial coverage must be disclosed | Prevents partial candidates, but does not itself establish representative coverage |
| Existing published guidance | Unchanged pending admin selection | Unchanged because no candidate is created |

These outcomes follow from the proposed policies and inspected control flow; they are not measured production outcomes. Requiring every configured stream, including empty streams, to qualify would impose an even stronger stall condition and is not recommended.

A rare admin-approved correction could contradict a common pattern in raw comments. If its stream is excluded, the model cannot consider that contradiction. Keeping the feedback in its original queue, showing why it was excluded, and retaining the previously published digest makes the tradeoff reviewable. Do not fabricate project IDs, attribute the feedback to its approving admin, or silently exempt that stream. Existing [feedback approval](/Users/johnnynguyen/Documents/Repos/Banhall-bmad-completion/convex/brain.ts:686) can also nominate a pending Brain source for separate curation; this does not make the feedback automatically eligible for the digest.

Whole-candidate rejection would be preferable if Banhall required all modalities for a valid conclusion, or if a mandatory privacy, authorization or integrity check failed for the retained inputs. The current inspected contract does not require every modality. Omission alone cannot settle selection bias; actual candidate evaluation remains necessary. These conditions are analyst conclusions, informed by the distinction between scoped processing and explicit downstream gating. [1] [2] [4]

## Proposed decision and acceptance examples

The concrete decision to record, if accepted:

> Apply existing eligibility and meaningful-signal filters, and exclude rows without attributable producers or projects. Evaluate each stream separately. Include a stream only when its retained rows contain at least two distinct writers and two distinct projects. Omit other streams without deleting their source records. Generate an unpublished candidate only when at least five rows remain overall and the existing freshness and other safeguards pass. Record exactly what was included, and show excluded stream counts and reasons to the admin. Publication remains a separate human action.

The same rule applies to QA's single stream: if it fails diversity, no candidate can be generated. Diverse writers or projects in another stream cannot rescue a failing stream.

| Proposed acceptance case | Required result |
| --- | --- |
| Six comments spanning two writers/two projects; one edit spanning one writer/one project | Distill from six comments only, assuming freshness passes and the model finds a pattern |
| Four qualifying rows plus many rows in failing streams | No model call; excluded rows cannot satisfy the five-row minimum |
| Two streams each individually span two writers/two projects, with five admitted rows together | Eligible for distillation; five is an aggregate minimum, not five per stream |
| Many rows, all attributable to one writer or one project | No candidate from that stream |
| Two individually failing streams appear diverse only when pooled | Both remain excluded |
| Missing producer or project, including approved general feedback | Exclude the affected rows; never count missing values as distinct identities |
| Only excluded feedback becomes newer | No new candidate merely because excluded timestamps advanced |
| A new candidate is saved | Exact admitted source count, signal IDs and producer counts; current publication unchanged |

Implementation details that follow from this proposal belong in story 4's plan: derive prompt inputs, source counts, provenance and cutoff from the same admitted rows; keep provenance IDs out of prose sent to the model; display legacy provenance as unavailable; and test the actual action with a mocked model transport. Adding omitted counts/reasons is a recommended extension of the current admin provenance requirement, not an existing implemented feature.

## Limits and next BMAD step

No production code, SPEC policy, native loop state, commit or remote branch changed during this research. No deployment data was inspected and no implementation test suite was rerun. The acceptance table describes future checks, not passing tests.

The current timestamp-only deduplication can miss changes to which rows are included when those changes do not advance the newest timestamp. Story 4 must preserve current freshness behavior and test eligibility changes; a broader provenance-fingerprint redesign should not be silently folded into this policy decision.

The one outstanding product choice is whether to accept the proposed partial candidate behavior, including exclusion of unattributed/projectless feedback. External research cannot supply that approval. Once chosen, use `bmad-loop-resolve` to record the decision and amend the blocked story, then let the native Astra 6 medium loop implement and verify it. Keep the wider completion, final verification and authorized merge-to-main work pending until the remaining stories pass.

## Source appendix

All external sources were accessed on 2026-09-04. Exa was used for discovery and retrieval; direct web retrieval supplied independent checks. Firecrawl was configured locally but exposed no callable tools in this session and was not used. Search result metadata was checked against primary pages; incorrect Exa date/author metadata for a NIST PDF was discarded. Source excerpts and reasoning are in `digests/`.

| Ref | Supports | Publisher and source | Published/updated | Evidence confidence |
| --- | --- | --- | --- | --- |
| [1] | Explicit drop versus fail mechanisms | [Databricks: expectations](https://docs.databricks.com/aws/en/ldp/expectations) | 2026-07-14 update reported by retrieved page | High for shared pattern with AWS; specific semantics single publisher |
| [2] | Quarantine and explicit downstream dependencies | [Databricks: expectation patterns](https://docs.databricks.com/aws/en/ldp/expectation-patterns) | 2026-07-14 update reported by retrieved page | Medium; unverified independently, same publisher as [1] |
| [3] | Record/dataset distinction; configurable job failure | [AWS Glue: evaluating data quality](https://docs.aws.amazon.com/glue/latest/dg/tutorial-data-quality.html) | Not stated; live documentation read | Medium for specific options, unverified independently; shared pattern verified |
| [4] | Contextual thresholds, representative evaluation, provenance | [NIST: AI risks and trustworthiness](https://airc.nist.gov/airmf-resources/airmf/3-sec-characteristics/) | 2023 AI RMF 1.0 excerpt; revision in progress | Medium; unverified independently, foundational and dated |
| [5] | De-identification needs separate disclosure-risk assessment | [NIST SP 800-188](https://csrc.nist.gov/pubs/sp/800/188/final) | 2023-09-14 | Medium; unverified independently, not a legal opinion |

## Staleness map

Generated from the source-claim ledger with BMAD's `recon_kit.py`; see `staleness.json`. Unknown publication dates are recorded separately and cannot produce a valid publication-based deadline. The 24-month pattern window yields 2028-07-14 for the Databricks sources. The foundational NIST sources are already beyond it, with computed dates of 2025-01-01 and 2025-09-14; they were reread for this run and are explicitly not evidence of a current architecture trend. Earliest computed date: 2025-01-01, already past. Check the in-progress AI RMF revision before reusing this report. AWS has no stated publication date, so check its live page before reuse rather than inventing a deadline. BMAD Refresh/Deepen can update this research.
