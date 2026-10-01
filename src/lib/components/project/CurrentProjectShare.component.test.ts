import { beforeEach, describe, expect, it } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import CurrentProjectPage from "./CurrentProjectPage.svelte";
import { __resetPage, __setPageParams, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

/**
 * Security wave 1 (audit 2026-09-25, a4 #22): Share is offered to whoever
 * publishForReview accepts, the project.setStage capability (the current
 * Owner, a Manager or an Admin), never to the creator as such.
 */
const now = Date.UTC(2026, 8, 5, 12);
const REPORT_DOC = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Report prose." }] }],
});

function seed(user: { _id: string; role: "writer" | "manager" | "admin" }) {
  __setQueryData("projects:getProject", {
    _id: "project-share", title: "Share project", clientName: "Acme Labs", writer: "Wren Writer",
    interviewer: "", interviewees: [], tagIds: [], mode: "generate", status: "review",
    workflowStage: "drafting", createdBy: "writer-creator", ownerId: "writer-owner",
    createdAt: now, updatedAt: now, shareToken: "share-fixture-token",
  });
  __setQueryData("users:getCurrentUser", { ...user, firstName: "Test", lastName: "User", email: "u@example.test" });
  __setQueryData("reports:getLatestReport", {
    _id: "report-share", projectId: "project-share", content: REPORT_DOC, version: 1,
    revisionNumber: 0, generatedAt: now, updatedAt: now,
  });
  __setQueryData("generations:getLatestGeneration", null);
  __setQueryData("pdReviews:getLatestPdReview", null);
  __setQueryData("transcripts:listTranscripts", []);
  __setQueryData("tags:listTags", []);
  for (const name of ["documents:listDocuments", "comments:listComments",
    "pdReviews:listPdReviewEvents", "chatV2:listThreads", "chatV2:listProposals",
    "research:listSessions", "uploadAttempts:listUploadAttempts", "snapshots:listSnapshots"]) {
    __setQueryData(name, []);
  }
  __setQueryData("reportViews:getViewSummary", null);
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
}

const shareButton = () => document.querySelector('button[title="Publish and copy review link"]');

async function mount(user: { _id: string; role: "writer" | "manager" | "admin" }) {
  __setPageUrl("/project/project-share?workspace=current");
  __setPageParams({ id: "project-share" });
  seed(user);
  await browserPage.viewport(1440, 1000);
  await render(CurrentProjectPage);
  await expect.poll(() => document.querySelector("h1")?.textContent?.trim()).toBe("Share project");
}

describe("CurrentProjectPage Share", () => {
  beforeEach(() => {
    __resetAuthState(); __resetPage(); __resetNavigation(); __resetConvexStub();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("offers Share to the current Owner, who did not create the project", async () => {
    await mount({ _id: "writer-owner", role: "writer" });
    await expect.poll(shareButton).not.toBeNull();
  });

  it("offers Share to a Manager", async () => {
    await mount({ _id: "manager-1", role: "manager" });
    await expect.poll(shareButton).not.toBeNull();
  });

  it("does not offer Share to the creator once ownership moved on", async () => {
    await mount({ _id: "writer-creator", role: "writer" });
    // Wait for the toolbar to settle before asserting the absence.
    await expect.poll(() => document.body.textContent).toContain("Report prose.");
    expect(shareButton()).toBeNull();
  });
});
