import { beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { UIMessage } from "@convex-dev/agent";
import type { Id } from "../../../../convex/_generated/dataModel";
import AgentChatPanel from "./AgentChatPanel.svelte";
import { __resetAuthState, __setAuthState } from "$lib/test/convex-auth-stub";
import { __resetConvexStub, __setPaginatedRows, __setQueryData, __setQueryDataForArgs, __setMutationResult, __setMutationError, __setQueryError, __mutationCalls, __activeQueryArgs } from "$lib/test/convex-svelte-stub.svelte";

const reportId = "report-1" as Id<"reports">;
const projectId = "project-1" as Id<"projects">;
const output = `BRAIN_SOURCES_V1:[{"title":"Control systems","scienceCode":"CRA 2.02.01 Software engineering"}]\n\n# SIMILAR PAST REPORTS FROM THE BRAIN (reference patterns only)\nUse them ONLY as a guide.\n\n--- REFERENCE PATTERN 1 (Control systems — CRA 2.02.01 Software engineering — writer: Private Writer) ---\nPrivate exemplar body`;
function answer(overrides: Partial<UIMessage> = {}): UIMessage {
  return { id: "answer-1", key: "answer-1", order: 1, stepOrder: 1, role: "assistant", status: "success", text: "Use measurable comparisons.", _creationTime: Date.now(), parts: [
    { type: "tool-searchBrain", toolCallId: "search-1", state: "output-available", input: { query: "uncertainty" }, output },
    { type: "text", text: "Use measurable comparisons." },
  ], ...overrides };
}
function seed(status = "completed") {
  __setQueryData("chatV2:listThreads", [{ agentThreadId: "thread-1", title: "Report review" }]);
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", [answer()]);
  __setQueryData("chatV2:listTurns", [{ _id: "turn-1", order: 1, status, stepCount: 1 }]);
  __setQueryData("chatV2:listProposals", []);
  __setQueryData("research:listSessions", []);
  __setQueryData("users:getCurrentUser", { _id: "writer-1", role: "writer" });
  __setQueryData("chatFeedback:getViewerVotes", []);
  __setMutationResult("chatFeedback:submitFeedback", 1);
}
beforeEach(() => { __resetConvexStub(); __resetAuthState(); localStorage.clear(); seed(); });

it("renders the real chat panel", async () => {
  await page.viewport(440, 850);
  await render(AgentChatPanel, { reportId, projectId });
  await expect.element(page.getByText("Use measurable comparisons.")).toBeVisible();

});

it("shows source chips in the real trace without exposing exemplar bodies or inventing links", async () => {
  await render(AgentChatPanel, { reportId, projectId });
  await page.getByText("Worked", { exact: true }).click();
  await page.getByText("Searched The Brain for “uncertainty”", { exact: true }).click();
  await expect.element(page.getByText("Control systems", { exact: true })).toBeVisible();
  await expect.element(page.getByText("CRA 2.02.01 Software engineering", { exact: true })).toBeVisible();
  expect(document.body.textContent).not.toContain("Private exemplar body");
  expect(document.body.textContent).not.toContain("Private Writer");
  expect(document.querySelector('[aria-label="Brain sources"] a')).toBeNull();
  for (const element of document.querySelectorAll('[aria-label="Brain sources"] span')) {
    expect(Number(getComputedStyle(element).fontWeight)).toBeLessThanOrEqual(500);
  }
  await page.screenshot({ path: "../../../../.vitest-attachments/chat-feedback-sources.png" });
});

it.each([1, -1] as const)("saves vote %s once and restores it after remount", async (vote) => {
  __setMutationResult("chatFeedback:submitFeedback", vote);
  const mounted = await render(AgentChatPanel, { reportId, projectId });
  const label = vote === 1 ? "Mark response helpful" : "Mark response not helpful";
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect.element(page.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(__mutationCalls("chatFeedback:submitFeedback")).toEqual([{ turnId: "turn-1", vote }]);
  await expect.element(page.getByRole("button", { name: label, exact: true })).toBeDisabled();
  await mounted.unmount();
  __setQueryData("chatFeedback:getViewerVotes", [{ turnId: "turn-1", vote }]);
  await render(AgentChatPanel, { reportId, projectId });
  await expect.element(page.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(__mutationCalls("chatFeedback:submitFeedback")).toHaveLength(1);
});

it("keeps feedback disabled while loading and retries a failed vote with the keyboard", async () => {
  __setQueryData("chatFeedback:getViewerVotes", undefined);
  await render(AgentChatPanel, { reportId, projectId });
  const helpful = page.getByRole("button", { name: "Mark response helpful", exact: true });
  await expect.element(helpful).toBeDisabled();
  __setQueryData("chatFeedback:getViewerVotes", []);
  __setMutationError("chatFeedback:submitFeedback", new Error("SECRET"));
  await helpful.click();
  await expect.element(page.getByRole("alert")).toHaveTextContent("Could not save feedback. Please try again.");
  expect(document.body.textContent).not.toContain("SECRET");
  await expect.element(helpful).toBeEnabled();
  __setMutationResult("chatFeedback:submitFeedback", 1);
  const button = helpful.element();
  if (!(button instanceof HTMLButtonElement)) throw new Error("Missing helpful control");
  button.focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(helpful).toHaveAttribute("aria-pressed", "true");
  expect(__mutationCalls("chatFeedback:submitFeedback")).toHaveLength(2);
});

it.each(["queued", "running", "failed", "aborted"])("does not rate %s turns", async (status) => {
  seed(status);
  await render(AgentChatPanel, { reportId, projectId });
  await expect.element(page.getByText("Use measurable comparisons.")).toBeVisible();
  expect(document.querySelector('[aria-label="Mark response helpful"]')).toBeNull();
});

it("rates a completed multi-step answer once after real agent message merging", async () => {
  __setPaginatedRows("chatV2:listMessages", [
    answer({ id: "earlier", key: "earlier", stepOrder: 0, text: "Early preliminary response.", parts: [{ type: "text", text: "Early preliminary response." }] }),
    answer({ stepOrder: 1, text: "Final measured comparison.", parts: [{ type: "text", text: "Final measured comparison." }] }),
  ]);
  await render(AgentChatPanel, { reportId, projectId });
  await expect.poll(() => document.querySelectorAll('[aria-label="Mark response helpful"]').length).toBe(1);
  // The real agent combines adjacent same-order assistant records into one
  // rendered answer. Assert association with that actual merged answer.
  const group = page.getByRole("group", { name: "Early preliminary response.Final measured comparison.", exact: true });
  await expect.element(group).toBeVisible();
  const labelledBy = group.element().getAttribute("aria-labelledby");
  if (!labelledBy) throw new Error("Feedback group lacks an answer association");
  const answerElement = document.getElementById(labelledBy);
  expect(answerElement?.textContent).toContain("Early preliminary response.");
  expect(answerElement?.textContent).toContain("Final measured comparison.");
  const container = answerElement?.closest(".group");
  expect(container?.contains(group.element())).toBe(true);
  expect(container?.querySelectorAll('[aria-label="Mark response helpful"]')).toHaveLength(1);
});


it("keeps feedback available across the full loaded turn window", async () => {
  const messages = Array.from({ length: 101 }, (_, i) => answer({
    id: `answer-${i}`, key: `answer-${i}`, order: i,
    parts: [{ type: "text", text: `Answer ${i}` }], text: `Answer ${i}`,
  }));
  __setPaginatedRows("chatV2:listMessages", messages);
  __setQueryData("chatV2:listTurns", messages.map((message, i) => ({ _id: `turn-${i}`, order: message.order, status: "completed", stepCount: 1 })));
  await render(AgentChatPanel, { reportId, projectId });
  await expect.poll(() => document.querySelectorAll('[aria-label="Mark response helpful"]').length).toBe(101);
  expect(__activeQueryArgs("chatFeedback:getViewerVotes")).toEqual([{ reportId, threadId: "thread-1", turnIds: messages.map((_, i) => `turn-${i}`) }]);
});

it("does not offer feedback on streaming messages or legacy answers without durable turns", async () => {
  __setPaginatedRows("chatV2:listMessages", [answer({ status: "streaming" })]);
  const mounted = await render(AgentChatPanel, { reportId, projectId });
  await expect.element(page.getByText("Use measurable comparisons.")).toBeVisible();
  expect(document.querySelector('[aria-label="Mark response helpful"]')).toBeNull();
  await mounted.unmount();
  __setPaginatedRows("chatV2:listMessages", [answer()]);
  __setQueryData("chatV2:listTurns", []);
  await render(AgentChatPanel, { reportId, projectId });
  await expect.element(page.getByText("Use measurable comparisons.")).toBeVisible();
  expect(document.querySelector('[aria-label="Mark response helpful"]')).toBeNull();
});


it("keeps distinct persisted votes attached to their answers with an unrated third", async () => {
  __setPaginatedRows("chatV2:listMessages", [1, 2, 3].map(i => answer({ id: `answer-${i}`, key: `answer-${i}`, order: i, text: `Distinct answer ${i}.`, parts: [{ type: "text", text: `Distinct answer ${i}.` }] })));
  __setQueryData("chatV2:listTurns", [1, 2, 3].map(i => ({ _id: `turn-${i}`, order: i, status: "completed", stepCount: 1 })));
  __setQueryData("chatFeedback:getViewerVotes", [{ turnId: "turn-1", vote: 1 }, { turnId: "turn-2", vote: -1 }]);
  await render(AgentChatPanel, { reportId, projectId });
  const helpful = page.getByRole("button", { name: "Mark response helpful", exact: true });
  const unhelpful = page.getByRole("button", { name: "Mark response not helpful", exact: true });
  await expect.element(helpful.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect.element(unhelpful.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect.element(helpful.nth(2)).toBeEnabled();
  await expect.element(helpful.nth(2)).toHaveAttribute("aria-pressed", "false");
  const answerIds = new Set<string>();
  for (const i of [1, 2, 3]) {
    const group = page.getByRole("group", { name: `Distinct answer ${i}.`, exact: true });
    await expect.element(group).toBeVisible();
    const labelledBy = group.element().getAttribute("aria-labelledby");
    if (!labelledBy) throw new Error("Feedback group lacks an answer association");
    answerIds.add(labelledBy);
    expect(document.getElementById(labelledBy)?.textContent).toContain(`Distinct answer ${i}.`);
    expect(group.element().querySelectorAll('button[aria-pressed]')).toHaveLength(2);
  }
  expect(answerIds.size).toBe(3);
});

it("suppresses duplicate clicks while a vote is pending and isolates a changed viewer", async () => {
  let settle: (vote: number) => void = () => { throw new Error("Missing pending vote"); };
  __setMutationResult("chatFeedback:submitFeedback", new Promise<number>(resolve => { settle = resolve; }));
  await render(AgentChatPanel, { reportId, projectId });
  const helpful = page.getByRole("button", { name: "Mark response helpful", exact: true });
  await helpful.click();
  await expect.element(helpful).toBeDisabled();
  const button = helpful.element();
  if (!(button instanceof HTMLButtonElement)) throw new Error("Missing control");
  button.click();
  expect(__mutationCalls("chatFeedback:submitFeedback")).toHaveLength(1);
  __setQueryData("users:getCurrentUser", { _id: "writer-2", role: "writer" });
  settle(1);
  await expect.element(helpful).toBeEnabled();
  await expect.element(helpful).toHaveAttribute("aria-pressed", "false");
  __setQueryData("users:getCurrentUser", { _id: "writer-1", role: "writer" });
  await expect.element(helpful).toHaveAttribute("aria-pressed", "true");
});

it("recovers safely from a vote query error after a page remount", async () => {
  __setQueryError("chatFeedback:getViewerVotes", new Error("SECRET QUERY"));
  const mounted = await render(AgentChatPanel, { reportId, projectId });
  const helpful = page.getByRole("button", { name: "Mark response helpful", exact: true });
  await expect.element(helpful).toBeDisabled();
  await expect.element(page.getByRole("alert")).toHaveTextContent("Feedback is unavailable. Please refresh this page to try again.");
  expect(document.body.textContent).not.toContain("SECRET QUERY");
  const subscriptionsBefore = __activeQueryArgs("chatFeedback:getViewerVotes").length;
  await mounted.unmount();
  __setQueryData("chatFeedback:getViewerVotes", []);
  await render(AgentChatPanel, { reportId, projectId });
  await expect.element(helpful).toBeEnabled();
  expect(__activeQueryArgs("chatFeedback:getViewerVotes").length).toBeGreaterThan(subscriptionsBefore);
  await helpful.click();
  await expect.element(helpful).toHaveAttribute("aria-pressed", "true");
});

it("keeps maximum unbroken source labels inside a mobile viewport", async () => {
  await page.viewport(320, 850);
  __setPaginatedRows("chatV2:listMessages", [answer({ parts: [
    { type: "tool-searchBrain", toolCallId: "search-1", state: "output-available", input: { query: "uncertainty" }, output: `BRAIN_SOURCES_V1:${JSON.stringify([{ title: "T".repeat(240), scienceCode: "S".repeat(160) }])}\n--- REFERENCE PATTERN 1 ---` },
    { type: "text", text: "Use measurable comparisons." },
  ] })]);
  await render(AgentChatPanel, { reportId, projectId });
  await page.getByText("Worked", { exact: true }).click();
  await page.getByText("Searched The Brain for “uncertainty”", { exact: true }).click();
  await expect.element(page.getByRole("group", { name: "Brain sources", exact: true })).toBeVisible();
  for (const element of document.querySelectorAll('[aria-label="Brain sources"], [aria-label="Brain sources"] span')) {
    expect(element.getBoundingClientRect().right).toBeLessThanOrEqual(320);
    expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth + 1);
  }
});

it("rates the last textual answer even if a later assistant row contains only a tool", async () => {
  __setPaginatedRows("chatV2:listMessages", [answer(), answer({ id: "tool-only", key: "tool-only", stepOrder: 2, text: "", parts: [{ type: "tool-searchBrain", toolCallId: "empty-search", state: "output-available", input: {}, output: "" }] })]);
  await render(AgentChatPanel, { reportId, projectId });
  await expect.element(page.getByRole("button", { name: "Mark response helpful", exact: true })).toBeVisible();
});


it("does not attach an old pending vote to another conversation", async () => {
  let settle: (vote: number) => void = () => { throw new Error("Missing pending vote"); };
  __setMutationResult("chatFeedback:submitFeedback", new Promise<number>(resolve => { settle = resolve; }));
  __setQueryData("chatV2:listThreads", [
    { _id: "mapping-1", agentThreadId: "thread-1", title: "Report review", createdAt: 1 },
    { _id: "mapping-2", agentThreadId: "thread-2", title: "Second conversation", createdAt: 2 },
  ]);
  __setQueryDataForArgs("chatV2:listTurns", { threadId: "thread-2", startOrder: 1, endOrder: 1 }, [{ _id: "turn-2", order: 1, status: "completed", stepCount: 1 }]);
  await render(AgentChatPanel, { reportId, projectId });
  const helpful = page.getByRole("button", { name: "Mark response helpful", exact: true });
  await helpful.click();
  await page.getByRole("button", { name: "Conversation menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Second conversation", exact: false }).click();
  settle(1);
  await expect.element(helpful).toBeEnabled();
  await expect.element(helpful).toHaveAttribute("aria-pressed", "false");
  expect(__activeQueryArgs("chatFeedback:getViewerVotes")).toEqual([{ reportId, threadId: "thread-2", turnIds: ["turn-2"] }]);
  expect(__mutationCalls("chatFeedback:submitFeedback")).toEqual([{ turnId: "turn-1", vote: 1 }]);
});


it.each([null, { _id: "roleless" }, { _id: "anonymous", role: "writer", isAnonymous: true }])("does not expose feedback to an ineligible viewer %j", async viewer => {
  __setQueryData("users:getCurrentUser", viewer);
  await render(AgentChatPanel, { reportId, projectId });
  await expect.element(page.getByText("Use measurable comparisons.")).toBeVisible();
  expect(document.querySelector('[aria-label="Mark response helpful"]')).toBeNull();
  expect(__activeQueryArgs("chatFeedback:getViewerVotes")).toEqual([]);
});


it("does not rate a completed turn that has only tool output", async () => {
  __setPaginatedRows("chatV2:listMessages", [answer({ text: "", parts: [{ type: "tool-searchBrain", toolCallId: "search-1", state: "output-available", input: {}, output }] })]);
  await render(AgentChatPanel, { reportId, projectId });
  await expect.element(page.getByText("Worked", { exact: true })).toBeVisible();
  expect(document.querySelector('[aria-label="Mark response helpful"]')).toBeNull();
});

it("does not subscribe or offer ratings when signed out", async () => {
  __setAuthState({ isAuthenticated: false });
  await render(AgentChatPanel, { reportId, projectId });
  await expect.element(page.getByText("Use measurable comparisons.")).toBeVisible();
  expect(document.querySelector('[aria-label="Mark response helpful"]')).toBeNull();
  expect(__activeQueryArgs("chatFeedback:getViewerVotes")).toEqual([]);
});
