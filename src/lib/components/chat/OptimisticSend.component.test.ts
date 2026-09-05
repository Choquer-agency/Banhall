import { beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { UIMessage } from "@convex-dev/agent";
import type { Id } from "../../../../convex/_generated/dataModel";
import AgentChatPanel from "./AgentChatPanel.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetConvexStub, __setPaginatedRows, __setQueryData, __setMutationResult, __setMutationError, __mutationCalls, __activeQueryArgs } from "$lib/test/convex-svelte-stub.svelte";
const reportId = "report-1" as Id<"reports">;
const projectId = "project-1" as Id<"projects">;
const sendName = "chatV2:sendMessage";
const prompt = "Clarify the uncertainty in section 242.";
const composer = () => page.getByRole("textbox");
const send = () => page.getByRole("button", { name: "Send message", exact: true });
const retry = () => page.getByRole("button", { name: "Retry", exact: true });
const localRows = () => [...document.querySelectorAll<HTMLElement>("[data-local-request]")];
function deferred() {
  let resolve!: (result: { threadId: string; messageId: string }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ threadId: string; messageId: string }>((yes, no) => { resolve = yes; reject = no; });
  __setMutationResult(sendName, promise);
  return { resolve, reject };
}
function row(id: string, text: string, order = 1, role: UIMessage["role"] = "user"): UIMessage {
  return { id, key: id, order, stepOrder: role === "user" ? 0 : 1, role, status: "success", text, _creationTime: 1000, parts: [{ type: "text", text }] };
}
function seedThreads() {
  __setQueryData("chatV2:listThreads", [
    { _id: "mapping-1", agentThreadId: "thread-1", title: "Original conversation" },
    { _id: "mapping-2", agentThreadId: "thread-2", title: "Second conversation" },
  ]);
}
async function navigate(name: string) {
  await page.getByRole("button", { name: "Conversation menu", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: false }).click();
}
async function writeAndSend(text = prompt) { await composer().fill(text); await send().click(); }
beforeEach(() => {
  __resetConvexStub(); __resetAuthState(); localStorage.clear();
  __setQueryData("chatV2:listThreads", []);
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", []);
  __setQueryData("chatV2:listTurns", []);
  __setQueryData("chatV2:listProposals", []);
  __setQueryData("research:listSessions", []);
});

it.each(["new", "existing"])("immediately renders a %s conversation send without inventing a durable turn", async kind => {
  if (kind === "existing") seedThreads();
  const pending = deferred();
  await page.viewport(720, 850);
  await render(AgentChatPanel, { reportId, projectId });
  await writeAndSend();
  await expect.element(page.getByText(prompt, { exact: true })).toBeVisible();
  await expect.element(composer()).toHaveValue("");
  expect(localRows()).toHaveLength(1);
  expect(localRows()[0].dataset.sendState).toBe("sending");
  expect(__activeQueryArgs("chatV2:listTurns")).toEqual([]);
  expect(page.getByRole("button", { name: "Stop generating", exact: true }).elements()).toHaveLength(0);
  expect(page.getByRole("button", { name: "Regenerate", exact: true }).elements()).toHaveLength(0);
  if (kind === "new") await page.screenshot({ path: "../../../../.audit/story-7/optimistic-after.png" });
  await composer().fill("A newer draft survives");
  pending.resolve({ threadId: "thread-1", messageId: "new-prompt" });
  await expect.poll(() => localRows()[0]?.dataset.sendState).toBe("published");
  await expect.element(composer()).toHaveValue("A newer draft survives");
  expect(localRows()).toHaveLength(1);
  __setPaginatedRows("chatV2:listMessages", [row("new-prompt", prompt)]);
  await expect.poll(() => localRows().length).toBe(0);
  expect(page.getByText(prompt, { exact: true }).elements()).toHaveLength(1);
  // Local handoff does not release the independent durable publication guard.
  expect(__mutationCalls(sendName)).toHaveLength(1);
  __setQueryData("chatV2:listTurns", [{ _id: "turn", promptMessageId: "new-prompt", order: 1, status: "completed", stepCount: 0 }]);
  await expect.element(send()).toBeEnabled();
});

it.each(["mutation-first", "publication-first"])("reconciles exact ids with %s and repeated historical content", async order => {
  seedThreads();
  const old = [row("old-prompt", prompt), row("old-answer", "Existing answer", 1, "assistant")];
  __setPaginatedRows("chatV2:listMessages", old);
  const pending = deferred();
  await render(AgentChatPanel, { reportId, projectId });
  await writeAndSend();
  expect(page.getByText(prompt, { exact: true }).elements()).toHaveLength(2);
  const publish = () => __setPaginatedRows("chatV2:listMessages", [...old, row("new-prompt", prompt, 2)]);
  if (order === "publication-first") {
    publish();
    await expect.poll(() => page.getByText(prompt, { exact: true }).elements().length).toBe(3);
    expect(localRows()).toHaveLength(1);
  }
  pending.resolve({ threadId: "thread-1", messageId: "new-prompt" });
  if (order === "mutation-first") {
    await expect.poll(() => localRows()[0]?.dataset.sendState).toBe("published");
    expect(page.getByText(prompt, { exact: true }).elements()).toHaveLength(2);
    publish();
  }
  await expect.poll(() => localRows().length).toBe(0);
  expect(page.getByText(prompt, { exact: true }).elements()).toHaveLength(2);
});

it.each(["highlight-only", "text-and-highlight"])("keyboard retry captures %s and ignores replacement composer context", async kind => {
  seedThreads();
  const highlight = { from: 2, to: 8, text: "Original report excerpt" };
  const clear = vi.fn();
  __setMutationError(sendName, new Error("Connection unavailable"));
  const view = await render(AgentChatPanel, { reportId, projectId, pendingHighlight: highlight, onClearHighlight: clear });
  if (kind === "text-and-highlight") await composer().fill(prompt);
  await send().click();
  await expect.element(page.getByRole("alert")).toHaveTextContent("Connection unavailable");
  const key = localRows()[0].dataset.localRequest;
  expect(localRows()[0].textContent).toContain(highlight.text);
  expect(clear).toHaveBeenCalledTimes(1);
  const replacement = { from: 20, to: 30, text: "Replacement highlight" };
  await view.rerender({ pendingHighlight: replacement });
  await composer().fill("Replacement draft");
  const pending = deferred();
  const retryButton = retry().element();
  if (!(retryButton instanceof HTMLButtonElement)) throw new Error("Missing retry button");
  for (let tabs = 0; tabs < 20 && document.activeElement !== retryButton; tabs++) await userEvent.tab();
  expect(document.activeElement).toBe(retryButton);
  expect(retryButton.matches(":focus-visible")).toBe(true);
  expect(Number(getComputedStyle(retryButton).fontWeight)).toBeLessThanOrEqual(500);
  await page.screenshot({ path: `../../../../.audit/story-7/retry-${kind}.png` });
  await userEvent.keyboard("{Enter}");
  retryButton.click(); retryButton.click();
  const expected = { reportId, threadId: "thread-1", content: kind === "highlight-only" ? "" : prompt, highlight };
  await expect.poll(() => __mutationCalls(sendName)).toEqual([expected, expected]);
  expect(localRows()[0].dataset.localRequest).toBe(key);
  expect(localRows()[0].dataset.sendState).toBe("sending");
  pending.resolve({ threadId: "thread-1", messageId: "retried" });
  await expect.poll(() => localRows()[0]?.dataset.sendState).toBe("published");
  await expect.element(composer()).toHaveValue("Replacement draft");
  expect(clear).toHaveBeenCalledTimes(1);
  __setPaginatedRows("chatV2:listMessages", [row("retried", `${expected.content}\n\n[Writer highlighted this excerpt from the report]:\n\"\"\"${highlight.text}\"\"\"`)]);
  await expect.poll(() => localRows().length).toBe(0);
});

it("captures refinement before edits and retries the original proposal id", async () => {
  seedThreads();
  __setQueryData("chatV2:listProposals", [{ _id: "proposal-1", _creationTime: 1000, agentThreadId: "thread-1", projectId, reportId, kind: "edit", targetText: "Old wording", newText: "Candidate wording", state: "pending", createdAt: 1000 }]);
  const first = deferred();
  await render(AgentChatPanel, { reportId, projectId });
  // A durable answer makes the proposal available in the transcript.
  __setPaginatedRows("chatV2:listMessages", [row("question", "Original question"), row("answer", "Original answer", 1, "assistant")]);
  await page.getByRole("button", { name: "Refine with AI", exact: true }).click();
  await writeAndSend("Make it more specific");
  await composer().fill("New refinement draft");
  first.reject(new Error("Refinement unavailable"));
  await expect.element(retry()).toBeEnabled();
  __setMutationResult(sendName, { threadId: "thread-1", messageId: "refinement" });
  await retry().click();
  const expected = { reportId, threadId: "thread-1", content: "Make it more specific", refineProposalId: "proposal-1" };
  expect(__mutationCalls(sendName)).toEqual([expected, expected]);
  await expect.element(composer()).toHaveValue("New refinement draft");
  expect(localRows()[0].textContent).not.toContain("proposal-1");
});

it.each(["resolve", "reject"])("keeps an existing conversation send scoped after navigation and %s", async outcome => {
  seedThreads();
  const pending = deferred();
  await render(AgentChatPanel, { reportId, projectId });
  await writeAndSend();
  await navigate("Second conversation");
  await composer().fill("Second conversation draft");
  expect(localRows()).toHaveLength(0);
  if (outcome === "resolve") pending.resolve({ threadId: "thread-1", messageId: "offscreen" });
  else pending.reject(new Error("Offline in original thread"));
  await expect.element(send()).toBeEnabled();
  expect(localRows()).toHaveLength(0);
  expect(page.getByRole("alert").elements()).toHaveLength(0);
  expect(__activeQueryArgs("chatV2:listProposals")).toEqual([{ threadId: "thread-2" }]);
  await expect.element(composer()).toHaveValue("Second conversation draft");
  // Even publishing the matching id while another thread is selected cannot acknowledge it.
  __setPaginatedRows("chatV2:listMessages", [row("offscreen", prompt)]);
  await expect.element(page.getByText(prompt, { exact: true })).toBeVisible();
  __setPaginatedRows("chatV2:listMessages", []);
  await navigate("Original conversation");
  await expect.poll(() => localRows().length).toBe(1);
  if (outcome === "reject") await expect.element(retry()).toBeEnabled();
  else {
    __setPaginatedRows("chatV2:listMessages", [row("offscreen", prompt)]);
    await expect.poll(() => localRows().length).toBe(0);
  }
});

it("retains failed unsaved conversations across another New conversation and retries with newThread", async () => {
  seedThreads();
  const pending = deferred();
  await render(AgentChatPanel, { reportId, projectId });
  await navigate("New conversation");
  await writeAndSend();
  const key = localRows()[0].dataset.localRequest;
  await navigate("New conversation");
  await composer().fill("Independent new chat draft");
  expect(localRows()).toHaveLength(0);
  pending.reject(new Error("Unsent new conversation"));
  await expect.element(send()).toBeEnabled();
  expect(localRows()).toHaveLength(0);
  await expect.element(composer()).toHaveValue("Independent new chat draft");
  await navigate(`Unsent conversation 1: ${prompt}`);
  await expect.element(retry()).toBeEnabled();
  expect(localRows()[0].dataset.localRequest).toBe(key);
  __setMutationResult(sendName, { threadId: "new-thread", messageId: "new-message" });
  await retry().click();
  const expected = { reportId, content: prompt, newThread: true };
  expect(__mutationCalls(sendName)).toEqual([expected, expected]);
  await expect.element(composer()).toHaveValue("Independent new chat draft");
  await expect.poll(() => __activeQueryArgs("chatV2:listProposals")).toEqual([{ threadId: "new-thread" }]);
});

it("retries initial implicit A with creation intent after separate B succeeds", async () => {
  const highlight = { from: 2, to: 8, text: "Initial A excerpt" };
  const clear = vi.fn();
  __setMutationError(sendName, new Error("Initial A failed before commit"));
  await page.viewport(720, 850);
  const view = await render(AgentChatPanel, { reportId, projectId, pendingHighlight: highlight, onClearHighlight: clear });
  // No New conversation selection: this is the initial implicit draft.
  await writeAndSend("Initial A");
  await expect.element(retry()).toBeEnabled();
  const key = localRows()[0].dataset.localRequest;
  const originalArgs = __mutationCalls(sendName)[0];
  await view.rerender({ pendingHighlight: null });
  await navigate("New conversation");
  expect(localRows()).toHaveLength(0);
  const b = deferred();
  await writeAndSend("Separate B");
  b.resolve({ threadId: "thread-B", messageId: "message-B" });
  await expect.poll(() => __activeQueryArgs("chatV2:listProposals")).toEqual([{ threadId: "thread-B" }]);
  __setQueryData("chatV2:listThreads", [{ _id: "mapping-B", agentThreadId: "thread-B", title: "Separate B" }]);
  __setPaginatedRows("chatV2:listMessages", [row("message-B", "Separate B")]);
  __setQueryData("chatV2:listTurns", [{ _id: "turn-B", promptMessageId: "message-B", order: 1, status: "completed", stepCount: 0 }]);
  await expect.poll(() => localRows().length).toBe(0);
  await composer().fill("Newer draft survives A retry");
  await navigate("Unsent conversation 1: Initial A");
  await expect.element(retry()).toBeEnabled();
  expect(localRows()[0].dataset.localRequest).toBe(key);
  await view.rerender({ pendingHighlight: { from: 20, to: 30, text: "Replacement excerpt" } });
  await page.screenshot({ path: "../../../../.audit/DW-98-fix/implicit-A-retained.png" });
  const clearsBeforeRetry = clear.mock.calls.length;
  const a = deferred();
  await retry().click();
  expect(__mutationCalls(sendName)[2]).toEqual(originalArgs);
  // Assert the API contract directly. The stub does not run backend fallback:
  // chatV2.ts only bypasses latest B when captured newThread is explicit.
  expect.soft(__mutationCalls(sendName)).toEqual([
    { reportId, content: "Initial A", highlight, newThread: true },
    { reportId, content: "Separate B", newThread: true },
    { reportId, content: "Initial A", highlight, newThread: true },
  ]);
  a.resolve({ threadId: "thread-A", messageId: "message-A" });
  await expect.poll(() => __activeQueryArgs("chatV2:listProposals")).toEqual([{ threadId: "thread-A" }]);
  await expect.poll(() => localRows()[0]?.dataset.sendState).toBe("published");
  expect(localRows()[0].dataset.localRequest).toBe(key);
  await expect.element(composer()).toHaveValue("Newer draft survives A retry");
  expect(clear).toHaveBeenCalledTimes(clearsBeforeRetry);
  __setPaginatedRows("chatV2:listMessages", [row("wrong-A-id", "Initial A")]);
  await expect.element(page.getByText("Initial A", { exact: true }).first()).toBeVisible();
  expect(localRows()).toHaveLength(1);
  __setPaginatedRows("chatV2:listMessages", [row("message-A", "Initial A")]);
  await expect.poll(() => localRows().length).toBe(0);
  await expect.element(composer()).toHaveValue("Newer draft survives A retry");
});

it("does not steal a newer unsaved conversation when the first send creates its thread", async () => {
  const pending = deferred();
  await render(AgentChatPanel, { reportId, projectId });
  await writeAndSend();
  await navigate("New conversation");
  await composer().fill("Keep new draft");
  pending.resolve({ threadId: "created-thread", messageId: "created-message" });
  await expect.element(send()).toBeEnabled();
  expect(localRows()).toHaveLength(0);
  expect(__activeQueryArgs("chatV2:listProposals")).toEqual([]);
  await expect.element(composer()).toHaveValue("Keep new draft");
  __setQueryData("chatV2:listThreads", [{ _id: "mapping", agentThreadId: "created-thread", title: "Created conversation" }]);
  await navigate("Created conversation");
  await expect.poll(() => localRows().length).toBe(1);
  __setPaginatedRows("chatV2:listMessages", [row("created-message", prompt)]);
  await expect.poll(() => localRows().length).toBe(0);
});

it("keeps separate keys for repeated failed sends and retries only the selected bubble", async () => {
  seedThreads();
  __setMutationError(sendName, new Error("Offline"));
  await render(AgentChatPanel, { reportId, projectId });
  await writeAndSend();
  await expect.element(retry()).toBeEnabled();
  await writeAndSend();
  await expect.poll(() => localRows().length).toBe(2);
  expect(new Set(localRows().map(row => row.dataset.localRequest)).size).toBe(2);
  const keys = localRows().map(row => row.dataset.localRequest);
  __setMutationResult(sendName, { threadId: "thread-1", messageId: "second" });
  await retry().nth(1).click();
  __setPaginatedRows("chatV2:listMessages", [row("second", prompt)]);
  await expect.poll(() => localRows().length).toBe(1);
  expect(localRows()[0].dataset.localRequest).toBe(keys[0]);
  expect(page.getByText(prompt, { exact: true }).elements()).toHaveLength(2);
});

it("historical resend shows its stored excerpt without consuming current draft or research", async () => {
  seedThreads();
  const stored = 'Historical prompt\n\n[Writer highlighted this excerpt from the report]:\n"""Historical excerpt"""\n\n[Writer is refining suggestion proposal-old. Keep this exact canonical report target:]\n"""Historical target"""';
  __setPaginatedRows("chatV2:listMessages", [row("old", stored), row("answer", "Historical answer", 1, "assistant")]);
  const pending = deferred();
  await render(AgentChatPanel, { reportId, projectId, pendingResearch: { from: 1, to: 2, text: "Current research", context: "Current surroundings" } });
  await composer().fill("Current draft");
  await page.getByRole("button", { name: "Regenerate", exact: true }).click();
  await expect.poll(() => localRows().length).toBe(1);
  expect(localRows()[0].textContent).toContain("Historical excerpt");
  expect(localRows()[0].textContent).not.toContain("Historical target");
  await expect.element(composer()).toHaveValue("Current draft");
  pending.reject(new Error("Historical retry"));
  await expect.element(retry()).toBeEnabled();
  __setMutationResult(sendName, { threadId: "thread-1", messageId: "resent" });
  await retry().click();
  const expected = { reportId, threadId: "thread-1", content: stored };
  expect(__mutationCalls(sendName)).toEqual([expected, expected]);
  expect(__mutationCalls("research:startResearch")).toHaveLength(0);
  await expect.element(composer()).toHaveValue("Current draft");
});

it("starts research without a local bubble and retains its research error surface", async () => {
  __setMutationError("research:startResearch", new Error("Research unavailable"));
  await render(AgentChatPanel, { reportId, projectId, pendingResearch: { from: 1, to: 2, text: "Research passage", context: "Surroundings" } });
  await writeAndSend("Research this");
  await expect.element(page.getByRole("alert")).toHaveTextContent("Research unavailable");
  expect(localRows()).toHaveLength(0);
  expect(__mutationCalls(sendName)).toHaveLength(0);
  expect(__mutationCalls("research:startResearch")).toEqual([{ reportId, selectedText: "Research passage", selectionFrom: 1, selectionTo: 2, surroundingContext: "Surroundings", instruction: "Research this" }]);
});

it("keeps pagination and active-reply controls driven by durable rows beside a local request", async () => {
  seedThreads();
  __setPaginatedRows("chatV2:listMessages", [row("old", "Old prompt", 10), row("answer", "Old answer", 10, "assistant")]);
  __setQueryData("chatV2:listTurns", [{ _id: "old-turn", order: 10, status: "completed", stepCount: 0 }]);
  const pending = deferred();
  await render(AgentChatPanel, { reportId, projectId });
  await writeAndSend();
  expect(__activeQueryArgs("chatV2:listTurns")).toEqual([{ threadId: "thread-1", startOrder: 10, endOrder: 10 }]);
  expect(page.getByRole("button", { name: "Stop generating", exact: true }).elements()).toHaveLength(0);
  // Older-page publication widens only the real durable window.
  __setPaginatedRows("chatV2:listMessages", [row("earlier", "Earlier prompt", 2), row("earlier-answer", "Earlier answer", 2, "assistant"), row("old", "Old prompt", 10), row("answer", "Old answer", 10, "assistant")]);
  await expect.poll(() => __activeQueryArgs("chatV2:listTurns")).toEqual([{ threadId: "thread-1", startOrder: 2, endOrder: 10 }]);
  pending.resolve({ threadId: "thread-1", messageId: "new-prompt" });
  await expect.poll(() => localRows()[0]?.dataset.sendState).toBe("published");
  // Neither a non-user persisted row with the id nor a different prompt acknowledges it.
  __setPaginatedRows("chatV2:listMessages", [row("wrong-prompt", prompt, 11), row("new-prompt", "Active reply", 11, "assistant")]);
  __setQueryData("chatV2:listTurns", [{ _id: "active-turn", order: 11, status: "running", stepCount: 0 }]);
  await expect.element(page.getByText("Active reply", { exact: true })).toBeVisible();
  expect(localRows()).toHaveLength(1);
  __setPaginatedRows("chatV2:listMessages", [row("new-prompt", prompt, 11), { ...row("active-answer", "Active reply", 11, "assistant"), status: "streaming" }]);
  await expect.poll(() => localRows().length).toBe(0);
  await page.getByRole("button", { name: "Stop generating", exact: true }).click();
  expect(__mutationCalls("chatV2:abortStreaming")).toEqual([{ threadId: "thread-1", order: 11 }]);
});

it("blocks sibling sends in an unsaved conversation until retry succeeds or its failure is dismissed", async () => {
  __setMutationError(sendName, new Error("Offline"));
  await render(AgentChatPanel, { reportId, projectId });
  await writeAndSend("First unsaved request");
  await expect.element(retry()).toBeEnabled();
  await composer().fill("Replacement draft");
  await expect.element(send()).toBeDisabled();
  await composer().click();
  await userEvent.keyboard("{Enter}");
  expect(__mutationCalls(sendName)).toEqual([{ reportId, content: "First unsaved request", newThread: true }]);
  expect(localRows()).toHaveLength(1);
  __setMutationResult(sendName, { threadId: "created", messageId: "first" });
  await retry().click();
  expect(__mutationCalls(sendName)).toEqual([{ reportId, content: "First unsaved request", newThread: true }, { reportId, content: "First unsaved request", newThread: true }]);
  await expect.element(composer()).toHaveValue("Replacement draft");
  await navigate("New conversation");
  __setMutationError(sendName, new Error("Still offline"));
  await writeAndSend("Abandoned request");
  await expect.element(retry()).toBeEnabled();
  await composer().fill("Allowed replacement");
  await page.getByRole("button", { name: "Dismiss send error", exact: true }).click();
  expect(localRows()).toHaveLength(0);
  await expect.element(send()).toBeEnabled();
  await send().click();
  await expect.element(retry()).toBeEnabled();
  expect(__mutationCalls(sendName).at(-1)).toEqual({ reportId, newThread: true, content: "Allowed replacement" });
});

it("immediately reveals a local send in a long bounded transcript while transport remains unresolved", async () => {
  seedThreads();
  const history = Array.from({ length: 40 }, (_, index) => [row(`prompt-${index}`, `Earlier question ${index}`, index), row(`answer-${index}`, `Earlier answer ${index}`, index, "assistant")]).flat();
  __setPaginatedRows("chatV2:listMessages", history);
  deferred();
  await page.viewport(720, 850);
  const view = await render(AgentChatPanel, { reportId, projectId });
  view.container.style.height = "550px";
  view.container.style.width = "600px";
  const log = page.getByRole("log", { name: "Conversation", exact: true }).element();
  if (!(log instanceof HTMLElement)) throw new Error("Missing scroll viewport");
  await expect.poll(() => log.scrollHeight > log.clientHeight).toBe(true);
  // Let the initial resize suppression expire before a real upward scroll.
  await new Promise(resolve => setTimeout(resolve, 250));
  log.scrollTop = 0;
  log.dispatchEvent(new Event("scroll"));
  await expect.poll(() => log.scrollTop).toBe(0);
  await writeAndSend("Visible before the server returns");
  await expect.poll(() => {
    const bubble = localRows()[0]?.getBoundingClientRect();
    const viewport = log.getBoundingClientRect();
    return !!bubble && bubble.top >= viewport.top && bubble.bottom <= viewport.bottom;
  }).toBe(true);
  expect(localRows()[0].dataset.sendState).toBe("sending");
  expect(log.scrollTop).toBeGreaterThan(0);
  await page.screenshot({ path: "../../../../.audit/story-7/optimistic-scrolled-after.png" });
});

it("keeps failed A before a later durable B prompt and answer without synthetic timing", async () => {
  seedThreads();
  __setPaginatedRows("chatV2:listMessages", [row("old", "Historical question"), row("old-answer", "Historical answer", 1, "assistant")]);
  __setMutationError(sendName, new Error("A failed"));
  await render(AgentChatPanel, { reportId, projectId });
  await writeAndSend("Failed A");
  await expect.element(retry()).toBeEnabled();
  __setMutationResult(sendName, { threadId: "thread-1", messageId: "B" });
  await writeAndSend("Successful B");
  __setPaginatedRows("chatV2:listMessages", [row("old", "Historical question"), row("old-answer", "Historical answer", 1, "assistant"), row("B", "Successful B", 2), row("B-answer", "Answer to B", 2, "assistant")]);
  await expect.poll(() => localRows().length).toBe(1);
  const a = page.getByText("Failed A", { exact: true }).element();
  const b = page.getByText("Successful B", { exact: true }).element();
  const answer = page.getByText("Answer to B", { exact: true }).element();
  expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(b.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(__activeQueryArgs("chatV2:listTurns")).toEqual([{ threadId: "thread-1", startOrder: 1, endOrder: 2 }]);
});

it("dismisses only the chosen failed request while preserving another failure and composer draft", async () => {
  seedThreads();
  __setMutationError(sendName, new Error("Offline"));
  await render(AgentChatPanel, { reportId, projectId });
  await writeAndSend("Dismiss this");
  await expect.element(retry()).toBeEnabled();
  await writeAndSend("Keep this failure");
  await expect.poll(() => localRows().length).toBe(2);
  await composer().fill("Keep this draft");
  await page.getByRole("button", { name: "Dismiss send error", exact: true }).nth(0).click();
  await expect.poll(() => localRows().length).toBe(1);
  expect(localRows()[0].textContent).toContain("Keep this failure");
  await expect.element(composer()).toHaveValue("Keep this draft");
  expect(__mutationCalls(sendName)).toHaveLength(2);
});

it("dismisses a displaced historical failure without navigation or another mutation", async () => {
  seedThreads();
  __setPaginatedRows("chatV2:listMessages", [row("old", "Historical request"), row("answer", "Historical answer", 1, "assistant")]);
  const pending = deferred();
  await render(AgentChatPanel, { reportId, projectId });
  await page.getByRole("button", { name: "Regenerate", exact: true }).click();
  await navigate("Second conversation");
  await composer().fill("Second draft");
  pending.reject(new Error("Historical failure"));
  await expect.element(page.getByRole("button", { name: "Return to original conversation", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss send error", exact: true }).click();
  expect(page.getByRole("alert").elements()).toHaveLength(0);
  expect(__activeQueryArgs("chatV2:listProposals")).toEqual([{ threadId: "thread-2" }]);
  await expect.element(composer()).toHaveValue("Second draft");
  await navigate("Original conversation");
  expect(localRows()).toHaveLength(0);
  expect(__mutationCalls(sendName)).toHaveLength(1);
});

it.each(["prompt", "highlight"])("bounds long multiline %s labels and distinguishes identical unsaved conversations", async kind => {
  const longText = `Same preview\n\n  ${"x".repeat(2000)}`;
  __setMutationError(sendName, new Error("Offline"));
  await render(AgentChatPanel, { reportId, projectId, ...(kind === "highlight" ? { pendingHighlight: { from: 1, to: 2, text: longText } } : {}) });
  if (kind === "prompt") await composer().fill(longText);
  await send().click();
  await expect.element(retry()).toBeEnabled();
  const firstKey = localRows()[0].dataset.localRequest;
  await navigate("New conversation");
  if (kind === "prompt") await composer().fill(longText);
  await send().click();
  await expect.element(retry()).toBeEnabled();
  const secondKey = localRows()[0].dataset.localRequest;
  await page.getByRole("button", { name: "Conversation menu", exact: true }).click();
  const first = page.getByRole("menuitem", { name: /^Unsent conversation 1: Same preview x+…$/ });
  const second = page.getByRole("menuitem", { name: /^Unsent conversation 2: Same preview x+…$/ });
  await expect.element(first).toBeVisible();
  await expect.element(second).toBeVisible();
  const menu = page.getByRole("menu").element();
  if (!(menu instanceof HTMLElement)) throw new Error("Missing menu");
  expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth);
  expect(first.element().textContent?.trim().length).toBeLessThanOrEqual(96);
  await first.click();
  expect(localRows()[0].dataset.localRequest).toBe(firstKey);
  await page.getByRole("button", { name: "Conversation menu", exact: true }).click();
  await second.click();
  expect(localRows()[0].dataset.localRequest).toBe(secondKey);
});

it("retains keyboard focus across Retry and repeated failure, then hands it to composer on success", async () => {
  seedThreads();
  __setMutationError(sendName, new Error("First failure"));
  await render(AgentChatPanel, { reportId, projectId });
  await writeAndSend();
  await expect.element(retry()).toBeEnabled();
  const button = retry().element();
  for (let tabs = 0; tabs < 25 && document.activeElement !== button; tabs++) await userEvent.tab();
  expect(document.activeElement).toBe(button);
  const second = deferred();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => localRows()[0]?.dataset.sendState).toBe("sending");
  expect(document.activeElement).toBe(button);
  second.reject(new Error("Second failure"));
  await expect.element(retry()).toBeEnabled();
  expect(document.activeElement).toBe(button);
  const third = deferred();
  await userEvent.keyboard("{Enter}");
  expect(document.activeElement).toBe(button);
  third.resolve({ threadId: "thread-1", messageId: "retried" });
  await expect.poll(() => document.activeElement === composer().element()).toBe(true);
  __setPaginatedRows("chatV2:listMessages", [row("retried", prompt)]);
  await expect.poll(() => localRows().length).toBe(0);
  expect(document.activeElement).toBe(composer().element());
  expect(__mutationCalls(sendName)).toHaveLength(3);
});

it.each(["move-focus", "navigate"])("does not steal focus on retry completion after %s", async movement => {
  seedThreads();
  __setMutationError(sendName, new Error("Failure"));
  await render(AgentChatPanel, { reportId, projectId });
  await writeAndSend();
  await expect.element(retry()).toBeEnabled();
  const button = retry().element();
  for (let tabs = 0; tabs < 25 && document.activeElement !== button; tabs++) await userEvent.tab();
  const pending = deferred();
  await userEvent.keyboard("{Enter}");
  if (movement === "navigate") await navigate("Second conversation");
  const menuButton = page.getByRole("button", { name: "Conversation menu", exact: true }).element();
  if (!(menuButton instanceof HTMLButtonElement)) throw new Error("Missing menu trigger");
  menuButton.focus();
  pending.resolve({ threadId: "thread-1", messageId: "retried" });
  await expect.poll(() => __mutationCalls(sendName).length).toBe(2);
  await expect.poll(() => localRows()[0]?.dataset.sendState ?? "offscreen").toBe(movement === "navigate" ? "offscreen" : "published");
  expect(document.activeElement).toBe(menuButton);
});

it("keeps the same focused composer when Enter inserts the first optimistic row", async () => {
  const pending = deferred();
  await render(AgentChatPanel, { reportId, projectId });
  await composer().fill(prompt);
  const original = composer().element();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => localRows().length).toBe(1);
  expect(composer().element()).toBe(original);
  expect(document.activeElement).toBe(original);
  await userEvent.keyboard("Continue typing");
  await expect.element(composer()).toHaveValue("Continue typing");
  pending.resolve({ threadId: "thread-1", messageId: "focused-send" });
  await expect.poll(() => localRows()[0]?.dataset.sendState).toBe("published");
  expect(document.activeElement).toBe(original);
});

it("returns keyboard focus to the composer after dismissing the last failed row", async () => {
  __setMutationError(sendName, new Error("Offline"));
  await render(AgentChatPanel, { reportId, projectId });
  await writeAndSend();
  const dismiss = page.getByRole("button", { name: "Dismiss send error", exact: true }).element();
  for (let tabs = 0; tabs < 25 && document.activeElement !== dismiss; tabs++) await userEvent.tab();
  expect(document.activeElement).toBe(dismiss);
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => localRows().length).toBe(0);
  expect(document.activeElement).toBe(composer().element());
  await userEvent.keyboard("Next draft");
  await expect.element(composer()).toHaveValue("Next draft");
});

it("contains long failed-send text within a narrow transcript and describes its actions", async () => {
  await page.viewport(320, 850);
  __setMutationError(sendName, new Error("Error".repeat(150)));
  await render(AgentChatPanel, { reportId, projectId });
  await writeAndSend("Prompt".repeat(150));
  await expect.element(retry()).toBeEnabled();
  await page.screenshot({ path: "../../../../.audit/story-7/followup-overflow-after.png" });
  const log = page.getByRole("log").element();
  expect(log.scrollWidth).toBeLessThanOrEqual(log.clientWidth);
  const button = retry().element();
  const description = document.getElementById(button.getAttribute("aria-describedby") ?? "");
  expect(description?.textContent).toContain("Prompt".repeat(150));
  await expect.element(page.getByRole("button", { name: "Dismiss send error", exact: true })).toBeVisible();
});

it("keeps long prompt text contained after exact durable handoff", async () => {
  await page.viewport(320, 850);
  seedThreads();
  const text = "Prompt".repeat(150);
  const pending = deferred();
  await render(AgentChatPanel, { reportId, projectId });
  await writeAndSend(text);
  const log = page.getByRole("log").element();
  expect(log.scrollWidth).toBeLessThanOrEqual(log.clientWidth);
  pending.resolve({ threadId: "thread-1", messageId: "long-prompt" });
  __setPaginatedRows("chatV2:listMessages", [row("long-prompt", text)]);
  await expect.poll(() => localRows().length).toBe(0);
  await expect.element(page.getByText(text, { exact: true })).toBeVisible();
  expect(log.scrollWidth).toBeLessThanOrEqual(log.clientWidth);
});

it("contains a displaced historical error and its actions in a narrow viewport", async () => {
  await page.viewport(320, 850);
  seedThreads();
  __setPaginatedRows("chatV2:listMessages", [row("old", "Historical request"), row("answer", "Historical answer", 1, "assistant")]);
  const pending = deferred();
  await render(AgentChatPanel, { reportId, projectId });
  await page.getByRole("button", { name: "Regenerate", exact: true }).click();
  await navigate("Second conversation");
  pending.reject(new Error("Error".repeat(150)));
  const returnButton = page.getByRole("button", { name: "Return to original conversation", exact: true });
  const dismissButton = page.getByRole("button", { name: "Dismiss send error", exact: true });
  await expect.element(returnButton).toBeVisible();
  await page.screenshot({ path: "../../../../.audit/story-7/second-overflow-after.png" });
  const alert = page.getByRole("alert").element();
  expect(alert.scrollWidth).toBeLessThanOrEqual(alert.clientWidth);
  for (const element of [alert, returnButton.element(), dismissButton.element()]) {
    const bounds = element.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(320);
  }
  await dismissButton.click();
  expect(page.getByRole("alert").elements()).toHaveLength(0);
  expect(__activeQueryArgs("chatV2:listProposals")).toEqual([{ threadId: "thread-2" }]);
});

it.each(["", " \n\t "])("shows a visible fallback for blank transport errors %j", async message => {
  __setMutationError(sendName, new Error(message));
  await render(AgentChatPanel, { reportId, projectId });
  await writeAndSend();
  await expect.element(retry()).toBeEnabled();
  await expect.element(page.getByRole("alert")).toHaveTextContent("Your message could not be sent.");
});
