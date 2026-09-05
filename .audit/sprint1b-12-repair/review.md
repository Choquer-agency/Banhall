# BMAD build patch review

Three context-free review layers ran at inherited Astra capability. Due to shared four-agent capacity, blind and edge ran together; verification-gap ran after they released slots. Baseline independent story review remains in ../sprint1b-12-review/review.md. This review covers the actual repair diff.

## Results and triage

Blind hunter returned twelve candidates. Edge-case hunter returned one overlapping scan-cost candidate. Verification-gap returned “No verification gaps found.”

Retained patches:

- A prior confirmation must not prevent successful clearing of an equal stale handle. Clear matching ragEntryId before deduplicating the audit insert; the whole mutation remains atomic. Historical audit seed test verifies clearing and stale-failure fencing.
- Centralize the exact persisted confirmation reason and label it a compatibility contract. Both lookup and insertion share it.
- Exercise the true overlapping-action schedule: hold the first erase promise, confirm a second attempt, then reject the first. No handle, failure audit or retry may reappear.

Other candidates:

- Source-index audit scans can exhaust transaction read limits with exceptionally large per-source histories. A new entry index/field violates this task's explicit unchanged-schema constraint. A truncated lookup would silently permit duplicate confirmations; preserve complete indexed iteration and fail transactionally on infrastructure limits. Root receives this material limitation; no ledger mutation in this lane.
- Historical compatibility test: folded into stale-handle patch.
- Failure source/entry isolation: same exact shared predicate protects both mutations; existing scope test plus focused failures prove the relevant branches. No demonstrated additional defect.
- Duplicate old confirmation with newer handle: existing anti-clobber test covers matching-id guard; duplicate fast exit cannot clear a different id.
- Reapproval deletion retries: pre-existing explicitly reviewed exception; task asks to protect absent id/no failure audit, not alter retry policy.
- Duplicate failure delivery and independent ladders: pre-existing manual restart semantics, originally deferred DW-17. No new attempt identifier/schema permitted.
- Hypothetical remote entry-id reuse: no demonstrated supported lifecycle; per erased-entry contract is explicitly the task's unit of identity.
- Split acceptance prose: optional presentation preference; clarification remains narrowly aligned with original contract.

No intent gap or bad-spec loopback. No unresolved actionable correctness finding within authorized scope. Full native verification remains separately recorded.
