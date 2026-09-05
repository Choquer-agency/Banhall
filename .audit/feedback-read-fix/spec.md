---
title: 'Bound completed-answer feedback reads'
type: 'bugfix'
created: '2026-09-05'
status: 'done'
baseline_commit: 'e3f23432121b6d3145cff7040c485ac28739a25f'
review_loop_iteration: 0
context: ['AGENTS.md', 'convex/_generated/ai/guidelines.md']
---

<frozen-after-approval reason="authorized narrow combined-review remediation">

## Intent

**Problem:** A completed small answer visible through the actual 80-message panel query cannot be rated when prior valid full messages make submitFeedback's eager100-message scan exceed16MiB.

**Approach:** Find the latest successful text-bearing assistant record in the exact target turn with supported, explicitly bounded component pagination. Stop after finding it instead of reading unrelated history. Fail safely without a vote if the target is unavailable within limits.

## Boundaries & Constraints

**Always:** Preserve server-derived identity/context, completed-turn and project/report checks, first-vote idempotency, text-only latest-record selection, deidentify-before-truncate, whole Unicode characters and existing error privacy. Own checkout /Users/johnnynguyen/Documents/Repos/Banhall-bmad-feedback-read-fix only. Use worker-owned npm dependencies and public placeholders. Record actual baseline failure and after success, counts/byte bounds, complete gates and review.

**Ask First:** A new API/schema/permission change or different answer concatenation/learning policy requires parent review before scope changes.

**Never:** Edit public signatures/schema, generated files, chatAgentV2.ts, chatV2.ts, lib/auth.ts, pipeline/analyzer/reports/workflow/QA modules, frontend, native spec/policy/state/ledger, original or integration source. No push/merge/loop. No claim that a row cap alone proves byte safety or that exhausted reads mean nonexistent data.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Available latest answer |49 prior long valid user prompts; latest small completed answer fits actual panel80 query|Actual submitFeedback succeeds and persists exact latest answer|No transaction-limit error|
| Trailing nontext |Successful tool/reasoning-only messages follow target text|Latest text-bearing assistant from same order selected|Never include private reasoning/tool text|
| Other orders |Subsequent turns and earlier text surround target|Exact target only|Unavailable target cannot fall back to neighboring answer|
| Byte/count exhaustion |Target text beyond bounded scan|No feedback write and safe domain error|Explicitly unavailable within limits, no fabricated answer|
| Replay/privacy |First vote repeated, identifiers and Unicode near truncation|First vote unchanged; raw/sanitized snapshots preserve current rules|Existing auth/error protections|

</frozen-after-approval>

## Code Map

- `convex/chatFeedback.ts:44`: eager newest100 component read then exact-order text filter, confirmed issue; only production edit expected here or a small owned helper.
- `convex/chatFeedback.test.ts`: actual agent component registration, identity, exact latest record, tool exclusion, racing first votes, project redaction and Unicode regressions.
- `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-feedback-probe/convex/feedbackReadLimit.probe.test.ts`: real baseline proof with49x180k user prompts, latest small answer, actual authenticated chatV2.listMessages80 control. Adapt to assert repaired success and retain before-failing output; no copying a test that expects the defect into final canonical suite.
- Installed `@convex-dev/agent/src/component/messages.ts:639`: listMessagesByThreadId supports upper order and cursor, statuses and tool inclusion. It lacks lower-order filter; do not construct opaque cursors. Its two successful tool/non-tool streams preserve order.
- Installed `convex-helpers/server/stream.ts:408,1060`: maximumBytesRead counts prefetched merged-stream bandwidth before breaking; first iteration may read two documents, later one; document-bound overshoot must be reserved. Component rereads anchor prompt for each request.
- Story5 complete spec under `_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/stories/5-chat-answer-feedback-and-brain-source-chips.md` is read-only context. Latest text-bearing record is intentional, not full-turn concatenation.

## Tasks & Acceptance

**Execution:**
- [x] `convex/chatFeedback.ts` replace eager scan with first one-row page and, only if needed, one remaining page capped99 rows and1MiB tracked stream reads. Apply maximumRowsRead and maximumBytesRead on both requests, retain exact-turn filter and stop at unavailable data. Reuse authorized project document if useful to avoid duplicate full read. Keep at most100 records/two component list calls, with documented headroom for two stream documents and repeated prompt lookups; no raw exception swallowing.
- [x] `convex/chatFeedbackReadLimits.test.ts` add real transaction-limited regressions for matrix, including panel80 and large history; capture baseline failing success assertion before production fix. Exercise second-page selection and safe byte exhaustion with valid sub-1MiB stored docs.
- [x] `.audit/feedback-read-fix` retain exact logs/exits, baseline/source hashes, decisions trail and complete gate output. No commit until parent workflow independently reviews and finalizes.

**Acceptance Criteria:**
- Given a visible small completed answer amid valid large history, when rating through the actual authenticated mutation, then the vote and exact bounded context persist within enforced transaction limits.
- Given nontext or out-of-order records, when selecting context, then existing latest text-only target-turn semantics remain intact.
- Given scan exhaustion, when no matching answer is found, then no vote is written and existing UI receives safe failure.
- Given final source, when complete canonical verification runs, then it passes with protected files and ledger unchanged.

## Spec Change Log

## Design Notes

Initial one-row request handles ordinary answers immediately. A bounded continuation supports intervening nontext records. Two requests each capped1MiB stream bandwidth reserve a full document overshoot and prompt anchor; merged prefetch is counted. Maximum document headroom plus existing auth/report/turn reads must remain below16MiB, verified with persisted large fixtures. Do not optimize by excluding tool messages if that changes mixed text/tool assistant eligibility.

## Verification

Own `npm ci`, then focused new and existing chatFeedback suites; `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` for canonical complete gate including browser, Convex types, Svelte, unit, discovery, build and uploader harnesses. Public preflight placeholders only. If branch lacks the new wrapper, report and run equivalent documented gates, never edit verification infrastructure. `git diff --check`; compare protected/runtime/schema/ledger hashes to exact base. No live deployment/provider claim.

## Suggested Review Order

- Follow the bounded initial lookup and conditional continuation.
  [chatFeedback.ts:48](../../convex/chatFeedback.ts#L48)
- Compare actual available-answer success with exhausted and cross-turn rejection cases.
  [chatFeedbackReadLimits.test.ts:42](../../convex/chatFeedbackReadLimits.test.ts#L42)
- Check installed SDK overshoot and merged-stream headroom.
  [read-bound-analysis.md:1](read-bound-analysis.md#L1)
- Inspect the independent review findings and regression refinements.
  [review-triage.md:1](review-triage.md#L1)
