import { beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { UIMessage } from "@convex-dev/agent";
import type { Id } from "../../../../convex/_generated/dataModel";
import AgentChatPanel from "./AgentChatPanel.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetConvexStub, __setPaginatedRows, __setQueryData, __setQueryDataForArgs, __setMutationResult, __activeQueryArgs, __mutationCalls } from "$lib/test/convex-svelte-stub.svelte";

const reportId = "report-1" as Id<"reports">;
const projectId = "project-1" as Id<"projects">;
function rows(order: number): UIMessage[] {
  return (["user", "assistant"] as const).map(role => ({ id: `${role}-${order}`, key: `${role}-${order}`, order, stepOrder: role === "user" ? 0 : 1,
    role, status: "success", text: role === "user" ? "Stored prompt" : "Stored answer", parts: [{ type: "text", text: role === "user" ? "Stored prompt" : "Stored answer" }], _creationTime: 1000 }));
}
const turns = (start: number) => Array.from({ length: 200 }, (_, i) => ({ _id: `turn-${start + i}`, order: start + i, status: "completed", stepCount: 0 }));
const regenerate = () => page.getByRole("button", { name: "Regenerate", exact: true });
beforeEach(() => {
  __resetConvexStub(); __resetAuthState(); localStorage.clear();
  __setQueryData("chatV2:listThreads", [{ agentThreadId: "thread-1", title: "Conversation" }]);
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", rows(1));
  __setQueryData("chatV2:listTurns", [{ _id: "turn-1", order: 1, status: "completed", stepCount: 0 }]);
  __setQueryData("research:getSessionDetails", null);
  __setQueryData("chatV2:listProposals", []); __setQueryData("research:listSessions", []);
  __setQueryData("users:getCurrentUser", { _id: "writer-1", role: "writer" });
  __setQueryData("chatFeedback:getViewerVotes", []);
  __setMutationResult("chatV2:sendMessage", { threadId: "thread-1", messageId: "pending-prompt" });
});

it("walks capped turn windows to observe the exact pending turn and releases only on completion", async () => {
  await render(AgentChatPanel, { reportId, projectId });
  await page.getByRole("textbox").fill("Preserved draft");
  await regenerate().click();
  await expect.element(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  __setPaginatedRows("chatV2:listMessages", rows(450));
  __setQueryDataForArgs("chatV2:listTurns", { threadId: "thread-1", startOrder: 1, endOrder: 450 }, turns(251));
  __setQueryDataForArgs("chatV2:listTurns", { threadId: "thread-1", startOrder: 1, endOrder: 250 }, turns(51));
  __setQueryDataForArgs("chatV2:listTurns", { threadId: "thread-1", startOrder: 1, endOrder: 50 }, [{ _id: "own", order: 2, promptMessageId: "pending-prompt", status: "running", stepCount: 0 }]);
  await expect.poll(() => __activeQueryArgs("chatV2:listTurns")).toContainEqual({ threadId: "thread-1", startOrder: 1, endOrder: 50 });
  await expect.element(regenerate()).toBeDisabled();
  __setQueryDataForArgs("chatV2:listTurns", { threadId: "thread-1", startOrder: 450, endOrder: 450 }, [{ _id: "latest", order: 450, status: "completed", stepCount: 0 }]);
  __setQueryDataForArgs("chatV2:listTurns", { threadId: "thread-1", startOrder: 1, endOrder: 50 }, [{ _id: "own", order: 2, promptMessageId: "pending-prompt", status: "completed", stepCount: 0 }]);
  await expect.poll(() => __activeQueryArgs("chatV2:listTurns")).toEqual([{ threadId: "thread-1", startOrder: 450, endOrder: 450 }]);
  await expect.element(regenerate()).toBeEnabled();
  await expect.element(page.getByRole("textbox")).toHaveValue("Preserved draft");
  await expect.element(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  expect(__mutationCalls("chatV2:sendMessage")).toHaveLength(1);
});

it("does not treat timing omitted by the newest-200 cap as legacy", async () => {
  __setPaginatedRows("chatV2:listMessages", [...rows(1), ...rows(201)]);
  __setQueryData("chatV2:listTurns", turns(2));
  await render(AgentChatPanel, { reportId, projectId });
  await expect.poll(() => regenerate().elements().length).toBe(1);
  __setQueryData("chatV2:listTurns", [{ _id: "old", order: 1, status: "aborted", stepCount: 0 }, ...turns(2).slice(1)]);
  await expect.poll(() => regenerate().elements().length).toBe(1);
});

it.each(["completed", "failed", "canceled", "missing"])("observes displaced research directly through %s and keeps it busy until terminal", async terminal => {
  __setMutationResult("research:startResearch", "pending-research");
  await render(AgentChatPanel, { reportId, projectId, pendingResearch: { from: 1, to: 2, text: "Passage", context: "Context" } });
  await page.getByRole("textbox").fill("Research this");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByRole("textbox").fill("Next instruction");
  await expect.element(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  __setQueryData("research:listSessions", Array.from({ length: 20 }, (_, i) => ({ _id: `session-${i}`, status: "completed", selectedText: "Passage", createdAt: i })));
  __setQueryDataForArgs("research:getSessionDetails", { sessionId: "pending-research" }, { session: { _id: "pending-research", status: "researching" } });
  await expect.poll(() => __activeQueryArgs("research:getSessionDetails")).toContainEqual({ sessionId: "pending-research" });
  await expect.element(regenerate()).toBeDisabled();
  __setQueryDataForArgs("research:getSessionDetails", { sessionId: "pending-research" }, terminal === "missing" ? null : { session: { _id: "pending-research", status: terminal } });
  await expect.element(regenerate()).toBeEnabled();
  await expect.element(page.getByRole("textbox")).toHaveValue("Next instruction");
  await expect.element(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  expect(__mutationCalls("chatV2:sendMessage")).toHaveLength(0);
});

it("bounds the accessible prompt excerpt while replaying the complete stored text", async () => {
  const prompt = "Original context ".repeat(40);
  const longRows = rows(1);
  longRows[0] = { ...longRows[0], text: prompt, parts: [{ type: "text", text: prompt }] };
  __setPaginatedRows("chatV2:listMessages", longRows);
  await render(AgentChatPanel, { reportId, projectId });
  await expect.element(regenerate()).toHaveAccessibleDescription(`Regenerate response to: ${prompt.trim().slice(0, 159)}…`);
  await regenerate().click();
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([{ reportId, threadId: "thread-1", content: prompt }]);
});
