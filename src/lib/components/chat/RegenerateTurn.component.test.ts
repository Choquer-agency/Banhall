import { beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { UIMessage } from "@convex-dev/agent";
import type { Id } from "../../../../convex/_generated/dataModel";
import AgentChatPanel from "./AgentChatPanel.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetConvexStub, __setPaginatedRows, __setQueryData, __setMutationResult, __setMutationError, __mutationCalls, __activeQueryArgs, __setQueryDataForArgs } from "$lib/test/convex-svelte-stub.svelte";

const reportId = "report-1" as Id<"reports">;
const projectId = "project-1" as Id<"projects">;
const stored = 'Original prompt\n\n[Writer highlighted this excerpt from the report]:\n"""Old excerpt"""\n\n[Writer is refining suggestion proposal-old. Keep this exact canonical report target:]\n"""Old target"""';
function row(role: UIMessage["role"], overrides: Partial<UIMessage> = {}): UIMessage {
  const text = role === "user" ? stored : "Original answer remains.";
  return { id: role, key: role, order: 1, stepOrder: role === "user" ? 0 : 1, role, status: "success", text, _creationTime: 1000, parts: [{ type: "text", text }], ...overrides };
}
function seed(status = "completed", rows = [row("user"), row("assistant")]) {
  __setQueryData("chatV2:listThreads", [{ agentThreadId: "thread-1", title: "Original conversation" }]);
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", rows);
  __setQueryData("chatV2:listTurns", [{ _id: "turn-1", order: 1, status, stepCount: 0 }]);
  __setQueryData("chatV2:listProposals", []);
  __setQueryData("research:listSessions", []);
  __setQueryData("users:getCurrentUser", { _id: "writer-1", role: "writer" });
  __setQueryData("chatFeedback:getViewerVotes", []);
  __setMutationResult("chatV2:sendMessage", { threadId: "thread-1", messageId: "new-prompt" });
}
const regenerate = () => page.getByRole("button", { name: "Regenerate", exact: true });
const expectedSend = { reportId, threadId: "thread-1", content: stored };
beforeEach(() => { __resetConvexStub(); __resetAuthState(); localStorage.clear(); seed(); });

it.each(["{Enter}", " "])("resends completed prompt through keyboard %s and retains the transcript", async key => {
  await page.viewport(1100, 850);
  await render(AgentChatPanel, { reportId, projectId });
  await expect.element(regenerate()).toBeVisible();
  const button = regenerate().element();
  if (!(button instanceof HTMLButtonElement)) throw new Error("Missing regenerate button");
  for (let tabs = 0; tabs < 12 && document.activeElement !== button; tabs++) await userEvent.tab();
  expect(document.activeElement).toBe(button);
  expect(button.matches(":focus-visible")).toBe(true);
  await expect.poll(() => getComputedStyle(button.parentElement ?? button).opacity).toBe("1");
  expect(getComputedStyle(button).boxShadow).not.toBe("none");
  if (key === "{Enter}") await page.screenshot({ path: "__screenshots__/regenerate-keyboard-transient.png" });
  await userEvent.keyboard(key);
  await expect.poll(() => __mutationCalls("chatV2:sendMessage")).toEqual([expectedSend]);
  await expect.element(page.getByText("Original answer remains.")).toBeVisible();
  await expect.poll(() => page.getByText("Original prompt", { exact: true }).elements().length).toBe(2);
  expect(Number(getComputedStyle(button).fontWeight)).toBeLessThanOrEqual(500);
  expect(button.className).toContain("focus-visible:ring-2");
  if (key === "{Enter}") await page.screenshot({ path: "__screenshots__/regenerate-transient.png" });
});

it.each(["failed-message", "failed-empty", "trailing-failure", "tool-only"])("supports %s without requiring a copyable answer", async scenario => {
  const assistant = row("assistant", { status: scenario === "tool-only" ? "success" : "failed", text: "", parts: scenario === "tool-only"
    ? [{ type: "tool-searchBrain", toolCallId: "search-only", state: "output-available", input: { query: "patterns" }, output: "The Brain has no approved knowledge matching that yet." }]
    : [] });
  seed(scenario === "tool-only" ? "completed" : "failed", scenario === "trailing-failure" ? [row("user")] : [row("user"), scenario === "failed-message" ? row("assistant", { status: "failed" }) : assistant]);
  await render(AgentChatPanel, { reportId, projectId });
  await regenerate().click();
  await expect.poll(() => __mutationCalls("chatV2:sendMessage")).toEqual([expectedSend]);
});

it("places one action after a multi-row answer and uses its matching prompt", async () => {
  seed("completed", [row("user"), row("assistant"), row("assistant", { id: "final", key: "final", stepOrder: 2, text: "Final answer.", parts: [{ type: "text", text: "Final answer." }] })]);
  await render(AgentChatPanel, { reportId, projectId });
  await expect.poll(() => regenerate().elements().length).toBe(1);
  await regenerate().click();
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([expectedSend]);
  await expect.element(page.getByText("Original answer remains.Final answer.")).toBeVisible();
});

it("waits for the exact paginated prompt instead of using an unrelated earlier prompt", async () => {
  seed("completed", [row("user", { order: 0 }), row("assistant")]);
  await render(AgentChatPanel, { reportId, projectId });
  await expect.element(page.getByText("Original answer remains.")).toBeVisible();
  expect(regenerate().elements()).toHaveLength(0);
  expect(__mutationCalls("chatV2:sendMessage")).toHaveLength(0);
  __setPaginatedRows("chatV2:listMessages", [row("user"), row("assistant")]);
  await regenerate().click();
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([expectedSend]);
});

it.each(["queued", "running", "aborted", "streaming", "pending"])("does not regenerate %s", async status => {
  seed(["streaming", "pending"].includes(status) ? "completed" : status,
    [row("user"), row("assistant", status === "streaming" || status === "pending" ? { status } : {})]);
  await render(AgentChatPanel, { reportId, projectId });
  await expect.element(page.getByText("Original answer remains.")).toBeVisible();
  expect(regenerate().elements()).toHaveLength(0);
  expect(__mutationCalls("chatV2:sendMessage")).toHaveLength(0);
});

it("preserves draft and current highlight/research context on resend and failure retry", async () => {
  const onClearHighlight = vi.fn();
  const onClearResearch = vi.fn();
  await render(AgentChatPanel, { reportId, projectId,
    pendingHighlight: { from: 1, to: 4, text: "Current highlight" }, onClearHighlight,
    pendingResearch: { from: 5, to: 8, text: "Current research", context: "Current surroundings" }, onClearResearch,
  });
  const composer = page.getByRole("textbox");
  await composer.fill("Unrelated draft");
  __setMutationError("chatV2:sendMessage", new Error("Resend unavailable"));
  await regenerate().click();
  await expect.element(page.getByRole("alert")).toHaveTextContent("Resend unavailable");
  await expect.element(composer).toHaveValue("Unrelated draft");
  __setMutationResult("chatV2:sendMessage", { threadId: "thread-1", messageId: "new" });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(() => __mutationCalls("chatV2:sendMessage")).toEqual([expectedSend, expectedSend]);
  await expect.element(composer).toHaveValue("Unrelated draft");
  expect(__mutationCalls("research:startResearch")).toHaveLength(0);
  expect(onClearHighlight).not.toHaveBeenCalled();
  expect(onClearResearch).not.toHaveBeenCalled();
  await expect.element(page.getByText("Research: Current research", { exact: true })).toBeVisible();
});

it("suppresses rapid duplicate activation while the shared send is pending", async () => {
  let settle: (value: { threadId: string; messageId: string }) => void = () => { throw new Error("Missing send"); };
  __setMutationResult("chatV2:sendMessage", new Promise(resolve => { settle = resolve; }));
  await render(AgentChatPanel, { reportId, projectId });
  await expect.element(regenerate()).toBeVisible();
  const button = regenerate().element();
  if (!(button instanceof HTMLButtonElement)) throw new Error("Missing button");
  button.click(); button.click();
  await expect.element(regenerate()).toBeDisabled();
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([expectedSend]);
  settle({ threadId: "thread-1", messageId: "new-prompt" });
  await expect.element(regenerate()).toBeDisabled();
  button.click();
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([expectedSend]);
  __setPaginatedRows("chatV2:listMessages", [row("user"), row("assistant"),
    row("user", { id: "new-prompt", key: "new-prompt", order: 2 }),
    row("assistant", { id: "new-answer", key: "new-answer", order: 2, text: "Regenerated answer.", parts: [{ type: "text", text: "Regenerated answer." }] }),
  ]);
  __setQueryData("chatV2:listTurns", [
    { _id: "turn-1", order: 1, status: "completed", stepCount: 0 },
    { _id: "turn-2", promptMessageId: "new-prompt", order: 2, status: "completed", stepCount: 0 },
  ]);
  await expect.element(regenerate().nth(0)).toBeEnabled();
  await expect.element(regenerate().nth(1)).toBeEnabled();
  await expect.element(page.getByText("Original answer remains.")).toBeVisible();
  await expect.element(page.getByText("Regenerated answer.")).toBeVisible();
  expect(page.getByText("Original prompt", { exact: true }).elements()).toHaveLength(2);
  await regenerate().nth(1).click();
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([expectedSend, expectedSend]);
});

it.each(["queued", "researching", "reviewing", "streaming"])("disables historical regeneration during another %s operation", async status => {
  if (status === "streaming") {
    __setPaginatedRows("chatV2:listMessages", [row("user"), row("assistant"), row("user", { order: 2, id: "next", key: "next" }), row("assistant", { order: 2, id: "live", key: "live", status: "streaming", parts: [{ type: "text", text: "Live answer" }], text: "Live answer" })]);
  } else {
    __setQueryData("research:listSessions", [{ _id: "research-1", status, selectedText: "Research passage", createdAt: 1000 }]);
  }
  await render(AgentChatPanel, { reportId, projectId });
  await expect.element(regenerate()).toBeDisabled();
  expect(__mutationCalls("chatV2:sendMessage")).toHaveLength(0);
});

it("preserves an active proposal refinement and its draft", async () => {
  __setQueryData("chatV2:listProposals", [{ _id: "proposal-1", _creationTime: 1000, agentThreadId: "thread-1", projectId, reportId, kind: "edit", targetText: "Existing wording", newText: "Candidate wording", state: "pending", createdAt: 1000 }]);
  await render(AgentChatPanel, { reportId, projectId });
  await page.getByRole("button", { name: "Refine with AI", exact: true }).click();
  const composer = page.getByRole("textbox");
  await composer.fill("My refinement draft");
  await regenerate().click();
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([expectedSend]);
  await expect.element(composer).toHaveValue("My refinement draft");
  await expect.element(page.getByText("Refining suggestion", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Candidate wording", { exact: true })).toBeVisible();
});

it("returns to the original thread and waits for loaded idle timing before retrying", async () => {
  __setQueryData("chatV2:listThreads", [
    { _id: "mapping-1", agentThreadId: "thread-1", title: "Original conversation", createdAt: 1 },
    { _id: "mapping-2", agentThreadId: "thread-2", title: "Second conversation", createdAt: 2 },
  ]);
  await render(AgentChatPanel, { reportId, projectId });
  __setMutationError("chatV2:sendMessage", new Error("Please retry resend"));
  await regenerate().click();
  await expect.element(page.getByRole("alert")).toHaveTextContent("Please retry resend");
  await page.getByRole("button", { name: "Conversation menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Second conversation", exact: false }).click();
  await page.getByRole("textbox").fill("Second thread draft");
  expect(page.getByRole("button", { name: "Retry", exact: true }).elements()).toHaveLength(0);
  expect(__activeQueryArgs("chatV2:listProposals")).toEqual([{ threadId: "thread-2" }]);
  __setQueryDataForArgs("chatV2:listTurns", { threadId: "thread-1", startOrder: 1, endOrder: 1 }, undefined);
  await page.getByRole("button", { name: "Return to original conversation", exact: true }).click();
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([expectedSend]);
  expect(__activeQueryArgs("chatV2:listProposals")).toEqual([{ threadId: "thread-1" }]);
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  await expect.element(retry).toBeDisabled();
  await expect.element(page.getByRole("textbox")).toHaveValue("Second thread draft");
  __setQueryDataForArgs("chatV2:listTurns", { threadId: "thread-1", startOrder: 1, endOrder: 1 }, [{ _id: "turn-1", order: 1, status: "running", stepCount: 0 }]);
  await expect.element(retry).toBeDisabled();
  __setQueryDataForArgs("chatV2:listTurns", { threadId: "thread-1", startOrder: 1, endOrder: 1 }, [{ _id: "turn-1", order: 1, status: "completed", stepCount: 0 }]);
  __setMutationResult("chatV2:sendMessage", { threadId: "thread-1", messageId: "retry" });
  await retry.click();
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([expectedSend, expectedSend]);
  await expect.element(page.getByRole("textbox")).toHaveValue("Second thread draft");
});

it.each(["composer", "research"])("disables regeneration while a %s mutation is pending", async kind => {
  let settle: (value: unknown) => void = () => { throw new Error("Missing operation"); };
  const mutation = kind === "research" ? "research:startResearch" : "chatV2:sendMessage";
  __setMutationResult(mutation, new Promise(resolve => { settle = resolve; }));
  await render(AgentChatPanel, { reportId, projectId,
    ...(kind === "research" ? { pendingResearch: { from: 1, to: 2, text: "Selected passage", context: "Surroundings" } } : {}),
  });
  await page.getByRole("textbox").fill("Current instruction");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.element(regenerate()).toBeDisabled();
  expect(__mutationCalls("chatV2:sendMessage")).toHaveLength(kind === "composer" ? 1 : 0);
  settle(kind === "research" ? "research-published" : { threadId: "thread-1", messageId: "composer-published" });
  await expect.element(page.getByRole("textbox")).toHaveValue("");
  await expect.element(regenerate()).toBeDisabled();
  if (kind === "research") {
    __setQueryData("research:listSessions", [{ _id: "research-published", status: "researching", selectedText: "Selected passage", createdAt: 1000 }]);
    await expect.element(regenerate()).toBeDisabled();
    __setQueryData("research:listSessions", [{ _id: "research-published", status: "completed", selectedText: "Selected passage", createdAt: 1000 }]);
  } else {
    __setPaginatedRows("chatV2:listMessages", [row("user"), row("assistant"), row("user", { id: "composer-published", key: "composer-published", order: 2 })]);
    __setQueryData("chatV2:listTurns", [{ _id: "turn-1", order: 1, status: "completed", stepCount: 0 }]);
    await expect.element(regenerate()).toBeDisabled();
    __setQueryData("chatV2:listTurns", [{ _id: "turn-1", order: 1, status: "completed", stepCount: 0 },
      { _id: "composer-turn", promptMessageId: "composer-published", order: 2, status: "queued", stepCount: 0 }]);
    await expect.element(regenerate()).toBeDisabled();
    __setPaginatedRows("chatV2:listMessages", [row("user"), row("assistant"), row("user", { id: "composer-published", key: "composer-published", order: 2 }), row("assistant", { id: "composer-answer", key: "composer-answer", order: 2 })]);
    __setQueryData("chatV2:listTurns", [{ _id: "turn-1", order: 1, status: "completed", stepCount: 0 },
      { _id: "composer-turn", promptMessageId: "composer-published", order: 2, status: "completed", stepCount: 0 }]);
  }
  await expect.element(regenerate().nth(0)).toBeEnabled();
});


it.each(["failed", "completed"])("retains an earlier %s turn without an assistant at its prompt position", async status => {
  const secondPrompt = "A distinct later prompt";
  seed(status, [row("user"), row("user", { id: "second-prompt", key: "second-prompt", order: 2, text: secondPrompt, parts: [{ type: "text", text: secondPrompt }] }),
    row("assistant", { order: 2 })]);
  __setQueryData("chatV2:listTurns", [
    { _id: "turn-1", order: 1, status, stepCount: 0 },
    { _id: "turn-2", order: 2, status: "completed", stepCount: 0 },
  ]);
  await render(AgentChatPanel, { reportId, projectId });
  await expect.poll(() => regenerate().elements().length).toBe(2);
  await expect.element(regenerate().nth(0)).toHaveAccessibleDescription('Regenerate response to: Original prompt [Writer highlighted this excerpt from the report]: """Old excerpt""" [Writer is refining suggestion proposal-old. Keep this exact canonical rep…');
  await expect.element(regenerate().nth(1)).toHaveAccessibleDescription(`Regenerate response to: ${secondPrompt}`);
  const firstAction = regenerate().nth(0).element();
  const laterPrompt = page.getByText(secondPrompt, { exact: true }).element();
  expect(firstAction.compareDocumentPosition(laterPrompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await regenerate().nth(0).click();
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([expectedSend]);
  // Publish its actual prompt/answer before another regeneration can start.
  __setPaginatedRows("chatV2:listMessages", [row("user"), row("user", { id: "second-prompt", key: "second-prompt", order: 2, text: secondPrompt, parts: [{ type: "text", text: secondPrompt }] }),
    row("assistant", { order: 2 }), row("user", { id: "new-prompt", key: "new-prompt", order: 3 }),
    row("assistant", { id: "third-answer", key: "third-answer", order: 3 }),
  ]);
  __setQueryData("chatV2:listTurns", [
    { _id: "turn-1", order: 1, status, stepCount: 0 },
    { _id: "turn-2", order: 2, status: "completed", stepCount: 0 },
    { _id: "turn-3", promptMessageId: "new-prompt", order: 3, status: "completed", stepCount: 0 },
  ]);
  await regenerate().nth(1).click();
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([expectedSend, { reportId, threadId: "thread-1", content: secondPrompt }]);
  expect(regenerate().elements()).toHaveLength(3);
});

it("waits for durable timing before exposing a partial success snapshot and supports resolved legacy rows", async () => {
  __setQueryData("chatV2:listTurns", undefined);
  await render(AgentChatPanel, { reportId, projectId });
  await expect.element(page.getByText("Original answer remains.")).toBeVisible();
  expect(regenerate().elements()).toHaveLength(0);
  __setQueryData("chatV2:listTurns", [{ _id: "turn-1", order: 1, status: "running", stepCount: 0 }]);
  await expect.element(page.getByText("Working…", { exact: true })).toBeVisible();
  expect(regenerate().elements()).toHaveLength(0);
  expect(__mutationCalls("chatV2:sendMessage")).toHaveLength(0);
  __setQueryData("chatV2:listTurns", []);
  await expect.element(regenerate()).toBeEnabled();
});

it.each(["queued", "running"])("blocks a historical completed action solely on another durable %s turn", async status => {
  __setPaginatedRows("chatV2:listMessages", [row("user"), row("assistant"),
    row("user", { id: "other-user", key: "other-user", order: 2 }),
    row("assistant", { id: "other-answer", key: "other-answer", order: 2 }),
  ]);
  __setQueryData("chatV2:listTurns", [
    { _id: "turn-1", order: 1, status: "completed", stepCount: 0 },
    { _id: "turn-2", order: 2, status, stepCount: 0 },
  ]);
  await render(AgentChatPanel, { reportId, projectId });
  await expect.element(regenerate()).toBeDisabled();
  expect(__mutationCalls("chatV2:sendMessage")).toHaveLength(0);
  __setQueryData("chatV2:listTurns", [
    { _id: "turn-1", order: 1, status: "completed", stepCount: 0 },
    { _id: "turn-2", order: 2, status: "completed", stepCount: 0 },
  ]);
  await expect.element(regenerate().nth(0)).toBeEnabled();
  await regenerate().nth(0).click();
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([expectedSend]);
});

it("preserves Copy, proposal contents, Brain sources and feedback after regeneration", async () => {
  const writeClipboard = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const sourceOutput = 'BRAIN_SOURCES_V1:[{"title":"Approved control pattern","scienceCode":"CRA 2.02.01 Software engineering"}]\n--- REFERENCE PATTERN 1 ---\nPrivate exemplar';
  __setPaginatedRows("chatV2:listMessages", [row("user"), row("assistant", { parts: [
    { type: "tool-searchBrain", toolCallId: "brain-search", state: "output-available", input: { query: "controls" }, output: sourceOutput },
    { type: "text", text: "Original answer remains." },
  ] })]);
  __setQueryData("chatV2:listProposals", [{ _id: "proposal-1", _creationTime: 1000, agentThreadId: "thread-1", projectId, reportId, kind: "edit", targetText: "Existing wording", newText: "Candidate wording", state: "pending", createdAt: 1000 }]);
  __setQueryData("chatFeedback:getViewerVotes", [{ turnId: "turn-1", vote: 1 }]);
  await render(AgentChatPanel, { reportId, projectId });
  await regenerate().click();
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([expectedSend]);
  await page.getByRole("button", { name: "Copy message", exact: true }).click();
  expect(writeClipboard).toHaveBeenCalledExactlyOnceWith("Original answer remains.");
  await expect.element(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  await expect.element(page.getByText("Candidate wording", { exact: true })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Refine with AI", exact: true })).toBeEnabled();
  await expect.element(page.getByRole("button", { name: "Mark response helpful", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByText("Worked", { exact: true }).click();
  await page.getByText("Searched The Brain for “controls”", { exact: true }).click();
  await expect.element(page.getByText("Approved control pattern", { exact: true })).toBeVisible();
  expect(document.body.textContent).not.toContain("Private exemplar");
  expect(__mutationCalls("chatV2:applyProposal")).toHaveLength(0);
  writeClipboard.mockRestore();
});


it.each(["completed", "failed", "aborted"])("releases the shared send guard when regeneration becomes %s", async status => {
  await render(AgentChatPanel, { reportId, projectId });
  await page.getByRole("textbox").fill("Keep this draft");
  await regenerate().click();
  await expect.element(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  await page.getByRole("textbox").click();
  await userEvent.keyboard("{Enter}");
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([expectedSend]);
  await expect.element(page.getByRole("textbox")).toHaveValue("Keep this draft");
  __setPaginatedRows("chatV2:listMessages", [row("user"), row("assistant"), row("user", { id: "new-prompt", key: "new-prompt", order: 2 })]);
  __setQueryData("chatV2:listTurns", [{ _id: "turn-1", order: 1, status: "completed", stepCount: 0 }]);
  await expect.element(regenerate()).toBeDisabled();
  await expect.element(page.getByRole("button", { name: "Stop generating", exact: true })).toBeVisible();
  await userEvent.keyboard("{Enter}");
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([expectedSend]);
  if (status === "aborted") {
    await page.getByRole("button", { name: "Stop generating", exact: true }).click();
    expect(__mutationCalls("chatV2:abortStreaming")).toEqual([{ threadId: "thread-1", order: 2 }]);
    await expect.element(regenerate()).toBeDisabled();
  } else if (status === "completed") {
    __setPaginatedRows("chatV2:listMessages", [row("user"), row("assistant"), row("user", { id: "new-prompt", key: "new-prompt", order: 2 }), row("assistant", { id: "next-answer", key: "next-answer", order: 2 })]);
  }
  __setQueryData("chatV2:listTurns", [{ _id: "turn-1", order: 1, status: "completed", stepCount: 0 }, { _id: "turn-2", promptMessageId: "new-prompt", order: 2, status, stepCount: 0 }]);
  await expect.element(regenerate().nth(0)).toBeEnabled();
  await expect.element(page.getByRole("textbox")).toHaveValue("Keep this draft");
  await expect.element(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([expectedSend, { reportId, threadId: "thread-1", content: "Keep this draft" }]);
});


it("reconciles a pending send outside the loaded messages after in-flight navigation", async () => {
  let settle: (value: { threadId: string; messageId: string }) => void = () => { throw new Error("Missing send"); };
  __setMutationResult("chatV2:sendMessage", new Promise(resolve => { settle = resolve; }));
  __setQueryData("chatV2:listThreads", [
    { _id: "mapping-1", agentThreadId: "thread-1", title: "Original conversation" },
    { _id: "mapping-2", agentThreadId: "thread-2", title: "Second conversation" },
  ]);
  await render(AgentChatPanel, { reportId, projectId });
  await regenerate().click();
  await page.getByRole("button", { name: "Conversation menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Second conversation", exact: false }).click();
  await page.getByRole("textbox").fill("Second thread draft");
  settle({ threadId: "thread-1", messageId: "offscreen-prompt" });
  await expect.poll(() => __activeQueryArgs("chatV2:listProposals")).toEqual([{ threadId: "thread-2" }]);
  await expect.element(page.getByRole("textbox")).toHaveValue("Second thread draft");
  await expect.element(regenerate()).toBeEnabled();
  await page.getByRole("button", { name: "Conversation menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Original conversation", exact: false }).click();
  // The pending prompt has fallen outside the newest message page.
  __setPaginatedRows("chatV2:listMessages", [row("user", { order: 5 }), row("assistant", { order: 5 })]);
  __setQueryDataForArgs("chatV2:listTurns", { threadId: "thread-1", startOrder: 1, endOrder: 5 }, [
    { _id: "offscreen-turn", promptMessageId: "offscreen-prompt", order: 2, status: "running", stepCount: 0 },
    { _id: "latest-turn", order: 5, status: "completed", stepCount: 0 },
  ]);
  await expect.poll(() => __activeQueryArgs("chatV2:listTurns")).toEqual([{ threadId: "thread-1", startOrder: 1, endOrder: 5 }]);
  await expect.element(regenerate()).toBeDisabled();
  __setQueryDataForArgs("chatV2:listTurns", { threadId: "thread-1", startOrder: 5, endOrder: 5 }, [
    { _id: "latest-turn", order: 5, status: "completed", stepCount: 0 },
  ]);
  __setQueryDataForArgs("chatV2:listTurns", { threadId: "thread-1", startOrder: 1, endOrder: 5 }, [
    { _id: "offscreen-turn", promptMessageId: "offscreen-prompt", order: 2, status: "completed", stepCount: 0 },
    { _id: "latest-turn", order: 5, status: "completed", stepCount: 0 },
  ]);
  await expect.poll(() => __activeQueryArgs("chatV2:listTurns")).toEqual([{ threadId: "thread-1", startOrder: 5, endOrder: 5 }]);
  await expect.element(regenerate()).toBeEnabled();
  await expect.element(page.getByRole("textbox")).toHaveValue("");
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([expectedSend]);
});


it("preserves the visible conversation and draft when an offscreen regeneration rejects", async () => {
  let rejectSend: (reason: Error) => void = () => { throw new Error("Missing send"); };
  __setMutationResult("chatV2:sendMessage", new Promise((_, reject) => { rejectSend = reject; }));
  __setQueryData("chatV2:listThreads", [
    { _id: "mapping-1", agentThreadId: "thread-1", title: "Original conversation" },
    { _id: "mapping-2", agentThreadId: "thread-2", title: "Second conversation" },
  ]);
  await render(AgentChatPanel, { reportId, projectId });
  await regenerate().click();
  await page.getByRole("button", { name: "Conversation menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Second conversation", exact: false }).click();
  await page.getByRole("textbox").fill("Second thread draft");
  rejectSend(new Error("Delayed resend failure"));
  await expect.element(page.getByRole("alert")).toHaveTextContent("Delayed resend failure");
  expect(__activeQueryArgs("chatV2:listProposals")).toEqual([{ threadId: "thread-2" }]);
  await expect.element(page.getByRole("textbox")).toHaveValue("Second thread draft");
  expect(page.getByRole("button", { name: "Retry", exact: true }).elements()).toHaveLength(0);
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([expectedSend]);
  await page.getByRole("button", { name: "Return to original conversation", exact: true }).click();
  expect(__activeQueryArgs("chatV2:listProposals")).toEqual([{ threadId: "thread-1" }]);
  await expect.element(page.getByRole("textbox")).toHaveValue("Second thread draft");
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([expectedSend]);
  __setMutationResult("chatV2:sendMessage", { threadId: "thread-1", messageId: "retried-prompt" });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  expect(__mutationCalls("chatV2:sendMessage")).toEqual([expectedSend, expectedSend]);
  await expect.element(page.getByRole("textbox")).toHaveValue("Second thread draft");
});
