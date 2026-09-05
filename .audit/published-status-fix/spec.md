---
title: 'Acknowledge published local chat sends honestly'
type: 'bugfix'
created: '2026-09-05'
status: 'done'
baseline_commit: 'e3f23432121b6d3145cff7040c485ac28739a25f'
review_loop_iteration: 0
context:
  - '{project-root}/docs/svelte-migration.md'
  - '{project-root}/docs/design-system.md'
---

<frozen-after-approval reason="user authorized integration review repairs">
## Intent
**Problem:** A local chat bubble continues to say Sending after the mutation has returned its confirmed thread and message IDs. This can last indefinitely when navigation leaves the exact persisted prompt outside the loaded page, even after a bounded turn scan proves completion.
**Approach:** Render Sent in the existing accessible status when local state is published. Retain Sending… for unresolved transport. Preserve the exact persisted-ID handoff and every existing send guard.

## Boundaries & Constraints
**Always:** Preserve story 7's canonical intent contract, local rows until exact returned user message ID appears in the selected thread's persisted loaded page, pendingSendByThread, captured drafts/highlights, offscreen routing, retry keys and arguments. Use existing status semantics and design tokens. Work only in this isolated branch/worktree. Preserve unrelated historical screenshot bytes after browser tests.
**Ask First:** Any new policy or changed backend authority, neither needed for this repair.
**Never:** Change backend APIs, use turn metadata to remove local rows, claim backend idempotency, edit native learner/worker/ledger/state, push, merge, or touch other worktrees. Do not inspect or edit Convex production. Parent owns final reporting and private commit. Use direct implementation if no agent capacity is available.

## I/O & Edge-Case Matrix
| Scenario | Input / State | Expected behavior | Errors |
|---|---|---|---|
| Transport pending | Delayed mutation | One local bubble, accessible Sending… | Existing behavior |
| Publication delayed | Mutation confirms exact IDs, persisted page lacks prompt | One retained local bubble, accessible Sent, newer draft retained | No retry introduced |
| Navigation and bounded guard | Resolve offscreen, return with newer page and 200 recent turn records, scan finds completed original turn | Sent remains; guard may release independently; local row remains | No synthetic durable data |
| Exact handoff | Same ID on another thread, wrong ID on origin, then exact user row on origin | Wrong thread or ID cannot remove local; exact row removes local and leaves one prompt | No text matching |
</frozen-after-approval>

## Code Map
- `src/lib/components/chat/AgentChatPanel.svelte:1123`: shared localMessage snippet currently renders Sending… for sending and published. Only production edit is conditional status copy here.
- `src/lib/components/chat/OptimisticSend.component.test.ts`: real rendered panel with deferred transport, navigation, exact-ID and draft tests. Extend here with meaningful regression and screenshots.
- `src/lib/components/chat/RegenerateLimits.component.test.ts:39`: existing query-argument fixture for walking bounded 200-turn windows; reuse pattern.
- `_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/stories/7-optimistic-user-bubble-on-send.md`: read canonical contract before implementing.
- `src/lib/test/convex-svelte-stub.svelte.ts`: transport/query fixtures, use existing helpers.

## Tasks & Acceptance
- [x] Add rendered panel regression before production repair; capture actual before screenshot and retain a failure proving old visible Sending label.
- [x] Repair only status copy; assert all matrix cases and capture after screenshot.
- [x] Run full canonical component suite before production edit and after; nonbrowser tests and Svelte check; inspect images and restore incidental historical screenshot changes.
- [x] Independent BMAD review and audit evidence.

**Acceptance Criteria:**
- Given an unresolved send, when rendered, then Sending… is accessible.
- Given confirmed mutation IDs with delayed persisted publication, when returning from another conversation and scanning a completed turn, then Sent is accessible, draft survives and no local duplicate is introduced.
- Given the exact loaded persisted user row on the originating thread, when observed, then the local row disappears and one durable prompt remains.

## Spec Change Log

## Verification
- `npm run test:component`: canonical full suite before/after production edit.
- Focused regression fails against original copy, passes after repair.
- `npm test` and `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check` pass.
- Before/after actual screenshot inspection; `git diff --check` clean.

## Review result

Fresh blind, edge-case, verification-gap and acceptance layers reported no findings. No source changes were needed after the verified gates. Review receipts and triage are retained alongside this spec.

## Suggested Review Order

- Confirm acknowledged publication changes only accessible visible copy.
  [AgentChatPanel.svelte:1123](../../src/lib/components/chat/AgentChatPanel.svelte#L1123)
- Verify bounded completion retains the local row until exact persisted identity arrives.
  [OptimisticSend.component.test.ts:637](../../src/lib/components/chat/OptimisticSend.component.test.ts#L637)
