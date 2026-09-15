import { beforeEach, describe, expect, it } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import CurrentProjectPage from "./CurrentProjectPage.svelte";
import { __resetPage, __setPageParams, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

/**
 * 2026-09-15 metadata gate on the current (classic) project page: same
 * `projects:getProjectEditAccess` contract as the preview workbench — a
 * definite `false` renders the title and SR&ED title as plain text and the
 * pickers as their values; loading keeps everything editable.
 */
const now = Date.UTC(2026, 8, 5, 12);

function seed() {
  __setQueryData("projects:getProject", {
    _id: "project-q4", title: "Thermal investigation", sredTitle: "Formal thermal title",
    clientName: "Acme Labs", writer: "Wren Writer", interviewer: "", interviewees: [],
    tagIds: ["tag-hw"], mode: "generate", status: "draft", workflowStage: "intake",
    industry: "manufacturing", scienceCode: "1.02.01", fiscalYearEnd: Date.UTC(2025, 11, 31, 12),
    createdBy: "writer-owner", ownerId: "writer-owner", createdAt: now, updatedAt: now,
    shareToken: "q4-fixture-token",
  });
  __setQueryData("users:getCurrentUser", {
    _id: "writer-other", role: "writer", firstName: "Wren", lastName: "Writer", email: "writer@example.test",
  });
  __setQueryData("reports:getLatestReport", null);
  __setQueryData("generations:getLatestGeneration", null);
  __setQueryData("pdReviews:getLatestPdReview", null);
  __setQueryData("transcripts:listTranscripts", []);
  __setQueryData("tags:listTags", [{ _id: "tag-hw", name: "Hardware", parentId: null }]);
  for (const name of ["documents:listDocuments", "comments:listComments",
    "pdReviews:listPdReviewEvents", "chatV2:listThreads", "chatV2:listProposals",
    "research:listSessions", "uploadAttempts:listUploadAttempts", "snapshots:listSnapshots"]) {
    __setQueryData(name, []);
  }
  __setQueryData("reportViews:getViewSummary", null);
}

const button = (name: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (el) => el.getAttribute("aria-label") === name
  ) ?? null;
const h1 = () => document.querySelector("h1");

async function mount(access: { canEditDetails: boolean } | undefined) {
  __setPageUrl("/project/project-q4?workspace=current");
  __setPageParams({ id: "project-q4" });
  seed();
  if (access !== undefined) __setQueryData("projects:getProjectEditAccess", access);
  await browserPage.viewport(1440, 1000);
  await render(CurrentProjectPage);
  await expect.poll(() => h1()?.textContent?.trim()).toBe("Thermal investigation");
}

describe("CurrentProjectPage metadata edit access", () => {
  beforeEach(() => {
    __resetAuthState(); __resetPage(); __resetNavigation(); __resetConvexStub();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("renders plain values and no edit controls when canEditDetails is false", async () => {
    await mount({ canEditDetails: false });

    for (const name of ["Edit internal project title", "Edit SR&ED title", "Edit fiscal year-end", "Add tags", "Remove tag Hardware"]) {
      expect(button(name), name).toBeNull();
    }
    expect(h1()!.parentElement!.querySelector("button")).toBeNull();
    expect(document.body.textContent).toContain("Formal thermal title");
    expect(document.body.textContent).toContain("Manufacturing");
    expect(document.body.textContent).toContain("1.02.01");
    expect(document.body.textContent).not.toContain("AI Suggests");
  });

  it("renders the editable controls when canEditDetails is true", async () => {
    await mount({ canEditDetails: true });

    expect(button("Edit internal project title")).not.toBeNull();
    expect(button("Edit SR&ED title")).not.toBeNull();
    expect(button("Add tags")).not.toBeNull();
    expect(document.body.textContent).toContain("AI Suggests");
  });

  it("keeps the controls editable while the access answer is still loading", async () => {
    await mount(undefined);

    expect(button("Edit SR&ED title")).not.toBeNull();
    expect(button("Add tags")).not.toBeNull();
  });
});
