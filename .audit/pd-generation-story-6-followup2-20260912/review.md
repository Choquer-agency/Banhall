# Story 6 fresh follow-up review

All four rendered step-04 review layers completed with gpt-6-astra, medium effort. Blind Hunter, Edge Case Hunter, and Verification Gap ran together; Intent Alignment used the first freed slot. All were launched before triage began and all returned within this workflow turn. Edge Case Hunter returned no findings. No reviewer changed ledger content. The edge reviewer subsequently added the bounded backend regression test requested by the primary agent.

| ID | Severity / disposition | Finding and action |
| --- | --- | --- |
| B1 | medium / patch | Numeric conversion erased fractional text before safe-integer validation. Counts now retain text and require decimal digits before conversion; a browser regression fails against the original page and passes after repair. |
| B2 | low / patch | Count feedback omitted the upper bound. It now states decimal digits and the maximum; executing UI coverage checks it. |
| B3 | low / patch | Replacement-report acceptance existed only in the browser transport stub. A backend test now creates the replacement, verifies it is latest, and records against the unchanged original report, asserting stored provenance and unchanged original bytes. |
| B4 | reject | Combined maximum drafts, judge documents, and auth document suggested. Existing executed independent bounds and the additive reservation calculation already establish the combined upper bound: 13 * 751024 + 5000000 + 1048576 = 15811888 bytes, below 16777216. No uncovered interaction was demonstrated. |
| B5 | reject | Unpaired-surrogate fixture is intentionally adversarial and explicitly labelled. It supplements, rather than replaces, the valid maximum-size three-byte-character fixture. It is not claimed as a hosted transport acceptance result. |
| B6 | low / patch | Project-switch tests had immediate context responses. Added a loading interval proving the old pin and submit action are absent until the selected project's context arrives, then verifying the new payload. |
| B7 | reject | A second pending-response suite for same-project restart would repeat the shared reset token mechanism already observed by project-switch pending-response tests and explicit restart/reset tests. No distinct defect was identified. |
| B8 | reject | Backend stale-target refusal, captured target submission, and UI error preservation are already tested at their respective boundaries. The proposed additional stubbed refusal does not demonstrate an uncovered consumer branch. These are separate boundary tests, not hosted end-to-end evidence. |
| B9 | reject | Client-side length feedback is optional convenience. Server validation preserves and rejects original oversized input, and existing UI error handling retains the evidence. No new data loss or acceptance failure was shown. |
| B10 | low / patch | Prior red evidence depended on ignored configs. Preserved their exact contents as text and supplied a portable reconstruction/runner for both prior source regressions and this count regression. Each mode uses a separate ignored optimizer cache and never replaces tracked source. |
| B11 | low / patch | Scoped patch audit found that trimmed application validation disagreed with the native pattern for whitespace. Both now validate the original decimal text; the regression includes whitespace-bearing input. |
| V1 | low / patch | History truncation had backend boundary coverage but no executing consumer assertion. Added disclosure appearance with hasMore true and removal after the query updates to false. |

Intent Alignment enumerated the literal and measurement-integrity readings and the existing recovery dispositions. The established anonymous auth code, editable model suggestion, supported bounded pagination, parser-supported heading normalization, incomplete-corpus withholding, and immutable original-report pin remain as previously reviewed. No new ambiguity or contract amendment was introduced. Schema, metric helper, and navigation remain in the recovery base and are verified at repository scope by the canonical gate.

Totals: 0 intent gaps, 0 bad-spec findings, 7 patches (0 high, 1 medium, 6 low), 0 deferred, 5 rejected. Follow-up score: 3 * 1 + 6 = 9. A follow-up review is recommended under the workflow threshold. Existing deferred-work entries were not read for triage, authored, re-opened, rewritten, or staged.
