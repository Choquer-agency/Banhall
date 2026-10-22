/**
 * Chat parity Phase A, task 2: Esc on the report page closes the Assistant
 * only when nothing else handled it (a menu, a dialog) and the composer holds
 * no unsent text. Both report pages share the rule. Fictional data only.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import CurrentProjectPage from "./CurrentProjectPage.svelte";
import PreviewProjectPage from "./PreviewProjectPage.svelte";
import { __resetPage, __setPageParams, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetConvexStub, __setPaginatedRows, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

const now = Date.UTC(2026, 8, 5, 12);
const content = JSON.stringify({ type: "doc", content: [
  { type: "paragraph", content: [{ type: "text", text: "Evidence from thermal trials." }] },
] });

function seed() {
  __setQueryData("projects:getProject", {
    _id: "project-1", title: "Adaptive cold storage controls", sredTitle: "", clientName: "Cedarline Systems",
    writer: "Writer", interviewer: "", interviewees: [], tagIds: [], mode: "generate", status: "review",
    workflowStage: "drafting", createdBy: "user-1", ownerId: "user-1", createdAt: now, updatedAt: now,
    industry: "manufacturing", scienceCode: "2.03.01", fiscalYearEnd: now, projectNumber: "1A",
  });
  __setQueryData("users:getCurrentUser", { _id: "user-1", role: "writer", firstName: "Jordan", lastName: "Ellis", email: "jordan@example.test" });
  __setQueryData("reports:getLatestReport", {
    _id: "report-1", projectId: "project-1", generationId: "gen-1", version: 1, revisionNumber: 1,
    content, createdAt: 1, updatedAt: 1,
  });
  __setQueryData("generations:getLatestGeneration", { _id: "gen-1", status: "completed", candidateMode: "single", postQaStatus: "done" });
  __setQueryData("generations:getGenerationSeedView", null);
  for (const name of ["pdReviews:getLatestPdReview", "reportViews:getViewSummary"]) __setQueryData(name, null);
  for (const name of ["documents:listDocuments", "tags:listTags", "comments:listComments", "chatV2:listThreads",
    "chatV2:listTurns", "chatV2:listProposals", "research:listSessions", "uploadAttempts:listUploadAttempts",
    "pdReviews:listPdReviewEvents", "snapshots:listSnapshots", "transcripts:listTranscripts"]) {
    __setQueryData(name, []);
  }
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
  __setQueryData("projectWorkflow:getProjectWorkflowHeader", {
    workflowStage: "drafting", stageIsFallback: false, workflowUpdatedAt: now, workflowVersion: 3,
    owner: { userId: "user-1", initials: "JE", label: "Jordan Ellis" }, ownerNeedsReview: false,
    createdByLabel: "Jordan Ellis", viewerAuthorities: ["owner"],
  });
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", []);
}

const composer = () => page.getByRole("textbox", { name: "Message the report assistant" });
const escape = () => userEvent.keyboard("{Escape}");

beforeEach(async () => {
  __resetAuthState(); __resetPage(); __resetNavigation(); __resetConvexStub();
  localStorage.clear(); sessionStorage.clear();
  document.body.innerHTML = "";
  await page.viewport(1440, 900);
});

describe("Esc on the preview report page", () => {
  async function openAssistant() {
    __setPageParams({ id: "project-1" });
    seed();
    await render(PreviewProjectPage);
    await page.getByRole("button", { name: "Assistant", exact: true }).click();
    await expect.element(composer()).toBeVisible();
  }
  const assistantOpen = () => document.querySelector('[data-panel-toggle="assistant"]')?.getAttribute("aria-pressed");

  it("leaves the Assistant open when Esc closes one of its menus", async () => {
    await openAssistant();
    await page.getByRole("button", { name: "Message options", exact: true }).click();
    const option = page.getByRole("menuitemcheckbox", { name: "Use Brain examples for this message" });
    await expect.element(option).toBeVisible();
    await escape();
    await expect.poll(() => option.elements().length).toBe(0);
    expect(assistantOpen()).toBe("true");
    await expect.element(composer()).toBeVisible();
  });

  it("leaves the Assistant open while the composer holds text, and closes it once empty", async () => {
    await openAssistant();
    await composer().fill("Tighten the uncertainty in Line 242.");
    await escape();
    expect(assistantOpen()).toBe("true");
    await page.screenshot({ path: "../../../../.vitest-attachments/chat-parity-phase-a/esc-keeps-draft.png" });
    // Esc from elsewhere on the page keeps it open too.
    (document.activeElement as HTMLElement | null)?.blur();
    await escape();
    expect(assistantOpen()).toBe("true");
    await composer().fill("");
    await escape();
    await expect.poll(assistantOpen).toBe("false");
  });

  // Fable review F3 P3-1: a message option set for the next message is unsent
  // work too, so Esc keeps the Assistant open while Brain is on.
  it("leaves the Assistant open while Brain is on for the next message", async () => {
    await openAssistant();
    await page.getByRole("button", { name: "Message options", exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name: "Use Brain examples for this message" }).click();
    await escape();
    (document.activeElement as HTMLElement | null)?.blur();
    await escape();
    expect(assistantOpen()).toBe("true");
  });
});

describe("Esc on the current report page", () => {
  async function openAssistant() {
    __setPageUrl("/project/project-1?workspace=current");
    __setPageParams({ id: "project-1" });
    seed();
    await render(CurrentProjectPage);
    await expect.element(composer()).toBeVisible();
  }
  const launcher = () => page.getByRole("button", { name: "Open AI assistant", exact: true });

  it("leaves the Assistant open when Esc closes one of its menus", async () => {
    await openAssistant();
    await page.getByRole("button", { name: "Message options", exact: true }).click();
    const option = page.getByRole("menuitemcheckbox", { name: "Use Brain examples for this message" });
    await expect.element(option).toBeVisible();
    await escape();
    await expect.poll(() => option.elements().length).toBe(0);
    expect(launcher().elements()).toHaveLength(0);
  });

  it("leaves the Assistant open while the composer holds text, and closes it once empty", async () => {
    await openAssistant();
    await composer().fill("Check this report for banned words.");
    await escape();
    expect(launcher().elements()).toHaveLength(0);
    await composer().fill("");
    await escape();
    await expect.element(launcher()).toBeVisible();
  });
});
