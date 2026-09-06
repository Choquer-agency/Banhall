# Q4 independent review disposition

All three root-dispatched fresh Astra6 medium reviewers completed successfully. The implementer's earlier nested-review error is retained as a failed extra attempt; it did not supply any review. Edge returned [] and gap returned no findings. Root inspected final source/tests, verification hashes and selected retained screenshots.

| Blind finding | Disposition | Reason / evidence |
|---|---|---|
| 1 Newer PD versus displayed report | patch | Reactive replacement review/document/filename test preserves draft and replaces old feedback. Existing component labels Feedback on the explicit source filename; no invented report-review association. |
| 2 Report-present review states | patch | One reactive case covers running, failed, unreadable and completed states beside existing draft. |
| 3 All-role permission matrix | reject / qualify | Seven-line change reuses current callback; requestGeneration retains requireInternalProjectAccess at generations.ts538. No new backend authorization proof or change. |
| 4 Concurrent generation matrix | reject / qualify | Existing callback and reserveGeneration active-generation rejection at generations.ts414-416 remain unchanged. No claim this browser fixture proves backend concurrency. |
| 5 Intake-to-report reactive transition | patch | Real mounted page receives report query update; editor appears and one feedback heading remains. |
| 6 Request rejection and retry | patch | Existing confirmation case rejects first request, observes alert and preserved draft, then confirms successful retry. |
| 7 Cancel event side effect | patch | Both request and generate_from_review event arrays remain empty after Cancel. |
| 8 Full report/long-feedback layout | reject / qualify | Bounded panel reuse, existing layout unchanged; captures cover a short fixture and explicitly disclose phone/default-chat and content-length limits. |
| 9 Individual horizontal containment | partial patch / qualify | Reading helper checks all four bounds for current filename, summary and suggestion. No arbitrary long-filename or general redesign claim. |
| 10 Bottom-scroll heading assumption | patch | Baseline capture retained, then heading explicitly scrolled before visibility assertion. |
| 11 Historical transcript fetch trace | reject / qualify | Assertion/comment now explicitly current active subscriptions; no never-fetched claim or new mock API solely for tracing. |
| 12 View-event lifecycle | patch | Actual once-per-completed-review-per-mount semantics checked across remount and current-ID changes; two legitimate initial/remount events are documented. |
| 13 Stale spec tracking | patch | Root marks implemented tasks complete and done after review acceptance, with verified Suggested Review Order. |
| 14 Independent review outstanding | patch | Three root dispatcher receipts/results completed, with all findings triaged here. |

Acceptance: original regression4 failed/6 passed, then10 passed and full9-step gate2044 unit/499 browser. After verification-only strengthening,11 focused browser tests and Svelte checks pass. Production remains exactly the seven lines that passed the full gate. The combined final gate will include the added lifecycle test. root-evidence-check.json supplements13 directory-symlink targets omitted by the worker's regular-file snapshot. No restoration, domain-policy, permission or AI-prose mutation change.
