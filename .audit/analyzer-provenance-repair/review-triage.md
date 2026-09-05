# Independent review triage

All three Astra medium layers were dispatched and returned by the coordinating task before this triage. Raw findings are retained as findings-blind-hunter.md, findings-edge-case-hunter.md, and findings-verification-gap.md. Edge-case and verification-gap layers returned no findings.

| Blind finding | Severity | Category | Resolution |
| --- | --- | --- | --- |
| 1: single omitted selection | low | reject | Candidate fallback is inherited, unchanged policy; this repair discloses it using the existing MODEL constant. Full selection/fallback matrix expansion is beyond the observed compare disclosure defect. |
| 2: iterative omitted selection | low | reject | Same unchanged candidateModelsForMode behavior. New action coverage proves selected iterative routing; source inspection of candidateModelsForMode confirms the inherited fallback. No new runtime fallback branch is introduced. |
| 3: additional selected models | low | reject | Existing tests already observe default compare MODEL versus selected opus plus both distinct legacy candidates after finding 4. Parameterizing every mode/model combination is broader policy coverage. |
| 4: second legacy candidate | low | patch | Parameterized real legacy candidate action test over both candidate indices, distinguishing queued candidate model from generation selection. |
| 5: selected gateway mode | low | reject | No transport or selection behavior changes. Existing gateway compare coverage remains; additional single/iterative gateway integration is broader than a descriptor repair. |
| 6: iterative swallowed downstream failure | low | patch | Added generation running state, persisted parsed analysis, and exact initial section scheduling assertions after the real action. |
| 7: one-candidate compare retry | low | reject | Retry policy unchanged and model rule explicitly keys on candidateMode in pipeline.ts:676. No candidate-count logic introduced by this metadata-only repair. |
| 8: missing candidateMode | low | reject | Legacy normalization is unchanged upstream of the disclosed mode rule. Legacy queued analyzer compatibility is covered by both candidate action tests. |
| 9: runtime model selections and hash | low | reject | The deployment manifest is a module-level object with no runtime input arguments; hash accepts that object only. Production routing is untouched. Existing canonical/runtime-exclusion and real entry tests pass, so action wrapping would add redundant coverage without exposing a change-caused gap. |
| 10: immutable source fingerprint | low | patch | Added SHA-256 fingerprints of each production/test changed file before final review gates, with explicit exits and a post-commit comparison. |

Totals: intent_gap 0, bad_spec 0, patch 3 low, defer 0, reject 7 low. No ledger edits required. Follow-up score 3; no follow-up review recommended.
