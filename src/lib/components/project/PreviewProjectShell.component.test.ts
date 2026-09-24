import { beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import PreviewProjectPage from "./PreviewProjectPage.svelte";
import { __resetPage, __setPageParams } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setPaginatedRows,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * The preview report page's final shell (ui-design-final.md sections 2 and 8,
 * row 5): tabs by mode, toolbar toggles, the persisted full-width reading
 * column, Assistant full screen in a 720px column, the Details side panel
 * and Send for review opening the Hand off view.
 */
function seed({ seedRun = false }: { seedRun?: boolean } = {}) {
  __setQueryData("projects:getProject", {
    _id: "project-1",
    title: "Adaptive cold storage controls",
    clientName: "Cedarline Systems",
    writer: "Writer",
    interviewer: "",
    interviewees: [],
    tagIds: [],
    mode: "generate",
    status: "review",
    workflowStage: "drafting",
    createdBy: "user-1",
    ownerId: "user-1",
    createdAt: new Date(2026, 8, 17).getTime(),
    updatedAt: Date.now() - 12 * 60_000,
    industry: "manufacturing",
    scienceCode: "2.03.01",
    fiscalYearEnd: new Date(2026, 5, 30).getTime(),
    projectNumber: "1A",
  });
  __setQueryData("users:getCurrentUser", { _id: "user-1", role: "writer", firstName: "Jordan", lastName: "Ellis", email: "jordan@example.test" });
  __setQueryData("reports:getLatestReport", {
    _id: "report-1",
    projectId: "project-1",
    generationId: "gen-1",
    version: 1,
    revisionNumber: 1,
    content: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Evidence from thermal trials." }] }] }),
    createdAt: 1,
    updatedAt: 1,
  });
  __setQueryData("generations:getLatestGeneration", {
    _id: "gen-1",
    status: "completed",
    candidateMode: seedRun ? "iterative" : "single",
    gatedWorkflow: seedRun ? "seeds" : undefined,
    seedPhase: seedRun ? "completed" : undefined,
    summaryVersionId: seedRun ? "summary-1" : null,
    postQaStatus: "done",
    agentOutputs: JSON.stringify({ qa: { overall_score: 78, section_scores: { "242": { score: 86 }, "244": { score: 62 } } } }),
  });
  __setQueryData(
    "generations:getGenerationSeedView",
    seedRun ? { _id: "gen-1", gatedWorkflow: "seeds", seedPhase: "completed", summaryVersionId: "summary-1", seedCanEdit: true } : null
  );
  for (const name of ["pdReviews:getLatestPdReview", "reportViews:getViewSummary"]) __setQueryData(name, null);
  for (const name of ["documents:listDocuments", "tags:listTags", "comments:listComments", "chatV2:listThreads", "chatV2:listTurns", "chatV2:listProposals", "research:listSessions", "uploadAttempts:listUploadAttempts"]) __setQueryData(name, []);
  __setQueryData("transcripts:listTranscripts", [{ _id: "t-1", label: "Interview with Priya", position: 0, createdAt: 1, charCount: 60, wordCount: 10 }]);
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
  __setQueryData("projectWorkflow:getProjectWorkflowHeader", {
    workflowStage: "drafting",
    stageIsFallback: false,
    workflowUpdatedAt: Date.now() - 12 * 60_000,
    workflowVersion: 3,
    owner: { userId: "user-1", initials: "JE", label: "Jordan Ellis" },
    ownerNeedsReview: false,
    createdByLabel: "Jordan Ellis",
    viewerAuthorities: ["owner"],
  });
  __setQueryData("workItems:getProjectWorkPanel", {
    currentHandoffId: null,
    openItems: [],
    viewer: { canCreate: true, canCreateFinancial: false },
    assignable: true,
    assignableReason: null,
    pointerHealthy: true,
    truncated: false,
  });
  __setQueryData("workItems:listAssigneeCandidates", {
    candidates: [
      { userId: "user-1", label: "Jordan Ellis", initials: "JE", email: null, role: "writer" },
      { userId: "user-2", label: "Sam Chen", initials: "SC", email: null, role: "manager" },
    ],
    truncated: false,
  });
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", []);
}

const tabs = () => Array.from(document.querySelectorAll("[data-panel-tab]")).map((tab) => tab.getAttribute("data-panel-tab"));
const surface = () => document.querySelector<HTMLElement>("[data-report-surface]")!;

