import { beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import PreviewProjectPage from "./PreviewProjectPage.svelte";
import { __resetPage, __setPageParams } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __mutationCalls, __resetConvexStub, __setMutationResult, __setPaginatedRows, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { buildTiptapDocument } from "../../../../convex/lib/tiptapReport";

/**
 * Review g1: the one-by-one replace review must not offer matches inside the
 * hidden Section headings, count a refused replacement, or mark a proposal
 * applied when nothing changed.
 */
const content = JSON.stringify(
  buildTiptapDocument(
    "Thermal investigation",
    "The technological uncertainty was whether the loop stays stable.",
    "Trials held one condition steady.",
    "The work clarified how load affects stability."
  )
);

function seed(find: string, replaceWith: string) {
  __setQueryData("projects:getProject", { _id: "project-1", title: "Thermal investigation", clientName: "Acme", writer: "Writer", interviewer: "", interviewees: [], tagIds: [], mode: "generate", status: "review", workflowStage: "drafting", createdBy: "user-1", ownerId: "user-1", createdAt: 1, updatedAt: 1 });
  __setQueryData("users:getCurrentUser", { _id: "user-1", role: "writer", firstName: "Writer", email: "writer@example.test" });
  __setQueryData("reports:getLatestReport", { _id: "report-1", projectId: "project-1", version: 1, revisionNumber: 1, content, createdAt: 1, updatedAt: 1 });
  for (const name of ["generations:getLatestGeneration", "pdReviews:getLatestPdReview", "reportViews:getViewSummary"]) __setQueryData(name, null);
  for (const name of ["transcripts:listTranscripts", "documents:listDocuments", "tags:listTags", "comments:listComments", "chatV2:listTurns", "research:listSessions", "uploadAttempts:listUploadAttempts"]) __setQueryData(name, []);
  __setQueryData("chatV2:listThreads", [{ _id: "m1", agentThreadId: "thread-1", title: "Conversation" }]);
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", [
    { id: "q", key: "q", order: 1, stepOrder: 0, role: "user", status: "success", text: "Tighten it.", _creationTime: 1000, parts: [{ type: "text", text: "Tighten it." }] },
    { id: "a", key: "a", order: 1, stepOrder: 1, role: "assistant", status: "success", text: "Here are replacements.", _creationTime: 1000, parts: [{ type: "text", text: "Here are replacements." }] },
  ]);
  __setQueryData("chatV2:listProposals", [{
    _id: "proposal-1", _creationTime: 1000, agentThreadId: "thread-1", projectId: "project-1", reportId: "report-1",
    kind: "replacements", state: "pending", createdAt: 1000, replacements: [{ find, replaceWith }],
  }]);
  __setMutationResult("chatV2:markProposalApplied", { revisionNumber: 2 });
}

beforeEach(() => {
  __resetAuthState(); __resetPage(); __resetNavigation(); __resetConvexStub(); localStorage.clear();
  __setPageParams({ id: "project-1" });
});

const headingText = () =>
  Array.from(document.querySelectorAll("[data-report-section-heading]")).map((h) => h.getAttribute("data-report-section-heading"));

async function openReview() {
  await page.viewport(1440, 1000);
  await render(PreviewProjectPage);
  await expect.element(page.getByText("The technological uncertainty was whether", { exact: false })).toBeVisible();
  if (!document.querySelector('[data-side-panel="chat"]')) await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page.getByRole("button", { name: "Review individually", exact: true }).click();
}

it("offers no match that sits only in a hidden heading, and marks nothing applied", async () => {
  seed("Work Performed", "");
  await openReview();
  await expect.element(page.getByText("No matching passage remains for “Work Performed”", { exact: false })).toBeVisible();
  expect(page.getByText("Reviewing replacements", { exact: true }).elements()).toHaveLength(0);
  const replaceAll = page.getByRole("button", { name: "Replace All", exact: true });
  if (replaceAll.elements().length > 0) await replaceAll.click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(__mutationCalls("chatV2:markProposalApplied")).toEqual([]);
  expect(headingText()).toEqual(["242", "244", "246"]);
});

it("counts and replaces only the prose match beside a heading match", async () => {
  seed("technological uncertainty", "technical question");
  await openReview();
  await expect.poll(() => /Instance 1 of (\d+)/.exec(document.body.textContent ?? "")?.[1]).toBe("1");
  await page.getByRole("button", { name: "Replace All", exact: true }).click();
  await expect.poll(() => __mutationCalls("chatV2:markProposalApplied").length).toBe(1);
  const saved = (__mutationCalls("chatV2:markProposalApplied")[0] as { content: string }).content;
  expect(saved).toContain("The technical question was whether");
  expect(saved).toContain("Line 242 — Scientific/Technological Uncertainty");
});
