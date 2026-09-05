Read `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-published-status-fix/_bmad/render/bmad-build/banhall-bmad-published-status-fix-38cbf0083706/e1e9054301e7447835fc/review-prompts/edge-case-hunter.md` completely and follow it as your review instructions.

Review content:

diff --git a/src/lib/components/chat/AgentChatPanel.svelte b/src/lib/components/chat/AgentChatPanel.svelte
index 8c90b04..92ffd0e 100644
--- a/src/lib/components/chat/AgentChatPanel.svelte
+++ b/src/lib/components/chat/AgentChatPanel.svelte
@@ -1120,7 +1120,7 @@
           {#if request.state.kind === "failed"}
             <span class="text-red-700" role="alert">{request.state.error}</span>
           {:else}
-            <span class="text-ink-muted" role="status">Sending…</span>
+            <span class="text-ink-muted" role="status">{request.state.kind === "published" ? "Sent" : "Sending…"}</span>
           {/if}
           {#if request.state.kind === "failed" || request.retried}
             <ActionButton variant="danger" class="min-h-7 px-2 font-medium aria-disabled:opacity-50"
diff --git a/src/lib/components/chat/OptimisticSend.component.test.ts b/src/lib/components/chat/OptimisticSend.component.test.ts
index dce19a8..17dce2c 100644
--- a/src/lib/components/chat/OptimisticSend.component.test.ts
+++ b/src/lib/components/chat/OptimisticSend.component.test.ts
@@ -5,7 +5,7 @@ import type { UIMessage } from "@convex-dev/agent";
 import type { Id } from "../../../../convex/_generated/dataModel";
 import AgentChatPanel from "./AgentChatPanel.svelte";
 import { __resetAuthState } from "$lib/test/convex-auth-stub";
-import { __resetConvexStub, __setPaginatedRows, __setQueryData, __setMutationResult, __setMutationError, __mutationCalls, __activeQueryArgs } from "$lib/test/convex-svelte-stub.svelte";
+import { __resetConvexStub, __setPaginatedRows, __setQueryData, __setQueryDataForArgs, __setMutationResult, __setMutationError, __mutationCalls, __activeQueryArgs } from "$lib/test/convex-svelte-stub.svelte";
 const reportId = "report-1" as Id<"reports">;
 const projectId = "project-1" as Id<"projects">;
 const sendName = "chatV2:sendMessage";
@@ -62,6 +62,7 @@ it.each(["new", "existing"])("immediately renders a %s conversation send without
   await composer().fill("A newer draft survives");
   pending.resolve({ threadId: "thread-1", messageId: "new-prompt" });
   await expect.poll(() => localRows()[0]?.dataset.sendState).toBe("published");
+  await expect.element(page.getByRole("status")).toHaveTextContent(/^Sent$/);
   await expect.element(composer()).toHaveValue("A newer draft survives");
   expect(localRows()).toHaveLength(1);
   __setPaginatedRows("chatV2:listMessages", [row("new-prompt", prompt)]);
@@ -632,3 +633,61 @@ it.each(["", " \n\t "])("shows a visible fallback for blank transport errors %j"
   await expect.element(retry()).toBeEnabled();
   await expect.element(page.getByRole("alert")).toHaveTextContent("Your message could not be sent.");
 });
+
+it("acknowledges an offscreen published send through bounded completion until exact page handoff", async () => {
+  seedThreads();
+  __setPaginatedRows("chatV2:listMessages", [row("old", "Earlier prompt", 1), row("old-answer", "Earlier answer", 1, "assistant")]);
+  __setQueryData("chatV2:listTurns", [{ _id: "old-turn", order: 1, status: "completed", stepCount: 0 }]);
+  const pending = deferred();
+  await page.viewport(720, 850);
+  await render(AgentChatPanel, { reportId, projectId });
+  await writeAndSend();
+  await expect.element(page.getByRole("status")).toHaveTextContent("Sending…");
+  const key = localRows()[0].dataset.localRequest;
+  await navigate("Second conversation");
+  await composer().fill("Preserved newer draft");
+  pending.resolve({ threadId: "thread-1", messageId: "confirmed-prompt" });
+  await expect.element(send()).toBeEnabled();
+  expect(localRows()).toHaveLength(0);
+  await expect.element(composer()).toHaveValue("Preserved newer draft");
+  // An exact ID loaded on another selected thread cannot hand off this request.
+  __setPaginatedRows("chatV2:listMessages", [row("confirmed-prompt", prompt, 2)]);
+  await expect.element(page.getByText(prompt, { exact: true })).toBeVisible();
+  __setPaginatedRows("chatV2:listMessages", [row("recent", "Recent prompt", 450), row("recent-answer", "Recent answer", 450, "assistant")]);
+  const recentTurns = Array.from({ length: 200 }, (_, index) => ({
+    _id: `turn-${251 + index}`, order: 251 + index, status: "completed", stepCount: 0,
+  }));
+  __setQueryDataForArgs("chatV2:listTurns", { threadId: "thread-1", startOrder: 1, endOrder: 450 }, recentTurns);
+  __setQueryDataForArgs("chatV2:listTurns", { threadId: "thread-1", startOrder: 1, endOrder: 250 }, [
+    { _id: "own-turn", order: 2, promptMessageId: "confirmed-prompt", status: "running", stepCount: 0 },
+  ]);
+  await navigate("Original conversation");
+  await composer().fill("Preserved newer draft");
+  await expect.poll(() => __activeQueryArgs("chatV2:listTurns")).toContainEqual({ threadId: "thread-1", startOrder: 1, endOrder: 250 });
+  await expect.element(send()).toBeDisabled();
+  expect(localRows()).toHaveLength(1);
+  expect(localRows()[0].dataset.localRequest).toBe(key);
+  expect(localRows()[0].dataset.sendState).toBe("published");
+  __setQueryDataForArgs("chatV2:listTurns", { threadId: "thread-1", startOrder: 450, endOrder: 450 }, [
+    { _id: "latest-turn", order: 450, status: "completed", stepCount: 0 },
+  ]);
+  __setQueryDataForArgs("chatV2:listTurns", { threadId: "thread-1", startOrder: 1, endOrder: 250 }, [
+    { _id: "own-turn", order: 2, promptMessageId: "confirmed-prompt", status: "completed", stepCount: 0 },
+  ]);
+  await expect.element(send()).toBeEnabled();
+  await expect.poll(() => __activeQueryArgs("chatV2:listTurns")).toEqual([{ threadId: "thread-1", startOrder: 450, endOrder: 450 }]);
+  expect(localRows()).toHaveLength(1);
+  expect(page.getByText(prompt, { exact: true }).elements()).toHaveLength(1);
+  await expect.element(composer()).toHaveValue("Preserved newer draft");
+  await page.screenshot({ path: "../../../../.audit/published-status-fix/published-after.png" });
+  await expect.element(page.getByRole("status")).toHaveTextContent(/^Sent$/);
+  // Identical content with a different ID still cannot acknowledge publication.
+  __setPaginatedRows("chatV2:listMessages", [row("different-prompt", prompt, 2)]);
+  await expect.poll(() => page.getByText(prompt, { exact: true }).elements().length).toBe(2);
+  expect(localRows()).toHaveLength(1);
+  __setPaginatedRows("chatV2:listMessages", [row("confirmed-prompt", prompt, 2)]);
+  await expect.poll(() => localRows().length).toBe(0);
+  expect(page.getByText(prompt, { exact: true }).elements()).toHaveLength(1);
+  await expect.element(composer()).toHaveValue("Preserved newer draft");
+  expect(__mutationCalls(sendName)).toHaveLength(1);
+});


SPEC:
---
title: 'Acknowledge published local chat sends honestly'
type: 'bugfix'
created: '2026-09-05'
status: 'in-review'
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
- [ ] Add rendered panel regression before production repair; capture actual before screenshot and retain a failure proving old visible Sending label.
- [ ] Repair only status copy; assert all matrix cases and capture after screenshot.
- [ ] Run full canonical component suite before production edit and after; nonbrowser tests and Svelte check; inspect images and restore incidental historical screenshot changes.
- [ ] Independent BMAD review and audit evidence.

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


EVIDENCE:
# Published status repair evidence

Prepared for independent BMAD review; no review acceptance or private commit yet.

Baseline: e3f23432121b6d3145cff7040c485ac28739a25f. Production change is one expression in AgentChatPanel.svelte localMessage status. Sending remains Sending…; published renders Sent using existing role=status. No backend, reconciliation, guard, retry, or query code changed.

## Verification

- Canonical pre-edit `npm run test:component`: 60 files, 462 tests passed; component-before.log and component-before.exit.
- New actual rendered regression against old copy: expected /^Sent$/ received Sending… after bounded scan confirmed completed turn. red.log and red.exit. Earlier fixture failures are separately retained in fixture-*.log; these do not count as bug reproduction.
- Focused `npm run test:component -- src/lib/components/chat/OptimisticSend.component.test.ts`: 34 passed; focused-green.log and focused-green.exit.
- `npm test`: 153 files, 1964 tests passed; unit.log and unit.exit.
- `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check`: zero errors, zero warnings; check.log and check.exit.
- Full post-edit canonical `npm run test:component`: 60 files, 463 tests passed; component-after.log and component-after.exit.

## Acceptance mapping

Transport pending, delayed page, and draft preservation: existing new/existing conversation tests now assert visible Sent after mutation; original Sending behavior additionally asserted in the new regression.

Offscreen routing, wrong-thread identity, bounded scan through 200 recent turns, running guard, completed guard release without local removal, same request key, one local row and preserved newer draft: new acknowledges-an-offscreen regression.

Exact handoff: new test publishes wrong ID with identical content without acknowledging local state, then exact persisted user ID, leaving zero local rows and one durable prompt. Existing suite continues covering non-user IDs and publication-first ordering.

## Visual evidence

published-before.png and published-after.png captured by actual rendered panel and inspected. Before shows Sending… despite completed scan; after shows Sent. Both retain the same prompt, newer draft, and enabled send control. Conversation menu is still visible during its closing animation in both captures; it does not obscure the affected status. Screenshot observations establish real browser UI under controlled transport fixtures, not live backend/provider operation.

## Limits

Only exact persisted-page identity removes local row. A publication-first identity delay can still briefly duplicate a prompt, as explicitly retained by story 7. Local state does not survive reload. Local keys do not imply backend idempotency. Native run acceptance belongs to the root orchestrator. No native ledger/state modified. Historical screenshots regenerated by canonical suites are restored from exact baseline Git bytes and recorded separately.


AUDIT FILE HASHES (screenshots/logs available at absolute project path /Users/johnnynguyen/Documents/Repos/Banhall-bmad-published-status-fix):
{
  ".audit/published-status-fix/red.exit": "4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865",
  ".audit/published-status-fix/source-manifest.json": "71d175231588d885dce4f6316129fde8f5f2813b9af176a979aa1eb4f815ea13",
  ".audit/published-status-fix/fixture-navigation.exit": "4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865",
  ".audit/published-status-fix/fixture-metadata.exit": "4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865",
  ".audit/published-status-fix/published-before.png": "7b120d9a6a9279ee325884e679391cbb87f43859b1f5f1304e4921d351ffc0e9",
  ".audit/published-status-fix/red.log": "5796f22828ef543c2cf55f3a6f32b391e4962533001e36a2393033ebdf464143",
  ".audit/published-status-fix/fixture-navigation.log": "38da247aa71c6df88634a4a2dc290b5b51b5c9fd07e725cd810afa2379b4a9ee",
  ".audit/published-status-fix/evidence.md": "1e93dd99c523e89d143d64f10a19333fe059c6bf160b40d2ef516757d7d3abc4",
  ".audit/published-status-fix/fixture-initial.log": "b43d80c6cc48908f4070aed30aae981038688100d86751a7051f15ba5d36ebe2",
  ".audit/published-status-fix/published-after.png": "ed66274242ebd9d1e66259c96241ea3f34e4cb498320e754959e4ac71d84ec01",
  ".audit/published-status-fix/component-after.log": "40ba7e991d811365a693a05ad5c49cb34cfe391440e6d4b82a5c788bf35797ae",
  ".audit/published-status-fix/decisions.tsv": "e0188a898c59348876f37a5b2fc05ff362e2f4e4b6efe7c6d314254334520d37",
  ".audit/published-status-fix/check.exit": "9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa",
  ".audit/published-status-fix/unit.log": "f20530149ac6d293aa09af282bac7de40e316b38e725b67c2ace189879931cc5",
  ".audit/published-status-fix/component-before.exit": "9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa",
  ".audit/published-status-fix/fixture-initial.exit": "4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865",
  ".audit/published-status-fix/spec.md": "2da9c2127c09bd007605de5f35331250503f884447c9e5dfb9d6f4801fd81a70",
  ".audit/published-status-fix/check.log": "edc85a9135f3e44413eef63871f6e5cd57cf903b6ab8d922260e4f37c8d98eb0",
  ".audit/published-status-fix/focused-green.log": "7c6ffc4ba44ed6274a738a0850a82102cfcd7cd5e6885999c23d77bd275a3eea",
  ".audit/published-status-fix/source.diff": "462a740dab7801e7b8b78b87defa4b1346bf54efc283d2819222a18f7c56c309",
  ".audit/published-status-fix/component-before.log": "98be3944de1ea180ef5d8d02e3bd4713e2143b84f1546c54c2dc566b5d07728c",
  ".audit/published-status-fix/unit.exit": "9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa",
  ".audit/published-status-fix/focused-green.exit": "9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa",
  ".audit/published-status-fix/historical-images-restored.json": "403f1dc8d64fae29ff6024f5630263e6518085bbbd5ff67587f11921a81ecc30",
  ".audit/published-status-fix/fixture-metadata.log": "4db206f40adb8dc23716bc6d0402623d8dc590bb17bdf9420c9c4a08eacd5421"
}

Do not invoke any skill. If the instruction file is unreadable, report that exact failure and stop. Return only the review result. Report only concrete evidence-backed findings; do not invent quota findings.
