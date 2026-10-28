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
 * Owner 2026-10-28 (Paper rows 34 and 35): a suggestion card's Review marks
 * only the words that change, inside the card's Line, and floats the review
 * bar over the report. Nothing shows in the report until Review is pressed.
 * Section headings are never marked.
 */
const CAPTURES = "../../../../.vitest-attachments/assistant-redesign";
const content = JSON.stringify(
  buildTiptapDocument(
    "Thermal investigation",
    "The technological uncertainty was whether the loop stays stable.",
    "Trials held one condition steady.",
    "The work clarified how load affects the loop."
  )
);

type Card = Record<string, unknown>;

function seed(card: Card) {
  __setQueryData("projects:getProject", { _id: "project-1", title: "Thermal investigation", clientName: "Acme", writer: "Writer", interviewer: "", interviewees: [], tagIds: [], mode: "generate", status: "review", workflowStage: "drafting", createdBy: "user-1", ownerId: "user-1", createdAt: 1, updatedAt: 1 });
  __setQueryData("users:getCurrentUser", { _id: "user-1", role: "writer", firstName: "Writer", email: "writer@example.test" });
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
  __setQueryData("reports:getLatestReport", { _id: "report-1", projectId: "project-1", version: 1, revisionNumber: 1, content, createdAt: 1, updatedAt: 1 });
  for (const name of ["generations:getLatestGeneration", "pdReviews:getLatestPdReview", "reportViews:getViewSummary"]) __setQueryData(name, null);
  for (const name of ["transcripts:listTranscripts", "documents:listDocuments", "tags:listTags", "comments:listComments", "chatV2:listTurns", "research:listSessions", "uploadAttempts:listUploadAttempts"]) __setQueryData(name, []);
  __setQueryData("chatV2:listThreads", [{ _id: "m1", agentThreadId: "thread-1", title: "Conversation" }]);
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", [
    { id: "q", key: "q", order: 1, stepOrder: 0, role: "user", status: "success", text: "Tighten it.", _creationTime: 1000, parts: [{ type: "text", text: "Tighten it." }] },
    { id: "a", key: "a", order: 1, stepOrder: 1, role: "assistant", status: "success", text: "Here is a suggestion.", _creationTime: 1000, parts: [{ type: "text", text: "Here is a suggestion." }] },
  ]);
  __setQueryData("chatV2:listProposals", [{
    _id: "proposal-1", _creationTime: 1000, agentThreadId: "thread-1", projectId: "project-1", reportId: "report-1",
    state: "pending", createdAt: 1000, ...card,
  }]);
  __setMutationResult("chatV2:applyProposal", { applied: true, count: 1 });
}

const edit: Card = {
  kind: "edit", section: "242", requireUniqueTarget: true,
  targetText: "The technological uncertainty was whether the loop stays stable.",
  newText: "The uncertainty was whether the loop stays steady.",
};

beforeEach(() => {
  __resetAuthState(); __resetPage(); __resetNavigation(); __resetConvexStub(); localStorage.clear();
  __setPageParams({ id: "project-1" });
});

const headingText = () =>
  Array.from(document.querySelectorAll("[data-report-section-heading]")).map((h) => h.getAttribute("data-report-section-heading"));
const texts = (selector: string) => Array.from(document.querySelectorAll(selector)).map((el) => el.textContent);

async function openCard() {
  await page.viewport(1440, 900);
  await render(PreviewProjectPage);
  await expect.element(page.getByText("The technological uncertainty was whether", { exact: false })).toBeVisible();
  if (!document.querySelector('[data-side-panel="chat"]')) await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Review", exact: true })).toBeVisible();
}

it("shows nothing in the report until Review, then marks only the words that change", async () => {
  seed(edit);
  await openCard();
  expect(document.querySelectorAll(".review-cut, .review-new").length).toBe(0);

  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect.poll(() => texts(".review-cut")).toEqual(["technological", "stable."]);
  expect(texts(".review-new")).toEqual(["steady."]);
  await expect.element(page.getByRole("toolbar", { name: "Review suggestion" })).toBeVisible();
  expect(headingText()).toEqual(["242", "244", "246"]);
  await page.screenshot({ path: `${CAPTURES}/v3-report-review.png` });

  // Show changes off: the report as it would read, new words lightly marked.
  await page.getByRole("switch", { name: "Show changes" }).click();
  await expect.poll(() => document.querySelectorAll(".review-new-quiet").length).toBe(1);
  expect(document.querySelectorAll(".review-cut").length).toBe(0);
  await page.screenshot({ path: `${CAPTURES}/v4-show-changes-off.png` });
});

it("accepts from the review bar and clears the marks", async () => {
  seed(edit);
  await openCard();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("toolbar", { name: "Review suggestion" }).getByRole("button", { name: "Accept" }).click();
  await expect.poll(() => __mutationCalls("chatV2:applyProposal")).toEqual([{ proposalId: "proposal-1" }]);
  await expect.poll(() => document.querySelectorAll(".review-cut, .review-new").length).toBe(0);
  expect(page.getByRole("toolbar", { name: "Review suggestion" }).elements()).toHaveLength(0);
});

it("marks a find and replace card only inside its own Line", async () => {
  seed({ kind: "replacements", section: "246", replacements: [{ find: "the loop", replaceWith: "the controller" }] });
  await openCard();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect.poll(() => texts(".review-new")).toEqual(["controller"]);
  expect(texts(".review-cut")).toEqual(["loop"]);
});

it("ends the review with Esc or Stop review", async () => {
  seed(edit);
  await openCard();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect.poll(() => document.querySelectorAll(".review-cut").length).toBe(2);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => document.querySelectorAll(".review-cut").length).toBe(0);
  await expect.element(page.getByRole("button", { name: "Review", exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Review", exact: true }).first().click();
  await page.getByRole("toolbar", { name: "Review suggestion" }).getByRole("button", { name: "Stop review" }).click();
  await expect.poll(() => document.querySelectorAll(".review-cut").length).toBe(0);
  expect(__mutationCalls("chatV2:applyProposal")).toEqual([]);
});
