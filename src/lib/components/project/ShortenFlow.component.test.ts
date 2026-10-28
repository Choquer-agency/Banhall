import { beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import PreviewProjectPage from "./PreviewProjectPage.svelte";
import { __resetPage, __setPageParams } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __mutationCalls, __resetConvexStub, __setMutationResult, __setPaginatedRows, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { buildTiptapDocument } from "../../../../convex/lib/tiptapReport";

/**
 * Owner 2026-10-28 (Paper row 21): a Line over its CRA limit shows a red
 * "35 words over" pill; it opens a popover whose "Ask the Assistant to
 * shorten it" sends the request in a new conversation, and the pill reads
 * "Shortening" while the reply is on its way.
 */
const CAPTURES = "../../../../.vitest-attachments/assistant-redesign";
const words = (count: number) => Array.from({ length: count }, (_, index) => `word${index}`).join(" ");
const content = JSON.stringify(buildTiptapDocument("Thermal investigation", words(385), "Trials held one condition steady.", "The work clarified how load affects the loop."));

function seed() {
  __setQueryData("projects:getProject", { _id: "project-1", title: "Thermal investigation", clientName: "Acme", writer: "Writer", interviewer: "", interviewees: [], tagIds: [], mode: "generate", status: "review", workflowStage: "drafting", createdBy: "user-1", ownerId: "user-1", createdAt: 1, updatedAt: 1 });
  __setQueryData("users:getCurrentUser", { _id: "user-1", role: "writer", firstName: "Writer", email: "writer@example.test" });
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
  __setQueryData("reports:getLatestReport", { _id: "report-1", projectId: "project-1", version: 1, revisionNumber: 1, content, createdAt: 1, updatedAt: 1 });
  for (const name of ["generations:getLatestGeneration", "pdReviews:getLatestPdReview", "reportViews:getViewSummary"]) __setQueryData(name, null);
  for (const name of ["transcripts:listTranscripts", "documents:listDocuments", "tags:listTags", "comments:listComments", "chatV2:listTurns", "research:listSessions", "uploadAttempts:listUploadAttempts", "chatV2:listThreads", "chatV2:listProposals"]) __setQueryData(name, []);
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", []);
  __setMutationResult("chatV2:sendMessage", { threadId: "thread-new", messageId: "q-new" });
}

beforeEach(() => {
  __resetAuthState(); __resetPage(); __resetNavigation(); __resetConvexStub(); localStorage.clear(); sessionStorage.clear();
  __setPageParams({ id: "project-1" });
  seed();
});

it("opens the limit popover from the pill and asks the Assistant to shorten the Line", async () => {
  await page.viewport(1440, 900);
  await render(PreviewProjectPage);
  const pill = page.getByRole("button", { name: /35 words over/ });
  await expect.element(pill).toBeVisible();
  await pill.click();
  const popover = page.getByRole("dialog", { name: "Line 242 is over the CRA limit" });
  await expect.element(popover).toBeVisible();
  await expect.element(popover).toHaveTextContent(/Words\s*385 of 350/);
  await page.screenshot({ path: `${CAPTURES}/f1-limit-popover.png` });

  await page.getByRole("button", { name: "Ask the Assistant to shorten it" }).click();
  await expect.poll(() => (__mutationCalls("chatV2:sendMessage")[0] as { content?: string; newThread?: boolean } | undefined))
    .toMatchObject({ content: "Shorten Line 242 so it fits the CRA limit. It is 35 words over.", newThread: true });
  expect(__mutationCalls("chatV2:sendMessage")).toHaveLength(1);
  await expect.element(page.getByText("Shortening", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${CAPTURES}/f2-shortening.png` });
});

it("closes the popover with Esc and gives focus back to the pill", async () => {
  await page.viewport(1440, 900);
  await render(PreviewProjectPage);
  const pill = page.getByRole("button", { name: /35 words over/ });
  await pill.click();
  await expect.element(page.getByRole("dialog", { name: "Line 242 is over the CRA limit" })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => document.querySelector("[data-limit-popover]")).toBeNull();
  await expect.poll(() => document.activeElement === pill.element()).toBe(true);
});
