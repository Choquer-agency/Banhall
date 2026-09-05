import { beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { UIMessage } from "@convex-dev/agent";
import type { Id } from "../../../../convex/_generated/dataModel";
import AgentChatPanel from "./AgentChatPanel.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetConvexStub, __setPaginatedRows, __setQueryData, __setMutationResult, __setMutationError, __mutationCalls, __activeQueryArgs } from "$lib/test/convex-svelte-stub.svelte";

const reportId = "report-1" as Id<"reports">;
const projectId = "project-1" as Id<"projects">;
const output = `\n\n# SIMILAR PAST REPORTS FROM THE BRAIN (reference patterns only)\nUse them ONLY as a guide.\n\n--- REFERENCE PATTERN 1 (Control systems — CRA 2.02.01 Software engineering — writer: Private Writer) ---\nPrivate exemplar body`;
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
  await page.screenshot({ path: "../../../../.audit/CAP-7-story-5/after-chat.png" });
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

it("rates only the last assistant message of a completed multi-step turn", async () => {
  __setPaginatedRows("chatV2:listMessages", [answer({ id: "earlier", key: "earlier", stepOrder: 0 }), answer()]);
  await render(AgentChatPanel, { reportId, projectId });
  await expect.poll(() => document.querySelectorAll('[aria-label="Mark response helpful"]').length).toBe(1);
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
