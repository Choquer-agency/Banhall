---
title: 'Chat spend budget and queue limit'
type: 'feature'
created: '2026-09-04'
status: ready-for-dev
baseline_revision: '495b3bbf828fbc52381b557378bc7b0b1cd1a2cf'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - convex/_generated/ai/guidelines.md
  - .factory/AGENTS.factory.md
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** CAP-11 has no admission limits on chat spending or queued turns. A project can continue incurring AI costs and a user can enqueue unlimited work.

**Approach:** Gate `sendMessage` transactionally against recorded project usage in the rolling 24 hours and the authenticated sender's queued turns across all projects. Expose administrator configuration through `appSettings`, with defaults of USD 50 and 3 queued turns.

## Boundaries & Constraints

**Always:** Preserve existing authentication, public argument shapes, proposal-only AI editing, and CAP-8 `CHAT_CONTEXT_OPTIONS`. Sum all project `aiUsage.costUsd` call sites by `createdAt`, including both window endpoints. Refuse spending strictly above the budget (the contract says exceeds); refuse a new turn when existing queued count is at least the maximum so admission never exceeds it. Running and terminal turns do not consume queued slots. Use typed `CHAT_SPEND_BUDGET_EXCEEDED` and `CHAT_QUEUE_LIMIT_EXCEEDED` errors before any writes or scheduling. Additive schema only; optional sender field on old rows. Settings are positive finite USD and positive safe integer queue count, with generous defaults when absent or malformed.

**Block If:** Enforcing these limits requires changing human workflow permissions or direct AI report prose writes.

**Never:** Change chat UI, model prompts/context bounds, pricing, usage logging semantics, or generation admission. Do not edit generated files, parallel epic files, or other stories. No backfill job. This is admission based on already-recorded cost, not reservation of future/in-flight spend.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Default allowance | No settings; project usage below or exactly USD 50; fewer than 3 queued for sender | `sendMessage` stores sender and queues/schedules one turn | None |
| Over budget | Multiple in-window project usage rows sum above budget, including non-chat calls | No new thread/message/turn/job | `CHAT_SPEND_BUDGET_EXCEEDED` |
| Window isolation | Old rows before now minus 24h, future rows, other-project rows; rows at both endpoints | Only this project's inclusive time window contributes | Normal budget result |
| Queue full | 3 queued by sender across threads/projects | Reject fourth, including new-thread path | `CHAT_QUEUE_LIMIT_EXCEEDED` |
| Queue isolation/release | Another sender's queued rows; own running/completed/failed/aborted rows | They do not occupy sender's queue; transition out of queued releases capacity | None |
| Legacy queue | Queued row without sender; component prompt identifies actual sender | Count for actual prompt sender, never infer thread creator; missing prompt owner cannot be attributed | Normal queue result |
| Admin settings | Admin sets positive fractional USD and positive integer max queue | Subsequent sends use both persisted values | None |
| Invalid/unauthorized settings | Zero, negative, nonfinite budget; fractional/nonpositive/unsafe queue; non-admin or anonymous | Reject atomically; preserve settings | Typed input/auth error |
| Stale settings | Missing/malformed stored values | Per-field defaults apply | None |

</intent-contract>

## Code Map

- `convex/chatV2.ts:238` contains `sendMessage`; auth yields user at `:253`, first thread write near `:291`, `saveMessage` near `:315`, turn insert near `:321`, scheduler near `:330`. Insert checks after validation and before thread creation. The sender already flows to the agent action. Shared threads do not identify the sender.
- `convex/schema.ts:466` has `aiUsage.costUsd`, `createdAt`, `by_projectId`; add `by_projectId_and_createdAt` for the rolling window. `:830` has `chatTurns` with `by_status`, no sender; add optional `userId: v.id('users')` and `by_userId_and_status`. Keep existing indexes.
- `convex/aiUsage.ts` has sanitized recorded costs and async indexed aggregation precedent in `usageReport`. Add a plain typed helper for the window sum, called in the mutation transaction, rather than a new public usage endpoint.
- `convex/appSettings.ts` has `setSetting`, `readPositiveInt`, admin-only `setDefaultModel`, and independent fallback readers. Reuse these patterns for `ai.chatDailyBudgetUsd` and `ai.chatMaxQueuedTurns`, reader `chatAdmissionLimits`, and public admin mutation `setChatAdmissionLimits`.
- `convex/lib/contracts.ts:9` defines `domainErrorCodes` and `domainError`.
- `convex/chatTurns.test.ts` registers the real agent component with convex-test, freezes time, supplies provider credentials, and has `setup`/`sendQueuedTurn` helpers. Extend tests through real public mutations and component queries, without model calls.
- Installed `@convex-dev/agent/src/component/messages.ts:686` exports `getMessagesByIds`; use `components.agent.messages.getMessagesByIds` on legacy prompt IDs to recover message `userId`. Query missing-user queued rows through the additive index, stopping when the limit is reached. No guessing from thread ownership.
- Cross-story context: stories 1,2,3,4,5,7 are done. CAP-4 reserved spend gating for this story. Preserve evidence builders, writer style, snapshots, trust and review decisions. CAP-8 chat context bounds is already present on this baseline.

- `tsconfig.json`: explicit root include categories preserve SvelteKit type coverage and include shared TypeScript; this repairs the baseline OXC inherited-config resolution failure encountered before tests could run.

