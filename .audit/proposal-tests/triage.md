# BMAD review triage

All three independent layers were read before triage. Edge and verification-gap duplicate blind finding 1 (same claim/action). Production behavior and permissions remain unchanged. No new deferred implementation defects were established, and the root prohibited ledger/status edits.

| Blind finding | Severity | Route | Resolution |
| --- | --- | --- | --- |
| 1 Cross-paragraph ambiguity lost | medium | patch | Restore two original cross-paragraph cases; retain same-paragraph cases too, for both uniqueness modes. Full report/proposal/snapshot/event state equality remains. |
| 2 Candidate wording absent from proposal | medium | patch | Seed exact rejected candidate wording before attempting to use it as canonical target. This sharpens the existing advertised scenario. |
| 3 Save mutation boundary underasserted | medium | patch | Compare complete pinned and newer report documents plus snapshots before/after successful save. |
| 4 Save associations/returned ID omitted | medium | patch | Match returned proposal ID, project, report, target and replacement on the inserted row. |
| 5 Open/closed assignment additional coverage | low | reject | No original assignment-path cases were lost. This is additional capability coverage outside bounded restoration; approved ownership policy already explains the necessary stale-expectation correction. No production defect demonstrated. |
| 6 Replacement chain ordering | low | reject | Original independent replacement-list scenario and its exact output/count remain. Rewriting to a chain would change the legacy scenario rather than restore a lost assertion; no new ordering algorithm introduced. |
| 7 Additional wording attribution fields | low | reject | Original event checks (proposal, original text, edited text) retained. Additional audit-field matrix is pre-existing coverage expansion, not a demonstrated migration loss. |
| 8 Successful replacement wording | low | reject | Original edit success and replacement-target rejection both retained. Matrix wording describes these paths; no new replacement success requirement or production defect established. |
| 9 Newer report complete equality | medium | patch | Compare complete newer report before/after apply in shared success helper. |
| 10 Multi-transcript ordering fixture | low | reject | Three existing lineage expectations corrected to actual ordered-set return shape without changing their single-transcript inputs. New multi-transcript scenario is outside legacy restoration and no ordering code changed. |

Final spec remains in-review by root instruction. Full gate/typecheck is explicitly held, not passed. Parent will verify the exact candidate in its final integrated native gate.
