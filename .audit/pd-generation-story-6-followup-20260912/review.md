# Story 6 follow-up review, 2026-09-12

Review base: a953bff56b1457989a0a8998a5543c56ef0a2136.
Workflow baseline: cd3f30cf6f1d72d5f0b05e189ba6efb07055b7fa.

All four rendered step-04 layers ran using context-free reviewer agents with explicit model `gpt-6-astra`, effort `medium`: Blind Hunter, Edge Case Hunter, Verification Gap, Intent Alignment. Each read the complete baseline diff; the intent auditor also read the verbatim intent contract. Three reviewers ran together, then Intent Alignment used the first freed slot. All completed before this turn ended. No reviewer changed files.

The edge finding duplicates F1; the verification-gap finding duplicates F8. The intent auditor describes the recovery reading and the already-documented dispositions on schema in the recovery base, editable model defaults, bounded pagination, established auth errors, and incomplete-corpus withholding. These do not introduce new unresolved requirements. Separate executed form and backend tests establish their respective boundaries; they are not claimed as hosted end-to-end evidence.

| ID | Severity / disposition | Finding and action |
| --- | --- | --- |
| F1 | medium / patch | Replacement-report warning promised refusal although the submitted original revision remains valid. Corrected copy and exercised retained-pin submission. No new latest-report policy. |
| F2 | medium / patch | Comparison-only budgets omitted project, financial, and judge documents. Added pagination byte bounds and ancillary reservations, including history labels. Corrected UTF-8 pair accounting and budget comments. |
| F3 | low / patch | Exactly 500 rows always reported incomplete. Added a reserved lookahead and 500/501 boundary coverage. |
| F4 | medium / patch | Incomplete metric cards asserted clauses were not met. Cards now say unavailable, tested with successful arithmetic in a partial window. |
| F5 | low / patch | Empty partial detail list asserted that no comparison had ever been recorded. Now describes the scanned window. |
| F6 | low / patch | Normalization comments promised invariance beyond parser-supported headings. Clarified that whitespace collapse applies to extracted prose, plaintext headings require one line, and the protocol removes headings. Parser behavior is unchanged. |
| F7 | medium / patch | Pending-response tests left project B drafts empty. Both success and error cases now preserve distinct nonempty B drafts. |
| F8 | medium / patch | Frontend safe-integer validation lacked executing coverage. The real form rejects an unsafe value and enables submission at the safe boundary. |
| F9 | low / patch | Full-reset tests omitted several counts, development state, and correction consent. All are populated and verified after project change and explicit restart. |
| F10 | reject | Unknown picker liveness shares the ordinary label. The API explicitly returns null and the form loads actual liveness before submission; the label makes no absence assertion. An extra badge is optional presentation. |
| F11 | reject | Suggested a dedicated pagination retry flow. No permanent failure was demonstrated; existing Newer projects navigation remains available for a failed later page. This pass does not add speculative network-recovery UI. |
| F12 | medium / patch | Large-draft tests did not observe ancillary read usage. Added an observer around actual convex-test database returns, covering large stored projects, financial summaries, and judges without substituting response data. This proves application bounds, not hosted enforcement. |

Totals after deduplication: 10 patches (0 high, 6 medium, 4 low), 0 intent gaps, 0 bad-spec findings, 0 deferred, 2 rejected. Follow-up score: 3 * 6 + 4 = 22; followup_review_recommended is true.

The deferred-work ledger is excluded from every edit and staging operation. Its content and status remain owned by the orchestrator.