## Tasks & Acceptance

**Execution:**
- [x] `tsconfig.json`: preserve generated SvelteKit include categories at the root and add shared modules so the installed Vite/OXC transform resolves their config.
- [x] `convex/schema.ts`: add optional sender and compound indexes, preserving legacy compatibility.
- [x] `convex/appSettings.ts`, `convex/lib/contracts.ts`: add limits reader, authenticated administrator setter with validation, and typed refusal codes.
- [x] `convex/aiUsage.ts`: add complete indexed rolling cost aggregation using explicit project and now inputs; no arbitrary truncation.
- [x] `convex/chatV2.ts`: check limits within `sendMessage`, count sender queues with legacy prompt fallback, then store authenticated sender on accepted turns.
- [x] `convex/chatTurns.test.ts`: cover every matrix row, settings permissions, refusal side effects (including agent messages and scheduled jobs), and cross-project queue scope.
- [x] `.audit/CAP-11/decisions.tsv`, `.audit/CAP-11/evidence.md`: record decisions, baseline, acceptance mapping and actual verification tails. Treat this dispatched story as the authorized ticket scope; use this existing engine worktree. Commit with CAP-11 after verification; never push.

**Acceptance Criteria:**
- Given an over-budget project, when an authorized user calls public `sendMessage`, then it throws the spend code and creates no message, turn, thread or scheduled job.
- Given a sender at their queued maximum across projects, when they call public `sendMessage`, then it throws the queue code without side effects, while other senders remain eligible.
- Given administrator changes through public settings mutation, when a user next sends a message, then admission uses those values and unauthorized callers cannot modify them.
- Given the completed change, when `npm test` and `PUBLIC_CONVEX_URL=http://localhost npm run check` run, then both pass with context-bound tests unchanged.

## Spec Change Log

## Review Triage Log

### 2026-09-04 Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 1, low 6)
- defer: 0
- reject: 8: (high 0, medium 4, low 4)
- addressed_findings:
  - `[medium]` `[patch]` Floating-point accumulation rejected USD 0.1 plus USD 0.2 at a USD 0.3 budget. Accumulate canonical decimal values in exact local BigInt units and compare the budget in the same units. A public-mutation regression reproduced the old failure and passes after the fix, including scientific/subnormal values.
  - `[low]` `[patch]` The all-call-sites test used only generation rows. Seed distinct chat and generation call sites.
  - `[low]` `[patch]` Malformed-budget coverage only asserted queue refusal. Assert spend refusal above the fallback budget with capacity available and unchanged state.
  - `[low]` `[patch]` Independent fallback coverage lacked a non-default valid budget with a malformed queue. Add fractional-budget coverage preserving that budget while using the default queue.
  - `[low]` `[patch]` Administrator configuration only covered inserting settings. Update existing keys and prove both raised and lowered limits affect subsequent sends without duplicate keys.
  - `[low]` `[patch]` Window tests never advanced the clock. Prove a blocked project is admitted after the relevant usage expires.
  - `[low]` `[patch]` A handful of usage rows could not detect a future truncation. Exercise 10,000 fractional rows and a decisive 10,001st row.

### 2026-09-04 Follow-up review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 0
- reject: 10: (high 0, medium 0, low 10)
- addressed_findings:
  - `[low]` `[patch]` Add explicit-thread spend and queue refusal cases with unchanged component/app state, covering the conversation continuation path.
  - `[low]` `[patch]` Clarify the spend refusal message to identify project AI usage, which includes non-chat calls.
  - `[low]` `[patch]` Verify large positive exponents and Number.MAX_VALUE at exact equality and with a subnormal excess through public mutations.
  - `[low]` `[patch]` Verify hexadecimal/blank stored budgets fall back and whitespace-padded scientific notation is honored.

### 2026-09-04 Rearmed review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 0
- reject: 6: (high 0, medium 0, low 6)
- addressed_findings:
  - `[low]` `[patch]` Preserve initial failure and final verification logs as tracked audit artifacts.
  - `[low]` `[patch]` Record exact dependency repair commands and the superseded link target.
  - `[low]` `[patch]` Record dependency versions, lockfile compatibility, local resolution, and isolation evidence.
  - `[low]` `[patch]` Distinguish the original implementation baseline from the rearmed review baseline.

### 2026-09-04 Fresh documentation review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 0
- reject: 9: (high 0, medium 0, low 9)
- addressed_findings:
  - `[low]` `[patch]` Describe archived command logs consistently as whitespace-normalized rather than raw; substantive output is preserved.

## Design Notes

The queue predicate and insert share a Convex transaction and indexed read dependencies. Legacy ownership is resolved from the component prompt, because a shared thread's creator may differ from a turn's sender. Missing legacy attribution remains tolerated. Usage uses event `createdAt`, not insertion time. `projectRollingCostUsdUnits` accumulates canonical decimal costs in local BigInt units at 324 decimal places, enough for every finite JavaScript Number, without rounding. The budget is converted with the same `usdDecimalUnits` helper; these large integers are never stored or returned through Convex. No frontend caller is touched.

## Verification

- `npx vitest run --project convex convex/chatTurns.test.ts`
- `npm test` (final default run passed; earlier host-contention retries used command-line worker/timeout allowances)
- `PUBLIC_CONVEX_URL=http://localhost npm run check`

