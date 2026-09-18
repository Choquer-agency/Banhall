# Reconciliation — prior PRD/spec/spine/code extracts → prd.md

Subagent reconciliation, 2026-09-16. Findings only.

## 1. Glossary discipline

| Sev | Term | Location | Fix |
|---|---|---|---|
| High | "Section" vs inherited "Line" (AD-8 H2s are `Line 242/244/246`) | prd.md §2, FR-2, FR-25 | Keep "Line" for the heading/parse contract, "Section" for the CRA part; say so once. |
| High | "candidate"/"Selection" collide with CandidateMode, generationCandidateRuns, awaiting_selection, selectReportCandidate | §2 Selection; UJ-2 "candidate iterations" | Rename to "Seed Selection"; ban bare "candidate". |
| Medium | "suggestion" vs Seed ("Previous suggestions") | FR-13 | "Previous Batch". |
| Medium | "outline" vs Running Summary; third sense "post-hoc outlining" | §4.1, FR-3, §7 | Define "Outline" as the rail rendering of the Running Summary. |
| Medium | "Subsection" vs "Content role" | §2 | Subsection = UI label; role id canonical. |
| Medium | "Stale" collides with chatProposalItems.state=stale and AD-23 change | §2, FR-17 | "Subsection Stale". |
| Medium | "Summary" vs Subsection #6 "Summarization…" and "Completion Report" | FR-2 | Rename #6 to the code role. |
| Low | "Approve" (Subsection) vs approveSectionDraft | §2, FR-32 | "Subsection Approval" vs "section-draft approval". |
| Low | Mode name aliases | §2 | One entry listing all aliases. |

## 2. Contradictions

Prior PRD §7: (1) gate-only-in-iterative implicit; §10 amends SPEC 106 not 105. (2)(3)(5)(6)(7) explicit. (4) SM-C4 rescope explicit but ID-ambiguous. (8) FR-16 "one experiment per Selection" reintroduces a count — restate as coverage.

Spine §5: (1)(2)(6)(8) explicit. (3) full-width review: no route named. (4) split-pane + rail collision missed in PRD (addendum D only). (5) sticky nav implicit. (7) conditioning vs inputsHash reuse/versioning missed: FR-19 versions Batches but never says whether Batches are keyed/reused.

## 3. Code reality

- High: `sectionEditEvents` starved — `approveSectionDraft` is its only producer; FR-33 does not replace it.
- High: FR-2 renames live role ids (code: "limitations of standard practice (passive uncertainties)", "active uncertainties", "prior-year status (continuing only)", "overall advancement"); FR-2 collapses passive+active.
- Medium: ghost draft retirement ignores that ghost feeds reportEditDistance/reportSnapshots baselines and three lifecycle tests.
- Medium: FR-27 "never reaped" leaves a dead Batch action unrecoverable while generation sits in awaiting_input.
- Medium: FR-16/FR-25 per-Selection Compliance Notes vs rows keyed by section + paragraphIndex.
- Low: FR-19 typed conflict needs a code from the closed domainError list.
- Low: no FR requires de-duplicating the three selector copies.

## 4. ID hygiene

- High: §0 says assumptions indexed in §9; it is §12.
- High: §10 reuses SM-C4 / SM-3 / OQ-5 for 09-09 items while this PRD defines its own. Qualify "(09-09)".
- Medium: Batch defined as immutable call result but FR-12/FR-13 add Seeds to it. Separate "Batch" from "shown set".
- Medium: §7 forbids per-Section prose approval; OQ-2 leaves it open.
- Low: FR-9, FR-31..38 no "Realizes"; SM-1 leaves FR-29..38 unmeasured; FR-3 duplicates FR-37; §6 "Managers and Admins all" untagged.
