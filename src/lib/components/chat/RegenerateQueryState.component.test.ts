import { beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { UIMessage } from "@convex-dev/agent";
import type { Id } from "../../../../convex/_generated/dataModel";
import AgentChatPanel from "./AgentChatPanel.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetConvexStub, __setPaginatedRows, __setQueryData, __setQueryError, __setQueryStale, __setMutationResult, __setMutationError, __mutationCalls } from "$lib/test/convex-svelte-stub.svelte";

const reportId = "report-1" as Id<"reports">;
const projectId = "project-1" as Id<"projects">;
const timing = [{ _id: "turn-1", order: 1, status: "completed", stepCount: 0 }];
const rows: UIMessage[] = (["user", "assistant"] as const).map(role => ({
  id: role, key: role, order: 1, stepOrder: role === "user" ? 0 : 1,
  role, status: "success", text: role === "user" ? "Stored prompt" : "Stored answer",
  parts: [{ type: "text", text: role === "user" ? "Stored prompt" : "Stored answer" }], _creationTime: 1000,
}));
const regenerate = () => page.getByRole("button", { name: "Regenerate", exact: true });

beforeEach(() => {
  __resetConvexStub(); __resetAuthState(); localStorage.clear();
  __setQueryData("chatV2:listThreads", [{ agentThreadId: "thread-1", title: "Original conversation" }]);
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", rows);
  __setQueryData("chatV2:listTurns", timing);
  __setQueryData("chatV2:listProposals", []);
  __setQueryData("research:listSessions", []);
  __setQueryData("users:getCurrentUser", { _id: "writer-1", role: "writer" });
  __setQueryData("chatFeedback:getViewerVotes", []);
  __setMutationResult("chatV2:sendMessage", { threadId: "thread-1", messageId: "new-prompt" });
});

it.each(["stale", "error"])("hides regeneration and disables historical retry with retained %s timing", async state => {
  await render(AgentChatPanel, { reportId, projectId });
  await expect.element(regenerate()).toHaveAccessibleDescription("Regenerate response to: Stored prompt");
  __setMutationError("chatV2:sendMessage", new Error("Try again"));
  await regenerate().click();
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  await expect.element(retry).toBeEnabled();
  if (state === "stale") __setQueryStale("chatV2:listTurns", true);
  else __setQueryError("chatV2:listTurns", new Error("Timing unavailable"));
  await expect.element(retry).toBeDisabled();
  expect(regenerate().elements()).toHaveLength(0);
  expect(__mutationCalls("chatV2:sendMessage")).toHaveLength(1);
  __setQueryStale("chatV2:listTurns", false);
  __setQueryData("chatV2:listTurns", timing);
  __setMutationResult("chatV2:sendMessage", { threadId: "thread-1", messageId: "retried" });
  await expect.element(regenerate()).toBeEnabled();
  await retry.click();
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([
    { reportId, threadId: "thread-1", content: "Stored prompt" },
    { reportId, threadId: "thread-1", content: "Stored prompt" },
  ]);
});

it.each(["loading", "stale", "error"])("blocks regeneration until %s research data recovers and active research ends", async state => {
  if (state === "loading") __setQueryData("research:listSessions", undefined);
  else if (state === "stale") __setQueryStale("research:listSessions", true);
  else __setQueryError("research:listSessions", new Error("Research unavailable"));
  await render(AgentChatPanel, { reportId, projectId });
  await expect.element(regenerate()).toBeDisabled();
  expect(__mutationCalls("chatV2:sendMessage")).toHaveLength(0);
  __setQueryStale("research:listSessions", false);
  __setQueryData("research:listSessions", [{ _id: "research-1", status: "researching", selectedText: "Passage", createdAt: 1000 }]);
  await expect.element(regenerate()).toBeDisabled();
  __setQueryData("research:listSessions", []);
  await regenerate().click();
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([{ reportId, threadId: "thread-1", content: "Stored prompt" }]);
});

it.each(["queued", "running", "aborted"])("renders one unanswered %s durable turn without a regenerate action", async status => {
  __setPaginatedRows("chatV2:listMessages", [rows[0]]);
  __setQueryData("chatV2:listTurns", [{ ...timing[0], status }]);
  await render(AgentChatPanel, { reportId, projectId });
  const label = status === "queued" ? "Starting…" : status === "running" ? "Working…" : "Stopped";
  await expect.element(page.getByText(label, { exact: true })).toBeVisible();
  expect(page.getByText(label, { exact: true }).elements()).toHaveLength(1);
  expect(regenerate().elements()).toHaveLength(0);
  expect(__mutationCalls("chatV2:sendMessage")).toHaveLength(0);
});