describe("PreviewProjectPage final shell", () => {
  beforeEach(async () => {
    __resetAuthState();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    localStorage.clear();
    document.body.innerHTML = "";
    __setPageParams({ id: "project-1" });
    await page.viewport(1440, 900);
  });

  it("shows Report and Sources for a one-shot report, with the page actions in the top bar", async () => {
    seed();
    await render(PreviewProjectPage);
    await expect.element(page.getByText("Evidence from thermal trials.", { exact: true })).toBeVisible();
    expect(tabs()).toEqual(["report", "sources"]);
    expect(document.querySelector('[data-panel-tab="report"]')?.getAttribute("aria-current")).toBe("page");
    expect(document.querySelector('[data-panel-tab="sources"]')?.textContent).toContain("1");
    // Top bar: breadcrumb and title, bell, More, Export, Send for review.
    const header = document.querySelector<HTMLElement>("[data-workspace-page-header]")!;
    expect(header.querySelector("h1")?.textContent).toBe("Adaptive cold storage controls");
    expect(header.textContent).toContain("Projects");
    expect(header.querySelector("[data-top-bar-bell]")).not.toBeNull();
    const exportButton = page.getByRole("button", { name: "Export .docx", exact: true }).element() as HTMLElement;
    expect(exportButton.className).toContain("bg-chrome");
    expect(page.getByRole("button", { name: "Send for review", exact: true }).elements()).toHaveLength(1);
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    const items = Array.from(document.querySelectorAll("[data-top-bar-more-item]")).map((item) => item.getAttribute("data-top-bar-more-item"));
    expect(items).toEqual(["ai-review", "share", "history", "financial"]);
    // The QA toggle carries the band chip.
    expect(document.querySelector("[data-qa-score-chip]")?.textContent).toBe("78");
  });

  it("shows Plan, Summary, Report and Sources for a Step-by-step report, with Plan and Summary done", async () => {
    seed({ seedRun: true });
    await render(PreviewProjectPage);
    await expect.element(page.getByText("Evidence from thermal trials.", { exact: true })).toBeVisible();
    expect(tabs()).toEqual(["plan", "summary", "report", "sources"]);
    const tab = (id: string) => document.querySelector<HTMLButtonElement>(`[data-panel-tab="${id}"]`)!;
    expect(tab("plan").textContent).toContain("done");
    expect(tab("summary").textContent).toContain("done");
    expect(tab("summary").getAttribute("aria-label")).toBe("Signed-off Summary");
    expect(tab("report").getAttribute("aria-current")).toBe("page");
  });

  it("opens the Sources view without unmounting the report", async () => {
    seed();
    await render(PreviewProjectPage);
    await expect.element(page.getByText("Evidence from thermal trials.", { exact: true })).toBeVisible();
    const editorText = page.getByText("Evidence from thermal trials.", { exact: true }).element();
    await page.getByRole("button", { name: /^Sources/ }).click();
    await expect.element(page.getByText("Interview with Priya", { exact: true })).toBeVisible();
    expect(document.querySelector('[data-panel-tab="sources"]')?.getAttribute("aria-current")).toBe("page");
    await page.getByRole("button", { name: "Report", exact: true }).click();
    await expect.element(page.getByText("Evidence from thermal trials.", { exact: true })).toBeVisible();
    expect(page.getByText("Evidence from thermal trials.", { exact: true }).element()).toBe(editorText);
  });

  it("switches between the 660px reading column and full width, and remembers it per browser", async () => {
    seed();
    localStorage.setItem("banhall_chat_open", "0");
    const screen = await render(PreviewProjectPage);
    await expect.element(page.getByText("Evidence from thermal trials.", { exact: true })).toBeVisible();
    expect(surface().getAttribute("data-report-width")).toBe("reading");
    const style = getComputedStyle(surface());
    expect(surface().getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)).toBe(660);
    const toggle = page.getByRole("button", { name: "Full width", exact: true });
    await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect.poll(() => surface().getAttribute("data-report-width")).toBe("full");
    await expect.poll(() => getComputedStyle(surface()).paddingLeft).toBe("96px");
    await expect.poll(() => localStorage.getItem("banhall_project_editor_maximized")).toBe("1");
    // With a side panel open the full-width report keeps 48px sides.
    await page.getByRole("button", { name: "Details", exact: true }).click();
    await expect.poll(() => getComputedStyle(surface()).paddingLeft).toBe("48px");
    screen.unmount();
    document.body.innerHTML = "";
    await render(PreviewProjectPage);
    await expect.element(page.getByText("Evidence from thermal trials.", { exact: true })).toBeVisible();
    await expect.poll(() => surface().getAttribute("data-report-width")).toBe("full");
    await expect.element(page.getByRole("button", { name: "Full width", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  it("puts the Assistant in a 400px right panel and takes the page in a 720px column when expanded", async () => {
    seed();
    await render(PreviewProjectPage);
    await expect.element(page.getByRole("textbox", { name: "Message the report assistant" })).toBeVisible();
    const aside = document.querySelector<HTMLElement>("[data-side-panel]")!;
    await expect.poll(() => aside.getBoundingClientRect().width).toBe(400);
    const main = document.querySelector<HTMLElement>("[data-project-main]")!;
    expect(aside.getBoundingClientRect().left).toBeGreaterThan(main.getBoundingClientRect().left);
    expect(document.querySelector('[data-panel-toggle="assistant"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("[data-side-panel-divider]")?.getAttribute("aria-valuenow")).toBe("400");

    await page.getByRole("button", { name: "Expand assistant", exact: true }).click();
    await expect.poll(() => document.querySelector("[data-assistant-column]")?.getAttribute("data-assistant-column")).toBe("full");
    await expect.poll(() => document.querySelector<HTMLElement>("[data-assistant-column]")!.getBoundingClientRect().width).toBe(720);
    expect(getComputedStyle(main).display).toBe("none");
    expect(document.querySelector('[data-panel-toggle="full-width"]')).toBeNull();
    await page.getByRole("button", { name: "Collapse assistant", exact: true }).click();
    await expect.poll(() => getComputedStyle(main).display).not.toBe("none");
    await expect.poll(() => aside.getBoundingClientRect().width).toBe(400);
  });

  it("resizes the side panel from the keyboard and remembers the width", async () => {
    seed();
    await render(PreviewProjectPage);
    await expect.poll(() => document.querySelector("[data-side-panel-divider]")).not.toBeNull();
    const divider = document.querySelector<HTMLElement>("[data-side-panel-divider]")!;
    divider.focus();
    divider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    await expect.poll(() => divider.getAttribute("aria-valuenow")).toBe("416");
    await expect.poll(() => localStorage.getItem("banhall_side_panel_width")).toBe("416");
  });

  it("opens Details in the side slot, one panel at a time, and saves a fact through the adapter", async () => {
    seed();
    await render(PreviewProjectPage);
    await expect.element(page.getByRole("textbox", { name: "Message the report assistant" })).toBeVisible();
    await page.getByRole("button", { name: "Details", exact: true }).click();
    await expect.element(page.getByRole("heading", { name: "Details", exact: true })).toBeVisible();
    expect(document.querySelector("[data-side-panel]")?.getAttribute("data-side-panel")).toBe("details");
    expect(document.querySelector('[data-panel-toggle="assistant"]')?.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector("[data-details-status-line]")?.textContent?.trim()).toBe("Drafting");
    await page.getByRole("button", { name: "Edit science code", exact: true }).click();
    await page.getByPlaceholder("Search by name or code").fill("robotics");
    await expect.poll(() => document.querySelectorAll("[data-command-item]").length).toBe(1);
    (document.querySelector("[data-command-item]") as HTMLElement).click();
    await expect.poll(() => __mutationCalls("projects:updateProjectScienceCode")).toEqual([
      { projectId: "project-1", scienceCode: "2.02.02" },
    ]);
    await page.getByRole("button", { name: "Close details", exact: true }).click();
    await expect.poll(() => document.querySelector("[data-side-panel]")?.getAttribute("data-side-panel") ?? null).toBeNull();
  });

  it("opens QA in the side slot with the quiet score line and band-coloured bars", async () => {
    seed();
    localStorage.setItem("banhall_chat_open", "0");
    await render(PreviewProjectPage);
    await expect.element(page.getByText("Evidence from thermal trials.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^QA review/ }).click();
    await expect.poll(() => document.querySelector("[data-qa-overall]")).not.toBeNull();
    expect(document.querySelector("[data-side-panel]")?.getAttribute("data-side-panel")).toBe("qa");
    expect(document.querySelector("[data-qa-overall]")?.textContent).toContain("78/100");
    expect(getComputedStyle(document.querySelector<HTMLElement>("[data-qa-overall-bar]")!).backgroundColor).toBe("rgb(245, 158, 11)");
    const aside = document.querySelector<HTMLElement>("[data-side-panel]")!;
    await expect.poll(() => aside.getBoundingClientRect().width).toBe(400);
    expect(document.querySelector('[data-panel-toggle="qa"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("opens the Hand off view on Internal review from Send for review", async () => {
    seed();
    await render(PreviewProjectPage);
    await expect.element(page.getByText("Evidence from thermal trials.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Send for review", exact: true }).click();
    await expect.element(page.getByRole("heading", { name: "Hand off", exact: true })).toBeVisible();
    expect(document.querySelector("[data-hand-off-stage]")?.textContent).toContain("Internal review");
    document.querySelector<HTMLButtonElement>("[data-hand-off-to]")!.click();
    await expect.poll(() => document.querySelectorAll("[data-command-item]").length).toBe(2);
    (document.querySelector("[data-command-item]") as HTMLElement).click();
    await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-hand-off-submit]")?.disabled).toBe(false);
    document.querySelector<HTMLButtonElement>("[data-hand-off-submit]")!.click();
    // On this branch the adapter uses the existing confirmed Internal review path.
    await expect.poll(() => __mutationCalls("workItems:create").length).toBe(1);
    expect(__mutationCalls("workItems:create")[0]).toMatchObject({
      projectId: "project-1",
      kind: "internal_review",
      assigneeId: "user-2",
      blocking: true,
      instructions: "",
      confirmedStageChange: "internal_review",
      expectedWorkflowVersion: 3,
    });
    expect(__mutationCalls("workItems:create")[0]).not.toHaveProperty("dueAt");
  });
});
