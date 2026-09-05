# DW-43 independent review triage

All three independent Astra medium layers returned before triage. Raw responses are retained in findings-blind-hunter.md, findings-edge-case-hunter.md, findings-verification-gap.md. Edge case returned no findings. Verification gap returned no findings after inspecting runtime logs and confirming no production menu diff.

| Blind finding | Severity | Category | Disposition and evidence |
|---|---|---|---|
| 1. toEqual permits undefined properties | low | patch | Payload comparisons now use toStrictEqual, enforcing omission of reviewDecision on unrelated edges. |
| 2. Exactly-one-call assertion precedes close | low | patch | Assert call count after the dialog is absent for all successful initial submissions. |
| 3. Pending/repeated-click coverage | low | reject | This ticket proves reviewDecision construction and existing outcomes; it introduces no concurrency control. Pending double-click prevention is not an acceptance claim, and expanding existing dialog concurrency policy is outside this verification gap. |
| 4. No successful retry after rejection | low | patch | Retry the real unchanged selected destination and retained note; assert closed dialog, two total calls and identical retry payload. This strengthens the existing error scenario without new product behavior. |
| 5. Configured error cannot be cleared narrowly | low | patch | Setting a result now clears the same function's configured failure. The recovery test executes that behavior without resetting query state. |
| 6. Every test uses version 7 | low | reject | The frozen contract explicitly chooses version 7; tests compare the real captured payload. An arbitrary future hardcoded 7 is speculative rather than an actual gap in proving DW-43. No revision-pinning or expanded OCC coverage is claimed. |
| 7. Every test uses project-1 | low | reject | The real component gets project-1 as its prop and its payload is asserted. Arbitrary hardcoded-ID mutation enumeration is not the reported missing decision bridge. |
| 8. No whitespace-only note | low | reject | Contract requires a normalized supplied note, which the return test checks with padded input, and unchanged unrelated empty-note payload. Exhaustive note normalization is existing dialog/backend behavior outside this gap. |
| 9. Selected Edits not asserted after rejection | low | patch | Assert aria-checked=true before retry; identical retry payload additionally proves destination preservation. |
| 10. Restricted-authority case absent | low | reject | Tests use the real permission-driven option generator with the owner input in the frozen matrix. They do not claim exhaustive authorization coverage; this ticket changes no authority policy. |
| 11. Raw evidence absent from supplied diff | low | reject | This is an explicitly scoped reviewer visibility caveat, not an absent artifact: before-new-test-mutant.log, before-existing-suite-mutant.log, targeted-after.log and full runtime logs were retained before review. The independent verification reviewer inspected them. Evidence remains included in the audit commit, with mocked transport limitations explicit. |

No intent gap, bad spec, or confident incidental defect requiring a deferred ledger entry. No ledger or native state changed.

The browser tests exercise real production menu/dialog code with mocked Convex transport. Dialog closure, selected destination, retained note and server explanation are visible component outcomes. They do not prove deployed persistence, notifications rendered by the app shell, or live-backend end-to-end behavior. Separate convex-test suites exercise backend mutation contracts.
