# B11 parent review triage

Three fresh Astra6 medium layers completed exit0. Edge returned []; gap found no gaps. Thirteen blind findings evaluated independently.

| Finding | Severity / route | Resolution |
| --- | --- | --- |
| Add live request/failure/confirmation updates | low / reject | The approved fix is three static labels; matrix requires valid ordered historical events rendered by the actual route. No changed subscription or live-update mechanism; broader transition test not a demonstrated defect. |
| Clarify stale failure semantics | low / patch | Evidence now distinguishes retained historical failure from suppressed late failure and cites the executed backend tests at315 and336. No historical evidence or backend code changes. |
| Fixture chronology assertion is not backend ordering | low / patch | Evidence explicitly limits browser proof to preserving supplied order; every actual DOM row is compared, not only fixture data. The separate fixture guard remains useful for valid chronology. Backend descending query is a source witness, not claimed browser execution. |
| Add unresolved/empty audit states | low / reject | Unchanged empty/loading branches outside three-label recovery matrix; no new stale event behavior demonstrated. |
| Add active access-denial transition | low / reject | Additional authorization transition beyond stated initial null render gate. Source access handling unchanged; backend authorization is not inferred from fixtures. |
| Assert rows hidden during authenticated loading | medium / patch | Add explicit rows().toHaveLength(0) after loading visibility settles; re-run same seven browser cases and24 backend outcomes. |
| Wait for cell content after row count | low / reject | Each openAudit performs a fresh render with pre-seeded data and automatic cleanup; no same-count prior table is used. Svelte creates the row and its text in the same update; exact cells are asserted immediately. No observed timing defect or stale prior table. |
| Scope rows to audit table | low / reject | Mounted route/shell currently contains exactly the audit table when open. All rows and four cells are checked; another table would fail count/content, not silently weaken proof. No current false positive. |
| Optional source/feedback associations | low / reject | Those IDs are not consumed by these cells. Frozen matrix requires only registered fields and valid recovery source; adding unused association combinations would mirror unchanged internals. |
| Empty string reason | low / reject | Requirement covers present/omitted reasons and retains existing nullish fallback. Empty-string semantics are unchanged; no new policy should be invented for label-only recovery. |
| Discovery/full gate pending | medium / patch | Parent stages the new ordinary browser test before canonical discovery and full component-inclusive gate. Acceptance requires their fresh receipts. |
| Default Svelte compiler warning | low / patch | Document explicit unchanged browser config/plugins/stub boundaries and no root config; do not claim production SSR/router parity. Repository full gate checks build/types separately. |
| Red excerpts and digest omitted | low / patch | Add actual three received/expected pairs and worker regression digest; raw red log/screenshot retained. Parent strengthened test is separately source-bound. |

No intent gap, bad spec or confident unrelated defect; no ledger mutation. Parent applies trivial evidence/test patches because the ephemeral implementation context cannot be resumed. Full gate remains a separate prerequisite until its receipt is written.
