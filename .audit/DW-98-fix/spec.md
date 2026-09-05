---
title: 'DW-98 preserve initial unsaved conversation creation intent'
type: bugfix
created: '2026-09-05'
status: done
baseline_commit: 'e8abbc14523eff3e1aa490712e7efafe9cd86b24'
review_loop_iteration: 0
context:
  - docs/svelte-migration.md
---

<frozen-after-approval reason="Previously authorized DW-98 repair">

## Intent

**Problem:** Initial implicit draft A captures neither threadId nor newThread before becoming an unsaved conversation. If it fails, another conversation B succeeds, and A is retried, the unchanged unbound args resolve through backend latest-thread fallback into B.

**Approach:** Capture explicit creation intent for an initial unsaved conversation through the existing newThread API. Retain those exact captured arguments on retry. Prove the initial implicit-draft failure and subsequent separate B sequence in the actual rendered panel before and after the minimal source repair.

## Boundaries & Constraints

**Always:** Work only in Banhall-bmad-dw98-fix on codex/bmad-dw98-fix. Preserve named existing thread routing, explicit New conversation routing, stored prompt/highlight/refinement args, newer composer edits, exact-ID handoff and existing guards. Worker-owned npm dependencies and public placeholders only. Before source change retain the failing regression against the exact baseline. Preserve historical audit screenshots, saving new captures in this repair audit.

**Ask First:** Backend or domain authority changes require intent clarification; none should be needed.

**Never:** Edit backend production, API signatures, permissions, generated files, original story/spec/policy, target, native workers/state or ledger. Do not merge or push, create PRs or start a native loop. Do not claim backend idempotency, persistence across reload, or exactly-once behavior after ambiguous transport failure. Do not apply the separately verified DW-97 research-guard repair here. Keep product patch minimal for root integration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Implicit draft failure | Empty initial report, no explicit New conversation selection; A fails before backend commit | Local A retains explicit creation intent and exact captured request | Failed bubble remains scoped to A |
| Separate B then Retry A | New conversation B succeeds; return to unsent A and retry | A explicitly creates its own conversation instead of latest B; newer draft survives | Preserve the logical key and captured arguments |
| Existing named thread | Composer is already in named thread | Sends and retries keep that exact threadId, not a new conversation | Existing retry behavior |
| Explicit New conversation | User selected New conversation | Existing newThread creation/retry behavior remains | Existing retry behavior |
| Captured content | Initial send includes content/highlight/refinement | Retry uses original args and excludes replacement draft/context | No backend/provider behavior change |
| Reconciliation | New A mutation returns exact identity, persisted A row arrives | Only exact thread/id acknowledgement removes local A | Publication-first ambiguity remains documented |

</frozen-after-approval>

## Code Map

- `src/lib/components/chat/AgentChatPanel.svelte:188-191,651-681`: initial startingNewChat is false; args capture currently adds newThread only for that flag, before initial composer sets it true. Capture explicit creation intent at the actual argument boundary while retaining named routing.
- `src/lib/components/chat/AgentChatPanel.svelte:694-738`: retry transports request.args and promotes local scope from returned threadId. Preserve this captured-request design.
- `src/lib/components/chat/OptimisticSend.component.test.ts`: existing suite mounts actual panel/createUIMessages over reactive transport. Initial empty success is covered, explicit New conversation failure/retry is covered, but initial implicit A failure after separately created B is missing.
- `src/lib/test/convex-svelte-stub.svelte.ts`: existing mutation/query control and call capture. Prefer existing helpers; any test-only simulation of latest-thread resolution must be explicitly identified as a fixture, never live backend proof.
- `convex/chatV2.ts:304-335` (read only): absent threadId and absent newThread resolve latest report thread; newThread bypasses fallback. These source semantics ground destination assertions.
- `.audit/story-7`: historical accepted receipts and screenshots must retain baseline bytes after canonical suites recapture them.

## Tasks & Acceptance

**Execution:**
- [x] `OptimisticSend.component.test.ts` -- reproduce implicit A failure, separate successful B, return/retry A, draft preservation and exact identity handoff; retain red log before source change.
- [x] `AgentChatPanel.svelte` -- capture explicit creation intent for an unsaved initial send while preserving named destinations.
- [x] `.audit/DW-98-fix` -- exact source hashes, commands/exits, matrix mapping, screenshot and review receipts.

**Acceptance Criteria:**
- Given initial implicit A failed without creating a thread and separate B succeeded, when A is retried, then its captured API request explicitly creates a separate thread and the panel adopts the returned A identity while preserving newer draft text.
- Given existing named or explicit-new conversations, when send/retry runs, then their existing routing and full captured context remain unchanged.
- Given a successful repair, when focused and full suites execute, then old safeguards and all matrix rows have passing coverage.

## Spec Change Log

## Verification

Use `npm ci`, `npx svelte-kit sync`, focused `npm run test:component -- src/lib/components/chat/OptimisticSend.component.test.ts src/lib/components/chat/RegenerateTurn.component.test.ts src/lib/components/chat/RegenerateQueryState.component.test.ts src/lib/components/chat/RegenerateLimits.component.test.ts`, complete `npm run test:component`, `npm test`, `npx tsc --noEmit -p convex/tsconfig.json`, `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check`, and `git diff --check`. Save each exit and output under this audit. Preserve before-failure then after-pass proof for same regression. Screenshot the real retained unsent/request state where useful; no generated visual or live backend claim. No commits until parent independent review/finalization.

## Review Triage

Four fresh BMAD review contexts completed blind, edge, verification-gap and acceptance layers. No actionable findings or failed layers. No intent gap, spec loop, deferred item or additional patch. Two waves accommodated concurrency limits. Original story/spec and ledger remain untouched.

## Suggested Review Order

- Bind initial unsaved sends to explicit creation before asynchronous state changes.
  [AgentChatPanel.svelte:662](../../src/lib/components/chat/AgentChatPanel.svelte#L662)

- Prove failed implicit A remains separate after B succeeds, preserving draft and exact identity.
  [OptimisticSend.component.test.ts:210](../../src/lib/components/chat/OptimisticSend.component.test.ts#L210)
