# DW-93 current review

Review invocation revision: `a338f6a08274e7a26b3f0195fb15424f7f30a1ed`. The done-spec route retains workflow baseline `bdf5d0e34cdd23dd17f74baf5be5f6d2ca32096d`. The only initial working-copy change was removal of the previous Auto Run Result. The review diff is retained as `review.diff.gz`. Four independent review layers were launched before triage, with the fourth using the first available slot. All completed within this workflow turn.

## Findings and disposition

| Finding | Source | Severity / disposition | Action or evidence |
| --- | --- | --- | --- |
| Staged check omits generated API and both codegen receipts | Blind, edge | medium / patch | Check index equality for every protected path. Six failing normal/optimized regressions reproduce the old false successes in integrity-before.log. |
| Native closure rejection lacks negative tests | Verification, blind | low / patch | Empty and wrong-bundle journal tests run in memory under normal and optimized Python. |
| Invocation metadata rejection lacks negative tests | Blind | low / patch | Add invocation inventory/hash/blob negative tests. |
| Staged branch lacks a clean success case | Blind | low / patch | Add clean --staged case in both Python modes. |
| Unknown or abbreviated arguments bypass intended staged validation | Blind | low / patch | argparse rejects unknown and abbreviated flags; regressions cover both. |
| Finalization command source is not retained | Blind | low / patch | Retain verify-finalization.py and its actual execution log. |
| Historical manifest and receipt lookup lack stable revision binding | Blind | low / patch | Bind earlier review artifacts to canonical commit a338f6a08274e7a26b3f0195fb15424f7f30a1ed in this record and evidence.md. |
| Automate native dispatch predecessor validation | Blind | low / reject | No inconsistent provenance observed. Manually inspected native-dispatch-provenance.json: journal 79/81 precede 123/126, with the exact baseline commit. This read-only evidence task does not require a generalized native journal validator. |
| Automate closure-to-review ordering | Blind | low / reject | Retained native-journal.json line 130 closes this story/DW-93 before matching review dispatch at 131. No incorrect sequence exists in the assessed artifacts. |
| Automate invocation HEAD ancestry check | Blind | low / reject | Existing revision and ancestry verified by Git in provenance-review.log; no unrelated invocation exists. |
| Automate native-task cross-check | Blind | low / reject | Inspected retained task: same story key, DW-93 IDs, baseline and exact flat spec path. No inconsistent task exists. |
| In-review snapshot lacks terminal result while task is checked | Blind, intent | low / reject | Expected intermediate state prescribed by step-04; terminal result and staged spec are checked at finalization. |

Counts after deduplication: intent_gap 0, bad_spec 0, patch 7 (high 0, medium 1, low 6), defer 0, reject 5 (all low). Recommendation score: 3 * 1 + 6 = 9, followup_review_recommended true.

The intent auditor found an evidence-focused handoff consistent with conditional repair and frozen structural coverage. It distinguished native ledger authorship from agent edits and current terminal completion from historical receipts. No production defect or unresolved product choice was identified. The historical ledger diff is already committed orchestrator content, not a change authored or staged during this invocation.

## Independent repair verification

The edge reviewer re-read both repaired Python files and independently ran the integrity suite: exit 0, 44 passed, 0 failed, no additional concrete defect. Parent retained the same result in integrity-after.log. Tests alter only in-memory reads and subprocess results; no protected file is mutated.

Historical review-followup finalization.log and staged-manifest.json describe commit `a338f6a08274e7a26b3f0195fb15424f7f30a1ed`, not this invocation's intermediate spec. Their different spec hash is expected. This pass retains executable finalization checks instead of treating those historical receipts as current proof.
