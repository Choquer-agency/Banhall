import { beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import CurrentProjectPage from "./CurrentProjectPage.svelte";
import PreviewProjectPage from "./PreviewProjectPage.svelte";
import { __resetPage, __setPageParams } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __activeQueryCount, __activeQueryArgs, __mutationCalls, __resetConvexStub, __setQueryData, __setPaginatedRows, __setMutationResult } from "$lib/test/convex-svelte-stub.svelte";

const composer = () => page.getByRole("textbox", { name: "Message the report assistant" });
const variants = [{ name: "current", component: CurrentProjectPage }, { name: "preview", component: PreviewProjectPage }];
function seed() {
  __setQueryData("projects:getProject", { _id: "project-1", title: "Thermal investigation", clientName: "Acme", writer: "Writer", interviewer: "", interviewees: [], tagIds: [], mode: "generate", status: "review", workflowStage: "drafting", createdBy: "user-1", ownerId: "user-1", createdAt: 1, updatedAt: 1 });
  __setQueryData("users:getCurrentUser", { _id: "user-1", role: "writer", firstName: "Writer", email: "writer@example.test" });
  __setQueryData("reports:getLatestReport", { _id: "report-1", projectId: "project-1", version: 1, revisionNumber: 1, content: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Evidence from thermal trials." }] }] }), createdAt: 1, updatedAt: 1 });
  for (const name of ["generations:getLatestGeneration", "pdReviews:getLatestPdReview", "reportViews:getViewSummary"]) __setQueryData(name, null);
  for (const name of ["transcripts:listTranscripts", "documents:listDocuments", "tags:listTags", "comments:listComments", "chatV2:listThreads", "chatV2:listTurns", "chatV2:listProposals", "research:listSessions", "uploadAttempts:listUploadAttempts"]) __setQueryData(name, []);
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", []);
}
beforeEach(() => {
  __resetAuthState(); __resetPage(); __resetNavigation(); __resetConvexStub(); localStorage.clear();
  __setPageParams({ id: "project-1" }); seed();
});

for (const { name, component } of variants) {
  it(`${name}: remembered closed assistant starts no chat and preserves draft and pending send on reopen`, async () => {
    await page.viewport(1440, 1000);
    localStorage.setItem("banhall_chat_open", "0");
    await render(component);
    await expect.element(page.getByText("Evidence from thermal trials.", { exact: true })).toBeVisible();
    expect(__activeQueryCount("chatV2:listThreads")).toBe(0);
    expect(__activeQueryCount("research:listSessions")).toBe(0);
    await page.getByRole("button", { name: "Open AI assistant", exact: true }).first().click();
    await expect.element(composer()).toBeVisible();
    const textarea = composer().element();
    let acknowledge!: (value: { threadId: string; messageId: string }) => void;
    __setMutationResult("chatV2:sendMessage", new Promise(resolve => { acknowledge = resolve; }));
    await composer().fill("Explain the thermal trials");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect.poll(() => document.querySelector("[data-local-request]")?.getAttribute("data-send-state")).toBe("sending");
    const localResponse = document.querySelector("[data-local-request]");
    await composer().fill("Keep this next draft");
    await page.getByRole("button", { name: "Close assistant", exact: true }).click();
    await page.getByRole("button", { name: "Open AI assistant", exact: true }).first().click();
    await expect.element(composer()).toHaveValue("Keep this next draft");
    expect(composer().element()).toBe(textarea);
    expect(document.querySelector("[data-local-request]")).toBe(localResponse);
    expect(__mutationCalls("chatV2:sendMessage")).toHaveLength(1);
    acknowledge({ threadId: "thread-1", messageId: "prompt-1" });
    await expect.poll(() => localResponse?.getAttribute("data-send-state")).toBe("published");
  });

  it(`${name}: active response continues through QA and assistant reopening`, async () => {
    await page.viewport(1440, 1000);
    __setQueryData("chatV2:listThreads", [{ _id: "mapping-1", agentThreadId: "thread-1", title: "Active conversation" }]);
    const answer = (text: string) => ({ id: "answer-1", key: "answer-1", role: "assistant", order: 1, stepOrder: 1, status: "streaming", text, _creationTime: 1, parts: [{ type: "text", text }] });
    __setPaginatedRows("chatV2:listMessages", [answer("Active response begins")]);
    await render(component);
    await expect.element(composer()).toBeVisible();
    const textarea = composer().element();
    await expect.element(page.getByText("Active response begins", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open QA panel", exact: true }).click();
    await expect.element(page.getByRole("button", { name: "Close QA review", exact: true })).toBeVisible();
    __setPaginatedRows("chatV2:listMessages", [answer("Active response advances while hidden")]);
    await page.getByRole("button", { name: "Open AI assistant", exact: true }).first().click();
    await expect.element(page.getByText("Active response advances while hidden", { exact: true })).toBeVisible();
    expect(composer().element()).toBe(textarea);
    expect(__mutationCalls("chatV2:sendMessage")).toHaveLength(0);
  });

  it(`${name}: opens history and each generation tool only on its existing route branch`, async () => {
    await page.viewport(1440, 1000);
    localStorage.setItem("banhall_chat_open", "0");
    __setQueryData("snapshots:listSnapshots", []);
    await render(component);
    await expect.element(page.getByText("Evidence from thermal trials.", { exact: true })).toBeVisible();
    expect(__activeQueryCount("snapshots:listSnapshots")).toBe(0);
    expect(__activeQueryCount("generations:getCandidates")).toBe(0);
    expect(__activeQueryCount("generations:getIterativeState")).toBe(0);
    await page.getByRole("button", { name: "History", exact: true }).click();
    await expect.element(page.getByRole("button", { name: "Close version history", exact: true })).toBeVisible();
    expect(__activeQueryArgs("snapshots:listSnapshots")).toEqual([{ reportId: "report-1" }]);
    await page.getByRole("button", { name: "Close version history", exact: true }).click();
    __setQueryData("generations:getLatestGeneration", { _id: "generation-1", status: "awaiting_selection", candidateMode: "compare" });
    await expect.poll(() => __activeQueryArgs("generations:getCandidates"), { timeout: 10000 }).toEqual([{ generationId: "generation-1" }]);
    __setQueryData("generations:getLatestGeneration", { _id: "generation-2", status: "awaiting_input", candidateMode: "iterative" });
    await expect.poll(() => __activeQueryArgs("generations:getIterativeState"), { timeout: 10000 }).toEqual([{ generationId: "generation-2" }]);
  });

  it(`${name}: remembered QA does not initialize chat`, async () => {
    await page.viewport(1440, 1000);
    localStorage.setItem("banhall_qa_open", "1");
    await render(component);
    await expect.element(page.getByText("Evidence from thermal trials.", { exact: true })).toBeVisible();
    expect(__activeQueryCount("chatV2:listThreads")).toBe(0);
  });
}

it("preview mobile starts report-only, activates Agent once, and retains its draft across panes", async () => {
  await page.viewport(390, 850);
  await render(PreviewProjectPage);
  await expect.element(page.getByText("Evidence from thermal trials.", { exact: true })).toBeVisible();
  expect(__activeQueryCount("chatV2:listThreads")).toBe(0);
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expect.element(composer()).toBeVisible();
  const textarea = composer().element();
  await composer().fill("Mobile draft survives");
  await page.getByRole("button", { name: "Report", exact: true }).click();
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expect.element(composer()).toHaveValue("Mobile draft survives");
  expect(composer().element()).toBe(textarea);
});

it("preview activates the default-open assistant when a mobile report becomes desktop", async () => {
  await page.viewport(390, 850);
  await render(PreviewProjectPage);
  await expect.element(page.getByText("Evidence from thermal trials.", { exact: true })).toBeVisible();
  expect(__activeQueryCount("chatV2:listThreads")).toBe(0);
  await page.viewport(1440, 1000);
  await expect.element(composer()).toBeVisible();
});

for (const action of ["Ask AI about this", "Research this selection"]) {
  it(`preview mobile exposes the assistant for ${action}`, async () => {
    await page.viewport(390, 850);
    await render(PreviewProjectPage);
    const paragraph = page.getByText("Evidence from thermal trials.", { exact: true });
    await expect.element(paragraph).toBeVisible();
    await paragraph.click();
    await userEvent.keyboard("{Home}{Shift>}{End}{/Shift}");
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect.element(composer()).toBeVisible();
    await expect.element(page.getByRole("button", { name: action.startsWith("Ask") ? "Remove pasted text" : "Remove research selection", exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Agent", exact: true })).toHaveAttribute("aria-pressed", "true");
  });
}
